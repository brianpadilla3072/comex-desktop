import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApiError } from "../src/errors.js";
import { applicationInput, specialistStore } from "../src/specialists/store.js";
import { appendRun, createTask, patchTask } from "../src/specialists/tasks.js";
import {
  COMMAND_CENTER_RECENT_MS, commandCenterSnapshotSchema, describeCommandCenter, registerCommandCenterRoutes,
  type CommandCenterDeps, type CommandCenterEngine,
} from "../src/command-center.js";
import { matchRoute, type RequestContext, type Route } from "../src/routes/registry.js";
import type { ServerConfig, WorkspaceInfo } from "../src/types.js";

// Nothing here may reach the person's own state: every location a server
// could read points into a scratch folder for the whole file.
const ISOLATED_KEYS = ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "OPENWORK_DATA_DIR", "OPENWORK_RUNTIME_DB", "OPENCODE_DB", "OPENWORK_ENV_STORE", "DEN_FEATURE_COMMAND_CENTER"];
const savedEnv = new Map<string, string | undefined>();
let sandbox = "";
before(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "command-center-env-"));
  for (const key of ISOLATED_KEYS) savedEnv.set(key, process.env[key]);
  process.env.HOME = sandbox;
  process.env.XDG_CONFIG_HOME = join(sandbox, "config");
  process.env.XDG_DATA_HOME = join(sandbox, "data");
  process.env.XDG_STATE_HOME = join(sandbox, "state");
  process.env.XDG_CACHE_HOME = join(sandbox, "cache");
  process.env.OPENWORK_DATA_DIR = join(sandbox, "openwork");
  process.env.OPENWORK_RUNTIME_DB = join(sandbox, "runtime.sqlite");
  process.env.OPENCODE_DB = join(sandbox, "opencode.db");
  process.env.OPENWORK_ENV_STORE = join(sandbox, "env.json");
  delete process.env.DEN_FEATURE_COMMAND_CENTER;
});
after(async () => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(sandbox, { recursive: true, force: true });
});

function workspace(id: string, name: string): WorkspaceInfo {
  return { id, name, path: `/scratch/${id}`, preset: "starter", workspaceType: "local" };
}

type EngineState = {
  /** Path (after the mount) → JSON payload, or a status number to fail with. */
  routes: Record<string, unknown>;
  calls: string[];
};

/** A fake of the server's own workspace proxy, keyed by `<workspaceId><enginePath>`. */
function fakeServer(state: EngineState): CommandCenterDeps["request"] {
  return async (request) => {
    const url = new URL(request.url);
    const match = /^\/workspace\/([^/]+)\/(opencode2\/api|opencode)(\/.*)$/.exec(url.pathname);
    assert.ok(match, `unexpected request ${url.pathname}`);
    const key = `${request.method} ${decodeURIComponent(match[1] ?? "")}${match[3] ?? ""}`;
    state.calls.push(key);
    const value = state.routes[key];
    if (value === undefined) return new Response("{}", { status: 404 });
    if (typeof value === "number") return new Response("{}", { status: value });
    return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
  };
}

async function fixture(engine: CommandCenterEngine, routes: Record<string, unknown>) {
  const root = await mkdtemp(join(sandbox, "server-"));
  const config = {
    configPath: join(root, "server.json"), port: 4711, token: "test-token",
    workspaces: [workspace("ws_a", "Alpha"), workspace("ws_b", "Beta"), { ...workspace("ws_remote", "Remote"), workspaceType: "remote" }],
  } satisfies Pick<ServerConfig, "configPath" | "port" | "token" | "workspaces">;
  const state: EngineState = { routes, calls: [] };
  const deps: CommandCenterDeps = { request: fakeServer(state), engine: () => engine, now: () => Date.now() };
  return { root, config, state, deps };
}

function asConfig(config: Pick<ServerConfig, "configPath" | "port" | "token" | "workspaces">): ServerConfig {
  // The command center reads only these fields; the rest of ServerConfig is irrelevant here.
  return Object.assign(Object.create(null), config);
}

test("v2: lists running, waiting and sub-agent work across workspaces with title, model and app", async () => {
  const { root, config, state, deps } = await fixture("v2", {
    "GET ws_a/session/active": { data: { ses_run: { type: "running" }, ses_child: { type: "running" }, ses_wait: { type: "running" } } },
    "GET ws_a/session/ses_run": { data: { id: "ses_run", title: "Draft the quote", model: { providerID: "local", id: "tiny" }, time: { created: 1_700_000_000, updated: 1_700_000_100 } } },
    "GET ws_a/session/ses_run/permission": { data: [] },
    "GET ws_a/session/ses_run/form": { data: [] },
    "GET ws_a/session/ses_child": { data: { id: "ses_child", title: "Sub-agent", parentID: "ses_run" } },
    "GET ws_a/session/ses_child/permission": { data: [] },
    "GET ws_a/session/ses_child/form": { data: [] },
    "GET ws_a/session/ses_wait": { data: { id: "ses_wait", title: "Needs approval" } },
    "GET ws_a/session/ses_wait/permission": { data: [{ id: "per_1", sessionID: "ses_wait" }] },
    "GET ws_a/session/ses_wait/form": { data: [] },
    "GET ws_b/session/active": { data: {} },
  });
  try {
    const store = await specialistStore(asConfig(config));
    const app = store.create(applicationInput.parse({ userName: "Test", name: "Exports", specialty: "Trade", personality: "Calm", template: "custom" }), { agents: 0, skills: 0 });
    store.bind("ws_a", app.id, "/scratch/ws_a");
    const snapshot = await describeCommandCenter(asConfig(config), deps);
    assert.equal(commandCenterSnapshotSchema.safeParse(snapshot).success, true);
    assert.equal(snapshot.complete, true);
    assert.deepEqual(snapshot.problems, []);
    const sessions = snapshot.items.filter(item => item.kind === "session");
    assert.deepEqual(sessions.map(item => item.sessionId), ["ses_wait", "ses_run"], "waiting first, sub-agents folded into the parent");
    const running = sessions.find(item => item.sessionId === "ses_run");
    assert.ok(running && running.kind === "session");
    assert.equal(running.status, "running");
    assert.equal(running.title, "Draft the quote");
    assert.deepEqual(running.model, { providerID: "local", modelID: "tiny" });
    assert.equal(running.subtasks, 1);
    assert.equal(running.applicationName, "Exports");
    assert.equal(running.workspaceName, "Alpha");
    assert.equal(running.updatedAt, 1_700_000_100_000, "engine seconds become milliseconds");
    assert.equal(sessions[0]?.status, "waiting_permission");
    assert.deepEqual(snapshot.counts, { running: 1, waiting: 1, failed: 0 });
    // Remote workspaces belong to another server and are never probed here.
    assert.equal(state.calls.some(call => call.includes("ws_remote")), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an unreadable workspace is reported, never read as nothing running", async () => {
  const { root, config, deps } = await fixture("v2", {
    "GET ws_a/session/active": 503,
    "GET ws_b/session/active": { data: {} },
  });
  try {
    const snapshot = await describeCommandCenter(asConfig(config), deps);
    assert.equal(snapshot.complete, false);
    assert.equal(snapshot.items.length, 0);
    assert.deepEqual(snapshot.problems.map(problem => [problem.source, problem.id, problem.label]), [["workspace", "ws_a", "Alpha"]]);
    assert.match(snapshot.problems[0]?.message ?? "", /503/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("v1: reads statuses, permissions and questions; retry carries its error", async () => {
  const { root, config, deps } = await fixture("v1", {
    "GET ws_a/session/status": { ses_retry: { type: "retry", attempt: 2, message: "Rate limited by provider", next: 0 }, ses_idle: { type: "idle" } },
    "GET ws_a/permission": [],
    "GET ws_a/question": [{ id: "que_1", sessionID: "ses_ask" }],
    "GET ws_a/session/ses_retry": { id: "ses_retry", title: "Retrying" },
    "GET ws_a/session/ses_ask": { id: "ses_ask", title: "Asking" },
    "GET ws_b/session/status": {},
    "GET ws_b/permission": [],
    "GET ws_b/question": [],
  });
  try {
    const snapshot = await describeCommandCenter(asConfig(config), deps);
    assert.equal(snapshot.complete, true);
    const byId = new Map(snapshot.items.flatMap(item => item.kind === "session" ? [[item.sessionId, item]] : []));
    assert.equal(byId.has("ses_idle"), false);
    assert.equal(byId.get("ses_retry")?.status, "retrying");
    assert.equal(byId.get("ses_retry")?.lastError, "Rate limited by provider");
    assert.equal(byId.get("ses_ask")?.status, "waiting_question");
    assert.equal(byId.get("ses_ask")?.engine, "v1");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("scheduled runs: running tasks absorb their conversation; recent failures show their error; old outcomes drop out", async () => {
  const { root, config, deps } = await fixture("v2", {
    "GET ws_a/session/active": { data: { ses_task: { type: "running" } } },
    "GET ws_a/session/ses_task": { data: { id: "ses_task", title: "Tarea programada: refresh" } },
    "GET ws_a/session/ses_task/permission": { data: [] },
    "GET ws_a/session/ses_task/form": { data: [{ id: "frm_1", sessionID: "ses_task" }] },
    "GET ws_b/session/active": { data: {} },
  });
  try {
    const store = await specialistStore(asConfig(config));
    const app = store.create(applicationInput.parse({ userName: "Test", name: "Exports", specialty: "Trade", personality: "Calm", template: "custom" }), { agents: 0, skills: 0 });
    store.bind("ws_a", app.id, "/scratch/ws_a");
    const cfg = asConfig(config);
    const running = await createTask(cfg, app.id, { name: "refresh", prompt: "Refresh.", schedule: { kind: "interval", everyMinutes: 30 }, model: { providerID: "local", modelID: "tiny" } });
    await patchTask(cfg, app.id, running.id, task => ({ ...task, lastStatus: "running", running: { workspaceId: "ws_a", sessionId: "ses_task", startedAt: Date.now() - 60_000, mode: "manual", missed: 0, evidencePath: null, skippedLogged: false } }));
    const failed = await createTask(cfg, app.id, { name: "report", prompt: "Report.", schedule: { kind: "daily", hour: 8, minute: 0 } });
    await appendRun(cfg, app.id, failed.id, { at: Date.now() - 5 * 60_000, mode: "scheduled", missed: 0, workspaceId: "ws_a", sessionId: "ses_old", status: "failed", detail: "The engine answered 502." });
    const stale = await createTask(cfg, app.id, { name: "stale", prompt: "Old.", schedule: { kind: "daily", hour: 9, minute: 0 } });
    await appendRun(cfg, app.id, stale.id, { at: Date.now() - COMMAND_CENTER_RECENT_MS - 60_000, mode: "scheduled", missed: 0, workspaceId: "ws_a", sessionId: null, status: "ok", detail: null });

    const snapshot = await describeCommandCenter(cfg, deps);
    assert.equal(snapshot.items.some(item => item.kind === "session"), false, "the task row stands for its conversation");
    const tasks = snapshot.items.flatMap(item => item.kind === "task" ? [item] : []);
    assert.deepEqual(tasks.map(item => item.taskName), ["refresh", "report"]);
    assert.equal(tasks[0]?.status, "waiting", "a pending question on the run's conversation surfaces on the task");
    assert.equal(tasks[0]?.sessionId, "ses_task");
    assert.deepEqual(tasks[0]?.model, { providerID: "local", modelID: "tiny" });
    assert.equal(tasks[1]?.status, "failed");
    assert.equal(tasks[1]?.lastError, "The engine answered 502.");
    assert.deepEqual(snapshot.counts, { running: 0, waiting: 1, failed: 1 });
  } finally { await rm(root, { recursive: true, force: true }); }
});

function routeHarness(config: ServerConfig, deps: CommandCenterDeps) {
  const routes: Route[] = [];
  registerCommandCenterRoutes({
    routes, config, deps, ensureWritable: () => {},
    jsonResponse: (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  });
  return async (method: string, path: string) => {
    const match = matchRoute(routes, method, path);
    assert.ok(match, `no route for ${method} ${path}`);
    const url = new URL(`http://127.0.0.1:1${path}`);
    const context: Pick<RequestContext, "request" | "url" | "params" | "config"> = { request: new Request(url, { method }), url, params: match.params, config };
    try {
      const response = await match.handler(Object.assign(Object.create(null), context));
      return { status: response.status, auth: match.auth, body: await response.json() };
    } catch (error) {
      if (error instanceof ApiError) return { status: error.status, auth: match.auth, body: { code: error.code } };
      throw error;
    }
  };
}

test("routes are owner-only, honour the flag, and stop goes to the engine chat runs on", async () => {
  const { root, config, state, deps } = await fixture("v2", {
    "GET ws_a/session/active": { data: {} },
    "GET ws_b/session/active": { data: {} },
    "POST ws_a/session/ses_1/interrupt": { data: { interrupted: true } },
  });
  try {
    const call = routeHarness(asConfig(config), deps);
    const listed = await call("GET", "/command-center/snapshot");
    assert.equal(listed.auth, "host");
    assert.equal(listed.status, 200);
    assert.equal(commandCenterSnapshotSchema.safeParse(listed.body).success, true);

    const stopped = await call("POST", "/command-center/sessions/ws_a/ses_1/stop");
    assert.equal(stopped.auth, "host");
    assert.deepEqual(stopped.body, { stopped: true });
    assert.ok(state.calls.includes("POST ws_a/session/ses_1/interrupt"));

    const missing = await call("POST", "/command-center/sessions/ws_missing/ses_1/stop");
    assert.equal(missing.status, 404);

    process.env.DEN_FEATURE_COMMAND_CENTER = "false";
    try {
      const off = await call("GET", "/command-center/snapshot");
      assert.equal(off.status, 404);
      assert.deepEqual(off.body, { code: "command_center_disabled" });
    } finally { delete process.env.DEN_FEATURE_COMMAND_CENTER; }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("v1 stop uses abort and reports a no-op honestly", async () => {
  const { root, config, deps } = await fixture("v1", { "POST ws_b/session/ses_2/abort": false });
  try {
    const call = routeHarness(asConfig(config), deps);
    assert.deepEqual((await call("POST", "/command-center/sessions/ws_b/ses_2/stop")).body, { stopped: false });
  } finally { await rm(root, { recursive: true, force: true }); }
});
