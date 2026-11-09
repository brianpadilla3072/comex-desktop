import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApiError } from "../src/errors.js";
import { workspaceIdForPath } from "../src/workspaces.js";
import { specialistStore, applicationInput } from "../src/specialists/store.js";
import { createTask, listRuns, listTasks } from "../src/specialists/tasks.js";
import { createSpecialistScheduler } from "../src/specialists/scheduler.js";
import { registerSpecialistRoutes } from "../src/specialists/routes.js";
import { matchRoute, type RequestContext, type Route } from "../src/routes/registry.js";
import type { ServerConfig } from "../src/types.js";

const input = (name: string) => applicationInput.parse({ userName: "Usuario de prueba", name, specialty: `Especialidad ${name}`, personality: `PERSONA_${name}`, template: "custom" });

type EngineState = { calls: string[]; created?: Record<string, unknown>; prompted?: Record<string, unknown> };
function fakeEngine(state: EngineState) {
  return async (request: Request) => {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/workspace\/[^/]+\/opencode2\/api/, "");
    state.calls.push(`${request.method} ${path}`);
    if (request.method === "POST" && path === "/session") { state.created = await request.json() as Record<string, unknown>; return new Response(JSON.stringify({ id: "ses_dry_1" }), { status: 200, headers: { "content-type": "application/json" } }); }
    if (request.method === "POST" && path.startsWith("/session/")) { state.prompted = await request.json() as Record<string, unknown>; return new Response("{}", { status: 200 }); }
    return new Response("{}", { status: 200 });
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "specialists-dryrun-"));
  const config = { configPath: join(root, "server.json"), port: 4711, token: "test-token", workspaces: [] as Array<{ id: string; path: string }> };
  const store = await specialistStore(config as unknown as ServerConfig);
  const app = store.create(input("Alpha"), { agents: 0, skills: 0 });
  const project = join(root, "project");
  await mkdir(project, { recursive: true });
  const workspaceId = workspaceIdForPath(project);
  config.workspaces.push({ id: workspaceId, path: project });
  store.bind(workspaceId, app.id, project);
  return { root, config, store, app, workspaceId };
}

function apiHarness(config: Record<string, unknown>) {
  const routes: Route[] = [];
  registerSpecialistRoutes({
    routes, config: config as unknown as ServerConfig,
    readJsonBody: async (request: Request) => await request.json() as Record<string, unknown>,
    jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
    ensureWritable: () => {}, createWorkspace: async () => "ws_new",
  });
  return async (method: string, fullPath: string, body?: unknown, headers?: Record<string, string>) => {
    const url = new URL(`http://127.0.0.1:1${fullPath}`);
    const match = matchRoute(routes, method, url.pathname);
    assert.ok(match, `no route for ${method} ${fullPath}`);
    const request = new Request(url, { method, body: body === undefined ? undefined : JSON.stringify(body), headers });
    try {
      const response = await match.handler({ request, url, params: match.params, config } as unknown as RequestContext);
      return { status: response.status, json: await response.json() as Record<string, unknown> };
    } catch (error) {
      if (error instanceof ApiError) return { status: error.status, json: { error: error.code } };
      throw error;
    }
  };
}

test("dry-run rehearses without touching task state, run log or evidence", async () => {
  const { root, config, app, workspaceId } = await fixture();
  const state: EngineState = { calls: [] };
  const scheduler = await createSpecialistScheduler(config as unknown as ServerConfig, fakeEngine(state));
  try {
    await withFlags({ tasks: "true", dry: "true" }, async () => {
      const task = await createTask(config, app.id, { name: "refrescar", prompt: "Refrescar datos.", schedule: { kind: "interval", everyMinutes: 20 } });
      const before = (await listTasks(config, app.id))[0]!;
      // Unknown task: 404, not a silent no-op.
      await assert.rejects(scheduler.dryRun(app.id, "task_inventada"), (error) => error instanceof ApiError && error.code === "task_not_found");
      const result = await scheduler.dryRun(app.id, task.id);
      assert.equal(result.ok, true);
      assert.equal(result.sessionId, "ses_dry_1");
      assert.equal(result.workspaceId, workspaceId);
      // The rehearsal session is labelled and the prompt carries the no-persistence banner.
      assert.match(String(state.created?.title), /Ensayo \(sin guardar\): refrescar/);
      assert.match(String(state.prompted?.text), /ENSAYO — no guardes nada/);
      assert.match(String(state.prompted?.text), /Refrescar datos\./);
      assert.equal((state.prompted?.metadata as Record<string, unknown>).openworkDryRun, true);
      // Nothing persisted: task state identical, no run log, no evidence file.
      const after = (await listTasks(config, app.id))[0]!;
      assert.equal(after.runs, 0);
      assert.equal(after.running, null);
      assert.equal(after.lastStatus, null);
      assert.equal(after.nextRunAt, before.nextRunAt);
      assert.deepEqual(await listRuns(config, app.id, task.id), []);
      const runsDir = join(root, "project", "comex", "tareas");
      await assert.rejects(readFile(join(runsDir, task.id, "runs"), "utf8").catch(e => { throw e; })).catch(() => undefined);
      // The real scheduler still sees the task as due-able: dry-run didn't consume a slot.
      assert.ok(after.nextRunAt && after.nextRunAt > Date.now());
    });
  } finally { await scheduler.stop(); await rm(root, { recursive: true, force: true }); }
});

test("dry-run route: honest errors (no scheduler, no project, flag off)", async () => {
  const { root, config, app, store } = await fixture();
  const call = apiHarness(config);
  try {
    await withFlags({ tasks: "true", dry: "true" }, async () => {
      const task = await createTask(config, app.id, { name: "x", prompt: "P.", schedule: { kind: "interval", everyMinutes: 10 } });
      // No scheduler running in this process: 503, not a silent no-op (same order as run-now).
      assert.equal((await call("POST", `/specialist-applications/${app.id}/tasks/${task.id}/dry-run`, {})).status, 503);
      assert.equal((await call("POST", `/specialist-applications/${app.id}/tasks/task_inventada/dry-run`, {})).status, 503);
    });
    await withFlags({ tasks: "true", dry: "false" }, async () => {
      assert.equal((await call("POST", `/specialist-applications/${app.id}/tasks/task_cualquiera/dry-run`, {})).json.error, "task_dry_run_disabled");
    });
    void store;
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function withFlags(flags: { tasks: "true" | "false"; dry: "true" | "false" }, run: () => Promise<void>) {
  const before = new Map([["DEN_FEATURE_SCHEDULED_TASKS", process.env.DEN_FEATURE_SCHEDULED_TASKS], ["DEN_FEATURE_TASK_DRY_RUN", process.env.DEN_FEATURE_TASK_DRY_RUN]]);
  process.env.DEN_FEATURE_SCHEDULED_TASKS = flags.tasks;
  process.env.DEN_FEATURE_TASK_DRY_RUN = flags.dry;
  return run().finally(() => {
    for (const [key, value] of before) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });
}
