import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ApiError } from "./errors.js";
import {
  comexArtifactsEnabled, resultsInboxEnabled, scheduledTasksEnabled, specialistApplicationsEnabled, studioOutputsEnabled,
} from "./comex/features.js";
import {
  INBOX_ITEM_LIMIT, INBOX_RETENTION_MS, applySeen, inboxEndedAt, inboxItemId, inboxItemIdSchema, inboxStatus, inboxStatusSchema,
  linkOutputs, pruneSeen, seenStoreSchema, type OutputCandidate, type SeenEntry,
} from "./results-inbox-core.js";
import { addRoute, type Route } from "./routes/registry.js";
import { listArtifacts } from "./specialists/artifacts.js";
import { readIsolation } from "./specialists/isolation/service.js";
import { listOutputs } from "./specialists/outputs.js";
import { specialistDirectory, specialistStore } from "./specialists/store.js";
import { listRuns, listTasks, runSchema } from "./specialists/tasks.js";
import type { ServerConfig, WorkspaceInfo } from "./types.js";

/**
 * Results inbox (docs/features/results-inbox): every finished scheduled task run across all
 * specialist applications, with the conversation to open, the outputs it wrote, its isolated
 * review state and a seen mark kept on the server so every device agrees. Results are read
 * fresh from the task run logs on every call; only the seen marks are stored here.
 */

type InboxConfig = Pick<ServerConfig, "configPath" | "workspaces">;

const outputSchema = z.object({
  kind: z.enum(["output", "artifact"]),
  id: z.string(),
  title: z.string(),
  type: z.string(),
  workspaceId: z.string(),
  updatedAt: z.number(),
});

export const resultsInboxItemSchema = z.object({
  id: inboxItemIdSchema,
  applicationId: z.string(),
  applicationName: z.string(),
  taskId: z.string(),
  taskName: z.string(),
  status: inboxStatusSchema,
  mode: z.enum(["scheduled", "manual"]),
  detail: z.string().nullable(),
  startedAt: z.number(),
  /** Null when the finish was not recorded (runs logged before this feature). */
  finishedAt: z.number().nullable(),
  /** What the inbox sorts and groups by: the finish, or the start when it is unknown. */
  endedAt: z.number(),
  workspaceId: z.string().nullable(),
  workspaceName: z.string().nullable(),
  sessionId: z.string().nullable(),
  isolation: z.object({ id: z.string(), review: z.enum(["pending", "reviewed"]) }).nullable(),
  outputs: z.array(outputSchema),
  seen: z.boolean(),
  seenAt: z.number().nullable(),
});

export const resultsInboxProblemSchema = z.object({
  source: z.enum(["applications", "tasks", "outputs", "seen"]),
  id: z.string().nullable(),
  label: z.string(),
  message: z.string(),
});

export const resultsInboxCountsSchema = z.object({
  total: z.number().int().nonnegative(),
  unseen: z.number().int().nonnegative(),
  needsReview: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});

export const resultsInboxSnapshotSchema = z.object({
  enabled: z.literal(true),
  generatedAt: z.number(),
  /** False when a source could not be read; the list may then be missing results. */
  complete: z.boolean(),
  items: z.array(resultsInboxItemSchema),
  problems: z.array(resultsInboxProblemSchema),
  counts: resultsInboxCountsSchema,
});

export const resultsInboxSummarySchema = z.object({
  enabled: z.literal(true),
  generatedAt: z.number(),
  complete: z.boolean(),
  counts: resultsInboxCountsSchema,
});

export const resultsInboxSeenInputSchema = z.object({
  ids: z.array(inboxItemIdSchema).min(1).max(INBOX_ITEM_LIMIT),
  seen: z.boolean().default(true),
}).strict();

export const resultsInboxSeenAllInputSchema = z.object({
  /** Only results that ended at or before this instant (the snapshot the person looked at). */
  upTo: z.number().int().nonnegative().optional(),
}).strict();

export type ResultsInboxItem = z.infer<typeof resultsInboxItemSchema>;
export type ResultsInboxSnapshot = z.infer<typeof resultsInboxSnapshotSchema>;
type Problem = z.infer<typeof resultsInboxProblemSchema>;

const seenFile = (config: Pick<ServerConfig, "configPath">) => join(specialistDirectory(config), "results-inbox.json");

async function readSeen(config: Pick<ServerConfig, "configPath">, now: number): Promise<SeenEntry[]> {
  let text: string;
  try {
    text = await readFile(seenFile(config), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  let parsed: ReturnType<typeof seenStoreSchema.safeParse>;
  try { parsed = seenStoreSchema.safeParse(JSON.parse(text)); } catch { throw new ApiError(409, "results_inbox_unreadable", "The results inbox seen marks are damaged."); }
  if (!parsed.success) throw new ApiError(409, "results_inbox_unreadable", "The results inbox seen marks are damaged.");
  return pruneSeen(parsed.data.seen, now);
}

async function writeSeen(config: Pick<ServerConfig, "configPath">, entries: SeenEntry[]) {
  const path = seenFile(config);
  await mkdir(specialistDirectory(config), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify({ version: 1, seen: entries }, null, 2), { mode: 0o600 });
  await rename(temporary, path);
}

/** Write queue for the seen file. Owner: this module; lifetime: the server process. Every
 *  read-modify-write of the seen marks runs through it so concurrent devices never lose marks. */
let seenChain: Promise<unknown> = Promise.resolve();
function serializeSeen<T>(work: () => Promise<T>): Promise<T> {
  const current = seenChain.then(work, work);
  seenChain = current.then(() => undefined, () => undefined);
  return current;
}

const workspaceLabel = (workspace: WorkspaceInfo) => workspace.displayName?.trim() || workspace.name?.trim() || workspace.path.split("/").pop() || workspace.id;

type CollectOptions = { now: number; withOutputs: boolean };

/** Results across every application, newest first, without seen state. */
async function collectResults(config: InboxConfig, options: CollectOptions) {
  const problems: Problem[] = [];
  const results: Array<Omit<ResultsInboxItem, "seen" | "seenAt">> = [];
  if (!specialistApplicationsEnabled() || !scheduledTasksEnabled()) return { results, problems };
  let applications: Array<{ id: string; name: string }>;
  let projects: (applicationId: string) => Array<{ workspaceId: string }>;
  try {
    const store = await specialistStore(config);
    applications = store.list().applications;
    projects = applicationId => store.projectsFor(applicationId);
  } catch {
    problems.push({ source: "applications", id: null, label: "", message: "The specialist applications could not be read." });
    return { results, problems };
  }
  const workspaces = new Map(config.workspaces.map(workspace => [workspace.id, workspace]));
  // Outputs and artifacts are read once per project, only when a result needs them.
  const outputCache = new Map<string, Promise<OutputCandidate[] | null>>();
  const outputsFor = (applicationId: string, applicationName: string, workspaceId: string) => {
    const key = `${applicationId}:${workspaceId}`;
    let pending = outputCache.get(key);
    if (!pending) {
      pending = (async () => {
        const workspace = workspaces.get(workspaceId);
        if (!workspace || !projects(applicationId).some(project => project.workspaceId === workspaceId)) return [];
        try {
          const [outputs, artifacts] = await Promise.all([
            studioOutputsEnabled() ? listOutputs(workspace.path) : Promise.resolve([]),
            comexArtifactsEnabled() ? listArtifacts(workspace.path) : Promise.resolve([]),
          ]);
          const candidates: OutputCandidate[] = [];
          for (const output of outputs) candidates.push({ kind: "output", id: output.id, title: output.title, type: output.kind, workspaceId, createdAt: output.createdAt, updatedAt: output.updatedAt });
          for (const artifact of artifacts) candidates.push({ kind: "artifact", id: artifact.id, title: artifact.title, type: artifact.type, workspaceId, createdAt: artifact.createdAt, updatedAt: artifact.updatedAt });
          return candidates;
        } catch {
          problems.push({ source: "outputs", id: workspaceId, label: `${applicationName} · ${workspaceLabel(workspace)}`, message: "The outputs of this project could not be read." });
          return null;
        }
      })();
      outputCache.set(key, pending);
    }
    return pending;
  };

  await Promise.all(applications.map(async (app) => {
    let tasks: Awaited<ReturnType<typeof listTasks>>;
    try {
      tasks = await listTasks(config, app.id);
    } catch {
      problems.push({ source: "tasks", id: app.id, label: app.name, message: "The scheduled tasks could not be read." });
      return;
    }
    await Promise.all(tasks.map(async (task) => {
      const runs = await listRuns(config, app.id, task.id);
      await Promise.all(runs.map(async (entry) => {
        const run = runSchema.parse(entry);
        const status = inboxStatus(run.status);
        if (!status) return;
        const endedAt = inboxEndedAt(run);
        if (options.now - endedAt > INBOX_RETENTION_MS) return;
        const workspaceId = run.workspaceId === "none" ? null : run.workspaceId;
        const workspace = workspaceId ? workspaces.get(workspaceId) : undefined;
        let isolation: ResultsInboxItem["isolation"] = null;
        if (run.isolationId) {
          const record = await readIsolation(config, app.id, run.isolationId).catch(() => null);
          isolation = { id: run.isolationId, review: record?.status === "active" ? "pending" : "reviewed" };
        }
        const candidates = options.withOutputs && workspaceId && (status === "ok" || status === "failed")
          ? await outputsFor(app.id, app.name, workspaceId) ?? []
          : [];
        results.push({
          id: inboxItemId(app.id, task.id, run.at),
          applicationId: app.id, applicationName: app.name, taskId: task.id, taskName: task.name,
          status, mode: run.mode, detail: status === "ok" ? null : run.detail,
          startedAt: run.at, finishedAt: run.finishedAt, endedAt,
          workspaceId, workspaceName: workspace ? workspaceLabel(workspace) : null,
          sessionId: run.sessionId, isolation,
          outputs: linkOutputs({ status, at: run.at, finishedAt: run.finishedAt, workspaceId }, candidates)
            .map(({ kind, id, title, type, workspaceId: where, updatedAt }) => ({ kind, id, title, type, workspaceId: where, updatedAt })),
        });
      }));
    }));
  }));
  results.sort((left, right) => right.endedAt - left.endedAt || left.id.localeCompare(right.id));
  return { results: results.slice(0, INBOX_ITEM_LIMIT), problems };
}

function countItems(items: ResultsInboxItem[]) {
  return {
    total: items.length,
    unseen: items.filter(item => !item.seen).length,
    needsReview: items.filter(item => item.isolation?.review === "pending").length,
    failed: items.filter(item => item.status === "failed" || item.status === "blocked").length,
  };
}

async function withSeen(config: InboxConfig, options: CollectOptions) {
  const { results, problems } = await collectResults(config, options);
  let seen: SeenEntry[] = [];
  try {
    seen = await readSeen(config, options.now);
  } catch {
    problems.push({ source: "seen", id: null, label: "", message: "The seen marks could not be read; every result shows as unread." });
  }
  const seenAt = new Map(seen.map(entry => [entry.id, entry.seenAt]));
  const items = results.map(result => ({ ...result, seen: seenAt.has(result.id), seenAt: seenAt.get(result.id) ?? null }));
  return { items, problems };
}

export async function describeResultsInbox(config: InboxConfig, now = Date.now()): Promise<ResultsInboxSnapshot> {
  const { items, problems } = await withSeen(config, { now, withOutputs: true });
  return resultsInboxSnapshotSchema.parse({ enabled: true, generatedAt: now, complete: problems.length === 0, items, problems, counts: countItems(items) });
}

/** Counts only, for the sidebar badge: skips reading outputs. */
export async function summarizeResultsInbox(config: InboxConfig, now = Date.now()) {
  const { items, problems } = await withSeen(config, { now, withOutputs: false });
  return resultsInboxSummarySchema.parse({ enabled: true, generatedAt: now, complete: problems.length === 0, counts: countItems(items) });
}

export function markResultsSeen(config: Pick<ServerConfig, "configPath">, ids: readonly string[], seen: boolean, now = Date.now()) {
  return serializeSeen(async () => {
    const current = await readSeen(config, now).catch((error: unknown) => {
      // A damaged file is replaced rather than blocking the person forever; anything else surfaces.
      if (error instanceof ApiError && error.code === "results_inbox_unreadable") return [];
      throw error;
    });
    const next = applySeen(current, ids, seen, now);
    await writeSeen(config, next);
    return { updated: ids.length };
  });
}

export async function markAllResultsSeen(config: InboxConfig, upTo: number | undefined, now = Date.now()) {
  const limit = upTo ?? now;
  const { results } = await collectResults(config, { now, withOutputs: false });
  const ids = results.filter(result => result.endedAt <= limit).map(result => result.id);
  if (ids.length === 0) return { updated: 0 };
  return markResultsSeen(config, ids, true, now);
}

function requireEnabled() {
  if (!resultsInboxEnabled()) throw new ApiError(404, "results_inbox_disabled", "The results inbox is turned off.");
}

export function registerResultsInboxRoutes(options: {
  routes: Route[];
  config: ServerConfig;
  readJsonBody: (request: Request) => Promise<Record<string, unknown>>;
  jsonResponse: (body: unknown, status?: number) => Response;
  ensureWritable: (config: ServerConfig) => void;
}) {
  const { routes, config, readJsonBody, jsonResponse, ensureWritable } = options;
  const noStore = (response: Response) => { response.headers.set("Cache-Control", "no-store"); return response; };
  // Owner access only (the host, or a paired device): results name every application,
  // project and conversation on this machine.
  addRoute(routes, "GET", "/results-inbox", "host", async () => {
    requireEnabled();
    return noStore(jsonResponse(await describeResultsInbox(config)));
  });
  addRoute(routes, "GET", "/results-inbox/summary", "host", async () => {
    requireEnabled();
    return noStore(jsonResponse(await summarizeResultsInbox(config)));
  });
  addRoute(routes, "POST", "/results-inbox/seen", "host", async (ctx) => {
    requireEnabled();
    ensureWritable(config);
    const parsed = resultsInboxSeenInputSchema.safeParse(await readJsonBody(ctx.request));
    if (!parsed.success) throw new ApiError(400, "invalid_payload", "Send ids (1 to 200 result ids) and seen (true or false).");
    return jsonResponse(await markResultsSeen(config, parsed.data.ids, parsed.data.seen));
  });
  addRoute(routes, "POST", "/results-inbox/seen-all", "host", async (ctx) => {
    requireEnabled();
    ensureWritable(config);
    const parsed = resultsInboxSeenAllInputSchema.safeParse(await readJsonBody(ctx.request));
    if (!parsed.success) throw new ApiError(400, "invalid_payload", "upTo must be an instant in epoch milliseconds.");
    return jsonResponse(await markAllResultsSeen(config, parsed.data.upTo));
  });
}
