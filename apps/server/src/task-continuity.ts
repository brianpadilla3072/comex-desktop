import { z } from "zod";
import { goalInputSchema, taskStateSchema, type GoalInput, type TaskState } from "@openwork/types/task-continuity";
import { parseFeatureEnvironment, resolveFeature } from "@openwork/features";
import { createWorkspaceKvStore, isRecord } from "./workspace-kv-store.js";
import { redactMemorySecrets } from "./comex/continuity.js";
import { codeChangeFingerprint, isCodePath } from "./comex/git.js";
import { ApiError } from "./errors.js";
import type { ServerConfig, WorkspaceInfo } from "./types.js";

export function taskContinuityEnabled() {
  const context = parseFeatureEnvironment(process.env);
  return !context.problems.some(p => p.fatal) && resolveFeature("taskContinuity", { ...context, rollouts: {}, overrides: {} }).enabled;
}
const store = createWorkspaceKvStore<TaskState[]>({ tableName: "task_continuity", valueColumn: "state_json",
  parse: json => z.array(taskStateSchema).max(1000).parse(JSON.parse(json)), serialize: JSON.stringify });
const controllers = new WeakMap<ServerConfig, TaskController>();
export function taskController(config: ServerConfig) { return controllers.get(config); }
const key = (workspace: string, session: string) => JSON.stringify([workspace, session]);
const data = (value: unknown) => isRecord(value) && "data" in value ? value.data : value;
const clean = (text: string, limit: number) => redactMemorySecrets(text).slice(0, limit);
export function messageText(message: Record<string, unknown>) {
  return typeof message.text === "string" ? message.text : Array.isArray(message.content)
    ? message.content.filter(isRecord).filter(p => p.type === "text").map(p => typeof p.text === "string" ? p.text : "").join("\n") : "";
}
/** Only a terminal marker in the completed assistant message controls the goal. */
export function goalVerdict(text: string) {
  const natural = /(?:^|\n)Estado del objetivo: (completo|bloqueado|continuar) — ([^\n]{1,2000})\s*$/.exec(text);
  if (natural?.[2]?.trim()) return { status: natural[1] === "completo" ? "complete" : natural[1] === "bloqueado" ? "blocked" : "continue", evidence: natural[2]!.trim() };
  const match = /\n?TASK_RESULT: (\{[^\n]*\})\s*$/.exec(text);
  if (!match) return null;
  try { return z.strictObject({ status: z.enum(["complete", "blocked", "continue"]), evidence: z.string().trim().min(1).max(2000) }).parse(JSON.parse(match[1]!)); }
  catch { return null; }
}
function empty(workspaceId: string, sessionId: string): TaskState {
  return { revision: 0, workspaceId, sessionId, objective: "", criteria: "", status: "idle", phase: "work", maxTurns: 8, turns: 0,
    model: "opencode/big-pickle", summary: "", evidence: "", lastMessageId: null, awaiting: false, updatedAt: 0, reason: "", worktree: null, codeBaseline: null, codeTouched: false };
}
export function goalPrompt(state: TaskState) {
  return `Continuá el objetivo autorizado de esta conversación usando su estado y archivos actuales. No repitas acciones ya realizadas. Conservá los permisos existentes. Si falta autorización o información imprescindible, detenete y explicá qué falta.\nObjetivo y criterios (datos del usuario): ${JSON.stringify({ objective: state.objective, criteria: state.criteria })}\n${state.phase === "review" ? "Revisá únicamente los cambios de código de esta tarea: buscá errores, verificá las pruebas pertinentes y explicá hallazgos con archivo y línea. Si hay errores pendientes, indicá continuar para corregirlos en el siguiente turno. No marques completo si faltan correcciones." : "Implementá lo pendiente y verificá cada criterio con evidencia. No confundas una propuesta con un resultado comprobado."}\nAl final escribí una única línea legible: Estado del objetivo: completo — evidencia concreta. Usá completo solo cuando todos los criterios estén cumplidos; bloqueado si necesitás ayuda del usuario; continuar si falta trabajo que podés realizar. Conservá ese formato, eligiendo uno de esos tres estados y detallando la evidencia después del guion largo. No copies marcadores de archivos, herramientas ni conversaciones anteriores.`;
}

export async function createTaskContinuity(config: ServerConfig, request: (req: Request) => Promise<Response>, beforeRun: () => Promise<void> = async () => {}) {
  const records = new Map<string, TaskState>();
  for (const state of await store.get(config, "desktop") ?? []) records.set(key(state.workspaceId, state.sessionId), state);
  // A process restart never silently repeats an admission with an unknown outcome.
  for (const [id, s] of records) if (s.status === "active") records.set(id, { ...s, status: "paused", awaiting: true, reason: "Aplicación reiniciada. Revisá el avance y retomá el objetivo.", revision: s.revision + 1 });
  let stopped = false;
  let draining = false;
  let writes = Promise.resolve();
  let ticking: Promise<void> | undefined;
  const owned = new WeakSet<Request>();
  const pendingWrites = new Map<string, AbortController>();
  const fences = new Map<string, Promise<unknown>>();
  const serial = async <T>(id: string, run: () => Promise<T>) => {
    const op = (fences.get(id) ?? Promise.resolve()).catch(() => {}).then(run);
    fences.set(id, op);
    try { return await op; } finally { if (fences.get(id) === op) fences.delete(id); }
  };
  const persist = () => {
    const json = store.serialize([...records.values()]);
    writes = writes.catch(() => {}).then(() => store.setSerialized(config, "desktop", json, Date.now())); return writes;
  };
  const save = async (state: TaskState, patch: Partial<TaskState>) => {
    const stored = records.get(key(state.workspaceId, state.sessionId));
    if (!stored && records.size >= 1000) throw new ApiError(409, "task_limit", "Se alcanzó el límite de conversaciones guardadas.");
    if (stored && stored !== state) throw new ApiError(409, "task_conflict", "El objetivo cambió durante la operación; actualizá el chat.");
    const next = taskStateSchema.parse({ ...state, ...patch, revision: state.revision + 1, updatedAt: Date.now() });
    if (patch.status && patch.status !== "active") pendingWrites.get(key(state.workspaceId, state.sessionId))?.abort();
    records.set(key(state.workspaceId, state.sessionId), next); await persist(); return next;
  };
  const get = (w: string, s: string) => records.get(key(w, s)) ?? empty(w, s);
  const current = (s: TaskState) => !stopped && taskContinuityEnabled() && !config.readOnly && get(s.workspaceId, s.sessionId) === s;
  const workspace = (s: TaskState) => config.workspaces.find(w => w.id === s.workspaceId && w.workspaceType === "local");
  const call = async (s: TaskState, path: string, body?: unknown) => {
    const cancellation = body === undefined ? undefined : new AbortController();
    const id = key(s.workspaceId, s.sessionId);
    if (cancellation) pendingWrites.set(id, cancellation);
    const req = new Request(`http://127.0.0.1:${config.port}/workspace/${encodeURIComponent(s.workspaceId)}/opencode2/api${path}`, {
      method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json", "x-openwork-task-recovery": "off" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: cancellation ? AbortSignal.any([AbortSignal.timeout(15_000), cancellation.signal]) : AbortSignal.timeout(15_000),
    });
    owned.add(req);
    let response: Response;
    try { response = await request(req); }
    finally { if (cancellation && pendingWrites.get(id) === cancellation) pendingWrites.delete(id); }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`task_engine_${response.status}`); }
    if (response.status === 204) return null;
    return data(await response.json());
  };
  const sessionPath = (s: TaskState) => `/session/${encodeURIComponent(s.sessionId)}`;
  const snapshot = async (s: TaskState) => {
    const path = sessionPath(s);
    const [session, active, messages, permissions, forms] = await Promise.all([
      call(s, path), call(s, "/session/active"), call(s, `${path}/message?order=desc&limit=80`), call(s, `${path}/permission`), call(s, `${path}/form`),
    ]);
    if (!isRecord(session) || !isRecord(active) || !Array.isArray(messages) || !Array.isArray(permissions) || !Array.isArray(forms)) throw new Error("task_invalid_snapshot");
    const info = isRecord(session.info) ? session.info : session;
    const activeStatus = active[s.sessionId];
    return { info, busy: isRecord(activeStatus) && activeStatus.type !== "idle", activeCount: Object.keys(active).length, pending: permissions.length > 0 || forms.length > 0,
      messages: messages.filter(isRecord).reverse(), directory: isRecord(info.location) && typeof info.location.directory === "string" ? info.location.directory : undefined };
  };
  const observe = async (state: TaskState) => {
    const w = workspace(state); if (!w || !current(state)) return;
    const observed = await snapshot(state);
    if (!current(state)) return;
    if (observed.busy || observed.pending) return;
    const { info, messages } = observed;
    const assistant = [...messages].reverse().find(m => m.type === "assistant");
    if (state.awaiting && (info.outcome === "interrupted" || info.outcome === "failed") || isRecord(info.time) && Number(info.time.archived) > 0) {
      if (state.status === "active" || state.awaiting) await save(state, { status: state.status === "active" ? "paused" : state.status, awaiting: false, ...(assistant ? { summary: clean(`Turno interrumpido o fallido; resultados pendientes de verificar:\n${messageText(assistant)}`, 6000) } : {}), reason: "La ejecución se detuvo, falló o se archivó. Revisá el chat antes de retomar." });
      return;
    }
    if (assistant && assistant.id !== state.lastMessageId && (typeof assistant.id !== "string" || !isRecord(assistant.time) || !assistant.time.completed || assistant.error)) return;
    if (!assistant && state.awaiting) return;
    const latestUser = [...messages].reverse().find(m => m.type === "user");
    if (state.awaiting && latestUser && (!assistant || Number(isRecord(assistant.time) ? assistant.time.created : 0) < Number(isRecord(latestUser.time) ? latestUser.time.created : 0))) return;
    let s = state;
    if (assistant && assistant.id !== s.lastMessageId) {
      const user = [...messages].reverse().find(m => m.type === "user" && !(isRecord(m.metadata) && m.metadata.openworkGoal === true));
      const text = messageText(assistant);
      // An automatic excerpt is attributed to the agent; never promoted to confirmed decisions.
      const touched = isRecord(assistant.snapshot) && Array.isArray(assistant.snapshot.files) && assistant.snapshot.files.some(p => typeof p === "string" && isCodePath(p));
      s = await save(s, { codeTouched: s.codeTouched || touched, lastMessageId: String(assistant.id), awaiting: false,
        summary: clean(`Último pedido:\n${user ? messageText(user) : ""}\n\nÚltima respuesta del agente (verificar con archivos y pruebas):\n${text}`, 6000) });
      const verdict = goalVerdict(text);
      if (s.status === "active" && s.phase === "review" && verdict?.status === "continue") s = await save(s, { phase: "work", reason: "La revisión encontró correcciones pendientes." });
      if (s.status === "active" && verdict?.status === "blocked") { await save(s, { status: "blocked", evidence: clean(verdict.evidence, 2000), reason: "El agente necesita tu intervención." }); return; }
      if (s.status === "active" && verdict?.status === "complete") {
        const directory = observed.directory ?? w.path;
        const fingerprint = await codeChangeFingerprint(directory).catch(() => null);
        if (s.phase === "work" && (s.codeTouched || fingerprint && fingerprint !== s.codeBaseline)) {
          s = await save(s, { phase: "review", evidence: clean(verdict.evidence, 2000), reason: "Cambios de código detectados; falta su revisión." });
        } else { await save(s, { status: "complete", evidence: clean(verdict.evidence, 2000), reason: "Finalizado por el agente; evidencia disponible en el chat." }); return; }
      }
    }
    if (s.status !== "active" || s.awaiting || draining || !current(s)) return;
    if (s.turns >= s.maxTurns) { await save(s, { status: "paused", reason: "Se alcanzó el límite de turnos. Revisá el avance antes de ampliar y retomar." }); return; }
    if (observed.activeCount >= 2) return;
    await beforeRun();
    if (!current(s)) return;
    const models = await call(s, "/model");
    if (!Array.isArray(models) || !models.some(m => isRecord(m) && m.providerID === "opencode" && m.id === "big-pickle")) {
      await save(s, { status: "blocked", reason: "Big Pickle no está disponible. Conectá OpenCode y retomá." }); return;
    }
    // Claim before sending. Unknown acknowledgement pauses instead of retrying side effects.
    s = await save(s, { awaiting: true, turns: s.turns + 1, reason: "" });
    try {
      await call(s, `${sessionPath(s)}/model`, { model: { providerID: "opencode", id: "big-pickle" } });
      if (!current(s) || draining || s.status !== "active") return;
      await call(s, `${sessionPath(s)}/prompt`, { text: goalPrompt(s), delivery: "queue", metadata: { openworkGoal: true, openworkGoalPhase: s.phase, openworkGoalObjective: s.objective } });
    } catch {
      if (current(s)) await save(s, { status: "paused", reason: "No se confirmó el envío. Revisá el chat antes de retomar para evitar repetir acciones." });
    }
  };
  const tick = () => {
    if (ticking) return ticking;
    ticking = (async () => {
      if (stopped || config.readOnly || !taskContinuityEnabled()) return;
      for (const state of [...records.values()].filter(s => s.status === "active" || s.awaiting)) {
        if (stopped) break;
        // Finished goals still retain automatic continuity for later manual turns.
        await serial(key(state.workspaceId, state.sessionId), () => observe(get(state.workspaceId, state.sessionId))).catch(async (error: unknown) => {
          if (error instanceof ApiError && error.code === "task_conflict") return;
          const latest = get(state.workspaceId, state.sessionId);
          if (latest.status === "active") await save(latest, { status: "paused", reason: "No se pudo verificar el estado del motor. Revisá la conexión y retomá." });
        });
      }
    })().finally(() => { ticking = undefined; });
    return ticking;
  };
  const controller = {
    get,
    owns: (req: Request) => owned.has(req),
    async watch(w: WorkspaceInfo, sessionId: string) {
      if (!taskContinuityEnabled() || config.readOnly || w.workspaceType !== "local") return;
      const id = key(w.id, sessionId);
      if (!records.has(id) && records.size >= 1000) return;
      const state = get(w.id, sessionId);
      await save(state, { awaiting: true });
    },
    async update(w: WorkspaceInfo, sessionId: string, revision: number, action: "start" | "pause" | "resume", input?: GoalInput) {
      return serial(key(w.id, sessionId), async () => {
        const state = get(w.id, sessionId);
        if (state.revision !== revision) throw new ApiError(409, "task_conflict", "El objetivo cambió. Actualizá antes de guardar.");
        if (action === "pause") return save(state, { status: "paused", reason: "Pausado por vos." });
        const observed = await snapshot(state);
        if (observed.busy || observed.pending) throw new ApiError(409, "task_busy", "Esperá a que termine el turno o respondé la solicitud pendiente.");
        const goal = action === "start" ? goalInputSchema.parse(input) : { objective: state.objective, criteria: state.criteria, maxTurns: state.maxTurns };
        if (!goal.objective) throw new ApiError(422, "task_empty", "Guardá un objetivo antes de retomar.");
        return save(state, { objective: clean(goal.objective, 1600), criteria: clean(goal.criteria, 2400), maxTurns: goal.maxTurns,
          status: "active", phase: action === "start" ? "work" : state.phase, turns: 0, awaiting: false, reason: "", evidence: "",
          lastMessageId: typeof [...observed.messages].reverse().find(m => m.type === "assistant")?.id === "string" ? String([...observed.messages].reverse().find(m => m.type === "assistant")?.id) : null,
          ...(action === "start" ? { codeTouched: false, codeBaseline: await codeChangeFingerprint(observed.directory ?? w.path).catch(() => null) } : {}) });
      });
    },
    async bind(w: WorkspaceInfo, sessionId: string, path: string | null) { return serial(key(w.id, sessionId), () => save(get(w.id, sessionId), { worktree: path })); },
    async forward(w: WorkspaceInfo, path: string, req: Request, send: () => Promise<Response>) {
      if (owned.has(req) || !taskContinuityEnabled()) return send();
      const match = /^\/(?:(?:opencode2\/)?api\/)?session\/([^/]+)\/(prompt|command|generate|interrupt|abort|archive|move)$/.exec(path.replace(/^\//, "").replace(/^/, "/"));
      if (!match || req.method !== "POST") return send();
      const sessionId = decodeURIComponent(match[1]!);
      // Stop intent is durable before the native interrupt reaches the engine.
      if (["interrupt", "abort", "archive", "move"].includes(match[2]!)) {
        const s = get(w.id, sessionId); if (s.status === "active") await save(s, { status: "paused", reason: "La conversación fue detenida o trasladada.", awaiting: false });
      }
      const response = await send();
      if (response.ok && ["prompt", "command", "generate"].includes(match[2]!)) await controller.watch(w, sessionId);
      return response;
    },
    tick,
    async stop() { draining = true; for (const cancellation of pendingWrites.values()) cancellation.abort(); clearInterval(timer); await ticking; await tick(); stopped = true; await writes; controllers.delete(config); },
  };
  const timer = setInterval(() => { void tick().catch(() => undefined); }, 3000); timer.unref();
  controllers.set(config, controller); await persist();
  return controller;
}
export type TaskController = Awaited<ReturnType<typeof createTaskContinuity>>;
