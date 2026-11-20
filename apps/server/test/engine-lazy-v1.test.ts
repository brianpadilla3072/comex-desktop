import { afterEach, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import { createLazyEngine, type LazyEngine, type LazyEngineOptions } from "../src/lazy-v1-engine.js";
import type { ManagedOpencodeServer } from "../src/managed-opencode.js";

// The on-demand engine v1 (feature lazyV1Engine) behind its loopback gate.
// Each "engine process" here is an in-process HTTP server that checks the
// fixed credentials, so these tests exercise the real gate sockets.

type FakeEngines = {
  spawned: number;
  closed: number;
  live: Set<Server>;
  spawn: LazyEngineOptions["spawn"];
};

function fakeEngines(options: { delayMs?: number; fail?: boolean } = {}): FakeEngines {
  const engines: FakeEngines = {
    spawned: 0,
    closed: 0,
    live: new Set(),
    spawn: async (credentials) => {
      engines.spawned += 1;
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      if (options.fail) throw new Error("fake engine failed to start");
      const expected = `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`;
      const server = createServer((request, response) => {
        if (request.headers.authorization !== expected) {
          response.writeHead(401).end();
          return;
        }
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ path: request.url, method: request.method, body: Buffer.concat(chunks).toString("utf8") }));
        });
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      engines.live.add(server);
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      let alive = true;
      const handle: ManagedOpencodeServer = {
        url: `http://127.0.0.1:${port}`,
        username: credentials.username,
        password: credentials.password,
        pid: 4242,
        execution: { command: "fake", args: [], cwd: "/", env: [] },
        isAlive: () => alive,
        close: async () => {
          if (!alive) return;
          alive = false;
          engines.closed += 1;
          engines.live.delete(server);
          server.closeAllConnections();
          await new Promise<void>((resolve) => server.close(() => resolve()));
        },
      };
      return handle;
    },
  };
  return engines;
}

const opened: LazyEngine[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((engine) => engine.close()));
});

async function lazy(engines: FakeEngines, overrides: Partial<LazyEngineOptions> = {}): Promise<LazyEngine> {
  const engine = await createLazyEngine({
    credentials: { username: "user", password: "secret" },
    spawn: engines.spawn,
    idleMs: 60_000,
    sweepMs: 60_000,
    execution: { command: "opencode", args: ["serve"], cwd: "/", env: [] },
    ...overrides,
  });
  opened.push(engine);
  return engine;
}

function auth(engine: LazyEngine): Record<string, string> {
  return { Authorization: `Basic ${Buffer.from(`${engine.username}:${engine.password}`).toString("base64")}` };
}

async function waitFor(check: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("nothing starts until the first request, which the started engine answers", async () => {
  const engines = fakeEngines();
  const engine = await lazy(engines);
  expect(engines.spawned).toBe(0);
  expect(engine.dormant()).toBe(true);
  expect(engine.pid).toBeNull();
  expect(engine.isAlive()).toBe(true);

  const response = await fetch(`${engine.url}/session?x=1`, { method: "POST", headers: auth(engine), body: "hello" });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ path: "/session?x=1", method: "POST", body: "hello" });
  expect(engines.spawned).toBe(1);
  expect(engine.state()).toBe("running");
  expect(engine.dormant()).toBe(false);
  expect(engine.pid).toBe(4242);
  expect(engine.directUrl()).not.toBe(engine.url);
});

test("concurrent first requests share exactly one start", async () => {
  const engines = fakeEngines({ delayMs: 100 });
  const engine = await lazy(engines);
  const responses = await Promise.all(Array.from({ length: 12 }, (_, index) =>
    fetch(`${engine.url}/item/${index}`, { headers: auth(engine) }).then((response) => response.json())));
  expect(engines.spawned).toBe(1);
  expect(responses.map((body) => body.path)).toEqual(Array.from({ length: 12 }, (_, index) => `/item/${index}`));
  await Promise.all([engine.ensureStarted(), engine.ensureStarted()]);
  expect(engines.spawned).toBe(1);
});

test("an idle engine stops, and a later request starts it again", async () => {
  const engines = fakeEngines();
  const stopped: number[] = [];
  const engine = await lazy(engines, { idleMs: 80, sweepMs: 20, onStopped: () => { stopped.push(Date.now()); } });
  await (await fetch(`${engine.url}/one`, { headers: auth(engine) })).text();
  await waitFor(() => engine.state() === "stopped");
  expect(engines.closed).toBe(1);
  expect(engines.live.size).toBe(0);
  expect(stopped.length).toBe(1);
  expect(engine.dormant()).toBe(true);
  expect(engine.status().stops).toBe(1);

  const again = await fetch(`${engine.url}/two`, { headers: auth(engine) });
  expect((await again.json()).path).toBe("/two");
  expect(engines.spawned).toBe(2);
  expect(engine.status().starts).toBe(2);
});

test("unfinished work or an unknown answer keeps the engine running", async () => {
  const engines = fakeEngines();
  let answer: "busy" | "unknown" | "idle" = "busy";
  const engine = await lazy(engines, {
    idleMs: 1,
    busy: async () => {
      if (answer === "unknown") throw new Error("probe failed");
      return answer === "busy";
    },
  });
  await engine.ensureStarted();
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(await engine.stopIfIdle()).toBe(false);
  answer = "unknown";
  expect(await engine.stopIfIdle()).toBe(false);
  expect(engine.state()).toBe("running");
  answer = "idle";
  expect(await engine.stopIfIdle()).toBe(true);
  expect(engine.state()).toBe("stopped");
});

test("recent traffic and silent-but-recent connections keep the engine running", async () => {
  const engines = fakeEngines();
  const engine = await lazy(engines, { idleMs: 200 });
  await (await fetch(`${engine.url}/recent`, { headers: auth(engine) })).text();
  expect(await engine.stopIfIdle()).toBe(false);
  expect(engine.state()).toBe("running");
});

test("while v1 serves chats it never idles, and a stopped engine starts again (engine switch)", async () => {
  const engines = fakeEngines();
  let v2ServesChats = true;
  const engine = await lazy(engines, { idleMs: 1, sweepMs: 20, idleStopAllowed: () => v2ServesChats });
  await engine.ensureStarted();
  await waitFor(() => engine.state() === "stopped");
  expect(engines.spawned).toBe(1);

  // Switching chats back to v1: the sweep starts it with no request at all.
  v2ServesChats = false;
  await waitFor(() => engine.state() === "running");
  expect(engines.spawned).toBe(2);
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(engine.state()).toBe("running");
  expect(await engine.stopIfIdle()).toBe(false);
});

test("a failed start drops the waiting connection and is retried by the next one", async () => {
  const engines = fakeEngines({ fail: true });
  const engine = await lazy(engines);
  await expect(fetch(`${engine.url}/x`, { headers: auth(engine) })).rejects.toThrow();
  expect(engine.state()).toBe("stopped");
  expect(engine.status().lastError).toContain("fake engine failed to start");
  await expect(engine.ensureStarted()).rejects.toThrow("fake engine failed to start");
  expect(engines.spawned).toBe(2);
});

test("close stops the process and the gate, and nothing restarts afterwards", async () => {
  const engines = fakeEngines();
  let closed = 0;
  const engine = await lazy(engines, { onClosed: () => { closed += 1; } });
  await engine.ensureStarted();
  await engine.close();
  await engine.close();
  expect(engines.closed).toBe(1);
  expect(engines.live.size).toBe(0);
  expect(closed).toBe(1);
  expect(engine.isAlive()).toBe(false);
  expect(engine.dormant()).toBe(false);
  await expect(fetch(`${engine.url}/after`, { headers: auth(engine) })).rejects.toThrow();
  await expect(engine.ensureStarted()).rejects.toThrow();
  expect(engines.spawned).toBe(1);
});

test("close during a start leaves no engine running", async () => {
  const engines = fakeEngines({ delayMs: 100 });
  const engine = await lazy(engines);
  const starting = engine.ensureStarted().catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 20));
  await engine.close();
  await starting;
  expect(engines.live.size).toBe(0);
});
