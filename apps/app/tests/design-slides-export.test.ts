import { afterAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const ownsDom = !GlobalRegistrator.isRegistered;
if (ownsDom) GlobalRegistrator.register({ url: "http://localhost/" });
afterAll(async () => { if (ownsDom) await GlobalRegistrator.unregister(); });

const { designManifestSchema } = await import("@openwork/types/designs");
const exporter = await import("../src/react-app/domains/design/editors/slides-export");
type DesignRenderRequest = import("@openwork/types/desktop-ipc").DesignRenderRequest;

const design = designManifestSchema.parse({
  format: "openwork.design", version: 1, id: "deck", kind: "slides", title: "Plan: Q1/2026", createdAt: 1, updatedAt: 2,
  pages: [
    { id: "a", title: "Portada", file: "pages/a.html", width: 1920, height: 1080 },
    { id: "b", title: "Cifras", file: "pages/b.html", width: 1920, height: 1080 },
  ],
});
const files: Record<string, string> = {
  "pages/a.html": '<html><head></head><body><img src="../assets/l.png"><h1>A</h1></body></html>',
  "pages/b.html": "<html><head></head><body><h1>B</h1></body></html>",
  "assets/l.png": "PNG",
};
const client = {
  readDesignFile: async (_ws: string, _id: string, path: string) => new Blob([files[path] ?? ""]),
};
const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function saver() {
  const saved: Array<{ name: string; type: string; size: number }> = [];
  return { saved, save: (blob: Blob, name: string) => { saved.push({ name, type: blob.type, size: blob.size }); } };
}

test("desktop PDF renders every page self-contained in one call and saves one file", async () => {
  const requests: DesignRenderRequest[] = [];
  const { saved, save } = saver();
  const result = await exporter.exportPdf({ workspaceId: "ws", design }, {
    client, save,
    render: async request => { requests.push(request); return { ok: true, files: [new Uint8Array([0x25, 0x50, 0x44, 0x46])] }; },
  });
  expect(result).toEqual({ mode: "desktop", files: 1 });
  expect(requests).toHaveLength(1);
  expect(requests[0]?.format).toBe("pdf");
  expect(requests[0]?.pages.map(page => [page.width, page.height])).toEqual([[1920, 1080], [1920, 1080]]);
  expect(requests[0]?.pages[0]?.html).toContain("data:image/png;base64,");
  expect(requests[0]?.pages[0]?.html).toContain("Content-Security-Policy");
  expect(saved).toEqual([{ name: "Plan Q1 2026.pdf", type: "application/pdf", size: 4 }]);
});

test("web PDF falls back to the print document", async () => {
  const printed: string[][] = [];
  const result = await exporter.exportPdf({ workspaceId: "ws", design, pageIds: ["b"] }, { client, render: null, print: async pages => { printed.push(pages.map(page => page.page.id)); } });
  expect(result).toEqual({ mode: "print", files: 0 });
  expect(printed).toEqual([["b"]]);
  const html = exporter.printDocumentHtml([{ page: design.pages[0]!, html: '<p a="1">&</p>', width: 1920, height: 1080 }], "T");
  expect(html).toContain("@page{size:1920px 1080px;margin:0}");
  expect(html).toContain('<iframe sandbox=""');
  expect(html).toContain('srcdoc="&lt;p a=&quot;1&quot;&gt;&amp;&lt;/p&gt;"');
});

test("PNG: desktop files per page, browser renderer when there is no desktop, errors surface with a code", async () => {
  const desktop = saver();
  expect(await exporter.exportPng({ workspaceId: "ws", design }, { client, save: desktop.save, render: async () => ({ ok: true, files: [pngBytes, pngBytes] }) })).toEqual({ mode: "desktop", files: 2 });
  expect(desktop.saved.map(item => item.name)).toEqual(["Plan Q1 2026-1.png", "Plan Q1 2026-2.png"]);
  const browser = saver();
  const rendered: string[] = [];
  expect(await exporter.exportPng({ workspaceId: "ws", design, pageIds: ["b"] }, {
    client, save: browser.save, render: null,
    renderInBrowser: async page => { rendered.push(page.page.id); return new Blob([pngBytes], { type: "image/png" }); },
  })).toEqual({ mode: "browser", files: 1 });
  expect(rendered).toEqual(["b"]);
  expect(browser.saved.map(item => item.name)).toEqual(["Cifras.png"]);
  await expect(exporter.exportPng({ workspaceId: "ws", design }, { client, render: async () => ({ ok: false, code: "render_timeout", message: "slow" }) }))
    .rejects.toMatchObject({ code: "render_timeout" });
  await expect(exporter.exportPng({ workspaceId: "ws", design, pageIds: ["zz"] }, { client, render: null })).rejects.toMatchObject({ code: "no_pages" });
});

test("PPTX sends the PNGs in order as base64 and saves the server file", async () => {
  const sent: unknown[] = [];
  const { saved, save } = saver();
  const result = await exporter.exportPptx({ workspaceId: "ws", design, pageIds: ["b", "a"] }, {
    save,
    render: async request => ({ ok: true, files: request.pages.map(() => pngBytes) }),
    client: { ...client, exportDesignPptx: async (ws, id, input) => { sent.push({ ws, id, input }); return new Blob(["pk"], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }); } },
  });
  expect(result).toEqual({ mode: "desktop", files: 1 });
  expect(sent).toEqual([{ ws: "ws", id: "deck", input: { format: "pptx", slides: [{ pageId: "b", png: "iVBORw==" }, { pageId: "a", png: "iVBORw==" }] } }]);
  expect(saved[0]?.name).toBe("Plan Q1 2026.pptx");
  await expect(exporter.exportPptx({ workspaceId: "ws", design }, { client, render: null })).rejects.toMatchObject({ code: "pptx_unavailable" });
});

test("foreignObjectSvg drops scripts and wraps XHTML at the page size", () => {
  const svg = exporter.foreignObjectSvg('<html><head><meta http-equiv="Content-Security-Policy" content="x"><style>h1{color:red}</style><script>alert(1)</script></head><body><h1>Hola<br></h1></body></html>', 1920, 1080);
  expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"')).toBe(true);
  expect(svg).toContain('<foreignObject x="0" y="0" width="1920" height="1080">');
  expect(svg).toContain("xmlns=\"http://www.w3.org/1999/xhtml\"");
  expect(svg).not.toContain("<script");
  expect(svg).not.toContain("Content-Security-Policy");
  expect(svg).toContain("h1{color:red}");
  expect(exporter.exportFileName("  ", "pdf")).toBe("presentacion.pdf");
  expect(exporter.exportFileName("Deck", "png", { number: 3, total: 12 })).toBe("Deck-03.png");
});
