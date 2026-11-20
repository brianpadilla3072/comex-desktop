import { z } from "zod";
import { ApiError } from "../errors.js";
import { addRoute, type Route } from "../routes/registry.js";
import type { ServerConfig } from "../types.js";
import { agentEcosystemEnabled } from "./features.js";
import {
  ClaimConflict, EcosystemHalted, NotFound,
  claimNeed, commentDeliverable, createDeliverable, expireStaleClaims, getEcosystemState,
  listDeliverables, listNeeds, listProjectSummaries, publishNeed,
  resolveNeed, setHalt, upsertProjectSummary,
} from "./agent-ecosystem.js";

const publishSchema = z.strictObject({
  from: z.string().min(1),
  projectId: z.string().min(1),
  sessionId: z.string().min(1),
  need: z.string().min(1),
  contextShort: z.string().min(1).max(200),
  priority: z.enum(["high", "normal", "low"]).optional(),
});
const claimSchema = z.strictObject({ agentId: z.string().min(1) });
const resolveSchema = z.strictObject({ agentId: z.string().min(1), resultRef: z.string().min(1) });
const summarySchema = z.strictObject({
  projectId: z.string().min(1), sessionId: z.string().min(1), agentId: z.string().min(1),
  title: z.string().min(1), status: z.enum(["active", "paused", "done", "halted"]),
  oneLiner: z.string().min(1).max(120),
});
const deliverableSchema = z.strictObject({
  projectId: z.string().min(1), ownerAgent: z.string().min(1), title: z.string().min(1),
  status: z.enum(["draft", "review", "done"]), draftPath: z.string().min(1),
});
const commentSchema = z.strictObject({ comment: z.string().min(1) });
const haltSchema = z.strictObject({ halted: z.boolean(), by: z.string().min(1) });

export function registerAgentEcosystemRoutes(options: {
  routes: Route[]; config: ServerConfig;
  readJsonBody(request: Request): Promise<Record<string, unknown>>;
  jsonResponse(value: unknown, status?: number): Response;
  ensureWritable(config: ServerConfig): void;
}) {
  const { routes, config, readJsonBody, jsonResponse, ensureWritable } = options;
  function guard() {
    if (!agentEcosystemEnabled()) throw new ApiError(404, "agent_ecosystem_disabled", "El ecosistema de agentes está desactivado.");
  }
  async function translate<T>(run: () => Promise<T>): Promise<T> {
    try { return await run(); }
    catch (error) {
      if (error instanceof ClaimConflict) throw new ApiError(409, "need_already_claimed", `El need ya fue tomado por ${error.claimedBy}.`);
      if (error instanceof EcosystemHalted) throw new ApiError(409, "ecosystem_halted", `El ecosistema fue detenido por ${error.haltedBy ?? "el usuario"}.`);
      if (error instanceof NotFound) throw new ApiError(404, `${error.kind}_not_found`, `No existe ${error.kind} ${error.id}.`);
      throw error;
    }
  }
  async function body<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
    const parsed = schema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw new ApiError(422, "ecosystem_invalid_payload", "Revisa los datos enviados.");
    return parsed.data;
  }

  addRoute(routes, "GET", "/workspace/:id/agent-ecosystem", "client", async ctx => {
    guard();
    return jsonResponse(await getEcosystemState(config, ctx.params.id));
  });
  addRoute(routes, "GET", "/workspace/:id/agent-ecosystem/needs", "client", async ctx => {
    guard();
    const status = ctx.url.searchParams.get("status");
    const allowed = ["open", "claimed", "resolved", "failed", "expired"];
    const filter = status && allowed.includes(status) ? status as "open" | "claimed" | "resolved" | "failed" | "expired" : undefined;
    return jsonResponse({ needs: await listNeeds(config, ctx.params.id, filter) });
  });
  addRoute(routes, "POST", "/workspace/:id/agent-ecosystem/needs", "client", async ctx => {
    guard(); ensureWritable(config);
    const input = await body(ctx.request, publishSchema);
    return jsonResponse({ need: await translate(() => publishNeed(config, ctx.params.id, input)) });
  });
  addRoute(routes, "POST", "/workspace/:id/agent-ecosystem/needs/:needId/claim", "client", async ctx => {
    guard(); ensureWritable(config);
    const input = await body(ctx.request, claimSchema);
    return jsonResponse({ need: await translate(() => claimNeed(config, ctx.params.id, ctx.params.needId, input.agentId)) });
  });
  addRoute(routes, "POST", "/workspace/:id/agent-ecosystem/needs/:needId/resolve", "client", async ctx => {
    guard(); ensureWritable(config);
    const input = await body(ctx.request, resolveSchema);
    return jsonResponse({ need: await translate(() => resolveNeed(config, ctx.params.id, ctx.params.needId, input.agentId, input.resultRef)) });
  });
  addRoute(routes, "GET", "/workspace/:id/agent-ecosystem/index", "client", async ctx => {
    guard();
    const projectId = ctx.url.searchParams.get("projectId") ?? undefined;
    return jsonResponse({ index: await listProjectSummaries(config, ctx.params.id, projectId) });
  });
  addRoute(routes, "POST", "/workspace/:id/agent-ecosystem/index", "client", async ctx => {
    guard(); ensureWritable(config);
    const input = await body(ctx.request, summarySchema);
    return jsonResponse({ summary: await translate(() => upsertProjectSummary(config, ctx.params.id, input)) });
  });
  addRoute(routes, "GET", "/workspace/:id/agent-ecosystem/board", "client", async ctx => {
    guard();
    return jsonResponse({ board: await listDeliverables(config, ctx.params.id) });
  });
  addRoute(routes, "POST", "/workspace/:id/agent-ecosystem/board", "client", async ctx => {
    guard(); ensureWritable(config);
    const input = await body(ctx.request, deliverableSchema);
    return jsonResponse({ deliverable: await translate(() => createDeliverable(config, ctx.params.id, input)) });
  });
  addRoute(routes, "POST", "/workspace/:id/agent-ecosystem/board/:deliverableId/comment", "client", async ctx => {
    guard(); ensureWritable(config);
    const input = await body(ctx.request, commentSchema);
    return jsonResponse({ deliverable: await translate(() => commentDeliverable(config, ctx.params.id, ctx.params.deliverableId, input.comment)) });
  });
  addRoute(routes, "POST", "/workspace/:id/agent-ecosystem/halt", "client", async ctx => {
    guard(); ensureWritable(config);
    const input = await body(ctx.request, haltSchema);
    return jsonResponse({ state: await translate(() => setHalt(config, ctx.params.id, input.halted, input.by)) });
  });
  addRoute(routes, "POST", "/workspace/:id/agent-ecosystem/expire", "client", async ctx => {
    guard(); ensureWritable(config);
    return jsonResponse({ expired: await translate(() => expireStaleClaims(config, ctx.params.id)) });
  });
}
