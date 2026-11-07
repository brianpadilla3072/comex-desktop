import { z } from "zod";
import { memoryNoteInputSchema, memoryScopeSchema } from "@openwork/types/scoped-memory";
import { ApiError } from "../errors.js";
import { addRoute, type Route } from "../routes/registry.js";
import type { ServerConfig } from "../types.js";
import { comexScopedMemoryEnabled } from "./features.js";
import { assertMemoryWritable, changeScopedMemory, readScopedMemory, type MemoryContext } from "./scoped-memory.js";

export function registerScopedMemoryRoutes(options: {
  routes: Route[]; config: ServerConfig;
  readJsonBody(request: Request): Promise<Record<string, unknown>>;
  jsonResponse(value: unknown, status?: number): Response;
  authorizeSession(workspaceId: string, sessionId: string): Promise<string>;
}) {
  const { routes, config, authorizeSession, readJsonBody, jsonResponse } = options;
  const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
  const save = z.object({ expectedRevision: revision, text: memoryNoteInputSchema, id: z.string().uuid().optional() }).strict();
  const remove = z.object({ expectedRevision: revision, id: z.string().uuid() }).strict();
  for (const method of ["GET", "POST", "DELETE"]) addRoute(routes, method, "/workspace/:id/memory/:sessionId/:scope", "client", async ctx => {
    if (!comexScopedMemoryEnabled()) throw new ApiError(404, "scoped_memory_disabled", "La memoria por niveles está desactivada.");
    const scope = memoryScopeSchema.safeParse(ctx.params.scope);
    if (!scope.success) throw new ApiError(422, "memory_scope_invalid", "Elegí conversación, proyecto o aplicación.");
    if (!ctx.actor?.tokenHash) throw new ApiError(403, "memory_identity_required", "Se necesita una conexión identificada.");
    const context: MemoryContext = { root: await authorizeSession(ctx.params.id, ctx.params.sessionId), sessionId: ctx.params.sessionId, identity: ctx.actor.tokenHash };
    const writable = !config.readOnly && (ctx.actor.type === "host" || ctx.actor.scope === "owner" || ctx.actor.scope === "collaborator");
    if (method === "GET") return jsonResponse({ ...await readScopedMemory(config, context, scope.data), writable });
    assertMemoryWritable(config, ctx.actor);
    const body = method === "POST" ? save.safeParse(await readJsonBody(ctx.request)) : remove.safeParse(await readJsonBody(ctx.request));
    if (!body.success) throw new ApiError(422, "memory_invalid_note", "Revisá la nota y la revisión guardada.");
    return jsonResponse({ ...await changeScopedMemory(config, context, scope.data,
      "text" in body.data ? { type: "save", ...body.data } : { type: "delete", id: body.data.id }, body.data.expectedRevision), writable });
  });
}
