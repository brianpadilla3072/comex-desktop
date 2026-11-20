import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { applyWebApprovalDefault, resolveServerConfig, WEB_APPROVAL_RESPONDER_WINDOW_MS, type CliArgs } from "../src/config.js";
import type { ServerConfig } from "../src/types.js";

const CLIENT_TOKEN = "web-approvals-test-client";
const HOST_TOKEN = "web-approvals-test-host";
const dir = mkdtempSync(join(tmpdir(), "openwork-web-approvals-"));
const workspacePath = join(dir, "workspace");
const overrides: Record<string, string | undefined> = {
  HOME: dir, XDG_CONFIG_HOME: join(dir, "config"), XDG_DATA_HOME: join(dir, "data"),
  XDG_CACHE_HOME: join(dir, "cache"), XDG_STATE_HOME: join(dir, "state"),
  OPENWORK_DATA_DIR: join(dir, "openwork"), OPENWORK_RUNTIME_DB: join(dir, "runtime.sqlite"),
  OPENCODE_DB: join(dir, "v1.db"), OPENWORK_ENV_STORE: join(dir, "env.json"), OPENWORK_ENGINE_AUTO_UPGRADE: "0",
  OPENWORK_MANAGE_OPENCODE: undefined, OPENWORK_WEB_ROOT: undefined,
  OPENWORK_APPROVAL_MODE: undefined, OPENWORK_APPROVAL_TIMEOUT_MS: undefined, DEN_FEATURE_WEB_APPROVALS: undefined,
};
const previous = new Map(Object.keys(overrides).map((key) => [key, process.env[key]]));
let config: ServerConfig;
let server: { port: number; stop: () => void | Promise<void> };

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function webArgs(extra: Partial<CliArgs> = {}): CliArgs {
  return { web: true, configPath: join(dir, "server.json"), workspaces: [], ...extra };
}

before(async () => {
  for (const [key, value] of Object.entries(overrides)) setEnv(key, value);
  mkdirSync(workspacePath, { recursive: true });
  config = await resolveServerConfig(webArgs({ workspaces: [workspacePath], port: 0, token: CLIENT_TOKEN,
    hostToken: HOST_TOKEN, logRequests: false }));
  const { startServer } = await import("../src/server.js");
  server = await startServer(config);
});

after(async () => {
  await server?.stop();
  for (const [key, value] of previous) setEnv(key, value);
  rmSync(dir, { recursive: true, force: true });
});

async function call(method: string, path: string, headers: Record<string, string>, body?: unknown) {
  const response = await fetch(`http://127.0.0.1:${server.port}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

const collaborator = { Authorization: `Bearer ${CLIENT_TOKEN}` };
let ownerToken = "";
const owner = () => ({ Authorization: `Bearer ${ownerToken}` });

function writeSkill(name: string) {
  return call("POST", `/workspace/${config.workspaces[0]?.id}/skills`, collaborator,
    { name, content: `---\nname: ${name}\ndescription: test\n---\nBody\n`, description: "test" });
}

async function waitForPending(): Promise<{ id: string; action: string }> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const listed = await call("GET", "/approvals", owner());
    assert.equal(listed.status, 200);
    const first = listed.json.items[0];
    if (first) return first;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("no pending approval appeared");
}

test("web keeps manual approvals with a responder window when webApprovals is on", async () => {
  assert.equal(config.approval.mode, "manual");
  assert.equal(config.approval.responderWindowMs, WEB_APPROVAL_RESPONDER_WINDOW_MS);
  assert.equal(config.approval.timeoutMs, 120_000);

  const args = webArgs();
  applyWebApprovalDefault(args, {});
  assert.equal(args.approvalMode, undefined, "nothing is forced while the web app answers approvals");

  const standalone = await resolveServerConfig({ configPath: join(dir, "server.json"), workspaces: [] });
  assert.equal(standalone.approval.mode, "manual");
  assert.equal(standalone.approval.responderWindowMs, undefined, "only web fails fast without a responder");
  assert.equal(standalone.approval.timeoutMs, 30_000);
});

test("--approval auto and OPENWORK_APPROVAL_MODE=auto still approve everything in web mode", async () => {
  const flag = await resolveServerConfig(webArgs({ approvalMode: "auto" }));
  assert.equal(flag.approval.mode, "auto");
  assert.equal(flag.approval.responderWindowMs, undefined);
  setEnv("OPENWORK_APPROVAL_MODE", "auto");
  try {
    const env = await resolveServerConfig(webArgs());
    assert.equal(env.approval.mode, "auto");
  } finally {
    setEnv("OPENWORK_APPROVAL_MODE", undefined);
  }
});

test("with webApprovals off, web falls back to auto unless manual is asked for", () => {
  const off = { DEN_FEATURE_WEB_APPROVALS: "false" };
  const plain = webArgs();
  applyWebApprovalDefault(plain, off);
  assert.equal(plain.approvalMode, "auto");
  const manualEnv = webArgs();
  applyWebApprovalDefault(manualEnv, { ...off, OPENWORK_APPROVAL_MODE: "manual" });
  assert.equal(manualEnv.approvalMode, "manual");
  const explicit = webArgs({ approvalMode: "manual" });
  applyWebApprovalDefault(explicit, off);
  assert.equal(explicit.approvalMode, "manual");
  const notWeb: CliArgs = { workspaces: [] };
  applyWebApprovalDefault(notWeb, off);
  assert.equal(notWeb.approvalMode, undefined);
});

test("a gated write with nobody able to answer fails at once with a clear reason", async () => {
  const started = Date.now();
  const result = await writeSkill("no-responder");
  assert.equal(result.status, 403);
  assert.equal(result.json.code, "approval_unavailable");
  assert.match(result.json.message, /owner access/);
  assert.ok(Date.now() - started < 5_000, "does not wait for the approval timeout");
});

test("collaborator access cannot list or answer approvals", async () => {
  assert.equal((await call("GET", "/approvals", collaborator)).status, 401);
  assert.equal((await call("POST", "/approvals/any", collaborator, { reply: "allow" })).status, 401);
});

test("a paired device (owner bearer) sees and approves a pending write", async () => {
  const issued = await call("POST", "/tokens", { "X-OpenWork-Host-Token": HOST_TOKEN }, { scope: "owner", label: "device:phone" });
  assert.equal(issued.status, 201);
  ownerToken = issued.json.token;
  assert.equal((await call("GET", "/approvals", owner())).status, 200);

  const write = writeSkill("approved-skill");
  const pending = await waitForPending();
  assert.equal(pending.action, "skills.upsert");
  const denied = await call("POST", `/approvals/${pending.id}`, collaborator, { reply: "allow" });
  assert.equal(denied.status, 401, "a collaborator cannot answer even with the id");
  const answer = await call("POST", `/approvals/${pending.id}`, owner(), { reply: "allow" });
  assert.deepEqual(answer, { status: 200, json: { ok: true, allowed: true } });
  const result = await write;
  assert.equal(result.status, 200);
  assert.equal(result.json.name, "approved-skill");
  assert.equal((await call("POST", `/approvals/${pending.id}`, owner(), { reply: "allow" })).status, 404);
});

test("the owner denying a pending write rejects it", async () => {
  const write = writeSkill("denied-skill");
  const pending = await waitForPending();
  const answer = await call("POST", `/approvals/${pending.id}`, owner(), { reply: "deny" });
  assert.deepEqual(answer, { status: 200, json: { ok: true, allowed: false } });
  const result = await write;
  assert.equal(result.status, 403);
  assert.equal(result.json.code, "write_denied");
});

test("the host token answers approvals too", async () => {
  const host = { "X-OpenWork-Host-Token": HOST_TOKEN };
  assert.equal((await call("GET", "/approvals", host)).status, 200);
  const write = writeSkill("host-skill");
  const pending = await waitForPending();
  assert.equal((await call("POST", `/approvals/${pending.id}`, host, { reply: "allow" })).status, 200);
  assert.equal((await write).status, 200);
});
