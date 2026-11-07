import { setTimeout as delay } from "node:timers/promises";
import { dirname, resolve, relative } from "node:path";
import { z } from "zod";
import { goalInputSchema } from "@openwork/types/task-continuity";
import { ApiError } from "./errors.js";
import { addRoute, type Route } from "./routes/registry.js";
import type { ServerConfig, WorkspaceInfo } from "./types.js";
import { taskController, taskContinuityEnabled } from "./task-continuity.js";
import { createGitWorktree, listGitWorktrees, removeGitWorktree } from "./comex/git.js";

export function registerTaskContinuityRoutes(o: {
  routes: Route[]; config: ServerConfig;
  resolveWorkspace(config: ServerConfig, id: string): Promise<WorkspaceInfo>;
  authorizeSession(workspace: WorkspaceInfo, sessionId: string): Promise<string | null>;
  native(workspace: WorkspaceInfo, path: string, body?: unknown): Promise<unknown>;
  readJsonBody(request: Request): Promise<Record<string, unknown>>;
  ensureWritable(config: ServerConfig): void;
  jsonResponse(value: unknown, status?: number): Response;
}) {
  const context = async (id: string, sessionId: string, write = false) => {
    if (!taskContinuityEnabled()) throw new ApiError(404, "tasks_disabled", "Los objetivos están desactivados.");
    if (!/^ses_[A-Za-z0-9_-]{1,252}$/.test(sessionId)) throw new ApiError(422, "task_invalid_session", "Conversación inválida.");
    if (write) o.ensureWritable(o.config);
    const workspace = await o.resolveWorkspace(o.config, id);
    if (workspace.workspaceType !== "local") throw new ApiError(422, "task_local_required", "Abrí un proyecto local.");
    const directory = await o.authorizeSession(workspace, sessionId);
    if (!directory) throw new ApiError(404, "session_not_found", "La conversación no pertenece al proyecto.");
    const controller = taskController(o.config);
    if (!controller) throw new ApiError(503, "tasks_unavailable", "Los objetivos no están disponibles; volvé a intentar.");
    return { workspace, directory, controller };
  };
  const bodySchema = z.strictObject({ revision: z.number().int().nonnegative(), action: z.enum(["start", "pause", "resume"]), goal: goalInputSchema.optional() });
  addRoute(o.routes, "GET", "/workspace/:id/tasks/:sessionId", "client", async ctx => {
    const { controller, workspace, directory } = await context(ctx.params.id, ctx.params.sessionId);
    const state = controller.get(ctx.params.id, ctx.params.sessionId);
    return o.jsonResponse({ ...state, worktree: resolve(directory) !== resolve(workspace.path) && managed(directory) ? directory : null });
  });
  addRoute(o.routes, "PUT", "/workspace/:id/tasks/:sessionId", "host", async ctx => {
    const { workspace, controller } = await context(ctx.params.id, ctx.params.sessionId, true);
    const body = bodySchema.safeParse(await o.readJsonBody(ctx.request));
    if (!body.success || body.data.action === "start" && !body.data.goal) throw new ApiError(422, "task_invalid", "Completá el objetivo, los criterios y el límite de turnos.");
    return o.jsonResponse(await controller.update(workspace, ctx.params.sessionId, body.data.revision, body.data.action, body.data.goal));
  });
  const managed = (path: string) => {
    if (!o.config.configPath) throw new ApiError(503, "task_runtime_missing", "No hay una carpeta de configuración disponible.");
    const parent = resolve(dirname(o.config.configPath), "comex-worktrees");
    const inside = relative(parent, resolve(path));
    return !!inside && !inside.startsWith("..") && !inside.startsWith("/") && inside.split(/[\\/]/).length === 2;
  };
  addRoute(o.routes, "GET", "/workspace/:id/tasks/:sessionId/worktrees", "host", async ctx => {
    const { workspace } = await context(ctx.params.id, ctx.params.sessionId);
    return o.jsonResponse({ items: (await listGitWorktrees(workspace.path)).filter(item => managed(item.path)) });
  });
  addRoute(o.routes, "POST", "/workspace/:id/tasks/:sessionId/worktrees", "host", async ctx => {
    const { workspace, controller, directory } = await context(ctx.params.id, ctx.params.sessionId, true);
    const body = z.strictObject({ action: z.enum(["isolate", "return", "remove"]), expectedHead: z.string().regex(/^[a-f0-9]{40,64}$/).optional(), path: z.string().max(4096).optional() }).safeParse(await o.readJsonBody(ctx.request));
    if (!body.success) throw new ApiError(422, "task_worktree_invalid", "Revisá el trabajo aislado.");
    const active = await o.native(workspace, "/api/session/active");
    if (!active || typeof active !== "object" || Object.keys(active).length) throw new ApiError(409, "task_busy", "Esperá a que terminen las tareas antes de cambiar de carpeta.");
    const s = controller.get(workspace.id, ctx.params.sessionId);
    if (s.status === "active") throw new ApiError(409, "task_pause_required", "Pausá el objetivo antes de cambiar de carpeta.");
    let target = workspace.path;
    if (body.data.action === "remove") {
      const path = body.data.path;
      if (!path || !body.data.expectedHead || !managed(path)) throw new ApiError(422, "task_worktree_invalid", "Elegí un trabajo aislado creado por la aplicación.");
      if (resolve(directory) === resolve(path)) throw new ApiError(409, "task_worktree_in_use", "Volvé al proyecto antes de retirar el trabajo.");
      // Native global listing is paginated; inspect all sessions before deleting a folder.
      let cursor: string | undefined;
      const seen = new Set<string>();
      do {
        const page = await o.native(workspace, `/api/session?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
        const envelope = z.object({ data: z.array(z.object({ location: z.object({ directory: z.string() }) }).passthrough()), cursor: z.object({ next: z.string().nullable().optional() }).optional() }).safeParse(page);
        if (!envelope.success) throw new ApiError(409, "task_worktree_unknown", "No se pudieron verificar las conversaciones; el trabajo se conserva.");
        if (envelope.data.data.some(row => resolve(row.location.directory) === resolve(path))) throw new ApiError(409, "task_worktree_in_use", "Otra conversación sigue usando esta carpeta.");
        cursor = envelope.data.cursor?.next ?? undefined;
        if (cursor && seen.has(cursor)) throw new ApiError(409, "task_worktree_unknown", "No se pudo completar la lista de conversaciones.");
        if (cursor) seen.add(cursor);
      } while (cursor);
      await removeGitWorktree(workspace.path, path, body.data.expectedHead);
      return o.jsonResponse({ removed: true });
    }
    if (body.data.action === "isolate") {
      if (!body.data.expectedHead || !o.config.configPath) throw new ApiError(422, "task_head_required", "Actualizá el commit de origen antes de aislar el trabajo.");
      if (s.worktree || resolve(directory) !== resolve(workspace.path)) throw new ApiError(409, "task_already_isolated", "La conversación ya tiene un trabajo aislado.");
      const created = await createGitWorktree(workspace.path, dirname(o.config.configPath), body.data.expectedHead);
      target = created.path;
    }
    await o.native(workspace, `/api/session/${encodeURIComponent(ctx.params.sessionId)}/move`, { directory: target, delivery: "queue" });
    let actual: string | null = null;
    for (let attempt = 0; attempt < 25; attempt++) {
      actual = await o.authorizeSession(workspace, ctx.params.sessionId);
      if (actual && resolve(actual) === resolve(target)) break;
      await delay(120);
    }
    if (!actual || resolve(actual) !== resolve(target)) throw new ApiError(409, "task_move_unverified", "No se confirmó el traslado. Actualizá el chat; el trabajo aislado se conserva.");
    return o.jsonResponse(await controller.bind(workspace, ctx.params.sessionId, target === workspace.path ? null : target));
  });
}
