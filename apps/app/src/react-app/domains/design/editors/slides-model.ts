import { DESIGN_LIMITS, DESIGN_PAGE_SIZES, designManifestSchema, type DesignManifest, type DesignPage } from "@openwork/types/designs";

/**
 * Pure helpers of the slides editor (docs/features/design-studio, "Slides editor"): the
 * client surface it needs, element snippets, page templates, order moves, zoom and the
 * presentation cursor. No React, no I/O.
 */

/** The part of the OpenWork server client the slides editor uses (A's client satisfies it). */
export type SlidesClient = {
  readDesignFile(workspaceId: string, designId: string, path: string): Promise<Blob>;
  writeDesignFile(workspaceId: string, designId: string, path: string, body: Blob | string): Promise<unknown>;
  /** The server client returns the updated manifest itself. */
  addDesignPage(workspaceId: string, designId: string, input: { title?: string; afterPageId?: string; html?: string }): Promise<DesignManifest>;
  reorderDesignPages(workspaceId: string, designId: string, pageIds: string[]): Promise<unknown>;
  deleteDesignPage(workspaceId: string, designId: string, pageId: string): Promise<unknown>;
};

export const SLIDE_SIZE = DESIGN_PAGE_SIZES.slides;

// ---- Order ----

/** Moves one id to `toIndex` (clamped). Returns the same array when nothing changes. */
export function movePageId(ids: readonly string[], pageId: string, toIndex: number): string[] {
  const from = ids.indexOf(pageId);
  if (from < 0) return [...ids];
  const target = Math.max(0, Math.min(ids.length - 1, toIndex));
  if (target === from) return [...ids];
  const next = ids.filter(id => id !== pageId);
  next.splice(target, 0, pageId);
  return next;
}

/** Applies a local order to the manifest pages (unknown ids dropped, missing pages appended). */
export function orderPages(pages: readonly DesignPage[], ids: readonly string[] | null): DesignPage[] {
  if (!ids) return [...pages];
  const byId = new Map(pages.map(page => [page.id, page]));
  const ordered = ids.flatMap(id => byId.get(id) ?? []);
  const seen = new Set(ordered.map(page => page.id));
  return [...ordered, ...pages.filter(page => !seen.has(page.id))];
}

/** After deleting `pageId`, the page to select: the next one, else the previous one. */
export function selectionAfterDelete(ids: readonly string[], pageId: string): string | null {
  const index = ids.indexOf(pageId);
  const rest = ids.filter(id => id !== pageId);
  if (!rest.length) return null;
  return rest[Math.min(Math.max(index, 0), rest.length - 1)] ?? null;
}

/** The id that appears in `next` and not in `previous` (the page the server just added). */
export function addedPageId(previous: readonly DesignPage[], next: readonly DesignPage[]): string | null {
  const known = new Set(previous.map(page => page.id));
  return next.find(page => !known.has(page.id))?.id ?? null;
}

// ---- Zoom ----

export const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const;
export type SlideZoom = "fit" | number;

/** Scale that fits a slide in the available box (keeps a small margin). */
export function fitScale(box: { width: number; height: number }, size: { width: number; height: number } = SLIDE_SIZE, margin = 32): number {
  const width = Math.max(1, box.width - margin * 2);
  const height = Math.max(1, box.height - margin * 2);
  const scale = Math.min(width / size.width, height / size.height);
  return Math.max(0.05, Math.min(4, Number.isFinite(scale) ? scale : 0.5));
}

export function resolveZoom(zoom: SlideZoom, box: { width: number; height: number }, size: { width: number; height: number } = SLIDE_SIZE): number {
  return zoom === "fit" ? fitScale(box, size) : zoom;
}

export function stepZoom(current: number, direction: 1 | -1): number {
  if (direction > 0) return ZOOM_STEPS.find(step => step > current + 0.001) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
  return [...ZOOM_STEPS].reverse().find(step => step < current - 0.001) ?? ZOOM_STEPS[0];
}

// ---- Presentation ----

export type PresentKey = "next" | "previous" | "first" | "last" | "exit" | null;

export function presentKey(key: string): PresentKey {
  if (["ArrowRight", "ArrowDown", "PageDown", " ", "Spacebar", "Enter", "n"].includes(key)) return "next";
  if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace", "p"].includes(key)) return "previous";
  if (key === "Home") return "first";
  if (key === "End") return "last";
  if (key === "Escape") return "exit";
  return null;
}

/** New index after a presentation command; null means leave presentation mode. */
export function presentStep(index: number, count: number, command: Exclude<PresentKey, null>): number | null {
  if (command === "exit") return null;
  if (count <= 0) return null;
  if (command === "first") return 0;
  if (command === "last") return count - 1;
  if (command === "next") return Math.min(count - 1, index + 1);
  return Math.max(0, index - 1);
}

// ---- Notes (design.json) ----

/**
 * Returns the `design.json` text with new speaker notes for one page, based on the latest
 * manifest on disk (the agent may have changed it meanwhile). Throws when the page is gone.
 */
export function manifestWithNotes(manifestText: string, pageId: string, notes: string, now = Date.now()): string {
  const manifest = designManifestSchema.parse(JSON.parse(manifestText));
  if (!manifest.pages.some(page => page.id === pageId)) throw new Error("page_not_found");
  const trimmed = notes.slice(0, 10_000);
  const pages = manifest.pages.map(page => {
    if (page.id !== pageId) return page;
    const { notes: _previous, ...rest } = page;
    return trimmed ? { ...rest, notes: trimmed } : rest;
  });
  return `${JSON.stringify(designManifestSchema.parse({ ...manifest, pages, updatedAt: Math.max(now, manifest.updatedAt) }), null, 2)}\n`;
}

// ---- Page documents ----

/** Inserts markup right before `</body>` (or at the end when the document has none). */
export function insertIntoBody(html: string, snippet: string): string {
  const match = /<\/body\s*>/i.exec(html);
  if (!match) return `${html}\n${snippet}\n`;
  return `${html.slice(0, match.index)}${snippet}\n${html.slice(match.index)}`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export type SlideElementKind = "text" | "table" | "rect" | "ellipse" | "line";

/**
 * Small, absolutely positioned blocks dropped near the slide center. Neutral colors and the
 * system font so they look right on any template; the agent or the person restyles them later.
 * `data-ow-element` marks them so comment/edit tools can find them.
 */
export function elementSnippet(kind: SlideElementKind, labels: { text: string; cell: (row: number, column: number) => string }): string {
  const base = "position:absolute;box-sizing:border-box;";
  switch (kind) {
    case "text":
      return `<div data-ow-element="text" style="${base}left:560px;top:460px;width:800px;font:500 56px/1.2 system-ui,-apple-system,'Segoe UI',sans-serif;color:#1f2933;text-align:center">${escapeHtml(labels.text)}</div>`;
    case "table": {
      const rows = [0, 1, 2].map(row => `<tr>${[0, 1, 2].map(column => {
        const tag = row === 0 ? "th" : "td";
        const weight = row === 0 ? "font-weight:600;background:#eef1f4;" : "";
        return `<${tag} style="${weight}border:1px solid #c9d1d9;padding:16px 20px;text-align:left">${escapeHtml(labels.cell(row, column))}</${tag}>`;
      }).join("")}</tr>`).join("");
      return `<table data-ow-element="table" style="${base}left:360px;top:340px;width:1200px;border-collapse:collapse;font:400 32px/1.3 system-ui,-apple-system,'Segoe UI',sans-serif;color:#1f2933">${rows}</table>`;
    }
    case "rect":
      return `<div data-ow-element="shape" data-shape="rect" style="${base}left:760px;top:390px;width:400px;height:300px;background:#d6e4f0;border:4px solid #2f6fb3;border-radius:12px"></div>`;
    case "ellipse":
      return `<div data-ow-element="shape" data-shape="ellipse" style="${base}left:810px;top:390px;width:300px;height:300px;background:#f3e3cf;border:4px solid #d9822b;border-radius:50%"></div>`;
    case "line":
      return `<svg data-ow-element="shape" data-shape="line" style="${base}left:660px;top:520px;overflow:visible" width="600" height="40" viewBox="0 0 600 40" aria-hidden="true"><line x1="0" y1="20" x2="560" y2="20" stroke="#1f2933" stroke-width="6" stroke-linecap="round"/><path d="M548 4 L590 20 L548 36 Z" fill="#1f2933"/></svg>`;
  }
}

export function imageSnippet(assetPath: string, alt: string): string {
  return `<img data-ow-element="image" src="../${escapeHtml(assetPath)}" alt="${escapeHtml(alt)}" style="position:absolute;left:560px;top:240px;width:800px;height:600px;object-fit:contain">`;
}

const IMAGE_EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg" };
export const SLIDE_IMAGE_ACCEPT = Object.keys(IMAGE_EXTENSIONS).join(",");

/** `assets/<slug>-<suffix>.<ext>` for an uploaded image, or null when the type or size is not allowed. */
export function assetPathForUpload(file: { name: string; type: string; size: number }, suffix: string): string | null {
  const extension = IMAGE_EXTENSIONS[file.type];
  if (!extension || file.size <= 0 || file.size > DESIGN_LIMITS.assetBytes) return null;
  const stem = file.name.replace(/\.[^.]*$/, "").normalize("NFKD").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 48) || "imagen";
  const safeSuffix = suffix.replace(/[^a-z0-9]/g, "").slice(0, 12) || "1";
  return `assets/${stem}-${safeSuffix}.${extension}`;
}

// ---- Templates for new slides ----

export type SlideTemplate = "blank" | "title" | "title-content" | "two-columns";
export const SLIDE_TEMPLATES: readonly SlideTemplate[] = ["blank", "title", "title-content", "two-columns"];

/** A self-contained 1920x1080 page document; the shared `../styles.css` applies when present. */
export function slideTemplateHtml(template: SlideTemplate, text: { title: string; subtitle: string; body: string; left: string; right: string }): string {
  const heading = (value: string, size: number) => `<h1 style="margin:0;font:700 ${size}px/1.1 system-ui,-apple-system,'Segoe UI',sans-serif;letter-spacing:-0.01em">${escapeHtml(value)}</h1>`;
  const paragraph = (value: string) => `<p style="margin:0;font:400 40px/1.4 system-ui,-apple-system,'Segoe UI',sans-serif">${escapeHtml(value)}</p>`;
  let body = "";
  if (template === "title") {
    body = `<main style="height:100%;display:flex;flex-direction:column;justify-content:center;gap:32px;padding:0 160px">${heading(text.title, 120)}${paragraph(text.subtitle)}</main>`;
  } else if (template === "title-content") {
    body = `<main style="height:100%;display:flex;flex-direction:column;gap:56px;padding:120px 160px">${heading(text.title, 80)}${paragraph(text.body)}</main>`;
  } else if (template === "two-columns") {
    body = `<main style="height:100%;display:flex;flex-direction:column;gap:56px;padding:120px 160px">${heading(text.title, 80)}<div style="display:grid;grid-template-columns:1fr 1fr;gap:80px">${paragraph(text.left)}${paragraph(text.right)}</div></main>`;
  }
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${SLIDE_SIZE.width}, height=${SLIDE_SIZE.height}">
<link rel="stylesheet" href="../styles.css">
<style>html,body{margin:0;width:${SLIDE_SIZE.width}px;height:${SLIDE_SIZE.height}px;overflow:hidden;background:#ffffff;color:#1f2933;position:relative}</style>
</head>
<body>
${body}
</body>
</html>
`;
}

/** Context handed to the agent when the person asks it for a new slide. */
export function askAgentContext(design: DesignManifest, afterPageId: string | null): string {
  const index = afterPageId ? design.pages.findIndex(page => page.id === afterPageId) : -1;
  const after = index >= 0 ? design.pages[index] : null;
  return JSON.stringify({ designId: design.id, kind: design.kind, insertAfter: after ? { id: after.id, title: after.title, position: index + 1 } : null, pages: design.pages.length });
}
