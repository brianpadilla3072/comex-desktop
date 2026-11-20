import { mkdir, lstat, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ApiError } from "../errors.js";
import { projectsExperienceEnabled, scheduledTasksEnabled, taskIsolationReviewEnabled } from "../comex/features.js";
import { nativeSessionDirectory } from "../opencode-v2-session-home.js";
import { closeIsolation, createIsolation } from "./isolation/service.js";
import { specialistStore } from "./store.js";
import { dataPath, dataRelative } from "./project-data.js";
import { appendRun, finishRun, identifyRun, isolateRun, listTasks, missedOccurrences, nextRun, patchTask, type SpecialistTask, type SpecialistTaskRun, type TaskPermissionMode } from "./tasks.js";
import type { ServerConfig } from "../types.js";

/** The local recurring-run loop. Mirrors task-continuity's rules: a single in-flight tick,
 *  claim-before-dispatch, and observation (never retries) of what is already running.
 *  Run metadata lives in the application's tasks store; full evidence files are written to the
 *  project workspace (comex/tareas/<taskId>/runs/) so a person — and the agent — can audit them. */

const TICK_MS = 10_000;
const RUN_TIMEOUT_MS = 15 * 60_000;
/** A "manual" run that waits for an approval is kept this long before it is retired. */
const MANUAL_WAIT_MS = 24 * 60 * 60_000;
const NO_PROJECT_RETRY_MS = 30 * 60_000;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export type SpecialistScheduler = {
  /** Run one task now, outside the schedule (manual button / "pruébala ya"). */
  trigger: (applicationId: string, taskId: string) => Promise<{ ok: boolean; detail?: string }>;
  /** Rehearse once in a disposable session: no claim, no run log, no evidence (F3). */
  dryRun: (applicationId: string, taskId: string) => Promise<{ ok: boolean; sessionId?: string; workspaceId?: string; detail?: string }>;
  tick: () => Promise<void>;
  stop: () => Promise<void>;
};

type Store = Awaited<ReturnType<typeof specialistStore>>;

/** The project a task runs in: its own when it names one (and it is still live on this host),
 *  otherwise the application's first live project. Null when there is none to run in. */
export function taskProject(store: Store, applicationId: string, task: Pick<SpecialistTask, "workspaceId">, live: (workspaceId: string) => boolean = () => true) {
  const bound = store.projectsFor(applicationId).filter(project => live(project.workspaceId));
  if (task.workspaceId) return bound.find(project => project.workspaceId === task.workspaceId) ?? null;
  return bound[0] ?? null;
}

/**
 * Which pending permission requests the scheduler answers for a run (contracts/projects/v1).
 * "auto" answers every request of the run's own sessions with "once" (a `deny` rule never
 * reaches the ask stage, so it still denies); "manual" answers nothing, so the request waits
 * for the person in the command center and the chat. Requests of other sessions are never touched.
 */
export function taskPermissionReplies(mode: TaskPermissionMode, autoEnabled: boolean, runSessions: readonly string[], pending: readonly { id: string; sessionID: string }[]) {
  if (mode !== "auto" || !autoEnabled) return [];
  return pending.filter(request => runSessions.includes(request.sessionID)).map(request => ({ sessionId: request.sessionID, requestId: request.id, reply: "once" as const }));
}

let active: SpecialistScheduler | undefined;
export function currentSpecialistScheduler(): SpecialistScheduler | undefined { return active; }

export async function createSpecialistScheduler(config: ServerConfig, request: (request: Request) => Promise<Response>) {
  const bootedAt = Date.now();
  let stopped = false;
  let ticking: Promise<void> | undefined;

  const call = async (workspaceId: string, path: string, body?: unknown): Promise<unknown> => {
    if (body !== undefined && (stopped || config.readOnly || !scheduledTasksEnabled())) throw new ApiError(409, "scheduled_tasks_disabled", "Las tareas locales están pausadas en esta instalación.");
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
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ApiError(409, "task_conflict", "La carpeta de tareas del proyecto no puede ser un enlace simbólico.");
  };

  const writeEvidence = async (rootPath: string, taskId: string, stamp: string, run: SpecialistTaskRun) => {
    const folder = dataPath(rootPath, "tareas", taskId, "runs");
    await ensureFolder(folder);
    await writeFile(join(folder, `${stamp}.json`), JSON.stringify(run, null, 2), { mode: 0o600 });
    return dataRelative(rootPath, "tareas", taskId, "runs", `${stamp}.json`);
  };

  /** Move a fresh run session into its isolated copy and confirm the engine applied it before
   *  the prompt is sent: a run must never write to the project by accident. */
  const moveIntoCopy = async (workspaceId: string, sessionId: string, directory: string) => {
    await call(workspaceId, `/session/${encodeURIComponent(sessionId)}/move`, { directory, delivery: "queue" });
    const expected = await realpath(directory);
    for (let attempt = 0; attempt < 25; attempt++) {
      const current = nativeSessionDirectory(await call(workspaceId, `/session/${encodeURIComponent(sessionId)}`).catch(() => null));
      if (current && await realpath(current).catch(() => current) === expected) return;
      await delay(120);
    }
    throw new ApiError(409, "task_isolation_move_unverified", "No se confirmó que la tarea trabaje en la copia aislada; no se envió el pedido.");
  };

  const dispatch = async (applicationId: string, task: SpecialistTask, mode: "scheduled" | "manual") => {
    const store = await specialistStore(config);
    const project = taskProject(store, applicationId, task, workspaceId => config.workspaces.some(workspace => workspace.id === workspaceId));
    if (!project) {
      // Nothing to run in: keep the task honest about why and back off instead of spinning.
      // Note: this rewrites nextRunAt to now+30min, so a daily task that returns drifts off its
      // wall-clock time until the next recalculation — accepted over re-probing every tick.
      const detail = task.workspaceId ? "El proyecto de esta tarea ya no está disponible en este host." : "La aplicación no tiene ningún proyecto disponible en este host.";
      await patchTask(config, applicationId, task.id, t => ({ ...t, lastStatus: "blocked", nextRunAt: t.enabled ? Date.now() + NO_PROJECT_RETRY_MS : t.nextRunAt }));
      await appendRun(config, applicationId, task.id, { at: Date.now(), mode, missed: 0, workspaceId: task.workspaceId ?? "none", sessionId: null, status: "blocked", detail });
      return { ok: false, detail: task.workspaceId ? "El proyecto de esta tarea ya no está disponible." : "La aplicación no tiene ningún proyecto disponible." };
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
          evidencePath: null, skippedLogged: false, isolationId: null,
        },
        nextRunAt: mode === "scheduled" ? nextRun(t.schedule, startedAt) : t.nextRunAt,
      };
    });
    const running = claimed.running!;
    let evidencePath: string | null = null;
    let sessionId: string | null = null;
    let isolationId: string | null = null;
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
      if (taskIsolationReviewEnabled() && task.isolation) {
        // The run works in an isolated copy; its changes wait for review (taskIsolationReview).
        const isolation = await createIsolation(config, {
          applicationId, workspaceId: project.workspaceId, projectRoot: project.rootPath,
          origin: { kind: "task_run", taskId: task.id, runAt: startedAt }, sessionId,
        });
        isolationId = isolation.id;
        await isolateRun(config, applicationId, task.id, startedAt, isolation.id);
        await patchTask(config, applicationId, task.id, t => ({ ...t, running: t.running ? { ...t.running, isolationId: isolation.id } : t.running }));
        await moveIntoCopy(project.workspaceId, sessionId, isolation.copyPath);
      }
      await call(project.workspaceId, `/session/${encodeURIComponent(sessionId)}/prompt`, {
        text: task.prompt, delivery: "queue", metadata: { openworkScheduledTask: task.id, openworkScheduledTaskName: task.name },
      });
      return { ok: true };
    } catch (error) {
      const detail = error instanceof ApiError ? error.message : "No se pudo confirmar el envío al motor.";
      // Nothing ran in the copy: remove it instead of leaving an empty review behind.
      if (isolationId) await closeIsolation(config, applicationId, isolationId).catch(() => undefined);
      await finishRun(config, applicationId, task.id, startedAt, { status: "failed", detail });
      if (evidencePath) await writeEvidence(project.rootPath, task.id, stamp, record("failed", detail)).catch(() => undefined);
      await patchTask(config, applicationId, task.id, t => ({
        ...t, running: null, lastStatus: "failed",
        ...(t.schedule.kind === "once" ? { enabled: false } : {}),
      }));
      return { ok: false, detail };
    }
  };

  /** Pending permission requests of a run: its session and the sessions it delegated to. */
  const runPermissions = async (workspaceId: string, sessionId: string) => {
    const children = payload(await call(workspaceId, `/session?parentID=${encodeURIComponent(sessionId)}&limit=50`).catch(() => null));
    const sessions = [sessionId, ...(Array.isArray(children)
      ? children.flatMap(child => isRecord(child) && typeof child.id === "string" && child.parentID === sessionId ? [child.id] : [])
      : [])];
    const requests: { id: string; sessionID: string }[] = [];
    for (const session of sessions) {
      const items = payload(await call(workspaceId, `/session/${encodeURIComponent(session)}/permission`));
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        if (isRecord(item) && typeof item.id === "string") requests.push({ id: item.id, sessionID: typeof item.sessionID === "string" ? item.sessionID : session });
      }
    }
    return { sessions, requests };
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
    // Permission mode (projectsExperience): "auto" answers the run's own requests, "manual"
    // leaves them for the person, and a run waiting for the person is not timed out early.
    let waitingForPerson = false;
    if (running.sessionId && projectsExperienceEnabled()) {
      const pending = await runPermissions(running.workspaceId, running.sessionId).catch(() => null);
      if (pending) {
        const replies = taskPermissionReplies(task.permissionMode, true, pending.sessions, pending.requests);
        for (const reply of replies) {
          await call(running.workspaceId, `/session/${encodeURIComponent(reply.sessionId)}/permission/${encodeURIComponent(reply.requestId)}/reply`, { decision: reply.reply, reply: reply.reply }).catch(() => undefined);
        }
        waitingForPerson = task.permissionMode === "manual" && pending.requests.length > 0;
      }
    }
    const timeout = waitingForPerson ? MANUAL_WAIT_MS : RUN_TIMEOUT_MS;
    if (Date.now() - running.startedAt > timeout) {
      await finish("failed", waitingForPerson ? "La corrida esperó una aprobación durante 24 horas; revisa el chat de la tarea." : "La corrida superó 15 minutos sin confirmarse; revisa el chat de la tarea.");
      return;
    }
    if (!running.sessionId) return; // crashed between claim and create; the timeout above covers it
    try {
      const messages = payload(await call(running.workspaceId, `/session/${encodeURIComponent(running.sessionId)}/message?order=desc&limit=10`));
      if (!Array.isArray(messages)) return;
      // The engine pages newest-first: take the FIRST assistant, not the oldest of the window.
      const assistant = messages.find(message => isRecord(message) && message.type === "assistant");
      if (!assistant || !isRecord(assistant) || !isRecord(assistant.time) || !Number(assistant.time.completed)) return;
      const failed = assistant.outcome === "failed" || assistant.outcome === "interrupted" || assistant.error != null;
      await finish(failed ? "failed" : "ok", failed ? "El motor terminó con un error o una interrupción. Revisa el chat de la tarea." : null);
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
        // One application's unreadable tasks must not stop the others' schedules.
        const tasks = await listTasks(config, application.id).catch(() => null);
        if (!tasks) continue;
        for (const task of tasks) {
          const roots = store.projectsFor(application.id);
          const root = roots.find(entry => entry.workspaceId === task.running?.workspaceId)?.rootPath ?? roots[0]?.rootPath ?? null;
          if (task.running) {
            await observe(application.id, task, root).catch(() => undefined);
            const fresh = (await listTasks(config, application.id)).find(entry => entry.id === task.id);
            if (fresh?.running && fresh.enabled && fresh.nextRunAt !== null && fresh.nextRunAt <= Date.now()) await markSkipped(application.id, fresh).catch(() => undefined);
            continue;
          }
          if (task.enabled && task.nextRunAt !== null && task.nextRunAt <= Date.now()) {
            if (!task.catchUp && (task.nextRunAt < bootedAt || Date.now() - task.nextRunAt > 60_000)) {
              const now = Date.now();
              const skipped = await patchTask(config, application.id, task.id, current => {
                if (current.running || current.nextRunAt !== task.nextRunAt || !current.enabled) throw new ApiError(409, "task_changed", "La tarea cambió durante la revisión del horario.");
                return { ...current, nextRunAt: nextRun(current.schedule, now), lastStatus: "skipped", ...(current.schedule.kind === "once" ? { enabled: false } : {}) };
              }).catch(() => null);
              if (!skipped) continue;
              await appendRun(config, application.id, task.id, { at: now, mode: "scheduled", missed: missedOccurrences(task.schedule, task.nextRunAt, now), workspaceId: roots[0]?.workspaceId ?? "none", sessionId: null, status: "skipped_missed", detail: "El horario pasó con la aplicación cerrada o suspendida. No se ejecutó." }).catch(() => undefined);
            } else await dispatch(application.id, task, "scheduled").catch(() => undefined);
          }
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
      const project = taskProject(store, applicationId, task, workspaceId => config.workspaces.some(workspace => workspace.id === workspaceId));
      if (!project) throw new ApiError(409, "no_workspace", task.workspaceId ? "El proyecto de esta tarea ya no está disponible para ensayarla." : "La aplicación no tiene ningún proyecto disponible para ensayar la tarea.");
      try {
        const created = payload(await call(project.workspaceId, "/session", { title: `Ensayo (sin guardar): ${task.name}` }));
        const sessionId = isRecord(created) && typeof created.id === "string" ? created.id : null;
        if (!sessionId) throw new ApiError(502, "task_engine", "El motor no devolvió el id de la sesión creada.");
        if (task.model) await call(project.workspaceId, `/session/${encodeURIComponent(sessionId)}/model`, {
          model: { providerID: task.model.providerID, id: task.model.modelID },
        });
        await call(project.workspaceId, `/session/${encodeURIComponent(sessionId)}/prompt`, {
          text: `[ENSAYO — no guardes nada: esta corrida no escribe archivos, no crea sesiones y no muta el proyecto; muestra qué herramientas usarías y qué escribirías]\n\n${task.prompt}`,
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
