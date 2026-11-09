import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { specialistDirectory } from "./store.js";
import type { ServerConfig } from "../types.js";

/** Recurring work per specialist application. Storage and rules mirror proposals.ts:
 *  one JSON file per application, atomic writes, strict validation, hard limits. */

export const scheduleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("interval"), everyMinutes: z.number().int().min(1).max(43_200) }),
  z.object({ kind: z.literal("daily"), hour: z.number().int().min(0).max(23), minute: z.number().int().min(0).max(59) }),
  z.object({ kind: z.literal("weekly"), daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7), hour: z.number().int().min(0).max(23), minute: z.number().int().min(0).max(59) }),
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
  }).nullable(),
});
export type SpecialistTask = z.infer<typeof taskSchema>;

export const runSchema = z.object({
  at: z.number(),
  mode: z.enum(["scheduled", "manual"]),
  missed: z.number().int().nonnegative(),
  workspaceId: z.string(),
  sessionId: z.string().nullable(),
  status: z.enum(["dispatched", "ok", "failed", "blocked"]),
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

async function readJson<T>(path: string, schema: { parse: (value: unknown) => T }, fallback: T): Promise<T> {
  try { return schema.parse(JSON.parse(await readFile(path, "utf8"))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback; return fallback; }
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

export async function listTasks(config: Pick<ServerConfig, "configPath">, id: string): Promise<SpecialistTask[]> {
  const value = await readJson<unknown[]>(tasksFile(config, id), { parse: (v: unknown) => { if (!Array.isArray(v)) throw new Error("shape"); return v; } }, []);
  return value.flatMap(entry => { try { return [taskSchema.parse(entry)]; } catch { return []; } });
}

async function saveTasks(config: Pick<ServerConfig, "configPath">, id: string, tasks: SpecialistTask[]) {
  await writeJson(tasksFile(config, id), tasks);
}

/** Atomic read-modify-write by id; the editor receives the stored draft and the patch lands with a fresh updatedAt. */
async function mutate(config: Pick<ServerConfig, "configPath">, id: string, taskId: string, edit: (task: SpecialistTask) => SpecialistTask): Promise<SpecialistTask> {
  const tasks = await listTasks(config, id);
  const current = tasks.find(task => task.id === taskId);
  if (!current) throw new ApiError(404, "task_not_found", "Esa tarea ya no está.");
  const next = taskSchema.parse({ ...edit(current), updatedAt: Date.now() });
  await saveTasks(config, id, tasks.map(task => task.id === taskId ? next : task));
  return next;
}

export async function createTask(config: Pick<ServerConfig, "configPath">, id: string, input: unknown) {
  const parsed = taskInputSchema.safeParse(input);
  if (!parsed.success) throw failure("Revisá el nombre (1-120), el prompt (1-8000) y el horario de la tarea.");
  const value = parsed.data;
  if (value.schedule.kind === "once" && value.schedule.at <= Date.now()) throw failure("La hora de la ejecución única ya pasó; programá una fecha futura.");
  const tasks = await listTasks(config, id);
  if (tasks.length >= TASK_LIMIT) throw new ApiError(409, "task_limit", `Esta aplicación ya tiene ${TASK_LIMIT} tareas. Borrá alguna antes de crear otra.`);
  const duplicate = tasks.find(task => task.name === value.name);
  if (duplicate) throw new ApiError(409, "task_exists", "Ya existe una tarea con ese nombre en esta aplicación.");
  const task: SpecialistTask = {
    id: `task_${randomUUID()}`, name: value.name, prompt: value.prompt, schedule: value.schedule,
    enabled: true, createdAt: Date.now(), updatedAt: Date.now(),
    nextRunAt: nextRun(value.schedule, Date.now()), lastRunAt: null, lastStatus: null, runs: 0, running: null,
  };
  await saveTasks(config, id, [task, ...tasks]);
  return task;
}

export async function updateTask(config: Pick<ServerConfig, "configPath">, id: string, taskId: string, input: Partial<SpecialistTaskInput> & { enabled?: boolean }) {
  const current = (await listTasks(config, id)).find(task => task.id === taskId);
  if (!current) throw new ApiError(404, "task_not_found", "Esa tarea ya no está.");
  const parsed = taskInputSchema.partial().safeParse(input);
  if (!parsed.success) throw failure("Revisá los campos de la tarea.");
  const patch = parsed.data;
  if (patch.name !== undefined && patch.name !== current.name) {
    const tasks = await listTasks(config, id);
    if (tasks.some(task => task.id !== taskId && task.name === patch.name)) throw new ApiError(409, "task_exists", "Otra tarea de esta aplicación ya usa ese nombre.");
  }
  if (patch.schedule?.kind === "once") {
    const reprogrammed = current.schedule.kind !== "once" || patch.schedule.at !== current.schedule.at;
    if (reprogrammed && patch.schedule.at <= Date.now()) throw failure("La hora de la ejecución única ya pasó; programá una fecha futura.");
  }
  const schedule = patch.schedule ?? current.schedule;
  const enabled = input.enabled ?? current.enabled;
  // Editing the schedule or re-enabling recalculates; pausing keeps the claim untouched for finalize.
  const reschedule = patch.schedule !== undefined || (enabled !== current.enabled && enabled);
  return mutate(config, id, taskId, task => ({
    ...task, ...patch, schedule, enabled,
    nextRunAt: reschedule ? nextRun(schedule, Date.now()) : task.nextRunAt,
  }));
}

export async function deleteTask(config: Pick<ServerConfig, "configPath">, id: string, taskId: string) {
  const tasks = await listTasks(config, id);
  const current = tasks.find(task => task.id === taskId);
  if (!current) throw new ApiError(404, "task_not_found", "Esa tarea ya no está.");
  if (current.running) throw new ApiError(409, "task_running", "La tarea tiene una corrida en curso; esperá a que termine o pausala.");
  await saveTasks(config, id, tasks.filter(task => task.id !== taskId));
  await rm(runLogFile(config, id, taskId), { force: true }).catch(() => undefined);
  return current;
}

/** The scheduler's only mutation entry: claim/advance/finish. Everything else goes through the routes. */
export function patchTask(config: Pick<ServerConfig, "configPath">, id: string, taskId: string, edit: (task: SpecialistTask) => SpecialistTask) {
  return mutate(config, id, taskId, edit);
}

export async function listRuns(config: Pick<ServerConfig, "configPath">, id: string, taskId: string): Promise<SpecialistTaskRun[]> {
  const value = await readJson<unknown[]>(runLogFile(config, id, taskId), { parse: (v: unknown) => { if (!Array.isArray(v)) throw new Error("shape"); return v; } }, []);
  return value.flatMap(entry => { try { return [runSchema.parse(entry)]; } catch { return []; } });
}

export async function appendRun(config: Pick<ServerConfig, "configPath">, id: string, taskId: string, run: SpecialistTaskRun) {
  const runs = await listRuns(config, id, taskId);
  const next = [run, ...runs].slice(0, RUN_LOG_LIMIT);
  await writeJson(runLogFile(config, id, taskId), next);
  return next;
}

export async function finishRun(config: Pick<ServerConfig, "configPath">, id: string, taskId: string, sessionId: string | null, patch: { status: "ok" | "failed" | "blocked"; detail?: string }) {
  const runs = await listRuns(config, id, taskId);
  const index = runs.findIndex(run => run.sessionId === sessionId || (sessionId === null && run.status === "dispatched"));
  if (index >= 0 && runs[index]!.status === "dispatched") {
    runs[index] = { ...runs[index]!, status: patch.status, detail: (patch.detail ?? "").slice(0, 2000) || null };
    await writeJson(runLogFile(config, id, taskId), runs);
  }
  return runs;
}
