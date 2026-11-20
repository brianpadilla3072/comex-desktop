import { realpath } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { ApiError } from "../../errors.js";
import { specialistApplicationsEnabled, taskIsolationReviewEnabled } from "../../comex/features.js";
import { addRoute, type Route } from "../../routes/registry.js";
import { specialistStore } from "../store.js";
import { listTasks } from "../tasks.js";
import type { ServerConfig, WorkspaceInfo } from "../../types.js";
import { ISOLATION_LIMITS } from "./core.js";
import {
  acceptIsolationFiles, closeIsolation, createIsolation, discardIsolationFiles, isolationChanges,
  isolationFileDiff, listIsolations, readIsolation, type IsolationRecord, type ReviewHooks,
} from "./service.js";

/** Owner routes of task isolation and review (docs/features/task-isolation-review). Every route
 *  is "host": the desktop or a paired device. Bodies are strict zod objects. */

const pathsBody = z.strictObject({ paths: z.array(z.string().min(1).max(1024)).min(1).max(ISOLATION_LIMITS.maxPathsPerRequest), overwrite: z.boolean().optional() });
const discardBody = z.strictObject({ paths: z.array(z.string().min(1).max(1024)).min(1).max(ISOLATION_LIMITS.maxPathsPerRequest) });
const sessionIdPattern = /^ses_[A-Za-z0-9_-]{1,252}$/;

/** What clients see of an isolation: no base manifest, the copy's folder for reference. */
export function isolationSummary(record: IsolationRecord) {
  return {
    id: record.id, applicationId: record.applicationId, workspaceId: record.workspaceId, mode: record.mode,
    copyPath: record.copyPath, origin: record.origin, sessionId: record.sessionId, status: record.status,
    createdAt: record.createdAt, closedAt: record.closedAt,
    reviewed: Object.keys(record.resolved).length,
  };
}

export function registerTaskIsolationRoutes(o: {
  routes: Route[]; config: ServerConfig;
  readJsonBody: (request: Request) => Promise<Record<string, unknown>>;
  jsonResponse: (body: unknown, status?: number) => Response;
  ensureWritable: (config: ServerConfig) => void;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
  /** The session's execution directory when it belongs to the workspace, else null. */
  authorizeSession: (workspace: WorkspaceInfo, sessionId: string) => Promise<string | null>;
  /** Native `session.move` (queued after any running turn). */
  moveSession: (workspace: WorkspaceInfo, sessionId: string, directory: string) => Promise<void>;
}) {
  const { routes, config, jsonResponse, readJsonBody } = o;
  const requireFeature = (write = false) => {
    if (!specialistApplicationsEnabled() || !taskIsolationReviewEnabled()) throw new ApiError(404, "task_isolation_disabled", "La revisión de tareas aisladas está desactivada.");
    if (write) o.ensureWritable(config);
  };
  const application = async (id: string) => (await specialistStore(config)).application(id);

  const moveAndVerify = async (workspace: WorkspaceInfo, sessionId: string, directory: string) => {
    await o.moveSession(workspace, sessionId, directory);
    const expected = await realpath(directory).catch(() => directory);
    for (let attempt = 0; attempt < 25; attempt++) {
      const current = await o.authorizeSession(workspace, sessionId);
      if (current && await realpath(current).catch(() => current) === expected) return;
      await delay(120);
    }
    throw new ApiError(409, "task_isolation_move_unverified", "No se confirmó el cambio de carpeta de la conversación. Actualiza el chat y vuelve a intentarlo.");
  };

  const hooks: ReviewHooks = {
    isBusy: async record => {
      if (record.origin.kind !== "task_run") return false;
      const taskId = record.origin.taskId;
      const tasks = await listTasks(config, record.applicationId).catch(() => []);
      return tasks.some(task => task.id === taskId && task.running?.isolationId === record.id);
    },
    releaseSession: async record => {
      if (!record.sessionId) return;
      const workspace = await o.resolveWorkspace(config, record.workspaceId);
      const current = await o.authorizeSession(workspace, record.sessionId);
      if (!current) return; // The conversation is gone: nothing points at the copy any more.
      if (await realpath(current).catch(() => current) !== await realpath(record.copyPath).catch(() => record.copyPath)) return;
      await moveAndVerify(workspace, record.sessionId, workspace.path);
    },
  };

  addRoute(routes, "GET", "/specialist-applications/:id/isolations", "host", async ctx => {
    requireFeature();
    const app = await application(ctx.params.id);
    const all = ctx.url.searchParams.get("status") === "all";
    const items = (await listIsolations(config, app.id)).filter(record => all || record.status === "active");
    return jsonResponse({ items: items.map(isolationSummary) });
  });
  addRoute(routes, "GET", "/specialist-applications/:id/isolations/:isoId", "host", async ctx => {
    requireFeature();
    const app = await application(ctx.params.id);
    const record = await readIsolation(config, app.id, ctx.params.isoId);
    return jsonResponse({ isolation: isolationSummary(record), busy: await hooks.isBusy?.(record) ?? false, changes: await isolationChanges(config, record) });
  });
  addRoute(routes, "GET", "/specialist-applications/:id/isolations/:isoId/diff", "host", async ctx => {
    requireFeature();
    const app = await application(ctx.params.id);
    const record = await readIsolation(config, app.id, ctx.params.isoId);
    return jsonResponse(await isolationFileDiff(config, record, ctx.url.searchParams.get("path") ?? ""));
  });
  addRoute(routes, "POST", "/specialist-applications/:id/isolations/:isoId/accept", "host", async ctx => {
    requireFeature(true);
    const app = await application(ctx.params.id);
    const body = pathsBody.safeParse(await readJsonBody(ctx.request));
    if (!body.success) throw new ApiError(422, "task_isolation_invalid", "Elige los archivos que quieres aceptar.");
    const result = await acceptIsolationFiles(config, app.id, ctx.params.isoId, body.data.paths, { overwrite: body.data.overwrite }, hooks);
    return jsonResponse({ ...result, isolation: isolationSummary(result.isolation) });
  });
  addRoute(routes, "POST", "/specialist-applications/:id/isolations/:isoId/discard", "host", async ctx => {
    requireFeature(true);
    const app = await application(ctx.params.id);
    const body = discardBody.safeParse(await readJsonBody(ctx.request));
    if (!body.success) throw new ApiError(422, "task_isolation_invalid", "Elige los archivos que quieres descartar.");
    const result = await discardIsolationFiles(config, app.id, ctx.params.isoId, body.data.paths, hooks);
    return jsonResponse({ ...result, isolation: isolationSummary(result.isolation) });
  });
  addRoute(routes, "DELETE", "/specialist-applications/:id/isolations/:isoId", "host", async ctx => {
    requireFeature(true);
    const app = await application(ctx.params.id);
    return jsonResponse({ isolation: isolationSummary(await closeIsolation(config, app.id, ctx.params.isoId, hooks)) });
  });

  /** A conversation's isolated copy, if any, plus the application it belongs to. */
  const conversation = async (workspaceId: string, sessionId: string, write = false) => {
    requireFeature(write);
    if (!sessionIdPattern.test(sessionId)) throw new ApiError(422, "task_isolation_invalid_session", "Conversación inválida.");
    const workspace = await o.resolveWorkspace(config, workspaceId);
    if (workspace.workspaceType !== "local") throw new ApiError(422, "task_isolation_local_required", "Abre un proyecto local.");
    const app = (await specialistStore(config)).forWorkspace(workspace.id);
    if (!app) throw new ApiError(409, "task_isolation_no_application", "Este proyecto no pertenece a una aplicación especialista.");
    const directory = await o.authorizeSession(workspace, sessionId);
    if (!directory) throw new ApiError(404, "session_not_found", "La conversación no pertenece al proyecto.");
    const isolation = (await listIsolations(config, app.id)).find(record => record.status === "active" && record.sessionId === sessionId) ?? null;
    return { workspace, app, directory, isolation };
  };
  addRoute(routes, "GET", "/workspace/:id/task-isolation/sessions/:sessionId", "host", async ctx => {
    const { app, isolation } = await conversation(ctx.params.id, ctx.params.sessionId);
    return jsonResponse({ applicationId: app.id, isolation: isolation ? isolationSummary(isolation) : null });
  });
  addRoute(routes, "POST", "/workspace/:id/task-isolation/sessions/:sessionId", "host", async ctx => {
    const { workspace, app, directory, isolation } = await conversation(ctx.params.id, ctx.params.sessionId, true);
    if (isolation) throw new ApiError(409, "task_isolation_already_isolated", "Esta conversación ya trabaja en una copia aislada.");
    if (await realpath(directory).catch(() => directory) !== await realpath(workspace.path).catch(() => workspace.path)) {
      throw new ApiError(409, "task_isolation_already_isolated", "Esta conversación ya trabaja fuera del proyecto. Vuelve al proyecto antes de aislarla.");
    }
    const record = await createIsolation(config, {
      applicationId: app.id, workspaceId: workspace.id, projectRoot: workspace.path,
      origin: { kind: "session", sessionId: ctx.params.sessionId }, sessionId: ctx.params.sessionId,
    });
    try { await moveAndVerify(workspace, ctx.params.sessionId, record.copyPath); }
    catch (error) {
      // The chat stays in the project; a copy nobody works in is removed.
      await closeIsolation(config, app.id, record.id).catch(() => undefined);
      throw error;
    }
    return jsonResponse({ applicationId: app.id, isolation: isolationSummary(record) }, 201);
  });
}
