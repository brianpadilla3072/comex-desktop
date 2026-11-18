import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest } from "node:http";

const dir = mkdtempSync(join(tmpdir(), "eco-e2e-"));
const TOKEN = "eco-e2e-client";
const overrides: Record<string, string | undefined> = {
  DEN_FEATURE_AGENT_ECOSYSTEM: "true",
  OPENWORK_DATA_DIR: join(dir, "openwork"), OPENWORK_RUNTIME_DB: join(dir, "runtime.sqlite"),
  OPENCODE_DB: join(dir, "v1.db"), OPENWORK_ENGINE_AUTO_UPGRADE: "0",
};
const previous = new Map(Object.keys(overrides).map(k => [k, process.env[k]]));
let server: { port: number; stop: () => void | Promise<void> };

before(async () => {
  for (const [k, v] of Object.entries(overrides)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  const { resolveServerConfig } = await import("../src/config.js");
  const { startServer } = await import("../src/server.js");
  const config = await resolveServerConfig({ configPath: join(dir, "server.json"), workspaces: [], port: 0,
    token: TOKEN, hostToken: "eco-e2e-host", logRequests: false });
  server = await startServer(config);
});

after(async () => {
  await server?.stop();
  for (const [k, v] of previous) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(dir, { recursive: true, force: true });
});

function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = httpRequest({
      host: "127.0.0.1", port: server.port, path, method,
      headers: {
        host: `127.0.0.1:${server.port}`, authorization: `Bearer ${TOKEN}`,
        ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
      },
    }, res => {
      let text = ""; res.setEncoding("utf8");
      res.on("data", (chunk: string) => { text += chunk; });
      res.on("end", () => {
        let json: Record<string, unknown> = {};
        try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* non-json */ }
        resolve({ status: res.statusCode ?? 0, json });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test("agent ecosystem end-to-end over real HTTP: publish, claim, halt, persist", async () => {
  const base = "/workspace/ws_e2e/agent-ecosystem";
  const empty = await call("GET", base);
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.json.needs, []);

  const published = await call("POST", `${base}/needs`, {
    from: "coordinator", projectId: "A", sessionId: "s1", need: "research", contextShort: "ctx",
  });
  assert.equal(published.status, 200);
  const needId = (published.json.need as { id: string }).id;
  assert.ok(needId);

  const claim1 = await call("POST", `${base}/needs/${needId}/claim`, { agentId: "researcher" });
  assert.equal(claim1.status, 200);
  const claim2 = await call("POST", `${base}/needs/${needId}/claim`, { agentId: "reviewer" });
  assert.equal(claim2.status, 409);
  assert.equal(claim2.json.code, "need_already_claimed");

  const halted = await call("POST", `${base}/halt`, { halted: true, by: "usuario" });
  assert.equal(halted.status, 200);
  const claim3 = await call("POST", `${base}/needs`, {
    from: "coordinator", projectId: "A", sessionId: "s1", need: "second", contextShort: "ctx",
  });
  const secondId = (claim3.json.need as { id: string }).id;
  const blocked = await call("POST", `${base}/needs/${secondId}/claim`, { agentId: "researcher" });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.json.code, "ecosystem_halted");

  const state = await call("GET", base);
  assert.equal(state.json.halted, true);
  assert.equal((state.json.needs as unknown[]).length, 2);
});
