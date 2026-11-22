import { afterEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startEmbeddedServer, type EmbeddedServerHandle } from "../src/embedded.js";

// Boot of the embedded server (what the desktop runs) with a stand-in engine
// v1 binary, under feature lazyV1Engine. The fake engine logs each spawn and
// answers every request, so the tests can count when v1 really starts.
// OpenCode v2 points at a missing binary: it never starts, and no network is
// used, but the saved engine choice still says whether v2 serves chats.

const FAKE_V1 = `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const http = require("node:http");
if (process.argv.includes("--version")) { process.stdout.write("0.0.0-fake\\n"); process.exit(0); }
const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
const expected = "Basic " + Buffer.from(process.env.OPENCODE_SERVER_USERNAME + ":" + process.env.OPENCODE_SERVER_PASSWORD).toString("base64");
appendFileSync(process.env.FAKE_V1_LOG, JSON.stringify({ pid: process.pid, port }) + "\\n");
const server = http.createServer((request, response) => {
  if (request.headers.authorization !== expected) { response.writeHead(401).end(); return; }
  const path = new URL(request.url, "http://x").pathname;
  if (path.endsWith("/event")) {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(": ok\\n\\n");
    return;
  }
  response.writeHead(200, { "content-type": "application/json" });
  if (path === "/session/status") response.end("{}");
  else if (["/session", "/permission", "/question"].includes(path)) response.end("[]");
  else response.end(JSON.stringify({ fake: true, path }));
});
server.listen(port, "127.0.0.1", () => process.stdout.write("opencode server listening on http://127.0.0.1:" + port + "\\n"));
`;

type World = { dir: string; workspace: string; bin: string; log: string };

const handles: EmbeddedServerHandle[] = [];
const dirs: string[] = [];
const envKeys = [
  "OPENWORK_RUNTIME_DB", "OPENWORK_DATA_DIR", "OPENCODE_DB", "OPENWORK_OPENCODE2_BIN", "OPENWORK_ENGINE_V2_PREVIEW",
  "OPENWORK_ENGINE_AUTO_UPGRADE", "DEN_FEATURE_LAZY_V1_ENGINE", "FAKE_V1_LOG", "OPENWORK_OPENCODE_BIN",
  "OPENWORK_MANAGED_OPENCODE_CWD", "OPENWORK_V1_ENGINE_IDLE_MS", "OPENWORK_OPENCODE_BASE_URL",
] as const;
const previousEnv = new Map(envKeys.map((key) => [key, process.env[key]]));

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.stop().catch(() => undefined)));
  for (const [key, value] of previousEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function world(): Promise<World> {
  const dir = await mkdtemp(join(tmpdir(), "openwork-lazy-v1-"));
  dirs.push(dir);
  const workspace = join(dir, "workspace");
  await mkdir(workspace, { recursive: true });
  const bin = join(dir, "opencode.cjs");
  await writeFile(bin, FAKE_V1, "utf8");
  await chmod(bin, 0o755);
  const log = join(dir, "v1-spawns.jsonl");
  // A v2 binary that exits at once: v2 never runs, without any download.
  const v2bin = join(dir, "opencode2");
  await writeFile(v2bin, "#!/bin/sh\nexit 1\n", "utf8");
  await chmod(v2bin, 0o755);
  Object.assign(process.env, {
    OPENWORK_RUNTIME_DB: join(dir, "runtime.sqlite"),
    OPENWORK_DATA_DIR: join(dir, "openwork"),
    OPENCODE_DB: join(dir, "v1.db"),
    OPENWORK_OPENCODE2_BIN: v2bin,
    OPENWORK_ENGINE_AUTO_UPGRADE: "0",
    FAKE_V1_LOG: log,
  });
  delete process.env.OPENWORK_OPENCODE_BIN;
  delete process.env.OPENWORK_MANAGED_OPENCODE_CWD;
  delete process.env.OPENWORK_OPENCODE_BASE_URL;
  return { dir, workspace, bin, log };
}

async function spawns(w: World): Promise<number> {
  const text = await readFile(w.log, "utf8").catch(() => "");
  return text.split("\n").filter(Boolean).length;
}

async function boot(w: World, chatEngine: "v1" | "v2"): Promise<EmbeddedServerHandle> {
  // A saved engine choice with a separate v2 history: switching back to v1
  // stays allowed (an adopted shared history would refuse it).
  delete process.env.OPENWORK_ENGINE_V2_PREVIEW;
  await writeFile(join(w.dir, "engine-v2-preview.json"), JSON.stringify({
    enabled: chatEngine === "v2",
    chatRouting: chatEngine === "v2",
    engineOrigin: "manual",
    historyDatabase: join(w.dir, "v2-history.db"),
  }));
  const handle = await startEmbeddedServer({
    host: "127.0.0.1",
    port: 0,
    approvalMode: "auto",
    configPath: join(w.dir, "server.json"),
    workspaces: [w.workspace],
    token: "lazy-v1-client",
    hostToken: "lazy-v1-host",
    manageOpencode: true,
    opencodeBin: w.bin,
    opencodeCwd: join(w.dir, "engine-cwd"),
    logRequests: false,
  });
  handles.push(handle);
  return handle;
}

async function request(handle: EmbeddedServerHandle, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${handle.url}${path}`, {
    ...init,
    headers: { Authorization: "Bearer lazy-v1-client", "content-type": "application/json", ...init.headers },
  });
}

async function v1EngineState(handle: EmbeddedServerHandle): Promise<unknown> {
  const status: unknown = await (await request(handle, "/experimental/engine-v2-preview/status")).json();
  return typeof status === "object" && status !== null && "v1Engine" in status ? status.v1Engine : null;
}

async function workspaceId(handle: EmbeddedServerHandle): Promise<string> {
  const id = handle.config.workspaces[0]?.id;
  if (!id) throw new Error("no workspace");
  return id;
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!await check()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test("with v2 serving chats, boot does not start v1 and status says it is stopped on demand", async () => {
  const w = await world();
  const handle = await boot(w, "v2");
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(await spawns(w)).toBe(0);
  expect(handle.config.opencodeBaseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  expect(handle.managedOpencode?.pid).toBeNull();
  expect(handle.managedOpencode?.isAlive()).toBe(true);
  expect(await v1EngineState(handle)).toMatchObject({ onDemand: true, state: "stopped", starts: 0 });
  const activity: unknown = await (await request(handle, "/experimental/engine-v2-preview/activity")).json();
  expect(activity).toMatchObject({ v1: { verdict: "idle", busySessions: 0, waitingRequests: 0 } });
  expect(await spawns(w)).toBe(0);
});

test("a v1 request starts v1 exactly once, even when several arrive together", async () => {
  const w = await world();
  const handle = await boot(w, "v2");
  const id = await workspaceId(handle);
  const responses = await Promise.all(Array.from({ length: 6 }, () =>
    request(handle, `/workspace/${encodeURIComponent(id)}/opencode/config`)));
  for (const response of responses) {
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ fake: true, path: "/config" });
  }
  expect(await spawns(w)).toBe(1);
  expect(await v1EngineState(handle)).toMatchObject({ onDemand: true, state: "running", starts: 1 });
  expect(handle.managedOpencode?.pid).toEqual(expect.any(Number));
});

test("an idle v1 stops, leaves no process behind, and the next request restarts it", async () => {
  const w = await world();
  process.env.OPENWORK_V1_ENGINE_IDLE_MS = "300";
  const handle = await boot(w, "v2");
  const id = await workspaceId(handle);
  expect((await request(handle, `/workspace/${encodeURIComponent(id)}/opencode/config`)).status).toBe(200);
  const firstPid = handle.managedOpencode?.pid;
  expect(firstPid).toEqual(expect.any(Number));
  await waitFor(async () => {
    const state = await v1EngineState(handle);
    return typeof state === "object" && state !== null && "state" in state && state.state === "stopped";
  });
  expect(handle.managedOpencode?.pid).toBeNull();
  if (typeof firstPid === "number") expect(() => process.kill(firstPid, 0)).toThrow();

  expect((await request(handle, `/workspace/${encodeURIComponent(id)}/opencode/config`)).status).toBe(200);
  expect(await spawns(w)).toBe(2);
});

test("switching chats back to v1 starts it right away", async () => {
  const w = await world();
  const handle = await boot(w, "v2");
  expect(await spawns(w)).toBe(0);
  const response = await request(handle, "/experimental/engine-v2-preview", {
    method: "PUT",
    body: JSON.stringify({ chatRouting: false }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ chatRouting: false });
  expect(await spawns(w)).toBe(1);
  expect(await v1EngineState(handle)).toMatchObject({ state: "running" });
});

test("with v1 serving chats, boot starts v1 as before", async () => {
  const w = await world();
  const handle = await boot(w, "v1");
  expect(await spawns(w)).toBe(1);
  expect(handle.managedOpencode?.pid).toEqual(expect.any(Number));
  expect(await v1EngineState(handle)).toMatchObject({ onDemand: true, state: "running" });
});

test("with the feature off, boot starts v1 even while v2 serves chats", async () => {
  const w = await world();
  process.env.DEN_FEATURE_LAZY_V1_ENGINE = "false";
  const handle = await boot(w, "v2");
  expect(await spawns(w)).toBe(1);
  expect(handle.managedOpencode?.pid).toEqual(expect.any(Number));
  expect(await v1EngineState(handle)).toEqual({ onDemand: false });
  const pid = handle.managedOpencode?.pid;
  await handle.stop();
  if (typeof pid === "number") expect(() => process.kill(pid, 0)).toThrow();
});

test("shutting down stops a started on-demand v1", async () => {
  const w = await world();
  const handle = await boot(w, "v2");
  const id = await workspaceId(handle);
  expect((await request(handle, `/workspace/${encodeURIComponent(id)}/opencode/config`)).status).toBe(200);
  const pid = handle.managedOpencode?.pid;
  expect(pid).toEqual(expect.any(Number));
  await handle.stop();
  if (typeof pid === "number") expect(() => process.kill(pid, 0)).toThrow();
});
