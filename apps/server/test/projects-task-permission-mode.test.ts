import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { applicationInput, specialistStore } from "../src/specialists/store.js";
import { createTask, listTasks, patchTask } from "../src/specialists/tasks.js";
import { createSpecialistScheduler, type SpecialistScheduler } from "../src/specialists/scheduler.js";
import type { ServerConfig, WorkspaceInfo } from "../src/types.js";

/**
 * Permission mode of a scheduled task (projectsExperience). "auto": the scheduler answers the
 * run's own permission requests (its session and the sessions it delegated to) with "once".
 * "manual": nothing is answered, the request waits for the person, and the run is not retired
 * by the 15-minute timeout while it waits. The fake engine stands behind the same workspace
 * proxy paths the scheduler uses in production.
 */

type Engine = { sessions: number; replies: Array<{ workspaceId: string; sessionId: string; requestId: string; body: unknown }>; created: string[] };

function fakeEngine(state: Engine) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const match = /^\/workspace\/([^/]+)\/opencode2\/api(\/.*)$/.exec(url.pathname);
    const workspaceId = decodeURIComponent(match?.[1] ?? "");
    const path = match?.[2] ?? "";
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    if (request.method === "POST" && path === "/session") {
      state.sessions += 1;
      const id = `ses_run_${state.sessions}`;
      state.created.push(`${workspaceId}:${id}`);
      return json({ data: { id } });
    }
    const reply = /^\/session\/([^/]+)\/permission\/([^/]+)\/reply$/.exec(path);
    if (request.method === "POST" && reply) {
      state.replies.push({ workspaceId, sessionId: reply[1] ?? "", requestId: reply[2] ?? "", body: await request.json() });
      return json({ data: true });
    }
    if (request.method === "POST") return json({});
    if (path === "/session") {
      const parent = url.searchParams.get("parentID") ?? "";
      return json({ data: [{ id: `${parent}_child`, parentID: parent }, { id: "ses_unrelated", parentID: "ses_elsewhere" }] });
    }
    const pending = /^\/session\/([^/]+)\/permission$/.exec(path);
    if (pending) return json({ data: [{ id: `per_${pending[1]}`, sessionID: pending[1] }] });
    // Message history: never completed, so the runs stay in flight.
    return json({ data: [] });
  };
}

const FLAGS: Record<string, string> = { DEN_FEATURE_SPECIALIST_APPLICATIONS: "true", DEN_FEATURE_SCHEDULED_TASKS: "true", DEN_FEATURE_PROJECTS_EXPERIENCE: "true", DEN_FEATURE_TASK_ISOLATION_REVIEW: "false" };
const saved = new Map(Object.keys(FLAGS).map(name => [name, process.env[name]]));
let root = "";
let scheduler: SpecialistScheduler;
let state: Engine;
let config: { configPath: string; port: number; token: string; workspaces: WorkspaceInfo[] };
let appId = "";
let store: Awaited<ReturnType<typeof specialistStore>>;

before(async () => {
  for (const [name, value] of Object.entries(FLAGS)) process.env[name] = value;
  root = await mkdtemp(join(tmpdir(), "projects-task-permission-"));
  config = { configPath: join(root, "server.json"), port: 4798, token: "test-token", workspaces: [] };
  store = await specialistStore(config);
  appId = store.create(applicationInput.parse({ userName: "Persona", name: "Tareas", specialty: "Pruebas", template: "custom" }), { agents: 0, skills: 0 }).id;
  for (const id of ["ws_first", "ws_second"]) {
    const path = join(root, id);
    await mkdir(join(path, "proyecto"), { recursive: true });
    config.workspaces.push({ id, name: id, path, workspaceType: "local" });
    store.bind(id, appId, path);
  }
  state = { sessions: 0, replies: [], created: [] };
  scheduler = await createSpecialistScheduler(config as unknown as ServerConfig, fakeEngine(state));
});

after(async () => {
  await scheduler.stop();
  for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  store.close();
  await rm(root, { recursive: true, force: true });
});

const schedule = { kind: "daily", hour: 3, minute: 0 } as const;
const runningSession = async (taskId: string) => z.string().parse((await listTasks(config, appId)).find(task => task.id === taskId)?.running?.sessionId);

test("auto: the run's own permission requests are approved once, in the task's project", async () => {
  const task = await createTask(config, appId, { name: "Automática", prompt: "Revisa.", schedule }, { owner: { workspaceId: "ws_second", permissionMode: "auto", isolation: false } });
  assert.deepEqual(await scheduler.trigger(appId, task.id), { ok: true });
  const sessionId = await runningSession(task.id);
  assert.ok(state.created.includes(`ws_second:${sessionId}`), "the run starts in the project the task names");
  await scheduler.tick();
  const replies = state.replies.filter(reply => reply.sessionId.startsWith(sessionId));
  assert.deepEqual(replies.map(reply => [reply.workspaceId, reply.sessionId, reply.requestId]).sort(), [
    ["ws_second", sessionId, `per_${sessionId}`],
    ["ws_second", `${sessionId}_child`, `per_${sessionId}_child`],
  ]);
  assert.deepEqual(replies[0]?.body, { decision: "once", reply: "once" });
  assert.ok(!state.replies.some(reply => reply.sessionId === "ses_unrelated"), "sessions of other conversations are never answered");
});

test("manual: nothing is answered and a run waiting for the person is not retired at 15 minutes", async () => {
  const task = await createTask(config, appId, { name: "Manual", prompt: "Revisa.", schedule }, { owner: { workspaceId: "ws_first", permissionMode: "manual", isolation: false } });
  assert.deepEqual(await scheduler.trigger(appId, task.id), { ok: true });
  const sessionId = await runningSession(task.id);
  await scheduler.tick();
  assert.ok(!state.replies.some(reply => reply.sessionId.startsWith(sessionId)), "manual runs leave every request to the person");
  // Twenty minutes in, still waiting for an approval: the run keeps its claim.
  await patchTask(config, appId, task.id, current => ({ ...current, running: current.running ? { ...current.running, startedAt: Date.now() - 20 * 60_000 } : null }));
  await scheduler.tick();
  const after = (await listTasks(config, appId)).find(entry => entry.id === task.id);
  assert.equal(after?.running?.sessionId, sessionId);
  assert.equal(after?.lastStatus, "running");
  // Past a day of waiting it is retired with an honest reason.
  await patchTask(config, appId, task.id, current => ({ ...current, running: current.running ? { ...current.running, startedAt: Date.now() - 25 * 60 * 60_000 } : null }));
  await scheduler.tick();
  const retired = (await listTasks(config, appId)).find(entry => entry.id === task.id);
  assert.equal(retired?.running, null);
  assert.equal(retired?.lastStatus, "failed");
});

test("a task whose project is gone is blocked instead of running somewhere else", async () => {
  const task = await createTask(config, appId, { name: "Huérfana", prompt: "Revisa.", schedule }, { owner: { workspaceId: "ws_gone", permissionMode: "manual" } });
  const result = await scheduler.trigger(appId, task.id);
  assert.equal(result.ok, false);
  assert.equal((await listTasks(config, appId)).find(entry => entry.id === task.id)?.lastStatus, "blocked");
});
