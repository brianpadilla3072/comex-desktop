import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { REDACTED, canSeeSecrets, redactSecrets } from "../src/secret-redaction.js";

// Findings of the local hive QA run (w4-1 .. w4-4): what a read-only token could see or do.
const dir = mkdtempSync(join(tmpdir(), "hive-security-"));
const HOST = "hive-security-host";
const CLIENT = "hive-security-client";
const overrides: Record<string, string | undefined> = {
  OPENWORK_DATA_DIR: join(dir, "openwork"), OPENWORK_RUNTIME_DB: join(dir, "runtime.sqlite"),
  OPENCODE_DB: join(dir, "v1.db"), OPENWORK_ENGINE_AUTO_UPGRADE: "0",
};
const previous = new Map(Object.keys(overrides).map(key => [key, process.env[key]]));
let server: { port: number; stop: () => void | Promise<void> };
const workspaceDir = join(dir, "workspace");
const outside = join(dir, "outside");

before(async () => {
  for (const [key, value] of Object.entries(overrides)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, "secret.md"), "outside the workspace");
  const { resolveServerConfig } = await import("../src/config.js");
  const { startServer } = await import("../src/server.js");
  const config = await resolveServerConfig({ configPath: join(dir, "server.json"), workspaces: [workspaceDir], port: 0, token: CLIENT, hostToken: HOST, logRequests: false });
  for (const workspace of config.workspaces) { workspace.opencodeUsername = "opencode"; workspace.opencodePassword = "engine-password-fixture"; }
  config.approval = { mode: "auto", timeoutMs: 1000 };
  server = await startServer(config);
});

after(async () => {
  await server?.stop();
  for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  rmSync(dir, { recursive: true, force: true });
});

async function call(method: string, path: string, headers: Record<string, string>, body?: string) {
  const response = await fetch(`http://127.0.0.1:${server.port}${path}`, { method, headers: { ...headers, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body });
  const text = await response.text();
  return { status: response.status, text };
}
const host = { "x-openwork-host-token": HOST };
async function issue(scope: "owner" | "viewer") {
  const issued = await call("POST", "/tokens", host, JSON.stringify({ scope }));
  return z.object({ token: z.string() }).parse(JSON.parse(issued.text)).token;
}
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
async function workspaceId(owner: string) {
  const listed = z.object({ items: z.array(z.object({ id: z.string() })) }).parse(JSON.parse((await call("GET", "/workspaces", bearer(owner))).text));
  return listed.items[0]!.id;
}

test("w4-1: engine credentials go only to owners and the host, never to read-only tokens", async () => {
  const viewer = await issue("viewer");
  const owner = await issue("owner");
  for (const headers of [bearer(viewer), bearer(CLIENT)]) {
    const listed = await call("GET", "/workspaces", headers);
    assert.equal(listed.status, 200);
    assert.equal(listed.text.includes("engine-password-fixture"), false);
    const status = await call("GET", "/status", headers);
    assert.equal(status.text.includes("engine-password-fixture"), false);
  }
  assert.equal((await call("GET", "/workspaces", bearer(owner))).text.includes("engine-password-fixture"), true);
});

test("w4-2: read-only tokens see configuration with secrets redacted", async () => {
  writeFileSync(join(workspaceDir, "opencode.jsonc"), JSON.stringify({ provider: { demo: { options: { apiKey: "provider-key-fixture", baseURL: "http://127.0.0.1:1" } } }, mcp: { tools: { type: "remote", url: "http://127.0.0.1:2", headers: { "X-MCP-Token": "mcp-token-fixture" } } } }));
  const viewer = await issue("viewer");
  const owner = await issue("owner");
  const id = await workspaceId(owner);
  for (const route of [`/workspace/${id}/config`, `/workspace/${id}/runtime-config`]) {
    const seen = await call("GET", route, bearer(viewer));
    assert.equal(seen.status, 200, route);
    assert.equal(seen.text.includes("provider-key-fixture"), false, route);
    assert.equal(seen.text.includes("mcp-token-fixture"), false, route);
  }
  assert.equal((await call("GET", `/workspace/${id}/config`, bearer(owner))).text.includes("provider-key-fixture"), true);
});

test("redaction keeps structure and non-secret values", () => {
  const value = { provider: { a: { options: { apiKey: "k", baseURL: "u" } } }, mcp: { m: { headers: { "X-Custom": "t" }, environment: { TOKEN: "v" }, url: "x" } }, list: [{ password: "p" }] };
  assert.deepEqual(redactSecrets(value), { provider: { a: { options: { apiKey: REDACTED, baseURL: "u" } } }, mcp: { m: { headers: { "X-Custom": REDACTED }, environment: { TOKEN: REDACTED }, url: "x" } }, list: [{ password: REDACTED }] });
  assert.deepEqual([canSeeSecrets({ type: "host" }), canSeeSecrets({ type: "remote", scope: "owner" }), canSeeSecrets({ type: "remote", scope: "viewer" }), canSeeSecrets(undefined)], [true, true, false, false]);
});

test("w4-3: a JSON body that is not an object is a 400, never a 500", async () => {
  for (const body of ["null", "[]", "42", "\"text\""]) {
    const response = await call("POST", "/workspaces/local", host, body);
    assert.equal(response.status, 400, body);
    assert.match(response.text, /invalid_json/, body);
  }
});

test("w4-4: workspace file routes never follow a symlink out of the workspace", async () => {
  const owner = await issue("owner");
  const id = await workspaceId(owner);
  symlinkSync(outside, join(workspaceDir, "escape"));
  symlinkSync(join(outside, "secret.md"), join(workspaceDir, "linked.md"));
  for (const path of ["escape/secret.md", "linked.md"]) {
    const read = await call("GET", `/workspace/${id}/files/content?path=${encodeURIComponent(path)}`, bearer(owner));
    assert.notEqual(read.status, 200, path);
    assert.equal(read.text.includes("outside the workspace"), false, path);
  }
  const write = await call("POST", `/workspace/${id}/files/content`, bearer(owner), JSON.stringify({ path: "escape/planted.md", content: "x" }));
  assert.notEqual(write.status, 200);
  assert.equal(existsSync(join(outside, "planted.md")), false);
  assert.equal(readFileSync(join(outside, "secret.md"), "utf8"), "outside the workspace");
});

test("w3-1: turning auto compaction off is saved for the workspace and survives a reload", async () => {
  const owner = await issue("owner");
  const id = await workspaceId(owner);
  const patch = await call("PATCH", `/workspace/${id}/config`, bearer(owner), JSON.stringify({ opencode: { compaction: { auto: false } } }));
  assert.equal(patch.status, 200, patch.text);
  const read = z.object({ opencode: z.object({ compaction: z.object({ auto: z.boolean() }) }) }).parse(JSON.parse((await call("GET", `/workspace/${id}/config`, bearer(owner))).text));
  assert.equal(read.opencode.compaction.auto, false);
  assert.match(readFileSync(join(workspaceDir, "opencode.jsonc"), "utf8"), /"compaction"/);
  const invalid = await call("PATCH", `/workspace/${id}/config`, bearer(owner), JSON.stringify({ opencode: { compaction: "off" } }));
  assert.equal(invalid.status, 400);
});
