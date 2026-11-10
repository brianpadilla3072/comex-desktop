import { mkdir, lstat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ApiError } from "../errors.js";
import { scheduledTasksEnabled } from "../comex/features.js";
import { specialistStore } from "./store.js";
import { appendRun, finishRun, identifyRun, listTasks, missedOccurrences, nextRun, patchTask, type SpecialistTask, type SpecialistTaskRun } from "./tasks.js";
import type { ServerConfig } from "../types.js";

/** The local recurring-run loop. Mirrors task-continuity's rules: a single in-flight tick,
 *  claim-before-dispatch, and observation (never retries) of what is already running.
 *  Run metadata lives in the application's tasks store; full evidence files are written to the
 *  project workspace (comex/tareas/<taskId>/runs/) so a person — and the agent — can audit them. */

const TICK_MS = 10_000;
const RUN_TIMEOUT_MS = 15 * 60_000;
const NO_PROJECT_RETRY_MS = 30 * 60_000;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export type SpecialistScheduler = {
  /** Run one task now, outside the schedule (manual button / "probala ya"). */
  trigger: (applicationId: string, taskId: string) => Promise<{ ok: boolean; detail?: string }>;
  /** Rehearse once in a disposable session: no claim, no run log, no evidence (F3). */
  dryRun: (applicationId: string, taskId: string) => Promise<{ ok: boolean; sessionId?: string; workspaceId?: string; detail?: string }>;
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

  /**
   * The OpenCode v2 API wraps every payload as `{ data, cursor? }` while the scheduler's own
   * shapes (`{ id }`, message arrays) are unwrapped. Reading the envelope directly made every
   * dispatch fail with "El motor no devolvió el id de la sesión" — and every run stay "running"
   * until the 15-minute timeout, because the message page is not an array either. Accept both
   * shapes so a v1-shaped engine (and the test fakes) keep working.
   */
  const payload = (value: unknown): unknown => isRecord(value) && "data" in value ? value.data : value;

  /** Same hardening as the evidence folder: never accept a symbolic link in the path we write. */
  const ensureFolder = async (path: string) => {
    await mkdir(path, { recursive: true });
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ApiError(409, "task_conflict", "La carpeta comex/tareas no puede ser un enlace simbólico.");
  };

  const writeEvidence = async (rootPath: string, taskId: string, stamp: string, run: SpecialistTaskRun) => {
    const folder = join(rootPath, "comex", "tareas", taskId, "runs");
    await ensureFolder(folder);
    await writeFile(join(folder, `${stamp}.json`), JSON.stringify(run, null, 2), { mode: 0o600 });
    return `comex/tareas/${taskId}/runs/${stamp}.json`;
  };

  const dispatch = async (applicationId: string, task: SpecialistTask, mode: "scheduled" | "manual") => {
    const store = await specialistStore(config);
    const bound = store.projectsFor(applicationId).filter(project => config.workspaces.some(workspace => workspace.id === project.workspaceId));
    const project = bound[0];
    if (!project) {
      // Nothing to run in: keep the task honest about why and back off instead of spinning.
      // Note: this rewrites nextRunAt to now+30min, so a daily task that returns drifts off its
      // wall-clock time until the next recalculation — accepted over re-probing every tick.
      await patchTask(config, applicationId, task.id, t => ({ ...t, lastStatus: "blocked", nextRunAt: t.enabled ? Date.now() + NO_PROJECT_RETRY_MS : t.nextRunAt }));
      await appendRun(config, applicationId, task.id, { at: Date.now(), mode, missed: 0, workspaceId: "none", sessionId: null, status: "blocked", detail: "La aplicación no tiene ningún proyecto disponible en este host." });
      return { ok: false, detail: "La aplicación no tiene ningún proyecto disponible." };
    }
    const startedAt = Date.now();
    // CAS claim: if another route/tool/scheduler claimed first, abort instead of overwriting.
    const claimed = await patchTask(config, applicationId, task.id, t => {
      if (t.running) throw new ApiError(409, "task_running", "La tarea ya tiene una corrida en curso.");
      if (mode === "scheduled" && !t.enabled) throw new ApiError(409, "task_paused", "La tarea fue pausada antes de reclamarla.");
      return {
        ...t, lastStatus: "running", lastRunAt: startedAt, runs: t.runs + 1,
        running: {
          workspaceId: project.workspaceId, sessionId: null, startedAt, mode,
          missed: mode === "scheduled" && t.nextRunAt !== null ? missedOccurrences(t.schedule, t.nextRunAt, startedAt) : 0,
          evidencePath: null, skippedLogged: false,
        },
        nextRunAt: mode === "scheduled" ? nextRun(t.schedule, startedAt) : t.nextRunAt,
      };
    });
    const running = claimed.running!;
    let evidencePath: string | null = null;
    let sessionId: string | null = null;
    const stamp = new Date(startedAt).toISOString().replace(/[:.]/g, "-");
    const record = (status: SpecialistTaskRun["status"], detail: string | null): SpecialistTaskRun => ({
      at: startedAt, mode, missed: running.missed, workspaceId: project.workspaceId, sessionId, status, detail,
    });
    try {
      // Log the attempt first: a failed dispatch must still leave a trace.
      await appendRun(config, applicationId, task.id, record("dispatched", null));
      const created = payload(await call(project.workspaceId, "/session", { title: `Tarea programada: ${task.name}` }));
      sessionId = isRecord(created) && typeof created.id === "string" ? created.id : null;
      // The run uses the model the person pinned on the task; otherwise the engine's default.
      if (sessionId && task.model) await call(project.workspaceId, `/session/${encodeURIComponent(sessionId)}/model`, {
        model: { providerID: task.model.providerID, id: task.model.modelID },
      });
      if (sessionId) await identifyRun(config, applicationId, task.id, startedAt, sessionId);
      evidencePath = await writeEvidence(project.rootPath, task.id, stamp, record("dispatched", null));
      await patchTask(config, applicationId, task.id, t => ({ ...t, running: t.running ? { ...t.running, sessionId, evidencePath } : t.running }));
      if (!sessionId) throw new ApiError(502, "task_engine", "El motor no devolvió el id de la sesión creada.");
      await call(project.workspaceId, `/session/${encodeURIComponent(sessionId)}/prompt`, {
        text: task.prompt, delivery: "queue", metadata: { openworkScheduledTask: task.id, openworkScheduledTaskName: task.name },
      });
      return { ok: true };
    } catch (error) {
      const detail = error instanceof ApiError ? error.message : "No se pudo confirmar el envío al motor.";
      await finishRun(config, applicationId, task.id, startedAt, { status: "failed", detail });
      if (evidencePath) await writeEvidence(project.rootPath, task.id, stamp, record("failed", detail)).catch(() => undefined);
      await patchTask(config, applicationId, task.id, t => ({
        ...t, running: null, lastStatus: "failed",
        ...(t.schedule.kind === "once" ? { enabled: false } : {}),
      }));
      return { ok: false, detail };
    }
  };

  const observe = async (applicationId: string, task: SpecialistTask, projectRoot: string | null) => {
    const running = task.running;
    if (!running) return;
    const finish = async (status: "ok" | "failed", detail: string | null) => {
      await finishRun(config, applicationId, task.id, running.startedAt, { status, detail: detail ?? "" });
      if (running.evidencePath && projectRoot) {
        await writeFile(join(projectRoot, running.evidencePath), JSON.stringify({
          at: running.startedAt, mode: running.mode, missed: running.missed, workspaceId: running.workspaceId,
          sessionId: running.sessionId, status, detail: detail ?? null,
        } satisfies SpecialistTaskRun, null, 2), { mode: 0o600 }).catch(() => undefined);
      }
      await patchTask(config, applicationId, task.id, t => ({
        ...t, running: null, lastStatus: status,
        // A one-shot task retires when its run is over either way; recurring ones keep their schedule.
        ...(t.schedule.kind === "once" ? { enabled: false, nextRunAt: null } : {}),
      }));
    };
    if (Date.now() - running.startedAt > RUN_TIMEOUT_MS) { await finish("failed", "La corrida superó 15 minutos sin confirmarse; revisá el chat de la tarea."); return; }
    if (!running.sessionId) return; // crashed between claim and create; the timeout above covers it
    try {
      const messages = payload(await call(running.workspaceId, `/session/${encodeURIComponent(running.sessionId)}/message?order=desc&limit=10`));
      if (!Array.isArray(messages)) return;
      // The engine pages newest-first: take the FIRST assistant, not the oldest of the window.
      const assistant = messages.find(message => isRecord(message) && message.type === "assistant");
      if (!assistant || !isRecord(assistant) || !isRecord(assistant.time) || !Number(assistant.time.completed)) return;
      await finish("ok", null);
    } catch {
      // Engine unavailable right now: the timeout will retire the run if it never comes back.
    }
  };

  /** A due task whose earlier run is still claimed gets one skipped_overlap line (not one per tick). */
  const markSkipped = async (applicationId: string, task: SpecialistTask) => {
    const running = task.running;
    if (!running || running.skippedLogged) return;
    await appendRun(config, applicationId, task.id, {
      at: Date.now(), mode: running.mode, missed: 0, workspaceId: running.workspaceId,
      sessionId: running.sessionId, status: "skipped_overlap", detail: "Otra corrida de la misma tarea seguía en curso.",
    });
    await patchTask(config, applicationId, task.id, t => ({ ...t, running: t.running ? { ...t.running, skippedLogged: true } : t.running })).catch(() => undefined);
  };

  const tick = () => {
    if (ticking) return ticking;
    ticking = (async () => {
      if (stopped || config.readOnly || !scheduledTasksEnabled()) return;
      const store = await specialistStore(config);
      for (const application of store.list().applications) {
        if (stopped) break;
        for (const task of await listTasks(config, application.id)) {
          const roots = store.projectsFor(application.id);
          const root = roots.find(entry => entry.workspaceId === task.running?.workspaceId)?.rootPath ?? roots[0]?.rootPath ?? null;
          if (task.running) {
            await observe(application.id, task, root).catch(() => undefined);
            const fresh = (await listTasks(config, application.id)).find(entry => entry.id === task.id);
            if (fresh?.running && fresh.enabled && fresh.nextRunAt !== null && fresh.nextRunAt <= Date.now()) await markSkipped(application.id, fresh).catch(() => undefined);
            continue;
          }
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
      void store.application(applicationId); // throws 404 when the application is gone
      const task = (await listTasks(config, applicationId)).find(entry => entry.id === taskId);
      if (!task) throw new ApiError(404, "task_not_found", "Esa tarea ya no está.");
      if (task.running) throw new ApiError(409, "task_running", "La tarea ya tiene una corrida en curso.");
      return dispatch(applicationId, task, "manual");
    },
    async dryRun(applicationId, taskId) {
      // The rehearsal never claims the task: no run log entry, no evidence file, no schedule
      // change. The prompt carries a banner so the agent knows persistence is off; a session is
      // still created so the person can watch what the task WOULD do. F3 of the plan.
      const store = await specialistStore(config);
      void store.application(applicationId);
      const task = (await listTasks(config, applicationId)).find(entry => entry.id === taskId);
      if (!task) throw new ApiError(404, "task_not_found", "Esa tarea ya no está.");
      const bound = store.projectsFor(applicationId).filter(project => config.workspaces.some(workspace => workspace.id === project.workspaceId));
      const project = bound[0];
      if (!project) throw new ApiError(409, "no_workspace", "La aplicación no tiene ningún proyecto disponible para ensayar la tarea.");
      try {
        const created = payload(await call(project.workspaceId, "/session", { title: `Ensayo (sin guardar): ${task.name}` }));
        const sessionId = isRecord(created) && typeof created.id === "string" ? created.id : null;
        if (!sessionId) throw new ApiError(502, "task_engine", "El motor no devolvió el id de la sesión creada.");
        if (task.model) await call(project.workspaceId, `/session/${encodeURIComponent(sessionId)}/model`, {
          model: { providerID: task.model.providerID, id: task.model.modelID },
        });
        await call(project.workspaceId, `/session/${encodeURIComponent(sessionId)}/prompt`, {
          text: `[ENSAYO — no guardes nada: esta corrida no escribe archivos, no crea sesiones y no muta el proyecto; mostrá qué herramientas usarías y qué escribirías]\n\n${task.prompt}`,
          delivery: "queue",
          metadata: { openworkScheduledTask: task.id, openworkScheduledTaskName: task.name, openworkDryRun: true },
        });
        return { ok: true, sessionId, workspaceId: project.workspaceId };
      } catch (error) {
        return { ok: false, detail: error instanceof ApiError ? error.message : "No se pudo lanzar el ensayo." };
      }
    },
    tick,
    async stop() { stopped = true; clearInterval(timer); if (active === controller) active = undefined; },
  };
  active = controller;
  return controller;
}
