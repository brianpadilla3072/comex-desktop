import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { ServerConfig } from "../src/types.js";

// Isolated task copies and their review (docs/features/task-isolation-review). Everything runs in
// a temp HOME with its own data dirs, runtime DB and env store; no real engine is contacted.
const dir = realpathSync(mkdtempSync(join(tmpdir(), "task-isolation-")));
const HOST = "isolation-host";
const CLIENT = "isolation-client";
const overrides: Record<string, string | undefined> = {
  HOME: join(dir, "home"), XDG_CONFIG_HOME: join(dir, "home", ".config"), XDG_DATA_HOME: join(dir, "home", ".local", "share"),
  XDG_STATE_HOME: join(dir, "home", ".local", "state"), XDG_CACHE_HOME: join(dir, "home", ".cache"),
  OPENWORK_DATA_DIR: join(dir, "openwork"), OPENWORK_RUNTIME_DB: join(dir, "runtime.sqlite"),
  OPENCODE_DB: join(dir, "v1.db"), OPENWORK_ENGINE_AUTO_UPGRADE: "0", OPENWORK_ENV_STORE: join(dir, "env.json"),
  DEN_FEATURE_SPECIALIST_APPLICATIONS: "true", DEN_FEATURE_TASK_ISOLATION_REVIEW: "true", DEN_FEATURE_SCHEDULED_TASKS: undefined,
};
const previous = new Map(Object.keys(overrides).map(key => [key, process.env[key]]));

type Service = typeof import("../src/specialists/isolation/service.js");
let service: Service;
let resolveServerConfig: typeof import("../src/config.js").resolveServerConfig;
let specialistStore: typeof import("../src/specialists/store.js").specialistStore;
let applicationInput: typeof import("../src/specialists/store.js").applicationInput;

before(async () => {
  for (const [key, value] of Object.entries(overrides)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  mkdirSync(join(dir, "home"), { recursive: true });
  service = await import("../src/specialists/isolation/service.js");
  ({ resolveServerConfig } = await import("../src/config.js"));
  ({ specialistStore, applicationInput } = await import("../src/specialists/store.js"));
});
after(() => {
  for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  rmSync(dir, { recursive: true, force: true });
});

let counter = 0;
/** A fresh server config, specialist application and project folder per test. */
async function fixture(files: Record<string, string | Uint8Array> = {}) {
  const base = join(dir, `case-${++counter}`);
  const project = join(base, "project");
  mkdirSync(project, { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(project, path, ".."), { recursive: true });
    writeFileSync(join(project, path), content);
  }
  const config = await resolveServerConfig({ configPath: join(base, "server.json"), workspaces: [project], port: 0, token: CLIENT, hostToken: HOST, logRequests: false });
  const store = await specialistStore(config);
  const app = store.create(applicationInput.parse({ userName: "Persona", name: `App ${counter}`, specialty: "Pruebas", template: "custom" }), { agents: 0, skills: 0 });
  const workspaceId = config.workspaces[0]?.id ?? "";
  store.bind(workspaceId, app.id, project);
  return { base, project, config, appId: app.id, workspaceId };
}

const read = (path: string) => readFileSync(path, "utf8");
const codeOf = async (work: Promise<unknown>) => {
  try { await work; return "ok"; }
  catch (error) { return z.object({ code: z.string() }).parse(error).code; }
};
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

test("a snapshot copy skips dependencies, caches and links, and lives in the application's data dir", async () => {
  const { project, config, appId, workspaceId } = await fixture({
    "informe.md": "# Informe\n", "datos/tabla.csv": "a,b\n1,2\n", "logo.png": PNG,
    "node_modules/x/index.js": "x", ".opencode/node_modules/y/index.js": "y", ".opencode/agents/analista.md": "agente", ".git/HEAD": "ref",
  });
  mkdirSync(join(dir, "outside"), { recursive: true });
  writeFileSync(join(dir, "outside", "secreto.txt"), "no copiar");
  symlinkSync(join(dir, "outside"), join(project, "enlace"));
  const record = await service.createIsolation(config, { applicationId: appId, workspaceId, projectRoot: project, origin: { kind: "session", sessionId: "ses_a" } });
  assert.equal(record.mode, "snapshot");
  assert.ok(record.copyPath.startsWith(join(dir, `case-${counter}`)), record.copyPath);
  assert.ok(record.copyPath.includes(join(appId, "isolations", record.id)));
  for (const path of ["informe.md", "datos/tabla.csv", "logo.png", ".opencode/agents/analista.md"]) assert.ok(existsSync(join(record.copyPath, path)), path);
  for (const path of ["node_modules", ".opencode/node_modules", ".git", "enlace"]) assert.equal(existsSync(join(record.copyPath, path)), false, path);
  assert.deepEqual(await service.isolationChanges(config, record), []);
  assert.deepEqual((await service.listIsolations(config, appId)).map(entry => entry.id), [record.id]);
});

test("changes are detected per file, binaries by size and type, text with a line diff", async () => {
  const { project, config, appId, workspaceId } = await fixture({ "informe.md": "uno\ndos\ntres\n", "datos/tabla.csv": "a,b\n", "logo.png": PNG });
  const record = await service.createIsolation(config, { applicationId: appId, workspaceId, projectRoot: project, origin: { kind: "session", sessionId: "ses_a" } });
  writeFileSync(join(record.copyPath, "informe.md"), "uno\nDOS\ntres\n");
  writeFileSync(join(record.copyPath, "nuevo.txt"), "hola\n");
  rmSync(join(record.copyPath, "datos", "tabla.csv"));
  writeFileSync(join(record.copyPath, "logo.png"), Uint8Array.from([...PNG, 0x01, 0x02]));
  const changes = await service.isolationChanges(config, record);
  assert.deepEqual(changes.map(change => [change.path, change.change, change.kind, change.conflict]), [
    ["datos/tabla.csv", "deleted", "text", false],
    ["informe.md", "modified", "text", false],
    ["logo.png", "modified", "binary", false],
    ["nuevo.txt", "added", "text", false],
  ]);
  const logo = changes.find(change => change.path === "logo.png");
  assert.deepEqual([logo?.size, logo?.baseSize, logo?.type], [PNG.length + 2, PNG.length, "image"]);
  const diff = await service.isolationFileDiff(config, record, "informe.md");
  assert.deepEqual(diff.hunks[0]?.lines.map(line => `${line.kind}:${line.text}`), ["context:uno", "removed:dos", "added:DOS", "context:tres"]);
  const binary = await service.isolationFileDiff(config, record, "logo.png");
  assert.deepEqual([binary.kind, binary.hunks.length, binary.before.size, binary.after.size], ["binary", 0, PNG.length, PNG.length + 2]);
  assert.equal(await codeOf(service.isolationFileDiff(config, record, "otro.md")), "task_isolation_path_unknown");
});

test("accepting applies files atomically, refuses conflicts as a whole, and overwrite is explicit", async () => {
  const { project, config, appId, workspaceId } = await fixture({ "informe.md": "v1\n", "datos/tabla.csv": "a,b\n" });
  const record = await service.createIsolation(config, { applicationId: appId, workspaceId, projectRoot: project, origin: { kind: "session", sessionId: "ses_a" } });
  writeFileSync(join(record.copyPath, "informe.md"), "v2\n");
  mkdirSync(join(record.copyPath, "salidas"), { recursive: true });
  writeFileSync(join(record.copyPath, "salidas", "nuevo.txt"), "nuevo\n");
  writeFileSync(join(record.copyPath, "datos", "tabla.csv"), "a,b\n1,2\n");
  // The person edits the same file in the project meanwhile.
  writeFileSync(join(project, "datos", "tabla.csv"), "a,b\nmanual\n");
  const conflicted = (await service.isolationChanges(config, record)).find(change => change.path === "datos/tabla.csv");
  assert.equal(conflicted?.conflict, true);
  // A request that includes a conflicting file writes nothing at all.
  assert.equal(await codeOf(service.acceptIsolationFiles(config, appId, record.id, ["informe.md", "datos/tabla.csv"])), "task_isolation_conflict");
  assert.equal(read(join(project, "informe.md")), "v1\n");
  const accepted = await service.acceptIsolationFiles(config, appId, record.id, ["informe.md", "salidas/nuevo.txt"]);
  assert.deepEqual(accepted.applied, ["informe.md", "salidas/nuevo.txt"]);
  assert.equal(read(join(project, "informe.md")), "v2\n");
  assert.equal(read(join(project, "salidas", "nuevo.txt")), "nuevo\n");
  assert.deepEqual(accepted.changes.map(change => change.path), ["datos/tabla.csv"]);
  // Overwriting the conflict is a separate, explicit choice.
  await service.acceptIsolationFiles(config, appId, record.id, ["datos/tabla.csv"], { overwrite: true });
  assert.equal(read(join(project, "datos", "tabla.csv")), "a,b\n1,2\n");
  // No temporary files are left next to the targets.
  assert.deepEqual(execFileSync("find", [project, "-name", ".openwork-isolation-*"], { encoding: "utf8" }), "");
  // A conversation's copy stays open until the person finishes it.
  assert.equal((await service.readIsolation(config, appId, record.id)).status, "active");
  const closed = await service.closeIsolation(config, appId, record.id);
  assert.equal(closed.status, "closed");
  assert.equal(existsSync(record.copyPath), false);
  assert.equal(await codeOf(service.acceptIsolationFiles(config, appId, record.id, ["informe.md"])), "task_isolation_closed");
});

test("deleting through review removes the project file only when it still matches the base", async () => {
  const { project, config, appId, workspaceId } = await fixture({ "viejo.txt": "borrar\n", "otro.txt": "borrar\n" });
  const record = await service.createIsolation(config, { applicationId: appId, workspaceId, projectRoot: project, origin: { kind: "session", sessionId: "ses_a" } });
  rmSync(join(record.copyPath, "viejo.txt"));
  rmSync(join(record.copyPath, "otro.txt"));
  writeFileSync(join(project, "otro.txt"), "editado a mano\n");
  await service.acceptIsolationFiles(config, appId, record.id, ["viejo.txt"]);
  assert.equal(existsSync(join(project, "viejo.txt")), false);
  assert.equal(await codeOf(service.acceptIsolationFiles(config, appId, record.id, ["otro.txt"])), "task_isolation_conflict");
  assert.equal(read(join(project, "otro.txt")), "editado a mano\n");
});

test("discarding the last change of a finished task run closes the review and removes the copy", async () => {
  const { project, config, appId, workspaceId } = await fixture({ "a.txt": "a\n", "b.txt": "b\n" });
  const record = await service.createIsolation(config, { applicationId: appId, workspaceId, projectRoot: project, origin: { kind: "task_run", taskId: "task_x", runAt: 1 } });
  writeFileSync(join(record.copyPath, "a.txt"), "A\n");
  writeFileSync(join(record.copyPath, "b.txt"), "B\n");
  let busy = true;
  const hooks = { isBusy: async () => busy };
  assert.equal(await codeOf(service.discardIsolationFiles(config, appId, record.id, ["a.txt"], hooks)), "task_isolation_busy");
  busy = false;
  const first = await service.discardIsolationFiles(config, appId, record.id, ["a.txt"], hooks);
  assert.equal(first.isolation.status, "active");
  assert.deepEqual(first.changes.map(change => change.path), ["b.txt"]);
  const last = await service.discardIsolationFiles(config, appId, record.id, ["b.txt"], hooks);
  assert.equal(last.isolation.status, "closed");
  assert.equal(existsSync(record.copyPath), false);
  assert.equal(read(join(project, "a.txt")), "a\n");
  assert.equal(read(join(project, "b.txt")), "b\n");
});

test("paths that leave the project, excluded paths and links are refused", async () => {
  const { project, config, appId, workspaceId } = await fixture({ "a.txt": "a\n" });
  const outside = join(dir, `outside-${counter}`);
  mkdirSync(outside, { recursive: true });
  const record = await service.createIsolation(config, { applicationId: appId, workspaceId, projectRoot: project, origin: { kind: "session", sessionId: "ses_a" } });
  for (const path of ["../a.txt", "/etc/passwd", "docs/../../a.txt", "docs\\a.txt", ".git/config"]) {
    assert.equal(await codeOf(service.acceptIsolationFiles(config, appId, record.id, [path])), "task_isolation_invalid_path", path);
    assert.equal(await codeOf(service.isolationFileDiff(config, record, path)), "task_isolation_invalid_path", path);
  }
  // A link the agent leaves in the copy is never reviewed nor followed.
  writeFileSync(join(outside, "fuera.txt"), "fuera\n");
  symlinkSync(outside, join(record.copyPath, "atajo"));
  symlinkSync(join(outside, "fuera.txt"), join(record.copyPath, "enlace.txt"));
  assert.deepEqual(await service.isolationChanges(config, record), []);
  // A project folder that became a link is never written through, even when overwriting.
  mkdirSync(join(record.copyPath, "docs"));
  writeFileSync(join(record.copyPath, "docs", "nota.txt"), "nota\n");
  symlinkSync(outside, join(project, "docs"));
  const change = (await service.isolationChanges(config, record)).find(entry => entry.path === "docs/nota.txt");
  assert.equal(change?.conflict, true);
  assert.equal(await codeOf(service.acceptIsolationFiles(config, appId, record.id, ["docs/nota.txt"], { overwrite: true })), "task_isolation_unsafe_path");
  assert.equal(existsSync(join(outside, "nota.txt")), false);
  // Isolation ids from URLs never name a folder outside the application's isolations.
  assert.equal(await codeOf(service.readIsolation(config, appId, "../../profiles")), "task_isolation_not_found");
});

test("a clean git repository gets a detached worktree that is removed after review", async () => {
  const { project, config, appId, workspaceId } = await fixture({ "informe.md": "v1\n" });
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Prueba", "-c", "user.email=prueba@example.invalid", "-c", "commit.gpgsign=false", "-C", project, ...args], { encoding: "utf8" });
  git("init", "-q");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  const record = await service.createIsolation(config, { applicationId: appId, workspaceId, projectRoot: project, origin: { kind: "task_run", taskId: "task_x", runAt: 1 } });
  assert.equal(record.mode, "git");
  assert.match(record.gitHead ?? "", /^[a-f0-9]{40}$/);
  assert.ok(git("worktree", "list", "--porcelain").includes(record.copyPath));
  writeFileSync(join(record.copyPath, "informe.md"), "v2\n");
  assert.deepEqual((await service.isolationChanges(config, record)).map(change => change.path), ["informe.md"]);
  const result = await service.acceptIsolationFiles(config, appId, record.id, ["informe.md"]);
  assert.equal(read(join(project, "informe.md")), "v2\n");
  assert.equal(result.isolation.status, "closed");
  assert.equal(git("worktree", "list", "--porcelain").includes(record.copyPath), false);
  // Pending changes in the project make the worktree an unfaithful base: snapshot instead.
  const dirty = await service.createIsolation(config, { applicationId: appId, workspaceId, projectRoot: project, origin: { kind: "session", sessionId: "ses_b" } });
  assert.equal(dirty.mode, "snapshot");
});

test("scheduled runs work in the isolated copy and expose pending review", async () => {
  process.env.DEN_FEATURE_SCHEDULED_TASKS = "true";
  const { project, config, appId } = await fixture({ "informe.md": "v1\n" });
  const { createTask, listTasks, listRuns } = await import("../src/specialists/tasks.js");
  const { createSpecialistScheduler } = await import("../src/specialists/scheduler.js");
  const locations = new Map<string, string>();
  const calls: string[] = [];
  let completed = false;
  const engine = async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname.replace(/^\/workspace\/[^/]+\/opencode2\/api/, "");
    calls.push(`${request.method} ${path}`);
    const body: unknown = request.method === "POST" ? await request.json() : null;
    if (request.method === "POST" && path === "/session") { locations.set("ses_run", project); return Response.json({ data: { id: "ses_run" } }); }
    const move = /^\/session\/([^/]+)\/move$/.exec(path);
    if (request.method === "POST" && move?.[1]) {
      locations.set(move[1], z.object({ directory: z.string() }).parse(body).directory);
      return Response.json({ data: true });
    }
    if (request.method === "POST") return Response.json({});
    const session = /^\/session\/([^/]+)$/.exec(path);
    if (session?.[1]) return Response.json({ data: { id: session[1], location: { directory: locations.get(session[1]) } } });
    return Response.json({ data: completed ? [{ type: "assistant", time: { completed: 1 } }] : [] });
  };
  const scheduler = await createSpecialistScheduler(config, engine);
  try {
    const task = await createTask(config, appId, { name: "Resumen", prompt: "Actualiza el informe.", schedule: { kind: "interval", everyMinutes: 60 } }, { enabled: false });
    assert.deepEqual(await scheduler.trigger(appId, task.id), { ok: true });
    const running = (await listTasks(config, appId)).find(entry => entry.id === task.id)?.running;
    const isolationId = running?.isolationId ?? "";
    const record = await service.readIsolation(config, appId, isolationId);
    // The session moved into the copy before the prompt was sent.
    assert.equal(locations.get("ses_run"), record.copyPath);
    assert.ok(calls.indexOf("POST /session/ses_run/move") < calls.indexOf("POST /session/ses_run/prompt"));
    assert.equal((await listRuns(config, appId, task.id))[0]?.isolationId, isolationId);
    // The agent writes in the copy; the project is untouched until review.
    writeFileSync(join(record.copyPath, "informe.md"), "v2\n");
    assert.equal(read(join(project, "informe.md")), "v1\n");
    assert.equal(await codeOf(service.acceptIsolationFiles(config, appId, isolationId, ["informe.md"], {}, { isBusy: async () => true })), "task_isolation_busy");
    completed = true;
    await scheduler.tick();
    assert.equal((await listTasks(config, appId)).find(entry => entry.id === task.id)?.running, null);
    assert.equal((await service.readIsolation(config, appId, isolationId)).status, "active");
  } finally {
    await scheduler.stop();
    delete process.env.DEN_FEATURE_SCHEDULED_TASKS;
  }
});

test("review routes are owner-only, validated, and report pending review on task runs", async () => {
  const { project, config, appId, workspaceId } = await fixture({ "informe.md": "v1\n" });
  const { startServer } = await import("../src/server.js");
  config.approval = { mode: "auto", timeoutMs: 1000 };
  const server = await startServer(config);
  try {
    const record = await service.createIsolation(config, { applicationId: appId, workspaceId, projectRoot: project, origin: { kind: "task_run", taskId: "task_x", runAt: 1 } });
    writeFileSync(join(record.copyPath, "informe.md"), "v2\n");
    const call = async (method: string, path: string, headers: Record<string, string>, body?: unknown) => {
      const response = await fetch(`http://127.0.0.1:${server.port}${path}`, { method, headers: { ...headers, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await response.text();
      return { status: response.status, json: text ? z.unknown().parse(JSON.parse(text)) : null };
    };
    const host = { "x-openwork-host-token": HOST };
    const client = { authorization: `Bearer ${CLIENT}` };
    const base = `/specialist-applications/${appId}/isolations`;
    for (const [method, path, body] of [["GET", base, undefined], ["GET", `${base}/${record.id}`, undefined], ["POST", `${base}/${record.id}/accept`, { paths: ["informe.md"] }], ["DELETE", `${base}/${record.id}`, undefined]] as const) {
      const response = await call(method, path, client, body);
      assert.ok(response.status === 401 || response.status === 403, `${method} ${path} → ${response.status}`);
    }
    const detail = z.object({ changes: z.array(z.object({ path: z.string() })) }).parse((await call("GET", `${base}/${record.id}`, host)).json);
    assert.deepEqual(detail.changes.map(change => change.path), ["informe.md"]);
    assert.equal((await call("POST", `${base}/${record.id}/accept`, host, { paths: [] })).status, 422);
    assert.equal((await call("POST", `${base}/${record.id}/accept`, host, { paths: ["informe.md"], extra: true })).status, 422);
    assert.equal((await call("GET", `${base}/${record.id}/diff?path=${encodeURIComponent("../server.json")}`, host)).status, 422);
    assert.equal((await call("GET", `${base}/iso_..%2F..%2Fprofiles`, host)).status, 404);
    const { appendRun, createTask } = await import("../src/specialists/tasks.js");
    const task = await createTask(config, appId, { name: "Resumen", prompt: "Actualiza.", schedule: { kind: "interval", everyMinutes: 60 } }, { enabled: false });
    await appendRun(config, appId, task.id, { at: 1, mode: "manual", missed: 0, workspaceId, sessionId: "ses_run", status: "ok", detail: null, isolationId: record.id });
    const review = async () => {
      process.env.DEN_FEATURE_SCHEDULED_TASKS = "true";
      try { return z.object({ runs: z.array(z.object({ review: z.string().nullable() })) }).parse((await call("GET", `/specialist-applications/${appId}/tasks/${task.id}/runs`, client)).json).runs[0]?.review; }
      finally { delete process.env.DEN_FEATURE_SCHEDULED_TASKS; }
    };
    assert.equal(await review(), "pending");
    const accepted = await call("POST", `${base}/${record.id}/accept`, host, { paths: ["informe.md"] });
    assert.equal(accepted.status, 200);
    assert.equal(read(join(project, "informe.md")), "v2\n");
    // Nothing left: the task run's review closed itself.
    assert.equal(await review(), "reviewed");
    // The conversation route refuses ids that are not sessions before touching the engine.
    assert.equal((await call("POST", `/workspace/${workspaceId}/task-isolation/sessions/not-a-session`, host, {})).status, 422);
    // The flag gates every route.
    process.env.DEN_FEATURE_TASK_ISOLATION_REVIEW = "false";
    assert.equal((await call("GET", base, host)).status, 404);
  } finally {
    process.env.DEN_FEATURE_TASK_ISOLATION_REVIEW = "true";
    await server.stop();
  }
});
