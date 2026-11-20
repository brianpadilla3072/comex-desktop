import { basename } from "node:path";
import { z } from "zod";
import { DESIGN_LIMITS, designIdSchema, designKindSchema, pageIdSchema, type DesignSummary } from "@openwork/types/designs";
import { designStudioEnabled, specialistApplicationsEnabled } from "../comex/features.js";
import { ApiError } from "../errors.js";
import { addRoute, type RequestContext, type Route } from "../routes/registry.js";
import { specialistStore } from "../specialists/store.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { DESIGN_CONTENT_SECURITY_POLICY, compareSummaries, contentTypeFor, fileByteLimit, checkDesignPath, summaryOf } from "./core.js";
import { designHtmlArchive } from "./html-archive.js";
import {
  addPage, bindDesignChat, createDesign, deleteDesign, deleteDesignPage, designChats, listDesigns, readDesignFile,
  readManifest, reorderDesignPages, updateManifest, writeDesignFile,
} from "./store.js";

/**
 * Design studio API (feature designStudio, docs/features/design-studio). Reads are "client",
 * writes are "host" (owner or paired device). A design belongs to a project of a specialist
 * application, resolved like the Projects API does (a live workspace bound to an application).
 */

const projectName = (workspace: WorkspaceInfo) => workspace.displayName?.trim() || workspace.name?.trim() || basename(workspace.path) || workspace.path;
const writableFor = (ctx: RequestContext, config: ServerConfig) => (ctx.actor?.type === "host" || ctx.actor?.scope === "owner") && !config.readOnly;

const titleSchema = z.string().trim().min(1).max(DESIGN_LIMITS.titleChars).refine(value => !/[\u0000-\u001f\u007f]/.test(value));
const createInputSchema = z.object({ workspaceId: z.string().min(1).max(200), kind: designKindSchema, title: titleSchema }).strict();
const patchInputSchema = z.object({ title: titleSchema.optional(), systemId: designIdSchema.nullable().optional() }).strict();
const pageInputSchema = z.object({ title: z.string().trim().max(DESIGN_LIMITS.titleChars).optional(), afterPageId: pageIdSchema.optional(), html: z.string().optional() }).strict();
const orderInputSchema = z.object({ pageIds: z.array(pageIdSchema).max(DESIGN_LIMITS.pages) }).strict();
const chatInputSchema = z.object({ sessionId: z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/) }).strict();

/** Read a raw request body, refusing it as soon as it passes `limit` bytes. */
export async function readLimitedBody(request: Request, limit: number): Promise<Uint8Array> {
  const tooLarge = () => new ApiError(413, "design_file_too_large", "El archivo supera el tamaño permitido.");
  const declared = Number(request.headers.get("content-length") ?? "NaN");
  if (Number.isFinite(declared) && declared > limit) throw tooLarge();
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) { await reader.cancel().catch(() => undefined); throw tooLarge(); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export function registerDesignRoutes(options: {
  routes: Route[]; config: ServerConfig;
  readJsonBody: (request: Request) => Promise<Record<string, unknown>>;
  jsonResponse: (body: unknown, status?: number) => Response;
  ensureWritable: (config: ServerConfig) => void;
}) {
  const { routes, config, readJsonBody, jsonResponse, ensureWritable } = options;

  function requireDesigns(write = false) {
    if (!specialistApplicationsEnabled() || !designStudioEnabled()) throw new ApiError(404, "design_studio_disabled", "El estudio de diseño está desactivado.");
    if (write) ensureWritable(config);
  }

  const live = (workspaceId: string) => config.workspaces.find(workspace => workspace.id === workspaceId) ?? null;

  async function resolveProject(workspaceId: string) {
    const store = await specialistStore(config);
    const binding = store.allProjects().find(project => project.workspaceId === workspaceId);
    const workspace = live(workspaceId);
    if (!binding || !workspace) throw new ApiError(404, "project_not_found", "Ese proyecto no existe.");
    return { store, workspace, rootPath: workspace.path };
  }

  const designParams = (ctx: RequestContext) => {
    const id = designIdSchema.safeParse(ctx.params.designId);
    if (!id.success) throw new ApiError(404, "design_not_found", "Ese diseño no existe.");
    return { workspaceId: ctx.params.workspaceId, designId: id.data };
  };

  async function parseBody<T>(schema: z.ZodType<T>, ctx: RequestContext, code: string, message: string): Promise<T> {
    const parsed = schema.safeParse(await readJsonBody(ctx.request));
    if (!parsed.success) throw new ApiError(422, code, message);
    return parsed.data;
  }

  addRoute(routes, "GET", "/designs", "client", async ctx => {
    requireDesigns();
    const only = ctx.url.searchParams.get("workspaceId");
    const store = await specialistStore(config);
    const designs: DesignSummary[] = [];
    for (const binding of store.allProjects()) {
      if (only && binding.workspaceId !== only) continue;
      const workspace = live(binding.workspaceId);
      if (!workspace) continue;
      const name = projectName(workspace);
      for (const manifest of await listDesigns(workspace.path).catch(() => [])) designs.push(summaryOf(manifest, workspace.id, name));
    }
    if (only && !designs.length) await resolveProject(only);
    designs.sort(compareSummaries);
    return jsonResponse({ designs, writable: writableFor(ctx, config) });
  });

  addRoute(routes, "POST", "/designs", "host", async ctx => {
    requireDesigns(true);
    const input = await parseBody(createInputSchema, ctx, "invalid_design", `Elige un tipo y un título de hasta ${DESIGN_LIMITS.titleChars} caracteres.`);
    const project = await resolveProject(input.workspaceId);
    const design = await createDesign(project.rootPath, { kind: input.kind, title: input.title });
    project.store.touchProject(project.workspace.id);
    return jsonResponse({ design }, 201);
  });

  addRoute(routes, "GET", "/designs/:workspaceId/:designId", "client", async ctx => {
    requireDesigns();
    const { workspaceId, designId } = designParams(ctx);
    const project = await resolveProject(workspaceId);
    return jsonResponse({ design: await readManifest(project.rootPath, designId), writable: writableFor(ctx, config) });
  });

  addRoute(routes, "PATCH", "/designs/:workspaceId/:designId", "host", async ctx => {
    requireDesigns(true);
    const { workspaceId, designId } = designParams(ctx);
    const project = await resolveProject(workspaceId);
    const patch = await parseBody(patchInputSchema, ctx, "invalid_design", `Usa un título de hasta ${DESIGN_LIMITS.titleChars} caracteres.`);
    if (patch.systemId) {
      if (patch.systemId === designId) throw new ApiError(422, "design_system_invalid", "Un diseño no puede seguirse a sí mismo.");
      const system = await readManifest(project.rootPath, patch.systemId).catch(() => null);
      if (system?.kind !== "system") throw new ApiError(422, "design_system_invalid", "Elige un sistema de diseño del mismo proyecto.");
    }
    const design = await updateManifest(project.rootPath, designId, current => ({
      ...current,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.systemId !== undefined ? { systemId: patch.systemId } : {}),
    }));
    project.store.touchProject(project.workspace.id);
    return jsonResponse({ design });
  });

  addRoute(routes, "DELETE", "/designs/:workspaceId/:designId", "host", async ctx => {
    requireDesigns(true);
    const { workspaceId, designId } = designParams(ctx);
    const project = await resolveProject(workspaceId);
    await deleteDesign(project.rootPath, designId);
    return jsonResponse({ ok: true });
  });

  addRoute(routes, "GET", "/designs/:workspaceId/:designId/files", "client", async ctx => {
    requireDesigns();
    const { workspaceId, designId } = designParams(ctx);
    const project = await resolveProject(workspaceId);
    const file = await readDesignFile(project.rootPath, designId, ctx.url.searchParams.get("path") ?? "");
    return new Response(file.bytes, { status: 200, headers: {
      "content-type": contentTypeFor(file.relativePath),
      // Every design file: no script, no network, nothing framed, never sniffed into another type.
      "content-security-policy": DESIGN_CONTENT_SECURITY_POLICY,
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    } });
  });

  addRoute(routes, "PUT", "/designs/:workspaceId/:designId/files", "host", async ctx => {
    requireDesigns(true);
    const { workspaceId, designId } = designParams(ctx);
    const project = await resolveProject(workspaceId);
    const path = ctx.url.searchParams.get("path") ?? "";
    const checked = checkDesignPath(path);
    if (!checked.ok) throw new ApiError(400, "design_path_invalid", "La ruta debe ser relativa a la carpeta del diseño, sin carpetas ocultas ni \"..\".");
    const bytes = await readLimitedBody(ctx.request, fileByteLimit(checked.role));
    const design = await writeDesignFile(project.rootPath, designId, path, bytes);
    project.store.touchProject(project.workspace.id);
    return jsonResponse({ ok: true, design });
  });

  addRoute(routes, "POST", "/designs/:workspaceId/:designId/pages", "host", async ctx => {
    requireDesigns(true);
    const { workspaceId, designId } = designParams(ctx);
    const project = await resolveProject(workspaceId);
    const input = await parseBody(pageInputSchema, ctx, "invalid_design_page", "Revisa el título y el contenido de la página.");
    const design = await addPage(project.rootPath, designId, input);
    project.store.touchProject(project.workspace.id);
    return jsonResponse({ design }, 201);
  });

  addRoute(routes, "PUT", "/designs/:workspaceId/:designId/pages/order", "host", async ctx => {
    requireDesigns(true);
    const { workspaceId, designId } = designParams(ctx);
    const project = await resolveProject(workspaceId);
    const input = await parseBody(orderInputSchema, ctx, "design_pages_mismatch", "El nuevo orden debe incluir cada página una vez.");
    return jsonResponse({ design: await reorderDesignPages(project.rootPath, designId, input.pageIds) });
  });

  addRoute(routes, "DELETE", "/designs/:workspaceId/:designId/pages/:pageId", "host", async ctx => {
    requireDesigns(true);
    const { workspaceId, designId } = designParams(ctx);
    const project = await resolveProject(workspaceId);
    return jsonResponse({ design: await deleteDesignPage(project.rootPath, designId, ctx.params.pageId) });
  });

  addRoute(routes, "PUT", "/designs/:workspaceId/:designId/thumbnail", "host", async ctx => {
    requireDesigns(true);
    const { workspaceId, designId } = designParams(ctx);
    const project = await resolveProject(workspaceId);
    const bytes = await readLimitedBody(ctx.request, DESIGN_LIMITS.assetBytes);
    return jsonResponse({ ok: true, design: await writeDesignFile(project.rootPath, designId, "thumbnail.png", bytes) });
  });

  addRoute(routes, "GET", "/designs/:workspaceId/:designId/export", "client", async ctx => {
    requireDesigns();
    const { workspaceId, designId } = designParams(ctx);
    const format = ctx.url.searchParams.get("format") ?? "html";
    // PDF, PPTX and PNG are rendered on demand (POST …/export); this route only packs files.
    if (format !== "html") throw new ApiError(400, "design_export_format", "Este formato se exporta con POST /designs/:ws/:id/export.");
    const project = await resolveProject(workspaceId);
    const archive = await designHtmlArchive(project.rootPath, designId);
    return new Response(archive.bytes, { status: 200, headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${archive.fileName}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    } });
  });

  // Which chat sessions work on the design: their prompts carry the design guidance.
  addRoute(routes, "GET", "/designs/:workspaceId/:designId/chats", "client", async ctx => {
    requireDesigns();
    const { workspaceId, designId } = designParams(ctx);
    const project = await resolveProject(workspaceId);
    await readManifest(project.rootPath, designId);
    return jsonResponse({ sessions: await designChats(project.rootPath, designId) });
  });

  addRoute(routes, "POST", "/designs/:workspaceId/:designId/chats", "host", async ctx => {
    requireDesigns(true);
    const { workspaceId, designId } = designParams(ctx);
    const project = await resolveProject(workspaceId);
    const input = await parseBody(chatInputSchema, ctx, "invalid_design_chat", "Indica la conversación del diseño.");
    await bindDesignChat(project.rootPath, designId, input.sessionId);
    return jsonResponse({ sessions: await designChats(project.rootPath, designId) });
  });
}
