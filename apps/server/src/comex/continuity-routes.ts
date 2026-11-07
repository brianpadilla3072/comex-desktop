import { z } from "zod";
import { ApiError } from "../errors.js";
import { addRoute, type Route } from "../routes/registry.js";
import type { ServerConfig } from "../types.js";
import { comexContinuityEnabled } from "./features.js";
import { checkpointInput, checkpointPath, ContinuityError, readComexCheckpoint, writeComexCheckpoint } from "./continuity.js";

export function registerContinuityRoutes(options: {
  routes: Route[]; config: ServerConfig;
  readJsonBody(request: Request): Promise<Record<string, unknown>>;
  jsonResponse(value: unknown, status?: number): Response;
  ensureWritable(config: ServerConfig): void;
  /** Must verify native session ownership before returning its workspace root. */
  authorizeSession(workspaceId: string, sessionId: string): Promise<string>;
}) {
  const { routes, config, readJsonBody, jsonResponse, ensureWritable, authorizeSession } = options;
  const bodySchema = z.strictObject({ expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), checkpoint: checkpointInput });
  function guard() {
    if (!comexContinuityEnabled()) throw new ApiError(404, "continuity_disabled", "La continuidad estructurada está desactivada.");
  }
  async function translate<T>(run: () => Promise<T>): Promise<T> {
    try { return await run(); }
    catch (error) {
      if (error instanceof ContinuityError) throw new ApiError(error.code === "busy" || error.code === "conflict" ? 409 : 422, `continuity_${error.code}`, error.message);
      throw error;
    }
  }
  addRoute(routes, "GET", "/workspace/:id/continuity/:sessionId", "client", async ctx => {
    guard();
    return translate(async () => {
      checkpointPath(ctx.params.sessionId);
      const root = await authorizeSession(ctx.params.id, ctx.params.sessionId);
      return jsonResponse(await readComexCheckpoint(root, ctx.params.sessionId));
    });
  });
  addRoute(routes, "PUT", "/workspace/:id/continuity/:sessionId", "host", async ctx => {
    guard(); ensureWritable(config);
    return translate(async () => {
      checkpointPath(ctx.params.sessionId);
      const root = await authorizeSession(ctx.params.id, ctx.params.sessionId);
      const body = bodySchema.safeParse(await readJsonBody(ctx.request));
      if (!body.success) throw new ApiError(422, "continuity_invalid", "Revisá los campos del resumen y su revisión.");
      const checkpoint = await writeComexCheckpoint(root, ctx.params.sessionId, body.data.checkpoint, body.data.expectedRevision);
      return jsonResponse({ status: "ready", revision: checkpoint.revision, checkpoint });
    });
  });
}
