import { ApiError } from "../errors.js";
import { scheduledTasksEnabled } from "../comex/features.js";
import { specialistStore } from "./store.js";
import { appendRun, finishRun, listTasks, missedOccurrences, nextRun, patchTask, type SpecialistTask } from "./tasks.js";
import type { ServerConfig } from "../types.js";

/** The local recurring-run loop. Mirrors task-continuity's rules: a single in-flight tick,
 *  claim-before-dispatch, and observation (never retries) of what is already running. */

const TICK_MS = 10_000;
const RUN_TIMEOUT_MS = 15 * 60_000;
const NO_PROJECT_RETRY_MS = 30 * 60_000;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export type SpecialistScheduler = {
  /** Run one task now, outside the schedule (manual button / "probala ya"). */
  trigger: (applicationId: string, taskId: string) => Promise<{ ok: boolean; detail?: string }>;
  tick: () => Promise<void>;
  stop: () => Promise<void>;
};

let active: SpecialistScheduler | undefined;
export function currentSpecialistScheduler(): SpecialistScheduler | undefined { return active; }

export async function createSpecialistScheduler(config: ServerConfig, request: (request: Request) => Promise<Response>) {
  let stopped = false;
  let ticking: Promise<void> | undefined;

  const call = async (workspaceId: string, path: string, body?: unknown): Promise<unknown> => {
    const response = await request(new Request(`http://127.0.0.1:${config.port}/workspace/${encodeURIComponent(workspaceId)}/opencode2/api${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json", "x-openwork-task-recovery": "off" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20_000),
    }));
    if (!response.ok) { await response.body?.cancel(); throw new ApiError(502, "task_engine", `El motor respondió ${response.status}.`); }
    return response.status === 204 ? null : await response.json();
  };

  const dispatch = async (applicationId: string, task: SpecialistTask, mode: "scheduled" | "manual") => {
    const store = await specialistStore(config);
    const bound = store.projectsFor(applicationId).filter(project => config.workspaces.some(workspace => workspace.id === project.workspaceId));
    const project = bound[0];
    if (!project) {
      // Nothing to run in: keep the task honest about why and back off instead of spinning.
      await patchTask(config, applicationId, task.id, t => ({ ...t, lastStatus: "blocked", nextRunAt: t.enabled ? Date.now() + NO_PROJECT_RETRY_MS : t.nextRunAt }));
      await appendRun(config, applicationId, task.id, { at: Date.now(), mode, missed: 0, workspaceId: "none", sessionId: null, status: "blocked", detail: "La aplicación no tiene ningún proyecto disponible en este host." });
      return { ok: false, detail: "La aplicación no tiene ningún proyecto disponible." };
    }
    const claimed = await patchTask(config, applicationId, task.id, t => ({
      ...t, lastStatus: "running", lastRunAt: Date.now(), runs: t.runs + 1,
      running: {
        workspaceId: project.workspaceId, sessionId: null, startedAt: Date.now(), mode,
        missed: mode === "scheduled" && t.nextRunAt !== null ? missedOccurrences(t.schedule, t.nextRunAt, Date.now()) : 0,
      },
      nextRunAt: mode === "scheduled" ? nextRun(t.schedule, Date.now()) : t.nextRunAt,
    }));
    const running = claimed.running;
    if (!running) throw new ApiError(409, "task_running", "No se pudo reclamar la tarea.");
    try {
      const created = await call(project.workspaceId, "/session", { title: `Tarea programada: ${task.name}` });
      const sessionId = isRecord(created) && typeof created.id === "string" ? created.id : null;
      await patchTask(config, applicationId, task.id, t => ({ ...t, running: t.running ? { ...t.running, sessionId } : t.running }));
      await appendRun(config, applicationId, task.id, { at: Date.now(), mode, missed: running.missed, workspaceId: project.workspaceId, sessionId, status: "dispatched", detail: null });
      if (!sessionId) throw new ApiError(502, "task_engine", "El motor no devolvió el id de la sesión creada.");
      await call(project.workspaceId, `/session/${encodeURIComponent(sessionId)}/prompt`, {
        text: task.prompt, delivery: "queue", metadata: { openworkScheduledTask: task.id, openworkScheduledTaskName: task.name },
      });
      return { ok: true };
    } catch (error) {
      await finishRun(config, applicationId, task.id, null, { status: "failed", detail: error instanceof ApiError ? error.message : "No se pudo confirmar el envío al motor." });
      await patchTask(config, applicationId, task.id, t => ({ ...t, running: null, lastStatus: "failed" }));
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  };

  const observe = async (applicationId: string, task: SpecialistTask) => {
    const running = task.running;
    if (!running) return;
    const finish = async (status: "ok" | "failed", detail: string | null) => {
      await finishRun(config, applicationId, task.id, running.sessionId, { status, detail: detail ?? "" });
      await patchTask(config, applicationId, task.id, t => ({
        ...t, running: null, lastStatus: status,
        // A one-shot task retires when its run is over; recurring ones keep their schedule.
        ...(t.schedule.kind === "once" && status === "ok" ? { enabled: false, nextRunAt: null } : {}),
      }));
    };
    if (Date.now() - running.startedAt > RUN_TIMEOUT_MS) { await finish("failed", "La corrida superó 15 minutos sin confirmarse; revisá el chat de la tarea."); return; }
    if (!running.sessionId) return; // crashed between claim and create; the timeout above covers it
    try {
      const messages = await call(running.workspaceId, `/session/${encodeURIComponent(running.sessionId)}/message?order=desc&limit=10`);
      if (!Array.isArray(messages)) return;
      const assistant = [...messages].reverse().find(message => isRecord(message) && message.type === "assistant");
      if (!assistant || !isRecord(assistant) || !isRecord(assistant.time) || !Number(assistant.time.completed)) return;
      await finish("ok", null);
    } catch {
      // Engine unavailable right now: the timeout will retire the run if it never comes back.
    }
  };

  const tick = () => {
    if (ticking) return ticking;
    ticking = (async () => {
      if (stopped || config.readOnly || !scheduledTasksEnabled()) return;
      const store = await specialistStore(config);
      for (const application of store.list().applications) {
        if (stopped) break;
        for (const task of await listTasks(config, application.id)) {
          if (task.running) { await observe(application.id, task).catch(() => undefined); continue; }
          if (task.enabled && task.nextRunAt !== null && task.nextRunAt <= Date.now()) await dispatch(application.id, task, "scheduled").catch(() => undefined);
        }
      }
    })().finally(() => { ticking = undefined; });
    return ticking;
  };

  const timer = setInterval(() => void tick().catch(() => undefined), TICK_MS);
  timer.unref();

  const controller: SpecialistScheduler = {
    async trigger(applicationId, taskId) {
      const store = await specialistStore(config);
      store.application(applicationId);
      const task = (await listTasks(config, applicationId)).find(entry => entry.id === taskId);
      if (!task) throw new ApiError(404, "task_not_found", "Esa tarea ya no está.");
      if (task.running) throw new ApiError(409, "task_running", "La tarea ya tiene una corrida en curso.");
      return dispatch(applicationId, task, "manual");
    },
    tick,
    async stop() { stopped = true; clearInterval(timer); },
  };
  active = controller;
  return controller;
}
