import { z } from "zod";
import { ApiError } from "./errors.js";
import { commandCenterEnabled, scheduledTasksEnabled, specialistApplicationsEnabled } from "./comex/features.js";
import { addRoute, type Route } from "./routes/registry.js";
import { specialistStore } from "./specialists/store.js";
import { listRuns, listTasks, type SpecialistTask, type SpecialistTaskRun } from "./specialists/tasks.js";
import type { ServerConfig, WorkspaceInfo } from "./types.js";

/**
 * Command center: everything in flight on this server in one read. Chat turns
 * come from the engine that chat runs on (through the server's own workspace
 * proxy, so session homes and directory scoping apply exactly as for the app),
 * and scheduled specialist task runs come from the tasks store. Nothing here is
 * stored: every call is a fresh observation, and a source that could not be
 * read is reported as a problem instead of being read as "nothing running".
 */

export type CommandCenterEngine = "v1" | "v2";

export type CommandCenterDeps = {
  /** The server's own fetch, used in-process like the scheduler and task recovery. */
  request: (request: Request) => Promise<Response>;
  /** Which engine chat turns run on right now. */
  engine: () => CommandCenterEngine;
  now?: () => number;
};

/** Finished or failed scheduled runs stay visible this long. */
export const COMMAND_CENTER_RECENT_MS = 24 * 60 * 60_000;
const RECENT_LIMIT = 50;
const REQUEST_TIMEOUT_MS = 5_000;

const modelSchema = z.object({ providerID: z.string(), modelID: z.string() });

export const commandCenterSessionItemSchema = z.object({
  kind: z.literal("session"),
  id: z.string(),
  workspaceId: z.string(),
  workspaceName: z.string(),
  applicationId: z.string().nullable(),
  applicationName: z.string().nullable(),
  sessionId: z.string(),
  title: z.string().nullable(),
  status: z.enum(["running", "retrying", "waiting_permission", "waiting_question"]),
  engine: z.enum(["v1", "v2"]),
  model: modelSchema.nullable(),
  startedAt: z.number().nullable(),
  updatedAt: z.number().nullable(),
  waitingRequests: z.number().int().nonnegative(),
  subtasks: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
});

export const commandCenterTaskItemSchema = z.object({
  kind: z.literal("task"),
  id: z.string(),
  applicationId: z.string(),
  applicationName: z.string(),
  taskId: z.string(),
  taskName: z.string(),
  workspaceId: z.string().nullable(),
  workspaceName: z.string().nullable(),
  sessionId: z.string().nullable(),
  status: z.enum(["running", "waiting", "ok", "failed", "blocked", "skipped"]),
  mode: z.enum(["scheduled", "manual"]).nullable(),
  model: modelSchema.nullable(),
  startedAt: z.number().nullable(),
  enabled: z.boolean(),
  nextRunAt: z.number().nullable(),
  lastError: z.string().nullable(),
});

export const commandCenterItemSchema = z.discriminatedUnion("kind", [commandCenterSessionItemSchema, commandCenterTaskItemSchema]);

export const commandCenterProblemSchema = z.object({
  source: z.enum(["workspace", "tasks"]),
  id: z.string().nullable(),
  label: z.string(),
  message: z.string(),
});

export const commandCenterSnapshotSchema = z.object({
  enabled: z.literal(true),
  generatedAt: z.number(),
  engine: z.enum(["v1", "v2"]),
  /** False when at least one source could not be read; the list may then be missing work. */
  complete: z.boolean(),
  items: z.array(commandCenterItemSchema),
  problems: z.array(commandCenterProblemSchema),
  counts: z.object({
    running: z.number().int().nonnegative(),
    waiting: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
});

export type CommandCenterSnapshot = z.infer<typeof commandCenterSnapshotSchema>;
export type CommandCenterSessionItem = z.infer<typeof commandCenterSessionItemSchema>;
export type CommandCenterTaskItem = z.infer<typeof commandCenterTaskItemSchema>;
type Problem = z.infer<typeof commandCenterProblemSchema>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const readString = (value: unknown, key: string): string | undefined => isRecord(value) && typeof value[key] === "string" ? value[key] : undefined;
const readNumber = (value: unknown, key: string): number | undefined => isRecord(value) && typeof value[key] === "number" && Number.isFinite(value[key]) ? value[key] : undefined;
const unwrap = (value: unknown): unknown => isRecord(value) && "data" in value ? value.data : value;
/** Engine timestamps are seconds on some builds and milliseconds on others. */
const millis = (value: number | undefined): number | null => value === undefined || value <= 0 ? null : value < 1e12 ? value * 1000 : value;

const workspaceLabel = (workspace: WorkspaceInfo) => workspace.displayName?.trim() || workspace.name?.trim() || workspace.id;

class EngineReadError extends Error {}

function engineCaller(config: ServerConfig, deps: CommandCenterDeps, workspace: WorkspaceInfo, engine: CommandCenterEngine) {
  const mount = `/workspace/${encodeURIComponent(workspace.id)}/${engine === "v2" ? "opencode2/api" : "opencode"}`;
  return async (path: string, body?: unknown): Promise<unknown> => {
    let response: Response;
    try {
      response = await deps.request(new Request(`http://127.0.0.1:${config.port}${mount}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json", "x-openwork-task-recovery": "off" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }));
    } catch {
      throw new EngineReadError("The engine did not answer in time.");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new EngineReadError(`The engine answered ${response.status}.`);
    }
    if (response.status === 204) return null;
    try {
      return unwrap(await response.json());
    } catch {
      throw new EngineReadError("The engine answered something unreadable.");
    }
  };
}

type RawSession = {
  sessionId: string;
  running: boolean;
  retrying: boolean;
  retryMessage: string | null;
  startedAt: number | null;
  permissions: number;
  questions: number;
};

/** In-flight sessions for one workspace. Throws EngineReadError when the engine cannot tell. */
async function readWorkspaceSessions(config: ServerConfig, deps: CommandCenterDeps, workspace: WorkspaceInfo, engine: CommandCenterEngine) {
  const call = engineCaller(config, deps, workspace, engine);
  const sessions = new Map<string, RawSession>();
  const entry = (sessionId: string) => {
    const current = sessions.get(sessionId) ?? { sessionId, running: false, retrying: false, retryMessage: null, startedAt: null, permissions: 0, questions: 0 };
    sessions.set(sessionId, current);
    return current;
  };
  if (engine === "v2") {
    const active = await call("/session/active");
    if (!isRecord(active)) throw new EngineReadError("The engine answered something unreadable.");
    for (const [sessionId, status] of Object.entries(active)) {
      const type = readString(status, "type");
      if (type !== "running" && type !== "busy" && type !== "retry") continue;
      const item = entry(sessionId);
      item.running = true;
      item.retrying = type === "retry";
      item.startedAt = millis(readNumber(status, "started") ?? readNumber(readRecordValue(status, "time"), "started"));
    }
    // v2 lists requests per conversation; the workspace-wide form list pages
    // every conversation the engine has, so only ask about the running ones.
    await Promise.all([...sessions.values()].map(async (item) => {
      const path = `/session/${encodeURIComponent(item.sessionId)}`;
      const [permissions, forms] = await Promise.all([call(`${path}/permission`), call(`${path}/form`)]);
      item.permissions = Array.isArray(permissions) ? permissions.length : 0;
      item.questions = Array.isArray(forms) ? forms.length : 0;
    }));
  } else {
    const [statuses, permissions, questions] = await Promise.all([call("/session/status"), call("/permission"), call("/question")]);
    if (!isRecord(statuses) || !Array.isArray(permissions) || !Array.isArray(questions)) {
      throw new EngineReadError("The engine answered something unreadable.");
    }
    for (const [sessionId, status] of Object.entries(statuses)) {
      const type = readString(status, "type");
      if (!type || type === "idle") continue;
      const item = entry(sessionId);
      item.running = true;
      item.retrying = type === "retry";
      item.retryMessage = type === "retry" ? readString(status, "message") ?? null : null;
    }
    for (const request of permissions) {
      const sessionId = readString(request, "sessionID");
      if (sessionId) entry(sessionId).permissions += 1;
    }
    for (const request of questions) {
      const sessionId = readString(request, "sessionID");
      if (sessionId) entry(sessionId).questions += 1;
    }
  }
  // Details are best effort: an unreadable title never hides running work.
  const details = await Promise.all([...sessions.values()].map(async (item) => {
    try {
      const value = await call(`/session/${encodeURIComponent(item.sessionId)}`);
      const info = isRecord(value) && isRecord(value.info) ? value.info : value;
      const model = readRecordValue(info, "model");
      const providerID = readString(model, "providerID");
      const modelID = readString(model, "id") ?? readString(model, "modelID");
      const time = readRecordValue(info, "time");
      return {
        item,
        title: readString(info, "title")?.trim() || null,
        parentId: readString(info, "parentID") ?? null,
        model: providerID && modelID ? { providerID, modelID } : null,
        updatedAt: millis(readNumber(time, "updated") ?? readNumber(time, "created")),
      };
    } catch {
      return { item, title: null, parentId: null, model: null, updatedAt: null };
    }
  }));
  return details;
}

function readRecordValue(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const nested = value[key];
  return isRecord(nested) ? nested : undefined;
}

type ApplicationRef = { id: string; name: string };

async function readApplications(config: ServerConfig) {
  if (!specialistApplicationsEnabled()) return { applications: [], byWorkspace: new Map<string, ApplicationRef>() };
  const store = await specialistStore(config);
  const applications = store.list().applications;
  const byWorkspace = new Map<string, ApplicationRef>();
  for (const app of applications) {
    for (const project of store.projectsFor(app.id)) byWorkspace.set(project.workspaceId, { id: app.id, name: app.name });
  }
  return { applications, byWorkspace };
}

function taskStatus(run: SpecialistTaskRun): CommandCenterTaskItem["status"] | null {
  if (run.status === "ok" || run.status === "failed" || run.status === "blocked") return run.status;
  if (run.status === "skipped_overlap" || run.status === "skipped_missed") return "skipped";
  return null;
}

export async function describeCommandCenter(config: ServerConfig, deps: CommandCenterDeps): Promise<CommandCenterSnapshot> {
  const now = deps.now?.() ?? Date.now();
  const engine = deps.engine();
  const problems: Problem[] = [];
  const workspaceNames = new Map(config.workspaces.map(workspace => [workspace.id, workspaceLabel(workspace)]));

  let applications: Awaited<ReturnType<typeof readApplications>> = { applications: [], byWorkspace: new Map() };
  try {
    applications = await readApplications(config);
  } catch {
    problems.push({ source: "tasks", id: null, label: "", message: "The specialist applications could not be read." });
  }

  const local = config.workspaces.filter(workspace => workspace.workspaceType === "local");
  const perWorkspace = await Promise.all(local.map(async (workspace) => {
    try {
      return { workspace, sessions: await readWorkspaceSessions(config, deps, workspace, engine) };
    } catch (error) {
      problems.push({
        source: "workspace", id: workspace.id, label: workspaceLabel(workspace),
        message: error instanceof EngineReadError ? error.message : "The workspace activity could not be read.",
      });
      return { workspace, sessions: [] };
    }
  }));

  // Scheduled runs: what is running now, plus outcomes from the last day.
  const tasks: CommandCenterTaskItem[] = [];
  const taskSessionIds = new Map<string, CommandCenterTaskItem>();
  if (scheduledTasksEnabled()) {
    await Promise.all(applications.applications.map(async (app) => {
      let list: SpecialistTask[];
      try {
        list = await listTasks(config, app.id);
      } catch {
        problems.push({ source: "tasks", id: app.id, label: app.name, message: "The scheduled tasks could not be read." });
        return;
      }
      await Promise.all(list.map(async (task) => {
        const base: Pick<CommandCenterTaskItem, "kind" | "id" | "applicationId" | "applicationName" | "taskId" | "taskName" | "model" | "enabled" | "nextRunAt"> = {
          kind: "task", id: `task:${app.id}:${task.id}`, applicationId: app.id, applicationName: app.name,
          taskId: task.id, taskName: task.name, model: task.model ? { providerID: task.model.providerID, modelID: task.model.modelID } : null,
          enabled: task.enabled, nextRunAt: task.nextRunAt,
        };
        if (task.running) {
          const item: CommandCenterTaskItem = {
            ...base, status: "running", mode: task.running.mode, startedAt: task.running.startedAt,
            workspaceId: task.running.workspaceId, workspaceName: workspaceNames.get(task.running.workspaceId) ?? null,
            sessionId: task.running.sessionId, lastError: null,
          };
          tasks.push(item);
          if (task.running.sessionId) taskSessionIds.set(`${task.running.workspaceId}:${task.running.sessionId}`, item);
          return;
        }
        let runs: SpecialistTaskRun[];
        try {
          runs = await listRuns(config, app.id, task.id);
        } catch {
          problems.push({ source: "tasks", id: app.id, label: app.name, message: "The scheduled task runs could not be read." });
          return;
        }
        const latest = runs.find(run => taskStatus(run) !== null);
        const status = latest ? taskStatus(latest) : null;
        if (!latest || !status || now - latest.at > COMMAND_CENTER_RECENT_MS) return;
        tasks.push({
          ...base, status, mode: latest.mode, startedAt: latest.at,
          workspaceId: latest.workspaceId === "none" ? null : latest.workspaceId,
          workspaceName: workspaceNames.get(latest.workspaceId) ?? null,
          sessionId: latest.sessionId,
          lastError: status === "ok" ? null : latest.detail,
        });
      }));
    }));
  }

  const sessions: CommandCenterSessionItem[] = [];
  for (const { workspace, sessions: details } of perWorkspace) {
    const inFlight = new Set(details.map(detail => detail.item.sessionId));
    const subtasks = new Map<string, number>();
    for (const detail of details) {
      if (detail.parentId && inFlight.has(detail.parentId)) subtasks.set(detail.parentId, (subtasks.get(detail.parentId) ?? 0) + 1);
    }
    const app = applications.byWorkspace.get(workspace.id) ?? null;
    for (const detail of details) {
      // A sub-agent shows inside its parent's row, not as separate work.
      if (detail.parentId && inFlight.has(detail.parentId)) continue;
      const { item } = detail;
      const waitingRequests = item.permissions + item.questions;
      const scheduled = taskSessionIds.get(`${workspace.id}:${item.sessionId}`);
      if (scheduled) {
        // The task row already stands for this conversation; carry its live state there.
        if (waitingRequests > 0) scheduled.status = "waiting";
        continue;
      }
      if (!item.running && waitingRequests === 0) continue;
      sessions.push({
        kind: "session", id: `session:${workspace.id}:${item.sessionId}`,
        workspaceId: workspace.id, workspaceName: workspaceLabel(workspace),
        applicationId: app?.id ?? null, applicationName: app?.name ?? null,
        sessionId: item.sessionId, title: detail.title,
        status: item.permissions > 0 ? "waiting_permission" : item.questions > 0 ? "waiting_question" : item.retrying ? "retrying" : "running",
        engine, model: detail.model, startedAt: item.startedAt, updatedAt: detail.updatedAt,
        waitingRequests, subtasks: subtasks.get(item.sessionId) ?? 0, lastError: item.retryMessage,
      });
    }
  }

  const active = tasks.filter(task => task.status === "running" || task.status === "waiting");
  const recent = tasks.filter(task => task.status !== "running" && task.status !== "waiting")
    .sort((left, right) => (right.startedAt ?? 0) - (left.startedAt ?? 0)).slice(0, RECENT_LIMIT);
  // Waiting first (they need the person), then running, then recent outcomes.
  const rank = (item: CommandCenterSessionItem | CommandCenterTaskItem) =>
    item.status === "waiting" || item.status === "waiting_permission" || item.status === "waiting_question" ? 0
      : item.status === "running" || item.status === "retrying" ? 1 : 2;
  const time = (item: CommandCenterSessionItem | CommandCenterTaskItem) => item.startedAt ?? (item.kind === "session" ? item.updatedAt : null) ?? 0;
  const items = [...sessions, ...active, ...recent].sort((left, right) =>
    rank(left) - rank(right) || time(right) - time(left) || left.id.localeCompare(right.id));

  return commandCenterSnapshotSchema.parse({
    enabled: true,
    generatedAt: now,
    engine,
    complete: problems.length === 0,
    items,
    problems,
    counts: {
      running: items.filter(item => item.status === "running" || item.status === "retrying").length,
      waiting: items.filter(item => item.status === "waiting" || item.status === "waiting_permission" || item.status === "waiting_question").length,
      failed: items.filter(item => item.status === "failed" || item.status === "blocked").length,
    },
  });
}

/** Stop one running turn on the engine chat runs on. Resolves to whether a live run was stopped. */
export async function stopCommandCenterSession(config: ServerConfig, deps: CommandCenterDeps, workspaceId: string, sessionId: string): Promise<boolean> {
  const workspace = config.workspaces.find(entry => entry.id === workspaceId);
  if (!workspace) throw new ApiError(404, "workspace_not_found", "Workspace not found");
  const engine = deps.engine();
  const call = engineCaller(config, deps, workspace, engine);
  const path = `/session/${encodeURIComponent(sessionId)}`;
  try {
    const result = engine === "v2" ? await call(`${path}/interrupt`, {}) : await call(`${path}/abort`, {});
    return engine === "v2" ? isRecord(result) && result.interrupted === true : result === true;
  } catch (error) {
    if (error instanceof EngineReadError) throw new ApiError(502, "command_center_stop_failed", error.message);
    throw error;
  }
}

function requireEnabled() {
  if (!commandCenterEnabled()) throw new ApiError(404, "command_center_disabled", "The command center is turned off.");
}

const stopParamsSchema = z.object({ workspaceId: z.string().min(1).max(512), sessionId: z.string().min(1).max(512) });

export function registerCommandCenterRoutes(options: {
  routes: Route[];
  config: ServerConfig;
  deps: CommandCenterDeps;
  jsonResponse: (body: unknown, status?: number) => Response;
  ensureWritable: (config: ServerConfig) => void;
}) {
  const { routes, config, deps, jsonResponse, ensureWritable } = options;
  // Owner access only (the host, or a paired device): the list names every
  // workspace and conversation on this machine.
  // Not "/command-center": that is the app page, and in the web app a GET of the same path
  // would answer with this JSON instead of the page (same origin).
  addRoute(routes, "GET", "/command-center/snapshot", "host", async () => {
    requireEnabled();
    const response = jsonResponse(await describeCommandCenter(config, deps));
    response.headers.set("Cache-Control", "no-store");
    return response;
  });
  addRoute(routes, "POST", "/command-center/sessions/:workspaceId/:sessionId/stop", "host", async (ctx) => {
    requireEnabled();
    ensureWritable(config);
    const params = stopParamsSchema.safeParse(ctx.params);
    if (!params.success) throw new ApiError(400, "invalid_payload", "workspaceId and sessionId are required");
    return jsonResponse({ stopped: await stopCommandCenterSession(config, deps, params.data.workspaceId, params.data.sessionId) });
  });
}
