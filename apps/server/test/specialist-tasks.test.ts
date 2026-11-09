import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApiError } from "../src/errors.js";
import { workspaceIdForPath } from "../src/workspaces.js";
import { openSpecialistStore, specialistStore, applicationInput } from "../src/specialists/store.js";
import { mkdir, writeFile } from "node:fs/promises";
import { inspectSpecialistPack, saveSpecialistPack } from "../src/specialists/packs.js";
import { createTask, deleteTask, listRuns, listTasks, missedOccurrences, nextRun, patchTask, updateTask } from "../src/specialists/tasks.js";
import { createSpecialistScheduler } from "../src/specialists/scheduler.js";
import { runLibraryTool, syncLibraryToolPlugin } from "../src/specialists/library-tool-api.js";
import { registerSpecialistRoutes } from "../src/specialists/routes.js";
import { matchRoute, type RequestContext, type Route } from "../src/routes/registry.js";
import type { ServerConfig } from "../src/types.js";

const input = (name: string) => applicationInput.parse({ userName: "Usuario de prueba", name, specialty: `Especialidad ${name}`, personality: `PERSONA_${name}`, template: "custom" });

function withFlag(value: "true" | "false", run: () => Promise<void>) {
  const before = process.env.DEN_FEATURE_SCHEDULED_TASKS;
  process.env.DEN_FEATURE_SCHEDULED_TASKS = value;
  return run().finally(() => { if (before === undefined) delete process.env.DEN_FEATURE_SCHEDULED_TASKS; else process.env.DEN_FEATURE_SCHEDULED_TASKS = before; });
}

const failureStatus = (error: unknown, code: string) => error instanceof ApiError && error.code === code;

test("schedule math honors minutes, local times and one-shots", () => {
  const from = new Date(2026, 10, 9, 14, 20, 0, 0).getTime(); // lunes 14:20 local
  assert.equal(nextRun({ kind: "interval", everyMinutes: 20 }, from), from + 20 * 60_000);
  assert.equal(nextRun({ kind: "daily", hour: 15, minute: 0 }, from), new Date(2026, 10, 9, 15, 0).getTime());
  assert.equal(nextRun({ kind: "daily", hour: 10, minute: 30 }, from), new Date(2026, 10, 10, 10, 30).getTime());
  assert.equal(nextRun({ kind: "weekly", daysOfWeek: [1], hour: 9, minute: 0 }, from), new Date(2026, 10, 16, 9, 0).getTime());
  assert.equal(nextRun({ kind: "weekly", daysOfWeek: [2], hour: 9, minute: 0 }, from), new Date(2026, 10, 10, 9, 0).getTime());
  assert.equal(nextRun({ kind: "once", at: from + 1 }, from), from + 1);
  assert.equal(nextRun({ kind: "once", at: from - 1 }, from), null);
  assert.equal(missedOccurrences({ kind: "interval", everyMinutes: 20 }, from - 50 * 60_000, from), 2);
  assert.equal(missedOccurrences({ kind: "interval", everyMinutes: 20 }, from - 60 * 60_000, from), 3);
  assert.equal(missedOccurrences({ kind: "interval", everyMinutes: 20 }, from, from), 0);
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "specialists-tasks-"));
  const config = { configPath: join(root, "server.json"), port: 4711, token: "test-token", workspaces: [] as Array<{ id: string; path: string }> };
  const store = await specialistStore(config as unknown as ServerConfig);
  const pack = join(root, "source");
  await mkdir(join(pack, "agents"), { recursive: true });
  await writeFile(join(pack, "agents", "revisor.md"), "---\ndescription: Revisor de prueba.\nmode: subagent\n---\nRevisá evidencia.\n");
  const app = store.create(input("Alpha"), { agents: 1, skills: 0 });
  await saveSpecialistPack(config, app.id, await inspectSpecialistPack(pack));
  return { root, config, store, app };
}

test("the task store validates names, limits and running edits", async () => {
  const { root, config, app } = await fixture();
  try {
    await assert.rejects(createTask(config, "app_x", { name: "", prompt: "p", schedule: { kind: "interval", everyMinutes: 5 } }), (error) => failureStatus(error, "invalid_task"));
    await assert.rejects(createTask(config, "app_x", { name: "t", prompt: "", schedule: { kind: "interval", everyMinutes: 5 } }), (error) => failureStatus(error, "invalid_task"));
    await assert.rejects(createTask(config, app.id, { name: "pasada", prompt: "p", schedule: { kind: "once", at: Date.now() - 1000 } }), (error) => failureStatus(error, "invalid_task"));
    await assert.rejects(createTask(config, app.id, { name: "malo", prompt: "p", schedule: { kind: "interval", everyMinutes: 0 } }), (error) => failureStatus(error, "invalid_task"));
    const task = await createTask(config, app.id, { name: "refrescar", prompt: "Refrescar datos.", schedule: { kind: "interval", everyMinutes: 20 } });
    assert.ok(task.nextRunAt !== null && task.nextRunAt > Date.now());
    assert.equal(task.enabled, true);
    await assert.rejects(createTask(config, app.id, { name: "refrescar", prompt: "otra", schedule: { kind: "interval", everyMinutes: 5 } }), (error) => failureStatus(error, "task_exists"));
    for (let i = 0; i < 19; i++) await createTask(config, app.id, { name: `t-${i}`, prompt: "p", schedule: { kind: "interval", everyMinutes: 60 } });
    await assert.rejects(createTask(config, app.id, { name: "desborda", prompt: "p", schedule: { kind: "interval", everyMinutes: 60 } }), (error) => failureStatus(error, "task_limit"));
    // A schedule edit recalculates; pausing keeps the slot for the claim.
    const edited = await updateTask(config, app.id, task.id, { schedule: { kind: "daily", hour: 8, minute: 30 } });
    assert.ok(edited.nextRunAt !== task.nextRunAt);
    const paused = await updateTask(config, app.id, task.id, { enabled: false });
    assert.equal(paused.enabled, false);
    // Delete refuses while a run holds the claim.
    await patchTask(config, app.id, task.id, t => ({ ...t, running: { workspaceId: "ws", sessionId: null, startedAt: Date.now(), mode: "scheduled", missed: 0 } }));
    await assert.rejects(deleteTask(config, app.id, task.id), (error) => failureStatus(error, "task_running"));
    await patchTask(config, app.id, task.id, t => ({ ...t, running: null }));
    await deleteTask(config, app.id, task.id);
    assert.equal((await listTasks(config, app.id)).some(t => t.id === task.id), false);
  } finally { await rmAll(root); }
});

const rmAll = async (root: string) => { const { rm } = await import("node:fs/promises"); await rm(root, { recursive: true, force: true }); };

function apiHarness(config: Record<string, unknown>) {
  const routes: Route[] = [];
  registerSpecialistRoutes({
    routes, config: config as unknown as ServerConfig,
    readJsonBody: async (request: Request) => await request.json() as Record<string, unknown>,
    jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
    ensureWritable: () => {}, createWorkspace: async () => "ws_new",
  });
  return async (method: string, path: string, body?: unknown, headers?: Record<string, string>) => {
    const match = matchRoute(routes, method, path);
    assert.ok(match, `no route for ${method} ${path}`);
    const url = new URL(`http://127.0.0.1:1${path}`);
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

test("task routes live and die with the scheduledTasks flag", async () => {
  const { root, config, app } = await fixture();
  const call = apiHarness(config);
  try {
    await withFlag("false", async () => {
      assert.equal((await call("GET", `/specialist-applications/${app.id}/tasks`)).json.error, "scheduled_tasks_disabled");
      const catalog = await call("GET", "/specialist-applications");
      assert.equal(catalog.json.scheduledTasksEnabled, false);
    });
    await withFlag("true", async () => {
      const catalog = await call("GET", "/specialist-applications");
      assert.equal(catalog.json.scheduledTasksEnabled, true);
      const created = await call("POST", `/specialist-applications/${app.id}/tasks`, { name: "monitoreo", prompt: "Consultá las fuentes.", schedule: { kind: "interval", everyMinutes: 20 } });
      assert.equal(created.status, 200);
      const listed = await call("GET", `/specialist-applications/${app.id}/tasks`);
      assert.equal((listed.json.tasks as Array<Record<string, unknown>>).length, 1);
      const taskId = String((created.json.task as { id: string }).id);
      assert.equal((await call("POST", `/specialist-applications/${app.id}/tasks/${taskId}/run-now`)).json.error, "scheduler_unavailable");
      const bad = await call("POST", `/specialist-applications/${app.id}/tasks`, { name: "x", prompt: "p", schedule: { kind: "diaria" } });
      assert.equal(bad.json.error, "invalid_task");
      const paused = await call("PUT", `/specialist-applications/${app.id}/tasks/${taskId}`, { enabled: false });
      assert.equal((paused.json.task as { enabled: boolean }).enabled, false);
      assert.equal((await call("DELETE", `/specialist-applications/${app.id}/tasks/${taskId}`)).json.deleted, taskId);
    });
  } finally { await rmAll(root); }
});

type EngineState = { completed: boolean; calls: string[]; prompted?: Record<string, unknown>; history?: Array<Record<string, unknown>> };

function fakeEngine(state: EngineState) {
  return async (request: Request) => {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/workspace\/[^/]+\/opencode2\/api/, "");
    state.calls.push(`${request.method} ${path}`);
    if (request.method === "POST" && path === "/session") return new Response(JSON.stringify({ id: "ses_auto_1" }), { status: 200, headers: { "content-type": "application/json" } });
    if (request.method === "POST" && path.startsWith("/session/")) { state.prompted = await request.json() as Record<string, unknown>; return new Response("{}", { status: 200 }); }
    if (path.startsWith("/session/")) {
      // Newest first, like the engine's order=desc pages.
      const history = state.history ?? (state.completed
        ? [{ type: "assistant", time: { completed: 1_700_000_000_000 } }, { type: "user", time: { created: 1 } }]
        : []);
      return new Response(JSON.stringify(history), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 200 });
  };
}

test("the scheduler claims before dispatch, records the run and finalizes it", async () => {
  const { root, config, app, store } = await fixture();
  try {
    const project = join(root, "project");
    await mkdir(project, { recursive: true });
    const workspaceId = workspaceIdForPath(project);
    config.workspaces.push({ id: workspaceId, path: project });
    store.bind(workspaceId, app.id, project);
    const state: EngineState = { completed: false, calls: [] };
    const scheduler = await createSpecialistScheduler(config as unknown as ServerConfig, fakeEngine(state));
    await withFlag("true", async () => {
      const task = await createTask(config, app.id, { name: "refrescar", prompt: "Refrescar datos.", schedule: { kind: "interval", everyMinutes: 20 } });
      // Simulate time asleep: 50 minutes late → three due occurrences (0, +20, +40) coalesce into one run.
      await patchTask(config, app.id, task.id, t => ({ ...t, nextRunAt: Date.now() - 50 * 60_000 }));
      await scheduler.tick();
      const running = (await listTasks(config, app.id)).find(t => t.id === task.id)!;
      assert.equal(running.lastStatus, "running");
      assert.equal(running.running?.workspaceId, workspaceId);
      assert.equal(running.running?.missed, 2);
      assert.equal(running.nextRunAt !== null && running.nextRunAt > Date.now(), true);
      assert.equal(state.prompted?.text, "Refrescar datos.");
      assert.equal((state.prompted?.metadata as Record<string, unknown>).openworkScheduledTask, task.id);
      // The same due task is not dispatched twice while claimed.
      const dispatchedBefore = state.calls.filter(c => c.startsWith("POST /session/")).length;
      await scheduler.tick();
      assert.equal(state.calls.filter(c => c.startsWith("POST /session/")).length, dispatchedBefore);
      // A blocked permission (assistant not completed) leaves the run open.
      await scheduler.tick();
      assert.equal((await listTasks(config, app.id)).find(t => t.id === task.id)!.lastStatus, "running");
      state.completed = true;
      await scheduler.tick();
      const done = (await listTasks(config, app.id)).find(t => t.id === task.id)!;
      assert.equal(done.lastStatus, "ok");
      assert.equal(done.running, null);
      // The run left auditable evidence inside the project, not just in the config dir.
      const { readdir } = await import("node:fs/promises");
      const runFiles = await readdir(join(project, "comex", "tareas", task.id, "runs"));
      assert.equal(runFiles.length, 1);
      assert.match(runFiles[0]!, /\.json$/);
      const evidence = JSON.parse(await readFile(join(project, "comex", "tareas", task.id, "runs", runFiles[0]!), "utf8")) as { status: string; sessionId: string | null };
      assert.equal(evidence.status, "ok");
      assert.equal(evidence.sessionId, "ses_auto_1");
      const runs = await listRuns(config, app.id, task.id);
      assert.equal(runs[0]?.status, "ok");
      assert.equal(runs[0]?.missed, 2);
      // Review regressions (Celda A): engine pages arrive newest-first — an unfinished top assistant
      // must NOT finalize the run by finding an older completed one — and a due claim logs one overlap line.
      await patchTask(config, app.id, task.id, t => ({ ...t, nextRunAt: Date.now() - 1000 }));
      state.history = [
        { type: "assistant", time: {} },
        { type: "user", time: { created: 1 } },
        { type: "assistant", time: { completed: 1 } },
      ];
      await scheduler.tick(); // dispatches run #2
      assert.equal((await listTasks(config, app.id)).find(t => t.id === task.id)!.lastStatus, "running");
      await scheduler.tick(); // observe: top assistant unfinished → stays open (the old bug finalized it)
      assert.equal((await listTasks(config, app.id)).find(t => t.id === task.id)!.lastStatus, "running");
      await patchTask(config, app.id, task.id, t => ({ ...t, nextRunAt: Date.now() - 1000 }));
      await scheduler.tick();
      await scheduler.tick();
      const overlaps = (await listRuns(config, app.id, task.id)).filter(entry => entry.status === "skipped_overlap");
      assert.equal(overlaps.length, 1);
      state.history = [{ type: "assistant", time: { completed: 2 } }];
      await scheduler.tick();
      assert.equal((await listTasks(config, app.id)).find(t => t.id === task.id)!.lastStatus, "ok");
      // Manual trigger from the route runs outside the schedule and does not move it.
      const beforeManual = (await listTasks(config, app.id)).find(t => t.id === task.id)!;
      const nextBefore = beforeManual.nextRunAt;
      const call = apiHarness(config);
      const started = await call("POST", `/specialist-applications/${app.id}/tasks/${task.id}/run-now`);
      assert.equal(started.json.started, true);
      const manual = (await listTasks(config, app.id)).find(t => t.id === task.id)!;
      assert.equal(manual.nextRunAt, nextBefore);
      assert.equal(manual.running?.mode, "manual");
      const blocked = await call("POST", `/specialist-applications/${app.id}/tasks/${task.id}/run-now`);
      assert.equal(blocked.json.error, "task_running");
      state.completed = true;
      await scheduler.tick();
      // Flag off: the loop goes quiet even with a due task.
      await patchTask(config, app.id, task.id, t => ({ ...t, nextRunAt: Date.now() - 1000 }));
      const callsBefore = state.calls.length;
      await withFlag("false", () => scheduler.tick());
      assert.equal(state.calls.length, callsBefore);
    });
    await scheduler.stop();
  } finally { await rmAll(root); }
});

test("a task without any bound project blocks with backoff instead of spinning", async () => {
  const { root, config, app } = await fixture();
  try {
    const state: EngineState = { completed: false, calls: [] };
    const scheduler = await createSpecialistScheduler(config as unknown as ServerConfig, fakeEngine(state));
    await withFlag("true", async () => {
      const task = await createTask(config, app.id, { name: "sin-proyecto", prompt: "p", schedule: { kind: "interval", everyMinutes: 5 } });
      await patchTask(config, app.id, task.id, t => ({ ...t, nextRunAt: Date.now() - 1000 }));
      await scheduler.tick();
      const blocked = (await listTasks(config, app.id)).find(t => t.id === task.id)!;
      assert.equal(blocked.lastStatus, "blocked");
      assert.equal(blocked.running, null);
      assert.ok(blocked.nextRunAt !== null && blocked.nextRunAt > Date.now());
      assert.equal(state.calls.length, 0);
      const runs = await listRuns(config, app.id, task.id);
      assert.equal(runs[0]?.status, "blocked");
    });
    await scheduler.stop();
  } finally { await rmAll(root); }
});

test("chat can create and manage tasks through the scoped tool bridge", async () => {  const { root, config, app, store } = await fixture();
  try {
    const project = join(root, "project-bridge");
    await mkdir(project, { recursive: true });
    const workspaceId = workspaceIdForPath(project);
    config.workspaces.push({ id: workspaceId, path: project });
    store.bind(workspaceId, app.id, project);
    await syncLibraryToolPlugin(config as unknown as ServerConfig, workspaceId, project);
    await withFlag("true", async () => {
      const created = await runLibraryTool(config, project, "specialist_task_create", { name: "lunes", prompt: "Resumí la semana.", schedule: { kind: "weekly", daysOfWeek: [1], hour: 9, minute: 0 } }) as { task: { name: string; schedule: { kind: string } } };
      assert.equal(created.task.name, "lunes");
      assert.equal(created.task.schedule.kind, "weekly");
      const listed = await runLibraryTool(config, project, "specialist_task_list", {}) as { tasks: Array<{ name: string; id: string }> };
      assert.equal(listed.tasks.length, 1);
      const id = listed.tasks[0]!.id;
      await runLibraryTool(config, project, "specialist_task_pause", { taskId: id });
      assert.equal((await listTasks(config, app.id)).find(t => t.id === id)!.enabled, false);
      await assert.rejects(runLibraryTool(config, project, "specialist_task_create", { name: "x", prompt: "p", schedule: { kind: "interval", everyMinutes: 0 } }), ApiError);
    });
    await withFlag("false", async () => {
      await assert.rejects(runLibraryTool(config, project, "specialist_task_create", { name: "apagado", prompt: "p", schedule: { kind: "interval", everyMinutes: 5 } }), (error) => failureStatus(error, "scheduled_tasks_disabled"));
    });
    // Review regression B1: the route-level tool schema accepts the task names (they used to 422 there).
    const call = apiHarness(config);
    const { readdir } = await import("node:fs/promises");
    const toolFiles = await readdir(join(root, "specialists", "tool"));
    const descriptor = JSON.parse(await readFile(join(root, "specialists", "tool", toolFiles[0]!), "utf8")) as { token: string };
    await withFlag("true", async () => {
      const listed = await call("POST", "/specialist-tool", { name: "specialist_task_list", input: {} }, { authorization: `Bearer ${descriptor.token}`, "content-type": "application/json" });
      assert.equal(listed.status, 200);
      assert.equal((listed.json.result as { tasks: unknown[] }).tasks.length, 1);
      const unknownTool = await call("POST", "/specialist-tool", { name: "specialist_task_rename", input: {} }, { authorization: `Bearer ${descriptor.token}`, "content-type": "application/json" });
      assert.equal(unknownTool.status, 422);
      assert.equal(unknownTool.json.error, "invalid_library_tool");
    });
  } finally { await rmAll(root); }
});
