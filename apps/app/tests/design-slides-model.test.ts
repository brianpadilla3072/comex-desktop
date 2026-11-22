import { expect, test } from "bun:test";
import { designManifestSchema, type DesignManifest } from "@openwork/types/designs";
import {
  addedPageId, askAgentContext, assetPathForUpload, elementSnippet, fitScale, imageSnippet, insertIntoBody, manifestWithNotes,
  movePageId, orderPages, presentKey, presentStep, resolveZoom, selectionAfterDelete, slideTemplateHtml, SLIDE_TEMPLATES, stepZoom,
} from "../src/react-app/domains/design/editors/slides-model";
import { mimeForPath, resolveDesignReference, selfContainedPageHtml, withExportCsp } from "../src/react-app/domains/design/editors/slides-inline";

const page = (id: string, extra: Partial<DesignManifest["pages"][number]> = {}) => ({ id, title: `Título ${id}`, file: `pages/${id}.html`, width: 1920, height: 1080, ...extra });
function manifest(): DesignManifest {
  return designManifestSchema.parse({ format: "openwork.design", version: 1, id: "deck", kind: "slides", title: "Deck", createdAt: 1, updatedAt: 5, pages: [page("a", { notes: "uno" }), page("b"), page("c")] });
}

test("movePageId, orderPages, selectionAfterDelete and addedPageId", () => {
  expect(movePageId(["a", "b", "c"], "a", 2)).toEqual(["b", "c", "a"]);
  expect(movePageId(["a", "b", "c"], "c", 0)).toEqual(["c", "a", "b"]);
  expect(movePageId(["a", "b", "c"], "b", 99)).toEqual(["a", "c", "b"]);
  expect(movePageId(["a", "b"], "z", 0)).toEqual(["a", "b"]);
  const pages = manifest().pages;
  expect(orderPages(pages, ["c", "a", "gone"]).map(item => item.id)).toEqual(["c", "a", "b"]);
  expect(orderPages(pages, null).map(item => item.id)).toEqual(["a", "b", "c"]);
  expect(selectionAfterDelete(["a", "b", "c"], "b")).toBe("c");
  expect(selectionAfterDelete(["a", "b", "c"], "c")).toBe("b");
  expect(selectionAfterDelete(["a"], "a")).toBeNull();
  expect(addedPageId(pages.slice(0, 2), pages)).toBe("c");
});

test("zoom: fit, steps and explicit values", () => {
  expect(fitScale({ width: 1024, height: 2000 }, { width: 1920, height: 1080 }, 32)).toBeCloseTo(960 / 1920);
  expect(resolveZoom(1.5, { width: 10, height: 10 })).toBe(1.5);
  expect(stepZoom(0.5, 1)).toBe(0.75);
  expect(stepZoom(0.6, -1)).toBe(0.5);
  expect(stepZoom(2, 1)).toBe(2);
  expect(stepZoom(0.25, -1)).toBe(0.25);
});

test("presentation keys and steps", () => {
  expect(presentKey("ArrowRight")).toBe("next");
  expect(presentKey(" ")).toBe("next");
  expect(presentKey("PageUp")).toBe("previous");
  expect(presentKey("Escape")).toBe("exit");
  expect(presentKey("x")).toBeNull();
  expect(presentStep(0, 3, "next")).toBe(1);
  expect(presentStep(2, 3, "next")).toBe(2);
  expect(presentStep(0, 3, "previous")).toBe(0);
  expect(presentStep(1, 3, "last")).toBe(2);
  expect(presentStep(1, 3, "exit")).toBeNull();
});

test("manifestWithNotes keeps the schema, sets or clears notes and refuses unknown pages", () => {
  const text = JSON.stringify(manifest());
  const updated = designManifestSchema.parse(JSON.parse(manifestWithNotes(text, "b", "Hablar de cifras", 99)));
  expect(updated.pages[1]?.notes).toBe("Hablar de cifras");
  expect(updated.pages[0]?.notes).toBe("uno");
  expect(updated.updatedAt).toBe(99);
  const cleared = designManifestSchema.parse(JSON.parse(manifestWithNotes(text, "a", "", 1)));
  expect("notes" in (cleared.pages[0] ?? {})).toBe(false);
  expect(cleared.updatedAt).toBe(5);
  expect(() => manifestWithNotes(text, "zz", "x")).toThrow();
  expect(() => manifestWithNotes("{}", "a", "x")).toThrow();
});

test("snippets go before </body> and escape their text", () => {
  expect(insertIntoBody("<html><body><p>x</p></BODY></html>", "<i>n</i>")).toBe("<html><body><p>x</p><i>n</i>\n</BODY></html>");
  expect(insertIntoBody("<p>x</p>", "<i>n</i>")).toBe("<p>x</p>\n<i>n</i>\n");
  expect(elementSnippet("text", { text: "<b>Hola</b>", cell: () => "" })).toContain("&lt;b&gt;Hola&lt;/b&gt;");
  const table = elementSnippet("table", { text: "", cell: (row, column) => (row === 0 ? `C${column + 1}` : "") });
  expect(table.match(/<th /g)?.length).toBe(3);
  expect(table.match(/<td /g)?.length).toBe(6);
  for (const kind of ["rect", "ellipse", "line"] as const) expect(elementSnippet(kind, { text: "", cell: () => "" })).toContain('data-ow-element="shape"');
  expect(imageSnippet("assets/logo-1.png", 'a"b')).toContain('src="../assets/logo-1.png" alt="a&quot;b"');
});

test("assetPathForUpload accepts images within the limit only", () => {
  expect(assetPathForUpload({ name: "Logo Empresa.PNG", type: "image/png", size: 10 }, "ab12")).toBe("assets/logo-empresa-ab12.png");
  expect(assetPathForUpload({ name: "../../x.svg", type: "image/svg+xml", size: 10 }, "z")).toBe("assets/x-z.svg");
  expect(assetPathForUpload({ name: "doc.pdf", type: "application/pdf", size: 10 }, "z")).toBeNull();
  expect(assetPathForUpload({ name: "big.png", type: "image/png", size: 21 * 1024 * 1024 }, "z")).toBeNull();
});

test("templates are complete 1920x1080 documents with escaped text", () => {
  for (const template of SLIDE_TEMPLATES) {
    const html = slideTemplateHtml(template, { title: "A & B", subtitle: "s", body: "b", left: "l", right: "r" });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("width:1920px;height:1080px");
    expect(html).toContain('href="../styles.css"');
    if (template !== "blank") expect(html).toContain("A &amp; B");
  }
  expect(JSON.parse(askAgentContext(manifest(), "b"))).toEqual({ designId: "deck", kind: "slides", insertAfter: { id: "b", title: "Título b", position: 2 }, pages: 3 });
});

test("resolveDesignReference stays inside the design folder", () => {
  expect(resolveDesignReference("pages/p-1.html", "../assets/logo.png")).toBe("assets/logo.png");
  expect(resolveDesignReference("pages/p-1.html", "../styles.css?v=2")).toBe("styles.css");
  expect(resolveDesignReference("styles.css", "assets/f%20a.woff2")).toBe("assets/f a.woff2");
  expect(resolveDesignReference("pages/p-1.html", "../../secret.txt")).toBeNull();
  expect(resolveDesignReference("pages/p-1.html", "https://example.com/a.png")).toBeNull();
  expect(resolveDesignReference("pages/p-1.html", "data:image/png;base64,AA")).toBeNull();
  expect(resolveDesignReference("pages/p-1.html", "/etc/passwd")).toBeNull();
  expect(resolveDesignReference("pages/p-1.html", "../.hidden/x.png")).toBeNull();
  expect(mimeForPath("assets/a.SVG")).toBe("image/svg+xml");
});

test("selfContainedPageHtml inlines the stylesheet, its urls, images and adds the CSP", async () => {
  const files: Record<string, Blob> = {
    "styles.css": new Blob(["body{background:url('assets/bg.png')}"], { type: "text/css" }),
    "assets/bg.png": new Blob([new Uint8Array([1, 2, 3])]),
    "assets/logo.svg": new Blob(["<svg/>"]),
  };
  const reads: string[] = [];
  const read = async (path: string) => { reads.push(path); const blob = files[path]; if (!blob) throw new Error("missing"); return blob; };
  const html = `<!doctype html><html><head><link rel="stylesheet" href="../styles.css"></head><body>
<img src="../assets/logo.svg"><img src='../assets/logo.svg'><img src="https://example.com/x.png"><img src="../assets/missing.png">
<a href="../pages/p-2.html">next</a><div style="background-image:url(../assets/bg.png)"></div></body></html>`;
  const out = await selfContainedPageHtml(html, "pages/p-1.html", read);
  expect(out).toContain('<meta http-equiv="Content-Security-Policy"');
  expect(out).toContain('<style data-ow-inlined="styles.css">body{background:url("data:image/png;base64,AQID")}</style>');
  expect(out.match(/src="data:image\/svg\+xml;base64,PHN2Zy8\+"/g)?.length).toBe(1);
  expect(out).toContain("src='data:image/svg+xml;base64,PHN2Zy8+'");
  expect(out).toContain('src="https://example.com/x.png"');
  expect(out).toContain('src="../assets/missing.png"');
  expect(out).toContain('href="../pages/p-2.html"');
  expect(out).toContain('url("data:image/png;base64,AQID")');
  expect(reads.filter(path => path === "assets/logo.svg").length).toBe(1);
  expect(withExportCsp("<p>x</p>")).toContain("<body><p>x</p></body>");
});
