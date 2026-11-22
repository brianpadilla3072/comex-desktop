import { DESIGN_LIMITS, pageIdSchema, type DesignManifest } from "@openwork/types/designs";
import { z } from "zod";
import { designStudioEnabled } from "../comex/features.js";
import { ApiError } from "../errors.js";
import { addRoute, type Route } from "../routes/registry.js";
import { buildPptx, PptxBuildError, PPTX_CONTENT_TYPE } from "./export-pptx.js";

/**
 * `POST /designs/:ws/:id/export` builds a PowerPoint file from slide images rendered by the app.
 *
 * Why the app sends images: PDF and PNG are produced where a browser engine exists (Electron's
 * own Chromium on desktop, the browser on web). The server has no renderer, so the PPTX gets
 * one PNG per slide, rendered by the same code that makes the PNG export.
 *
 * Body (JSON, no multipart): `{ format: "pptx", slides: [{ pageId, png }] }` where `png` is
 * base64 without a `data:` prefix and the slides go in the order they must appear. Titles and
 * speaker notes come from `design.json`, never from the request. Limits
 * (`DESIGN_EXPORT_LIMITS`): up to 200 slides, 8 MiB per decoded PNG, 160 MiB per request.
 * `pdf` and `png` are answered with 422 `design_export_client_side`: the app makes them.
 *
 * Answers the `.pptx` bytes (`attachment`). Nothing is written to disk, so the route is a
 * "client" route (the web UI holds the collaborator token).
 */

export const DESIGN_EXPORT_LIMITS = {
  slides: DESIGN_LIMITS.pages,
  pngBytes: 8 * 1024 * 1024,
  requestBytes: 160 * 1024 * 1024,
} as const;

const BASE64_MAX_CHARS = Math.ceil(DESIGN_EXPORT_LIMITS.pngBytes / 3) * 4;

export const designExportRequestSchema = z.strictObject({
  format: z.enum(["pptx", "pdf", "png"]),
  slides: z.array(z.strictObject({
    pageId: pageIdSchema,
    png: z.string().min(1).max(BASE64_MAX_CHARS).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  })).min(1).max(DESIGN_EXPORT_LIMITS.slides),
});
export type DesignExportRequest = z.infer<typeof designExportRequestSchema>;

export type DesignExportRouteOptions = {
  routes: Route[];
  /** Resolves the workspace and reads `design.json` (404/422 ApiErrors for unknown ids). */
  loadDesign(workspaceId: string, designId: string): Promise<DesignManifest>;
  now?: () => Date;
};

async function readBoundedJson(request: Request, limit: number): Promise<unknown> {
  const tooLarge = () => new ApiError(413, "design_export_too_large", "La exportación supera el tamaño permitido.");
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw tooLarge();
  if (!request.body) throw new ApiError(400, "invalid_json", "Falta el cuerpo de la solicitud.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return parsed;
  } catch {
    throw new ApiError(400, "invalid_json", "El cuerpo no es JSON válido.");
  }
}

/** `attachment` header with an ASCII fallback and the UTF-8 name. */
export function pptxContentDisposition(title: string): string {
  const base = title.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "-").replace(/\s+/g, " ").trim().slice(0, 100) || "presentacion";
  const ascii = base.normalize("NFKD").replace(/[^\x20-\x7e]/g, "").replace(/["\\]/g, "").trim() || "presentacion";
  return `attachment; filename="${ascii}.pptx"; filename*=UTF-8''${encodeURIComponent(`${base}.pptx`)}`;
}

/** The route body, callable without a full request context (tests, other hosts). */
export async function handleDesignExport(options: Omit<DesignExportRouteOptions, "routes">, input: { workspaceId: string; designId: string; request: Request }): Promise<Response> {
  const { loadDesign } = options;
  const now = options.now ?? (() => new Date());
  if (!designStudioEnabled()) throw new ApiError(404, "design_studio_disabled", "El estudio de diseño está desactivado.");
  const parsed = designExportRequestSchema.safeParse(await readBoundedJson(input.request, DESIGN_EXPORT_LIMITS.requestBytes));
  if (!parsed.success) throw new ApiError(422, "design_export_invalid", "Revisa las diapositivas que quieres exportar.");
  if (parsed.data.format !== "pptx") throw new ApiError(422, "design_export_client_side", "El PDF y el PNG se generan en la app.");
  const design = await loadDesign(input.workspaceId, input.designId);
  if (design.kind !== "slides") throw new ApiError(422, "design_export_not_slides", "Solo las presentaciones se exportan a PowerPoint.");
  const pages = new Map(design.pages.map(page => [page.id, page]));
  const seen = new Set<string>();
  const slides = parsed.data.slides.map(slide => {
    const page = pages.get(slide.pageId);
    if (!page) throw new ApiError(422, "design_export_unknown_page", "Una de las diapositivas ya no existe; actualiza y vuelve a exportar.");
    if (seen.has(slide.pageId)) throw new ApiError(422, "design_export_invalid", "Una diapositiva aparece dos veces.");
    seen.add(slide.pageId);
    const png = new Uint8Array(Buffer.from(slide.png, "base64"));
    if (png.byteLength > DESIGN_EXPORT_LIMITS.pngBytes) throw new ApiError(413, "design_export_too_large", "Una diapositiva supera el tamaño permitido.");
    return { title: page.title, notes: page.notes ?? "", png };
  });
  let bytes: Uint8Array;
  try {
    bytes = buildPptx({ title: design.title, slides, createdAt: now() });
  } catch (error) {
    if (error instanceof PptxBuildError) throw new ApiError(422, `design_export_${error.code}`, error.message);
    throw error;
  }
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": PPTX_CONTENT_TYPE,
      "content-disposition": pptxContentDisposition(design.title),
      "content-length": String(bytes.byteLength),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export function registerDesignExportRoutes(options: DesignExportRouteOptions): void {
  addRoute(options.routes, "POST", "/designs/:ws/:id/export", "client", async ctx =>
    handleDesignExport(options, { workspaceId: ctx.params.ws, designId: ctx.params.id, request: ctx.request }));
}
