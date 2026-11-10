import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApiError } from "../src/errors.js";
import { workspaceIdForPath } from "../src/workspaces.js";
import { applicationInput, specialistStore } from "../src/specialists/store.js";
import { inspectSpecialistPack, saveSpecialistPack } from "../src/specialists/packs.js";
import { createTask, listRuns, listTasks, patchTask, updateTask } from "../src/specialists/tasks.js";
import { createSpecialistScheduler, type SpecialistScheduler } from "../src/specialists/scheduler.js";
import { registerSpecialistRoutes } from "../src/specialists/routes.js";
import { matchRoute, type RequestContext, type Route } from "../src/routes/registry.js";
import type { ServerConfig } from "../src/types.js";

/**
 * ONE continuous server session through the whole scheduler lifecycle — the
 * production shape: a single scheduler instance, a single bound workspace and
 * a single app, chasing tasks from DUE through OBSERVE, manual/dry-run,
 * one-shot and BLOCKED (host loses the workspace). Tests share that session
 * and must run in file order (node:test runs top-level tests sequentially).
 * The fake engine stands in for the opencode engine behind the same
 * /session + /session/:id/prompt + history (message pages) contract as
 * specialist-tasks.test.ts — no production code is edited here.
 */

type Store = Awaited<ReturnType<typeof specialistStore>>;

type EngineState = {
  completed: boolean;
  failPrompt: boolean;
  sessions: number;
  calls: string[];
  prompts: Array<Record<string, unknown>>;
  history: Array<Record<string, unknown>> | null;
};

function fakeEngine(state: EngineState): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/workspace\/[^/]+\/opencode2\/api/, "");
    state.calls.push(`${request.method} ${path}`);
    if (request.method === "POST" && path === "/session") {
      state.sessions += 1;
      // The real engine wraps payloads as { data } (OpenCode v2 API).
      return new Response(JSON.stringify({ data: { id: `ses_fake_${state.sessions}` } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (request.method === "POST" && path.startsWith("/session/")) {
      if (state.failPrompt) return new Response("fake engine exploded", { status: 500 });
      state.prompts.push((await request.json()) as Record<string, unknown>);
      return new Response("{}", { status: 200 });
    }
    if (path.startsWith("/session/")) {
      // Newest-first assistant history, like the engine's order=desc pages.
      const history = state.history ?? (state.completed
        ? [{ type: "assistant", time: { completed: 1_700_000_000_000 } }, { type: "user", time: { created: 1 } }]
        : []);
      return new Response(JSON.stringify({ data: history }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 200 });
  };
}

type Budget = {
  runsPerDay: number;
  estTokensPerRun: number;
  estTokensPerDay: number;
  estSnapshotsMBPerDay: number;
  note: string;
};

function assertBudgetShape(value: unknown): Budget {
  assert.equal(typeof value, "object");
  assert.ok(value !== null);
  const raw = value as Record<string, unknown>;
  assert.equal(typeof raw.runsPerDay, "number");
  assert.equal(typeof raw.estTokensPerRun, "number");
  assert.equal(typeof raw.estTokensPerDay, "number");
  assert.equal(typeof raw.estSnapshotsMBPerDay, "number");
  assert.equal(typeof raw.note, "string");
  const budget: Budget = {
    runsPerDay: raw.runsPerDay as number,
    estTokensPerRun: raw.estTokensPerRun as number,
    estTokensPerDay: raw.estTokensPerDay as number,
    estSnapshotsMBPerDay: raw.estSnapshotsMBPerDay as number,
    note: raw.note as string,
  };
  assert.ok(budget.runsPerDay > 0, "runsPerDay must be > 0 for an interval-20m task");
  assert.match(budget.note, /corridas\/día/);
  return budget;
}

type SessionCtx = {
  root: string;
  config: { configPath: string; port: number; token: string; workspaces: Array<{ id: string; path: string }> };
  store: Store;
  appId: string;
  project: string;
  workspaceId: string;
  scheduler: SpecialistScheduler;
  state: EngineState;
};

async function createSession(): Promise<SessionCtx> {
  const root = await mkdtemp(join(tmpdir(), "specialists-scheduler-session-"));
  const config = { configPath: join(root, "server.json"), port: 4721, token: "test-token", workspaces: [] as Array<{ id: string; path: string }> };
  const store = await specialistStore(config as unknown as ServerConfig);
  const pack = join(root, "source");
  await mkdir(join(pack, "agents"), { recursive: true });
  await writeFile(join(pack, "agents", "revisor.md"), "---\ndescription: Revisor de prueba.\nmode: subagent\n---\nRevisá evidencia.\n");
  const app = store.create(applicationInput.parse({ userName: "Usuario de prueba", name: "Sesión", specialty: "Especialidad Sesión", personality: "PERSONA_Sesion", template: "custom" }), { agents: 1, skills: 0 });
  await saveSpecialistPack(config as unknown as ServerConfig, app.id, await inspectSpecialistPack(pack));
  const project = join(root, "project");
  await mkdir(project, { recursive: true });
  const workspaceId = workspaceIdForPath(project);
  config.workspaces.push({ id: workspaceId, path: project });
  store.bind(workspaceId, app.id, project);
  const state: EngineState = { completed: false, failPrompt: false, sessions: 0, calls: [], prompts: [], history: null };
  const scheduler = await createSpecialistScheduler(config as unknown as ServerConfig, fakeEngine(state));
  return { root, config, store, appId: app.id, project, workspaceId, scheduler, state };
}

let sessionPromise: Promise<SessionCtx> | undefined;
function session(): Promise<SessionCtx> {
  sessionPromise ??= createSession();
  return sessionPromise;
}

after(async () => {
  if (!sessionPromise) return;
  const ctx = await sessionPromise.catch(() => null);
  if (!ctx) return;
  await ctx.scheduler.stop();
  try {
    ctx.store.close();
  } catch {
    // Fixture teardown is best-effort; the tmpdir removal below is the assertion.
  }
  await rm(ctx.root, { recursive: true, force: true });
});

async function withFlags<T>(run: () => Promise<T>): Promise<T> {
  const keys = ["DEN_FEATURE_SCHEDULED_TASKS", "DEN_FEATURE_TASK_DRY_RUN"] as const;
  const before = new Map(keys.map(key => [key, process.env[key]]));
  for (const key of keys) process.env[key] = "true";
  try {
    return await run();
  } finally {
    for (const key of keys) {
      const value = before.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function taskById(ctx: SessionCtx, taskId: string) {
  const found = (await listTasks(ctx.config as unknown as ServerConfig, ctx.appId)).find(entry => entry.id === taskId);
  assert.ok(found, `task ${taskId} must exist`);
  return found!;
}

function lastPrompt(state: EngineState): Record<string, unknown> {
  const prompt = state.prompts[state.prompts.length - 1];
  assert.ok(prompt, "at least one prompt must have been posted");
  return prompt!;
}

function apiHarness(config: Record<string, unknown>) {
  const routes: Route[] = [];
  registerSpecialistRoutes({
    routes, config: config as unknown as ServerConfig,
    readJsonBody: async (request: Request) => (await request.json()) as Record<string, unknown>,
    jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
    ensureWritable: () => {}, createWorkspace: async () => "ws_new",
  });
  return async (method: string, path: string, body?: unknown) => {
    const match = matchRoute(routes, method, path);
    assert.ok(match, `no route for ${method} ${path}`);
    const url = new URL(`http://127.0.0.1:1${path}`);
    const request = new Request(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    try {
      const response = await match.handler({ request, url, params: match.params, config } as unknown as RequestContext);
      return { status: response.status, json: (await response.json()) as Record<string, unknown> };
    } catch (error) {
      if (error instanceof ApiError) return { status: error.status, json: { error: error.code } };
      throw error;
    }
  };
}

const t1 = { id: "" };

test("1. DUE + MISSED: a backdated interval-20m task dispatches exactly once with missed=2", async () => {
  const ctx = await session();
  await withFlags(async () => {
    const task = await createTask(ctx.config as unknown as ServerConfig, ctx.appId, { name: "refrescar", prompt: "Refrescar datos.", schedule: { kind: "interval", everyMinutes: 20 } });
    t1.id = task.id;
    // Simulate time asleep: 50 minutes late → floor(50/20)=2 missed occurrences coalesce into one run.
    await patchTask(ctx.config as unknown as ServerConfig, ctx.appId, task.id, entry => ({ ...entry, nextRunAt: Date.now() - 50 * 60_000 }));
    const sessionsBefore = ctx.state.sessions;
    const promptsBefore = ctx.state.prompts.length;
    await ctx.scheduler.tick();
    const claimed = await taskById(ctx, task.id);
    assert.equal(claimed.lastStatus, "running");
    assert.equal(claimed.running?.workspaceId, ctx.workspaceId);
    assert.equal(claimed.running?.missed, 2, "missed must be observed on the claim");
    assert.equal(claimed.running?.mode, "scheduled");
    assert.equal(ctx.state.sessions, sessionsBefore + 1, "exactly one session must be created");
    assert.equal(ctx.state.prompts.length, promptsBefore + 1, "exactly one prompt must be posted");
    const prompt = lastPrompt(ctx.state);
    assert.equal(prompt.text, "Refrescar datos.");
    const metadata = prompt.metadata as Record<string, unknown>;
    assert.equal(metadata.openworkScheduledTask, task.id);
    assert.equal(metadata.openworkScheduledTaskName, "refrescar");
    // Second tick must NOT re-dispatch while the run is claimed.
    await ctx.scheduler.tick();
    assert.equal(ctx.state.sessions, sessionsBefore + 1, "no second session while claimed");
    assert.equal(ctx.state.prompts.length, promptsBefore + 1, "no second prompt while claimed");
    assert.equal((await taskById(ctx, task.id)).lastStatus, "running");
    // The dispatched attempt is on the honest runs log.
    const runs = await listRuns(ctx.config as unknown as ServerConfig, ctx.appId, task.id);
    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.status, "dispatched");
    assert.equal(runs[0]?.missed, 2);
    // Evidence file for this run exists under comex/tareas/<taskId>/runs/<stamp>.json
    const files = await readdir(join(ctx.project, "comex", "tareas", task.id, "runs"));
    assert.equal(files.length, 1);
    assert.match(files[0]!, /\.json$/);
    const evidence = JSON.parse(await readFile(join(ctx.project, "comex", "tareas", task.id, "runs", files[0]!), "utf8")) as { status: string; sessionId: string | null };
    assert.equal(evidence.status, "dispatched");
    assert.equal(evidence.sessionId, "ses_fake_1");
    // The runs-log entry must identify the same session (audit trail). T-1: it is null.
    assert.equal(runs[0]?.sessionId, "ses_fake_1");
  });
});

test("2. OBSERVE OK: a completed assistant message finalizes the run as ok", async () => {
  const ctx = await session();
  await withFlags(async () => {
    ctx.state.history = null;
    ctx.state.completed = true;
    await ctx.scheduler.tick();
    ctx.state.completed = false;
    const done = await taskById(ctx, t1.id);
    assert.equal(done.lastStatus, "ok");
    assert.equal(done.running, null);
    assert.equal(done.runs, 1);
    const runs = await listRuns(ctx.config as unknown as ServerConfig, ctx.appId, t1.id);
    assert.equal(runs[0]?.status, "ok");
    assert.equal(runs[0]?.missed, 2);
    const files = await readdir(join(ctx.project, "comex", "tareas", t1.id, "runs"));
    assert.equal(files.length, 1, "the same single evidence file is updated in place");
    const evidence = JSON.parse(await readFile(join(ctx.project, "comex", "tareas", t1.id, "runs", files[0]!), "utf8")) as { status: string };
    assert.equal(evidence.status, "ok");
  });
});

test("3. OBSERVE FAILED: an engine error mid-prompt marks the task failed with readable detail", async () => {
  const ctx = await session();
  await withFlags(async () => {
    const task = await createTask(ctx.config as unknown as ServerConfig, ctx.appId, { name: "fallar", prompt: "Prompt que explota.", schedule: { kind: "interval", everyMinutes: 20 } });
    await patchTask(ctx.config as unknown as ServerConfig, ctx.appId, task.id, entry => ({ ...entry, nextRunAt: Date.now() - 1000 }));
    ctx.state.failPrompt = true;
    await ctx.scheduler.tick();
    ctx.state.failPrompt = false;
    const failed = await taskById(ctx, task.id);
    assert.equal(failed.lastStatus, "failed");
    assert.equal(failed.running, null);
    const runs = await listRuns(ctx.config as unknown as ServerConfig, ctx.appId, task.id);
    assert.equal(runs[0]?.status, "failed");
    const detail = runs[0]?.detail;
    assert.equal(typeof detail, "string");
    assert.ok((detail as string).length > 3, "failure detail must be readable, never empty");
    assert.match(detail as string, /500/, "detail must name the engine failure");
    const files = await readdir(join(ctx.project, "comex", "tareas", task.id, "runs"));
    assert.equal(files.length, 1);
    const evidence = JSON.parse(await readFile(join(ctx.project, "comex", "tareas", task.id, "runs", files[0]!), "utf8")) as { status: string; detail: string | null };
    assert.equal(evidence.status, "failed");
    assert.equal(evidence.detail, detail);
  });
});

test("4. MANUAL run-now: a PAUSED task still runs manually, and a RUNNING task answers 409 task_running", async () => {
  const ctx = await session();
  await withFlags(async () => {
    const call = apiHarness(ctx.config as unknown as Record<string, unknown>);
    const task = await createTask(ctx.config as unknown as ServerConfig, ctx.appId, { name: "manual", prompt: "Corrida manual.", schedule: { kind: "interval", everyMinutes: 20 } });
    await updateTask(ctx.config as unknown as ServerConfig, ctx.appId, task.id, { enabled: false });
    const paused = await taskById(ctx, task.id);
    assert.equal(paused.enabled, false);
    const nextBefore = paused.nextRunAt;
    // A tick must stay quiet for a paused task (the manual path is the only way in).
    const sessionsBefore = ctx.state.sessions;
    await patchTask(ctx.config as unknown as ServerConfig, ctx.appId, task.id, entry => ({ ...entry, nextRunAt: Date.now() - 1000 }));
    await ctx.scheduler.tick();
    assert.equal(ctx.state.sessions, sessionsBefore, "tick must not dispatch a paused task");
    assert.equal((await taskById(ctx, task.id)).running, null);
    await patchTask(ctx.config as unknown as ServerConfig, ctx.appId, task.id, entry => ({ ...entry, nextRunAt: nextBefore }));
    const started = await call("POST", `/specialist-applications/${ctx.appId}/tasks/${task.id}/run-now`);
    assert.equal(started.status, 200);
    assert.equal(started.json.started, true, "run-now on a PAUSED task must start");
    const manual = await taskById(ctx, task.id);
    assert.equal(manual.running?.mode, "manual");
    assert.equal(manual.lastStatus, "running");
    assert.equal(manual.nextRunAt, nextBefore, "manual trigger must not move the schedule");
    assert.equal(manual.enabled, false, "manual trigger must not unpause");
    // Same trigger while running: honest 409, never queued or overwritten.
    const blocked = await call("POST", `/specialist-applications/${ctx.appId}/tasks/${task.id}/run-now`);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.json.error, "task_running");
    // Observe the manual run to a clean end for the next tests.
    ctx.state.history = null;
    ctx.state.completed = true;
    await ctx.scheduler.tick();
    ctx.state.completed = false;
    const done = await taskById(ctx, task.id);
    assert.equal(done.lastStatus, "ok");
    assert.equal(done.running, null);
    assert.equal(done.enabled, false);
  });
});

test("5. DRY-RUN during a real run: no claim conflict, no runs-log/count entry, ENSAYO banner in the prompt", async () => {
  const ctx = await session();
  await withFlags(async () => {
    // New real claimed run for the same task: backdate and tick with the engine still thinking.
    ctx.state.history = null;
    ctx.state.completed = false;
    await patchTask(ctx.config as unknown as ServerConfig, ctx.appId, t1.id, entry => ({ ...entry, nextRunAt: Date.now() - 1000 }));
    await ctx.scheduler.tick();
    const running = await taskById(ctx, t1.id);
    assert.equal(running.lastStatus, "running");
    assert.ok(running.running?.sessionId, "a real run must be claimed");
    const runsBefore = await listRuns(ctx.config as unknown as ServerConfig, ctx.appId, t1.id);
    const countBefore = running.runs;
    const startedAtBefore = running.running!.startedAt;
    const sessionBefore = running.running!.sessionId;
    const evidenceBefore = await readdir(join(ctx.project, "comex", "tareas", t1.id, "runs"));
    const dry = await ctx.scheduler.dryRun(ctx.appId, t1.id);
    assert.equal(dry.ok, true, "dryRun must succeed alongside a real run");
    assert.equal(typeof dry.sessionId, "string");
    assert.equal(dry.workspaceId, ctx.workspaceId);
    const prompt = lastPrompt(ctx.state);
    const text = prompt.text as string;
    assert.match(text, /ENSAYO/, "the dry-run prompt must carry the ENSAYO banner");
    assert.match(text, /Refrescar datos\./);
    const metadata = prompt.metadata as Record<string, unknown>;
    assert.equal(metadata.openworkDryRun, true);
    assert.equal(metadata.openworkScheduledTask, t1.id);
    const afterDry = await taskById(ctx, t1.id);
    assert.equal(afterDry.runs, countBefore, "dryRun must add nothing to the runs count");
    assert.equal(afterDry.running?.startedAt, startedAtBefore);
    assert.equal(afterDry.running?.sessionId, sessionBefore);
    assert.equal(afterDry.lastStatus, "running");
    const runsAfter = await listRuns(ctx.config as unknown as ServerConfig, ctx.appId, t1.id);
    assert.equal(runsAfter.length, runsBefore.length, "dryRun must add nothing to the runs log");
    const evidenceAfter = await readdir(join(ctx.project, "comex", "tareas", t1.id, "runs"));
    assert.equal(evidenceAfter.length, evidenceBefore.length, "dryRun must write no evidence");
    // Close the real run honestly.
    ctx.state.completed = true;
    await ctx.scheduler.tick();
    ctx.state.completed = false;
    assert.equal((await taskById(ctx, t1.id)).lastStatus, "ok");
  });
});

test("6. ONE-SHOT: once run completes the task ends disabled with nextRunAt null", async () => {
  const ctx = await session();
  await withFlags(async () => {
    const task = await createTask(ctx.config as unknown as ServerConfig, ctx.appId, { name: "una-vez", prompt: "Solo una vez.", schedule: { kind: "once", at: Date.now() + 60_000 } });
    assert.ok(task.nextRunAt !== null);
    await patchTask(ctx.config as unknown as ServerConfig, ctx.appId, task.id, entry => ({ ...entry, nextRunAt: Date.now() - 1000 }));
    ctx.state.history = null;
    ctx.state.completed = false;
    await ctx.scheduler.tick();
    const running = await taskById(ctx, task.id);
    assert.equal(running.lastStatus, "running");
    assert.equal(running.enabled, true);
    ctx.state.completed = true;
    await ctx.scheduler.tick();
    ctx.state.completed = false;
    const done = await taskById(ctx, task.id);
    assert.equal(done.lastStatus, "ok");
    assert.equal(done.running, null);
    assert.equal(done.enabled, false, "a spent one-shot task must end disabled");
    assert.equal(done.nextRunAt, null, "a spent one-shot task must clear nextRunAt");
    const runs = await listRuns(ctx.config as unknown as ServerConfig, ctx.appId, task.id);
    assert.equal(runs[0]?.status, "ok");
  });
});

test("7. BLOCKED without a project: no engine call, honest detail, ~30min backoff", async () => {
  const ctx = await session();
  await withFlags(async () => {
    const task = await createTask(ctx.config as unknown as ServerConfig, ctx.appId, { name: "sin-proyecto", prompt: "Sin proyecto.", schedule: { kind: "interval", everyMinutes: 5 } });
    await patchTask(ctx.config as unknown as ServerConfig, ctx.appId, task.id, entry => ({ ...entry, nextRunAt: Date.now() - 1000 }));
    const callsBefore = ctx.state.calls.length;
    const sessionsBefore = ctx.state.sessions;
    // The store has no unbind API; the host losing the workspace (its entry
    // gone from config.workspaces) is exactly the state dispatch() filters on.
    ctx.config.workspaces = ctx.config.workspaces.filter(entry => entry.id !== ctx.workspaceId);
    try {
      const before = Date.now();
      await ctx.scheduler.tick();
      const blocked = await taskById(ctx, task.id);
      assert.equal(blocked.lastStatus, "blocked");
      assert.equal(blocked.running, null);
      assert.ok(blocked.nextRunAt !== null, "blocked must keep a retry time");
      assert.ok(blocked.nextRunAt >= before + 29 * 60_000, "nextRunAt must back off ~30min, not spin");
      assert.ok(blocked.nextRunAt <= Date.now() + 30 * 60_000 + 5_000, "backoff must not overshoot 30min");
      const runs = await listRuns(ctx.config as unknown as ServerConfig, ctx.appId, task.id);
      assert.equal(runs[0]?.status, "blocked");
      assert.equal(runs[0]?.workspaceId, "none");
      const detail = runs[0]?.detail;
      assert.equal(typeof detail, "string");
      assert.match(detail as string, /proyecto/);
      assert.equal(ctx.state.sessions, sessionsBefore, "no engine session may be created when blocked");
      assert.equal(ctx.state.calls.length, callsBefore, "no engine call at all when blocked");
    } finally {
      ctx.config.workspaces.push({ id: ctx.workspaceId, path: ctx.project });
    }
  });
});

test("8. Budget: create and update responses both carry an honest runsPerDay estimate", async () => {
  const ctx = await session();
  await withFlags(async () => {
    const call = apiHarness(ctx.config as unknown as Record<string, unknown>);
    const created = await call("POST", `/specialist-applications/${ctx.appId}/tasks`, { name: "presupuesto", prompt: "Medir el costo diario.", schedule: { kind: "interval", everyMinutes: 20 } });
    assert.equal(created.status, 200);
    const createdBudget = assertBudgetShape(created.json.budget);
    assert.equal(createdBudget.runsPerDay, 72, "20m interval runs 72 times a day");
    const taskId = String((created.json.task as { id: string }).id);
    const updated = await call("PUT", `/specialist-applications/${ctx.appId}/tasks/${taskId}`, { enabled: false });
    assert.equal(updated.status, 200);
    const updatedBudget = assertBudgetShape(updated.json.budget);
    assert.equal(updatedBudget.runsPerDay, 72);
    assert.equal(updatedBudget.note, createdBudget.note);
    assert.equal((updated.json.task as { enabled: boolean }).enabled, false);
  });
});

test("a v2 envelope { data } is unwrapped for the session id and the message page", async () => {
  // Regression: the engine answers `{ data: … }`; reading the envelope directly left every
  // dispatch without a session id and every run "running" until the 15-minute timeout.
  const ctx = await session();
  await withFlags(async () => {
    const task = await createTask(ctx.config, ctx.appId, { name: "convelope", prompt: "P.", schedule: { kind: "interval", everyMinutes: 20 } });
    const before = ctx.state.sessions;
    const result = await ctx.scheduler.trigger(ctx.appId, task.id);
    assert.equal(result.ok, true, result.detail);
    const running = (await listTasks(ctx.config, ctx.appId)).find(entry => entry.id === task.id)!;
    // The session id in the claim and in the run log comes from the unwrapped payload.
    assert.equal(running.running?.sessionId, `ses_fake_${before + 1}`);
    const runs = await listRuns(ctx.config, ctx.appId, task.id);
    assert.equal(runs[0]?.sessionId, `ses_fake_${before + 1}`);
  });
});
