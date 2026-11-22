import type { DesignRenderRequest, DesignRenderResult } from "@openwork/types/desktop-ipc";
import type { DesignManifest, DesignPage } from "@openwork/types/designs";
import { designRender } from "@/app/lib/desktop";
import { blobToBase64, selfContainedPageHtml } from "./slides-inline";
import type { SlidesClient } from "./slides-model";

/**
 * Slide exports (docs/features/design-studio, "Slides editor"):
 *   PDF  desktop: Electron renders every page offline (`designRender`, printToPDF, exact size).
 *        web: a print document (one sandboxed iframe per page, `@page` at the slide size) and
 *        the browser's print dialog, where the person picks "Save as PDF".
 *   PNG  desktop: Electron `capturePage`. web: SVG `foreignObject` drawn on a canvas; scripts in
 *        the page do not run there and only inlined assets show (the export inlines them).
 *   PPTX the PNGs go to `POST /designs/:ws/:id/export`, which builds the file with titles and notes.
 * HTML belongs to the base (`exportDesignHtml`).
 */

export type DesignPptxRequest = { format: "pptx"; slides: Array<{ pageId: string; png: string }> };

export type SlidesExportClient = Pick<SlidesClient, "readDesignFile"> & {
  /** `POST /designs/:ws/:id/export` → the `.pptx` bytes. */
  exportDesignPptx(workspaceId: string, designId: string, input: DesignPptxRequest): Promise<Blob>;
};

export type DesignRenderer = (request: DesignRenderRequest) => Promise<DesignRenderResult>;

export type SlidesExportTarget = {
  workspaceId: string;
  design: DesignManifest;
  /** Pages to export, in this order. Default: every page of the design. */
  pageIds?: readonly string[];
};

export type SlidesExportDeps = {
  client: Pick<SlidesExportClient, "readDesignFile"> & Partial<Pick<SlidesExportClient, "exportDesignPptx">>;
  /** Offline renderer. Default: Electron's when running in the desktop app, else none (browser path). */
  render?: DesignRenderer | null;
  /** Browser-side PNG renderer (tests replace it). */
  renderInBrowser?: (page: RenderablePage) => Promise<Blob>;
  /** Browser-side print (tests replace it). */
  print?: (pages: readonly RenderablePage[]) => Promise<void>;
  save?: (blob: Blob, fileName: string) => void;
};

export type SlidesExportResult = { mode: "desktop" | "browser" | "print"; files: number };

export class SlidesExportError extends Error {
  constructor(readonly code: "no_pages" | "render_failed" | "render_timeout" | "pptx_unavailable" | "too_large", message: string) {
    super(message);
  }
}

/** Mirrors the server caps (apps/server/src/designs/export-routes.ts DESIGN_EXPORT_LIMITS). */
export const PPTX_UPLOAD_LIMITS = { pngBytes: 8 * 1024 * 1024, requestBytes: 160 * 1024 * 1024 } as const;

export type RenderablePage = { page: DesignPage; html: string; width: number; height: number };

export function desktopRenderer(): DesignRenderer | null {
  if (typeof window === "undefined" || !window.__OPENWORK_ELECTRON__?.invokeDesktop) return null;
  return designRender;
}

/** `<title>.<ext>` without characters file systems reject. */
export function exportFileName(title: string, extension: string, index?: { number: number; total: number }): string {
  const clean = title.replace(/[\u0000-\u001f<>:"/\\|?*]+/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, 80) || "presentacion";
  const suffix = index && index.total > 1 ? `-${String(index.number).padStart(String(index.total).length, "0")}` : "";
  return `${clean}${suffix}.${extension}`;
}

export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function selectedPages(design: DesignManifest, pageIds?: readonly string[]): DesignPage[] {
  if (!pageIds) return [...design.pages];
  const byId = new Map(design.pages.map(page => [page.id, page]));
  return pageIds.flatMap(id => byId.get(id) ?? []);
}

export async function renderablePages(target: SlidesExportTarget, client: Pick<SlidesClient, "readDesignFile">): Promise<RenderablePage[]> {
  const pages = selectedPages(target.design, target.pageIds);
  if (!pages.length) throw new SlidesExportError("no_pages", "No pages to export.");
  const read = (path: string) => client.readDesignFile(target.workspaceId, target.design.id, path);
  return Promise.all(pages.map(async page => ({
    page,
    width: page.width,
    height: page.height,
    html: await selfContainedPageHtml(await (await read(page.file)).text(), page.file, read),
  })));
}

function bytesBlob(bytes: Uint8Array, type: string): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type });
}

async function desktopFiles(render: DesignRenderer, format: "pdf" | "png", pages: readonly RenderablePage[]): Promise<Uint8Array[]> {
  const result = await render({ format, pages: pages.map(({ html, width, height }) => ({ html, width, height })) });
  if (!result.ok) throw new SlidesExportError(result.code === "render_timeout" ? "render_timeout" : "render_failed", result.message);
  return result.files;
}

async function pngBlobs(pages: readonly RenderablePage[], deps: SlidesExportDeps): Promise<{ blobs: Blob[]; mode: "desktop" | "browser" }> {
  const render = deps.render === undefined ? desktopRenderer() : deps.render;
  if (render) return { blobs: (await desktopFiles(render, "png", pages)).map(bytes => bytesBlob(bytes, "image/png")), mode: "desktop" };
  const renderInBrowser = deps.renderInBrowser ?? renderPngInBrowser;
  const blobs: Blob[] = [];
  for (const page of pages) blobs.push(await renderInBrowser(page));
  return { blobs, mode: "browser" };
}

export async function exportPdf(target: SlidesExportTarget, deps: SlidesExportDeps): Promise<SlidesExportResult> {
  const pages = await renderablePages(target, deps.client);
  const render = deps.render === undefined ? desktopRenderer() : deps.render;
  if (render) {
    const [pdf] = await desktopFiles(render, "pdf", pages);
    if (!pdf) throw new SlidesExportError("render_failed", "The renderer returned no file.");
    (deps.save ?? saveBlob)(bytesBlob(pdf, "application/pdf"), exportFileName(target.design.title, "pdf"));
    return { mode: "desktop", files: 1 };
  }
  await (deps.print ?? printPages)(pages);
  return { mode: "print", files: 0 };
}

export async function exportPng(target: SlidesExportTarget, deps: SlidesExportDeps): Promise<SlidesExportResult> {
  const pages = await renderablePages(target, deps.client);
  const { blobs, mode } = await pngBlobs(pages, deps);
  const save = deps.save ?? saveBlob;
  blobs.forEach((blob, index) => {
    const name = pages.length === 1 ? `${pages[index]?.page.title || target.design.title}` : target.design.title;
    save(blob, exportFileName(name, "png", { number: index + 1, total: blobs.length }));
  });
  return { mode, files: blobs.length };
}

export async function exportPptx(target: SlidesExportTarget, deps: SlidesExportDeps): Promise<SlidesExportResult> {
  const exportDesignPptx = deps.client.exportDesignPptx;
  if (!exportDesignPptx) throw new SlidesExportError("pptx_unavailable", "PowerPoint export is not available.");
  const pages = await renderablePages(target, deps.client);
  const { blobs, mode } = await pngBlobs(pages, deps);
  let total = 0;
  const slides = await Promise.all(blobs.map(async (blob, index) => {
    if (blob.size > PPTX_UPLOAD_LIMITS.pngBytes) throw new SlidesExportError("too_large", "A slide image is too large.");
    total += blob.size;
    return { pageId: pages[index]?.page.id ?? "", png: await blobToBase64(blob) };
  }));
  if (total * 4 / 3 > PPTX_UPLOAD_LIMITS.requestBytes) throw new SlidesExportError("too_large", "The presentation is too large.");
  const file = await exportDesignPptx(target.workspaceId, target.design.id, { format: "pptx", slides });
  (deps.save ?? saveBlob)(file, exportFileName(target.design.title, "pptx"));
  return { mode, files: 1 };
}

// ---- Browser paths ----

/**
 * The page as an SVG image: the document (scripts removed) serialized as XHTML inside a
 * `foreignObject`. Only self-contained documents render fully (assets must be data: URLs).
 */
export function foreignObjectSvg(html: string, width: number, height: number): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const node of Array.from(doc.querySelectorAll("script, meta[http-equiv], link, base, iframe, object, embed"))) node.remove();
  const xhtml = new XMLSerializer().serializeToString(doc.documentElement);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><foreignObject x="0" y="0" width="${width}" height="${height}">${xhtml}</foreignObject></svg>`;
}

export async function renderPngInBrowser(page: RenderablePage): Promise<Blob> {
  const svg = foreignObjectSvg(page.html, page.width, page.height);
  const image = new Image();
  image.width = page.width;
  image.height = page.height;
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = page.width;
  canvas.height = page.height;
  const context = canvas.getContext("2d");
  if (!context) throw new SlidesExportError("render_failed", "Canvas is not available.");
  context.drawImage(image, 0, 0, page.width, page.height);
  return new Promise((resolve, reject) => canvas.toBlob(blob => (blob ? resolve(blob) : reject(new SlidesExportError("render_failed", "The slide could not be drawn."))), "image/png"));
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The print document: one sandboxed (no scripts) iframe per page, one printed page each. */
export function printDocumentHtml(pages: readonly RenderablePage[], title: string): string {
  const first = pages[0];
  const size = first ? `${first.width}px ${first.height}px` : "auto";
  const frames = pages.map(page => `<iframe sandbox="" title="${escapeAttribute(page.page.title)}" style="width:${page.width}px;height:${page.height}px" srcdoc="${escapeAttribute(page.html)}"></iframe>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeAttribute(title)}</title><style>@page{size:${size};margin:0}html,body{margin:0;padding:0}iframe{display:block;border:0;break-after:page;page-break-after:always}iframe:last-child{break-after:auto;page-break-after:auto}@media screen{body{background:#fff}}</style></head><body>${frames}</body></html>`;
}

/** Opens the browser's print dialog for the pages (web fallback for PDF). */
export function printPages(pages: readonly RenderablePage[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    // The print document carries no script; same-origin lets this page call print() on it.
    frame.setAttribute("sandbox", "allow-same-origin allow-modals");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none";
    const cleanup = () => { setTimeout(() => frame.remove(), 1000); };
    frame.onload = () => {
      const view = frame.contentWindow;
      if (!view) { cleanup(); reject(new SlidesExportError("render_failed", "The print view could not open.")); return; }
      try {
        view.focus();
        view.print();
        resolve();
      } catch (error) {
        reject(new SlidesExportError("render_failed", error instanceof Error ? error.message : "print failed"));
      } finally {
        cleanup();
      }
    };
    frame.srcdoc = printDocumentHtml(pages, pages[0]?.page.title ?? "");
    document.body.appendChild(frame);
  });
}
