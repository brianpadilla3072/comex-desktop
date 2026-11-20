import { afterEach, beforeEach, expect, test } from "bun:test";
import { strFromU8, unzipSync } from "fflate";
import type { DesignManifest } from "@openwork/types/designs";
import { ApiError } from "../src/errors.js";
import { buildPptx, PPTX_CONTENT_TYPE, PPTX_SLIDE_HEIGHT_EMU, PPTX_SLIDE_WIDTH_EMU, PptxBuildError, readPngSize, xmlEscape } from "../src/designs/export-pptx.js";
import { DESIGN_EXPORT_LIMITS, handleDesignExport, pptxContentDisposition, registerDesignExportRoutes } from "../src/designs/export-routes.js";
import { matchRoute, type Route } from "../src/routes/registry.js";

/** A PNG header with the given size (enough for the builder, which never decodes pixels). */
function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.set([8, 6, 0, 0, 0], 24);
  return bytes;
}
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

const NOW = new Date("2026-01-02T03:04:05.000Z");

function manifest(overrides: Partial<DesignManifest> = {}): DesignManifest {
  return {
    format: "openwork.design", version: 1, id: "plan-ventas", kind: "slides", title: "Plan de ventas & metas",
    createdAt: 1, updatedAt: 2, systemId: null, thumbnail: null,
    pages: [
      { id: "p-1", title: "Portada", file: "pages/p-1.html", width: 1920, height: 1080, notes: "Saludo inicial.\nPresentar al equipo." },
      { id: "p-2", title: "Cifras <clave>", file: "pages/p-2.html", width: 1920, height: 1080 },
    ],
    ...overrides,
  };
}

test("buildPptx writes every required OOXML part with slides, pictures, titles and notes", () => {
  const bytes = buildPptx({ title: "Plan", createdAt: NOW, slides: [
    { title: "Portada", notes: "Línea uno\nLínea dos", png: png(1920, 1080) },
    { title: "A & B", notes: "", png: png(1000, 1000) },
  ] });
  const files = unzipSync(bytes);
  const names = Object.keys(files);
  expect(names[0]).toBe("[Content_Types].xml");
  for (const part of [
    "_rels/.rels", "docProps/core.xml", "docProps/app.xml", "ppt/presentation.xml", "ppt/_rels/presentation.xml.rels",
    "ppt/slideMasters/slideMaster1.xml", "ppt/slideMasters/_rels/slideMaster1.xml.rels", "ppt/slideLayouts/slideLayout1.xml",
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels", "ppt/notesMasters/notesMaster1.xml", "ppt/notesMasters/_rels/notesMaster1.xml.rels",
    "ppt/theme/theme1.xml", "ppt/theme/theme2.xml", "ppt/presProps.xml", "ppt/viewProps.xml", "ppt/tableStyles.xml",
    "ppt/slides/slide1.xml", "ppt/slides/slide2.xml", "ppt/slides/_rels/slide1.xml.rels", "ppt/slides/_rels/slide2.xml.rels",
    "ppt/notesSlides/notesSlide1.xml", "ppt/notesSlides/notesSlide2.xml", "ppt/notesSlides/_rels/notesSlide1.xml.rels",
    "ppt/media/image1.png", "ppt/media/image2.png",
  ]) expect(names).toContain(part);
  const text = (name: string) => strFromU8(files[name]);
  const types = text("[Content_Types].xml");
  for (const part of ["/ppt/slides/slide2.xml", "/ppt/notesSlides/notesSlide2.xml", "/ppt/notesMasters/notesMaster1.xml", "/ppt/presentation.xml"]) expect(types).toContain(`PartName="${part}"`);
  expect(types).toContain('Extension="png" ContentType="image/png"');
  const presentation = text("ppt/presentation.xml");
  expect(presentation).toContain(`<p:sldSz cx="${PPTX_SLIDE_WIDTH_EMU}" cy="${PPTX_SLIDE_HEIGHT_EMU}"/>`);
  expect(presentation.match(/<p:sldId /g)?.length).toBe(2);
  const presentationRels = text("ppt/_rels/presentation.xml.rels");
  expect(presentationRels).toContain('Id="rId10"');
  expect(presentationRels).toContain('Target="slides/slide2.xml"');
  expect(presentationRels).toContain("notesMasters/notesMaster1.xml");
  const slide1 = text("ppt/slides/slide1.xml");
  expect(slide1).toContain('<p:ph type="title"/>');
  expect(slide1).toContain("<a:t>Portada</a:t>");
  expect(slide1).toContain('<a:blip r:embed="rId2"/>');
  // 16:9 is full-bleed and the picture comes after (above) the title.
  expect(slide1).toContain(`<a:off x="0" y="0"/><a:ext cx="${PPTX_SLIDE_WIDTH_EMU}" cy="${PPTX_SLIDE_HEIGHT_EMU}"/>`);
  expect(slide1.indexOf("<p:pic>")).toBeGreaterThan(slide1.indexOf('type="title"'));
  // A square image is contained and centered.
  expect(text("ppt/slides/slide2.xml")).toContain(`<a:ext cx="${PPTX_SLIDE_HEIGHT_EMU}" cy="${PPTX_SLIDE_HEIGHT_EMU}"/>`);
  expect(text("ppt/slides/slide2.xml")).toContain("<a:t>A &amp; B</a:t>");
  const slideRels = text("ppt/slides/_rels/slide1.xml.rels");
  expect(slideRels).toContain("../media/image1.png");
  expect(slideRels).toContain("../notesSlides/notesSlide1.xml");
  const notes = text("ppt/notesSlides/notesSlide1.xml");
  expect(notes).toContain("<a:t>Línea uno</a:t>");
  expect(notes).toContain("<a:t>Línea dos</a:t>");
  expect(notes).toContain('<p:ph type="body" idx="1"/>');
  expect(text("ppt/notesSlides/_rels/notesSlide1.xml.rels")).toContain("../slides/slide1.xml");
  expect(text("docProps/core.xml")).toContain("2026-01-02T03:04:05Z");
  expect(Array.from(files["ppt/media/image1.png"])).toEqual(Array.from(png(1920, 1080)));
});

test("buildPptx rejects empty decks and non-PNG images", () => {
  expect(() => buildPptx({ title: "x", createdAt: NOW, slides: [] })).toThrow(PptxBuildError);
  expect(() => buildPptx({ title: "x", createdAt: NOW, slides: [{ title: "a", notes: "", png: new Uint8Array([1, 2, 3]) }] })).toThrow(PptxBuildError);
});

test("readPngSize and xmlEscape", () => {
  expect(readPngSize(png(1920, 1080))).toEqual({ width: 1920, height: 1080 });
  expect(readPngSize(new Uint8Array(40))).toBeNull();
  expect(xmlEscape(`a<b>&"c'\u0001`)).toBe("a&lt;b&gt;&amp;&quot;c&apos;");
});

test("pptxContentDisposition keeps a safe ASCII name and the UTF-8 name", () => {
  expect(pptxContentDisposition("Presentación: Q1/2026")).toBe(`attachment; filename="Presentacion- Q1-2026.pptx"; filename*=UTF-8''${encodeURIComponent("Presentación- Q1-2026.pptx")}`);
  expect(pptxContentDisposition("  ")).toContain('filename="presentacion.pptx"');
});

let previousFlag: string | undefined;
beforeEach(() => { previousFlag = process.env.DEN_FEATURE_DESIGN_STUDIO; process.env.DEN_FEATURE_DESIGN_STUDIO = "true"; });
afterEach(() => { if (previousFlag === undefined) delete process.env.DEN_FEATURE_DESIGN_STUDIO; else process.env.DEN_FEATURE_DESIGN_STUDIO = previousFlag; });

function setup(design: DesignManifest = manifest()) {
  const routes: Route[] = [];
  const loads: string[][] = [];
  const options = { now: () => NOW, loadDesign: async (ws: string, id: string) => {
    loads.push([ws, id]);
    if (ws !== "ws_1" || id !== design.id) throw new ApiError(404, "design_not_found", "No existe");
    return design;
  } };
  registerDesignExportRoutes({ routes, ...options });
  async function post(body: unknown, path = "/designs/ws_1/plan-ventas/export", headers: Record<string, string> = {}) {
    const route = matchRoute(routes, "POST", path);
    if (!route) throw new Error("route missing");
    const request = new Request(`http://localhost${path}`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
    return handleDesignExport(options, { workspaceId: route.params.ws, designId: route.params.id, request });
  }
  return { routes, loads, post };
}

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  try { await promise; } catch (error) { if (error instanceof ApiError) return error; throw error; }
  throw new Error("expected an ApiError");
}

test("export route answers a pptx in the requested order with titles and notes from design.json", async () => {
  const { routes, post } = setup();
  expect(matchRoute(routes, "POST", "/designs/ws_1/plan-ventas/export")?.auth).toBe("client");
  const response = await post({ format: "pptx", slides: [{ pageId: "p-2", png: base64(png(1920, 1080)) }, { pageId: "p-1", png: base64(png(1920, 1080)) }] });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe(PPTX_CONTENT_TYPE);
  expect(response.headers.get("content-disposition")).toContain("Plan de ventas & metas.pptx");
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  expect(strFromU8(files["ppt/slides/slide1.xml"])).toContain("<a:t>Cifras &lt;clave&gt;</a:t>");
  expect(strFromU8(files["ppt/notesSlides/notesSlide2.xml"])).toContain("<a:t>Presentar al equipo.</a:t>");
});

test("export route validates flag, body, pages, kind and sizes", async () => {
  const { post, loads } = setup();
  const ok = base64(png(1920, 1080));
  expect((await rejection(post({ format: "pdf", slides: [{ pageId: "p-1", png: ok }] }))).code).toBe("design_export_client_side");
  expect((await rejection(post({ format: "pptx", slides: [] }))).code).toBe("design_export_invalid");
  expect((await rejection(post({ format: "pptx", slides: [{ pageId: "../x", png: ok }] }))).code).toBe("design_export_invalid");
  expect((await rejection(post({ format: "pptx", slides: [{ pageId: "p-1", png: "no base64!" }] }))).code).toBe("design_export_invalid");
  expect((await rejection(post({ format: "pptx", extra: 1, slides: [{ pageId: "p-1", png: ok }] }))).code).toBe("design_export_invalid");
  expect((await rejection(post("{"))).code).toBe("invalid_json");
  expect((await rejection(post({ format: "pptx", slides: [{ pageId: "p-9", png: ok }] }))).code).toBe("design_export_unknown_page");
  expect((await rejection(post({ format: "pptx", slides: [{ pageId: "p-1", png: ok }, { pageId: "p-1", png: ok }] }))).code).toBe("design_export_invalid");
  expect((await rejection(post({ format: "pptx", slides: [{ pageId: "p-1", png: base64(new Uint8Array([1, 2, 3, 4])) }] }))).code).toBe("design_export_invalid_png");
  expect((await rejection(post({ format: "pptx", slides: [{ pageId: "p-1", png: ok }] }, "/designs/ws_2/plan-ventas/export"))).status).toBe(404);
  const tooLarge = await rejection(post({ format: "pptx", slides: [{ pageId: "p-1", png: ok }] }, undefined, { "content-length": String(DESIGN_EXPORT_LIMITS.requestBytes + 1) }));
  expect(tooLarge.status).toBe(413);
  process.env.DEN_FEATURE_DESIGN_STUDIO = "false";
  const before = loads.length;
  expect((await rejection(post({ format: "pptx", slides: [{ pageId: "p-1", png: ok }] }))).code).toBe("design_studio_disabled");
  expect(loads.length).toBe(before);
});

test("export route refuses designs that are not slides", async () => {
  const { post } = setup(manifest({ kind: "mockup" }));
  expect((await rejection(post({ format: "pptx", slides: [{ pageId: "p-1", png: base64(png(1920, 1080)) }] }))).code).toBe("design_export_not_slides");
});
