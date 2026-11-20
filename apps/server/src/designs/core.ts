import {
  DESIGN_LIMITS, DESIGN_PAGE_SIZES, designRelativePathSchema,
  type DesignKind, type DesignManifest, type DesignPage, type DesignSummary,
} from "@openwork/types/designs";

/**
 * Pure rules of the design studio (no I/O). Another implementation must match them:
 * contracts/designs/v1/vectors.json runs every function here.
 */

const MAX_SLUG = 48;

/** A readable, path-free id from the title ("Plan de lanzamiento" → "plan-de-lanzamiento"). */
export function slugFromTitle(title: string): string {
  const slug = title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, MAX_SLUG).replace(/-+$/g, "");
  return slug || "diseno";
}

/** The first free id for a new design: the slug, then `slug-2`, `slug-3`… */
export function designIdFor(title: string, taken: ReadonlySet<string>): string {
  const base = slugFromTitle(title);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** The next page id: `p-<n>` one above the highest numbered page. */
export function nextPageId(pages: readonly Pick<DesignPage, "id">[]): string {
  let highest = 0;
  for (const page of pages) {
    const match = /^p-(\d{1,9})$/.exec(page.id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `p-${highest + 1}`;
}

export type DesignPathResult = { ok: true; path: string; role: "manifest" | "page" | "board" | "tokens" | "thumbnail" | "asset" } | { ok: false; code: "design_path_invalid" };

/** Classify a path inside a design folder; refuses absolute paths, `..`, empty and hidden segments. */
export function checkDesignPath(input: string): DesignPathResult {
  const parsed = designRelativePathSchema.safeParse(input);
  if (!parsed.success || /[\u0000-\u001f\u007f:]/.test(input)) return { ok: false, code: "design_path_invalid" };
  const path = parsed.data;
  if (path === "design.json") return { ok: true, path, role: "manifest" };
  if (path === "board.json") return { ok: true, path, role: "board" };
  if (path === "tokens.json") return { ok: true, path, role: "tokens" };
  if (path === "thumbnail.png") return { ok: true, path, role: "thumbnail" };
  if (/^pages\/[^/]+\.html?$/i.test(path)) return { ok: true, path, role: "page" };
  return { ok: true, path, role: "asset" };
}

/** The most bytes one file of this role may hold. */
export function fileByteLimit(role: Exclude<DesignPathResult, { ok: false }>["role"]): number {
  return role === "page" || role === "manifest" || role === "board" || role === "tokens" ? DESIGN_LIMITS.pageBytes : DESIGN_LIMITS.assetBytes;
}

const CONTENT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg",
  jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", ico: "image/x-icon",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8", csv: "text/csv; charset=utf-8",
};

export function contentTypeFor(path: string): string {
  const extension = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? "";
  return CONTENT_TYPES[extension] ?? "application/octet-stream";
}

/**
 * Every design file is served with this policy: a page may only use inline styles and images or
 * fonts embedded in itself (the app turns relative assets into blob/data URLs). No script, no
 * network, no frames.
 */
export const DESIGN_CONTENT_SECURITY_POLICY = "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:";

/** The page ids in a new order: the same set, each once. */
export function reorderPages(pages: readonly DesignPage[], pageIds: readonly string[]): DesignPage[] | null {
  if (pageIds.length !== pages.length || new Set(pageIds).size !== pageIds.length) return null;
  const byId = new Map(pages.map(page => [page.id, page]));
  const next: DesignPage[] = [];
  for (const id of pageIds) {
    const page = byId.get(id);
    if (!page) return null;
    next.push(page);
  }
  return next;
}

/** Insert a page after `afterPageId` (or at the end when absent or unknown). */
export function insertPage(pages: readonly DesignPage[], page: DesignPage, afterPageId: string | null | undefined): DesignPage[] {
  const index = afterPageId ? pages.findIndex(entry => entry.id === afterPageId) : -1;
  if (index < 0) return [...pages, page];
  return [...pages.slice(0, index + 1), page, ...pages.slice(index + 1)];
}

/** A strictly increasing modification time, even when two writes land in the same millisecond. */
export const bumpedTime = (previous: number, now: number) => Math.max(now, previous + 1);

export function pageSize(kind: DesignKind): { width: number; height: number } {
  return { ...DESIGN_PAGE_SIZES[kind] };
}

export function summaryOf(manifest: DesignManifest, workspaceId: string, projectName: string): DesignSummary {
  return {
    workspaceId, projectName, id: manifest.id, kind: manifest.kind, title: manifest.title,
    pages: manifest.pages.length, updatedAt: manifest.updatedAt, createdAt: manifest.createdAt,
    hasThumbnail: manifest.thumbnail !== null,
  };
}

/** Newest first, then by title. */
export function compareSummaries(left: DesignSummary, right: DesignSummary): number {
  return right.updatedAt - left.updatedAt || left.title.localeCompare(right.title, "es");
}

/** The first bytes of every PNG file. */
export function isPng(bytes: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
}
