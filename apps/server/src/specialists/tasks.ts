import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { specialistDirectory } from "./store.js";
import type { ServerConfig } from "../types.js";

/** Recurring work per specialist application. Storage mirrors proposals.ts (one JSON file per
 *  application, atomic writes, strict validation, hard limits); full run evidence goes to the
 *  project workspace (comex/tareas/) from scheduler.ts. Every read-modify-write here is
 *  serialized per application: bun is single-threaded but the awaits between read and write are
 *  exactly where a concurrent route/scheduler/tool mutation would otherwise lose updates. */

const uniqueDays = z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(days => new Set(days).size === days.length, "daysOfWeek no puede tener días repetidos");

export const scheduleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("interval"), everyMinutes: z.number().int().min(1).max(43_200) }),
  z.object({ kind: z.literal("daily"), hour: z.number().int().min(0).max(23), minute: z.number().int().min(0).max(59) }),
  z.object({ kind: z.literal("weekly"), daysOfWeek: uniqueDays, hour: z.number().int().min(0).max(23), minute: z.number().int().min(0).max(59) }),
  z.object({ kind: z.literal("once"), at: z.number().int() }),
]);
export type SpecialistSchedule = z.infer<typeof scheduleSchema>;

export const taskSchema = z.object({
  id: z.string(),
  name: z.string(),
  prompt: z.string(),
  schedule: scheduleSchema,
  enabled: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
  nextRunAt: z.number().nullable(),
  lastRunAt: z.number().nullable(),
  /** The last outcome the scheduler observed; "running" while a dispatch is in flight. */
  lastStatus: z.enum(["ok", "failed", "blocked", "running"]).nullable(),
  runs: z.number().int().nonnegative(),
  /** Claim written before dispatch and cleared when the run is observed to finish. */
  running: z.object({
    workspaceId: z.string(),
    sessionId: z.string().nullable(),
    startedAt: z.number(),
    mode: z.enum(["scheduled", "manual"]),
    /** Occurrences skipped by a restart or a long pause; coalesced into this one run. */
    missed: z.number().int().nonnegative(),
    /** Workspace-relative evidence file for this run; written once dispatched. */
    evidencePath: z.string().nullable().default(null),
    /** One "skipped_overlap" log line per claimed run, not one per tick. */
    skippedLogged: z.boolean().default(false),
  }).nullable(),
});
export type SpecialistTask = z.infer<typeof taskSchema>;

export const runSchema = z.object({
  at: z.number(),
  mode: z.enum(["scheduled", "manual"]),
  missed: z.number().int().nonnegative(),
  workspaceId: z.string(),
  sessionId: z.string().nullable(),
  status: z.enum(["dispatched", "ok", "failed", "blocked", "skipped_overlap"]),
  detail: z.string().max(2000).nullable(),
});
export type SpecialistTaskRun = z.infer<typeof runSchema>;

export const taskInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(8000),
  schedule: scheduleSchema,
});
export type SpecialistTaskInput = z.infer<typeof taskInputSchema>;

const TASK_LIMIT = 20;
const RUN_LOG_LIMIT = 20;

const failure = (message: string) => new ApiError(422, "invalid_task", message);
const tasksFile = (config: Pick<ServerConfig, "configPath">, id: string) => join(specialistDirectory(config), id, "tasks.json");
const runLogFile = (config: Pick<ServerConfig, "configPath">, id: string, taskId: string) => join(specialistDirectory(config), id, "tasks", `${taskId}.json`);

const chains = new Map<string, Promise<unknown>>();
function serialize<T>(id: string, work: () => Promise<T>): Promise<T> {
  const previous = chains.get(id) ?? Promise.resolve();
  const current = previous.then(work, work);
  chains.set(id, current.then(() => undefined, () => undefined));
  return current;
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try { const value: unknown = JSON.parse(await readFile(path, "utf8")); return value as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback; throw error; }
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(temporary, path);
}

/** The first instant strictly after `from` at which this schedule fires. Null when finished. */
export function nextRun(schedule: SpecialistSchedule, from: number): number | null {
  if (schedule.kind === "once") return schedule.at > from ? schedule.at : null;
  if (schedule.kind === "interval") return from + schedule.everyMinutes * 60_000;
  const start = new Date(from);
  for (let day = 0; day <= 7; day++) {
    const candidate = new Date(start.getFullYear(), start.getMonth(), start.getDate() + day, schedule.hour, schedule.minute, 0, 0);
    if (candidate.getTime() <= from) continue;
    if (schedule.kind === "daily" || schedule.daysOfWeek.includes(candidate.getDay())) return candidate.getTime();
  }
  return null;
}

/** Occurrences lost between `due` and `now` (coalesced, never replayed as a burst). */
export function missedOccurrences(schedule: SpecialistSchedule, due: number, now: number): number {
  if (schedule.kind !== "interval") return due < now ? 1 : 0;
  return Math.max(0, Math.floor((now - due) / (schedule.everyMinutes * 60_000)));
}

async function loadTasks(config: Pick<ServerConfig, "configPath">, id: string): Promise<SpecialistTask[]> {
  const value = await readJson<unknown>(tasksFile(config, id), []);
  if (!Array.isArray(value)) return [];
  return value.flatMap(entry => { try { return [taskSchema.parse(entry)]; } catch { return []; } });
}

export function listTasks(config: Pick<ServerConfig, "configPath">, id: string): Promise<SpecialistTask[]> {
  return loadTasks(config, id);
}

/** Atomic read-modify-write by id under the application's serialization chain. */
function mutate(config: Pick<ServerConfig, "configPath">, id: string, taskId: string, edit: (task: SpecialistTask) => SpecialistTask): Promise<SpecialistTask> {
  return serialize(id, async () => {
    const tasks = await loadTasks(config, id);
    const current = tasks.find(task => task.id === taskId);
    if (!current) throw new ApiError(404, "task_not_found", "Esa tarea ya no está.");
    const next = taskSchema.parse({ ...edit(current), updatedAt: Date.now() });
    await writeJson(tasksFile(config, id), tasks.map(task => task.id === taskId ? next : task));
    return next;
  });
}

export async function createTask(config: Pick<ServerConfig, "configPath">, id: string, input: unknown, options: { enabled?: boolean } = {}) {
  const parsed = taskInputSchema.safeParse(input);
  if (!parsed.success) throw failure("Revisá el nombre (1-120), el prompt (1-8000) y el horario de la tarea.");
  const value = parsed.data;
  if (value.schedule.kind === "once" && value.schedule.at <= Date.now()) throw failure("La hora de la ejecución única ya pasó; programá una fecha futura.");
  const enabled = options.enabled ?? true;
  return serialize(id, async () => {
    const tasks = await loadTasks(config, id);
    if (tasks.length >= TASK_LIMIT) throw new ApiError(409, "task_limit", `Esta aplicación ya tiene ${TASK_LIMIT} tareas. Borrá alguna antes de crear otra.`);
    if (tasks.some(task => task.name === value.name)) throw new ApiError(409, "task_exists", "Ya existe una tarea con ese nombre en esta aplicación.");
    const task: SpecialistTask = {
      id: `task_${randomUUID()}`, name: value.name, prompt: value.prompt, schedule: value.schedule,
      // Accepted proposals are born PAUSED (the plan's rule): a task that runs unseen once is the
      // recipe for ghost data. Re-enabling recalculates nextRunAt from the current instant.
      enabled, createdAt: Date.now(), updatedAt: Date.now(),
      nextRunAt: enabled ? nextRun(value.schedule, Date.now()) : null, lastRunAt: null, lastStatus: null, runs: 0, running: null,
    };
    await writeJson(tasksFile(config, id), [task, ...tasks]);
    return task;
  });
}

export async function updateTask(config: Pick<ServerConfig, "configPath">, id: string, taskId: string, input: Partial<SpecialistTaskInput> & { enabled?: boolean }) {
  const parsed = taskInputSchema.partial().safeParse(input);
  if (!parsed.success) throw failure("Revisá los campos de la tarea.");
  const patch = parsed.data;
  return serialize(id, async () => {
    const tasks = await loadTasks(config, id);
    const current = tasks.find(task => task.id === taskId);
    if (!current) throw new ApiError(404, "task_not_found", "Esa tarea ya no está.");
    if (patch.name !== undefined && patch.name !== current.name && tasks.some(task => task.id !== taskId && task.name === patch.name)) {
      throw new ApiError(409, "task_exists", "Otra tarea de esta aplicación ya usa ese nombre.");
    }
    if (patch.schedule?.kind === "once" && (current.schedule.kind !== "once" || patch.schedule.at !== current.schedule.at) && patch.schedule.at <= Date.now()) {
      throw failure("La hora de la ejecución única ya pasó; programá una fecha futura.");
    }
    const schedule = patch.schedule ?? current.schedule;
    const enabled = input.enabled ?? current.enabled;
    // Editing the schedule or re-enabling recalculates. Pausing clears the slot: a paused task
    // holds no next run (the claim, if any, is what finalize is still observing).
    const next = taskSchema.parse({
      ...current, ...patch, schedule, enabled,
      nextRunAt: enabled ? (patch.schedule !== undefined || current.enabled === false ? nextRun(schedule, Date.now()) : current.nextRunAt) : null,
      updatedAt: Date.now(),
    });
    await writeJson(tasksFile(config, id), tasks.map(task => task.id === taskId ? next : task));
    return next;
  });
}

export function deleteTask(config: Pick<ServerConfig, "configPath">, id: string, taskId: string) {
  return serialize(id, async () => {
    const tasks = await loadTasks(config, id);
    const current = tasks.find(task => task.id === taskId);
    if (!current) throw new ApiError(404, "task_not_found", "Esa tarea ya no está.");
    if (current.running) throw new ApiError(409, "task_running", "La tarea tiene una corrida en curso; esperá a que termine o pausala.");
    await writeJson(tasksFile(config, id), tasks.filter(task => task.id !== taskId));
    await rm(runLogFile(config, id, taskId), { force: true }).catch(() => undefined);
    return current;
  });
}

/** F4 run budget: an honest local estimate in time/space (not cloud quota) shown when a person
 *  creates or activates a task — the "AI Usage bar" adapted: the cost here is model time and
 *  snapshot space on this machine. Pure math over the schedule + prompt length. */
export type TaskBudget = {
  runsPerDay: number;
  /** Rough per-run token estimate: prompt size × a few back-and-forth turns of context. */
  estTokensPerRun: number;
  estTokensPerDay: number;
  /** Snapshot growth estimate in MB/day, assuming each run's output is ~2× the prompt size. */
  estSnapshotsMBPerDay: number;
  note: string;
};
export function estimateTaskBudget(task: Pick<SpecialistTask, "prompt" | "schedule">): TaskBudget {
  const runsPerDay = task.schedule.kind === "interval" ? 1440 / task.schedule.everyMinutes
    : task.schedule.kind === "daily" ? 1
    : task.schedule.kind === "weekly" ? 1 / 7
    : task.schedule.kind === "once" ? 0 : 0;
  const estTokensPerRun = Math.round((task.prompt.length / 4) * 8);
  const estSnapshotsMBPerDay = Math.round(((task.prompt.length * 2) * runsPerDay / 1_000_000) * 10) / 10;
  const note = task.schedule.kind === "once"
    ? "Una sola corrida: sin costo recurrente."
    : `≈ ${Math.round(runsPerDay * 10) / 10} corridas/día · ≈ ${(estTokensPerRun * runsPerDay / 1000).toFixed(0)}k tokens/día · ≈ ${estSnapshotsMBPerDay} MB/día de snapshots en el proyecto.`;
  return { runsPerDay: Math.round(runsPerDay * 100) / 100, estTokensPerRun, estTokensPerDay: Math.round(estTokensPerRun * runsPerDay), estSnapshotsMBPerDay, note };
}

/** The scheduler's mutation entry (claim/advance/finish), serialized like the rest. */
export function patchTask(config: Pick<ServerConfig, "configPath">, id: string, taskId: string, edit: (task: SpecialistTask) => SpecialistTask) {
  return mutate(config, id, taskId, edit);
}

export async function listRuns(config: Pick<ServerConfig, "configPath">, id: string, taskId: string): Promise<SpecialistTaskRun[]> {
  const value = await readJson<unknown>(runLogFile(config, id, taskId), []);
  if (!Array.isArray(value)) return [];
  return value.flatMap(entry => { try { return [runSchema.parse(entry)]; } catch { return []; } });
}

export function appendRun(config: Pick<ServerConfig, "configPath">, id: string, taskId: string, run: SpecialistTaskRun) {
  return serialize(id, async () => {
    const runs = await listRuns(config, id, taskId);
    const next = [run, ...runs].slice(0, RUN_LOG_LIMIT);
    await writeJson(runLogFile(config, id, taskId), next);
    return next;
  });
}

/** Record which engine session a dispatched entry belongs to (the log must never stay sessionId-less). */
export function identifyRun(config: Pick<ServerConfig, "configPath">, id: string, taskId: string, at: number, sessionId: string) {
  return serialize(id, async () => {
    const runs = await listRuns(config, id, taskId);
    const index = runs.findIndex(run => run.at === at && run.status === "dispatched");
    if (index >= 0) {
      runs[index] = { ...runs[index]!, sessionId };
      await writeJson(runLogFile(config, id, taskId), runs);
    }
    return runs;
  });
}

/** Close the dispatched entry created at exactly `at` (never an older orphan). */
export function finishRun(config: Pick<ServerConfig, "configPath">, id: string, taskId: string, at: number, patch: { status: "ok" | "failed" | "blocked" | "skipped_overlap"; detail?: string }) {  return serialize(id, async () => {
    const runs = await listRuns(config, id, taskId);
    const index = runs.findIndex(run => run.at === at && run.status === "dispatched");
    if (index >= 0) {
      runs[index] = { ...runs[index]!, status: patch.status, detail: (patch.detail ?? "").slice(0, 2000) || null };
      await writeJson(runLogFile(config, id, taskId), runs);
    }
    return runs;
  });
}
