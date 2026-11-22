import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { createPairingRegistry, PAIRING_CODE_TTL_MS, PAIRING_MAX_FAILURES } from "../src/device-pairing.js";

// Remote devices (a phone, a laptop over Tailscale) get their own revocable owner token by
// redeeming a one-time code shown on the desktop.
const dir = mkdtempSync(join(tmpdir(), "device-pairing-"));
const HOST = "pairing-host";
const CLIENT = "pairing-client";
const overrides: Record<string, string | undefined> = {
  OPENWORK_DATA_DIR: join(dir, "openwork"), OPENWORK_RUNTIME_DB: join(dir, "runtime.sqlite"),
  OPENCODE_DB: join(dir, "v1.db"), OPENWORK_ENGINE_AUTO_UPGRADE: "0",
  // Never the person's own ~/.config/openwork/env.json: the env routes write user-level variables.
  OPENWORK_ENV_STORE: join(dir, "env.json"),
};
const previous = new Map(Object.keys(overrides).map(key => [key, process.env[key]]));
let server: { port: number; stop: () => void | Promise<void> };

before(async () => {
  for (const [key, value] of Object.entries(overrides)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  mkdirSync(join(dir, "workspace"), { recursive: true });
  const { resolveServerConfig } = await import("../src/config.js");
  const { startServer } = await import("../src/server.js");
  const config = await resolveServerConfig({ configPath: join(dir, "server.json"), workspaces: [join(dir, "workspace")], port: 0, token: CLIENT, hostToken: HOST, logRequests: false });
  config.approval = { mode: "auto", timeoutMs: 1000 };
  server = await startServer(config);
});
after(async () => {
  await server?.stop();
  for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  rmSync(dir, { recursive: true, force: true });
});

async function call(method: string, path: string, headers: Record<string, string> = {}, body?: unknown) {
  const response = await fetch(`http://127.0.0.1:${server.port}${path}`, { method, headers: { ...headers, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, json: text ? z.unknown().parse(JSON.parse(text)) : null };
}
const host = { "x-openwork-host-token": HOST };
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const issued = z.object({ code: z.string(), expiresAt: z.number() });
const redeemed = z.object({ id: z.string(), token: z.string(), scope: z.literal("owner") });

test("a redeemed code gives the device owner access that works on host routes and can be revoked", async () => {
  assert.deepEqual((await call("GET", "/pairing/status")).json, { enabled: true });
  // The collaborator token the web page gets cannot create codes or reach host routes.
  assert.equal((await call("POST", "/pairing/codes", bearer(CLIENT))).status, 401);
  const { code } = issued.parse((await call("POST", "/pairing/codes", host)).json);
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const device = redeemed.parse((await call("POST", "/pairing/redeem", {}, { code: code.toLowerCase().replace("-", " "), deviceName: "Celular" })).json);
  // Host routes now accept the device token (the same check the specialist and env routes use).
  assert.equal((await call("GET", "/tokens", bearer(device.token))).status, 200);
  const devices = z.object({ items: z.array(z.object({ id: z.string(), name: z.string() })) }).parse((await call("GET", "/pairing/devices", bearer(device.token))).json);
  assert.deepEqual(devices.items.map(item => item.name), ["Celular"]);
  // Single use.
  assert.equal((await call("POST", "/pairing/redeem", {}, { code, deviceName: "Otro" })).status, 410);
  // Revoked: the device loses access at once.
  assert.equal((await call("DELETE", `/pairing/devices/${device.id}`, host)).status, 200);
  assert.equal((await call("GET", "/tokens", bearer(device.token))).status, 401);
});

test("wrong guesses burn the code and bad requests never issue a token", async () => {
  const { code } = issued.parse((await call("POST", "/pairing/codes", host)).json);
  assert.equal((await call("POST", "/pairing/redeem", {}, { code: "", deviceName: "x" })).status, 400);
  for (let attempt = 0; attempt < PAIRING_MAX_FAILURES; attempt += 1) {
    assert.equal((await call("POST", "/pairing/redeem", {}, { code: "AAAA-AAAA", deviceName: "Intruso" })).status, 400);
  }
  assert.equal((await call("POST", "/pairing/redeem", {}, { code, deviceName: "Tarde" })).status, 410);
  const tokens = z.object({ items: z.array(z.object({ label: z.string().optional() })) }).parse((await call("GET", "/tokens", host)).json);
  assert.equal(tokens.items.some(token => token.label === "device:Intruso" || token.label === "device:Tarde"), false);
});

test("codes expire and a new code replaces the previous one", () => {
  let now = 1_000;
  const registry = createPairingRegistry({ now: () => now });
  const first = registry.issue();
  const second = registry.issue();
  assert.throws(() => registry.consume(first.code === second.code ? "ZZZZ-ZZZZ" : first.code));
  const third = registry.issue();
  now += PAIRING_CODE_TTL_MS + 1;
  assert.throws(() => registry.consume(third.code), /venció/);
});

test("a paired device manages what the desktop manages, except the desktop's own cloud account", async () => {
  const { code } = issued.parse((await call("POST", "/pairing/codes", host)).json);
  const device = redeemed.parse((await call("POST", "/pairing/redeem", {}, { code, deviceName: "Laptop" })).json);
  assert.equal((await call("GET", "/env?includeValues=false", bearer(device.token))).status, 200);
  assert.equal((await call("PUT", "/env", bearer(device.token), { key: "PAIRING_TEST_KEY", value: "1" })).status < 300, true);
  assert.equal(existsSync(join(dir, "env.json")), true);
  assert.equal((await call("DELETE", "/den-session", bearer(device.token))).status, 401);
  // An owner token that is not a paired device keeps the old rule, and so does the page's token.
  const plain = redeemed.parse((await call("POST", "/tokens", host, { scope: "owner" })).json);
  assert.equal((await call("GET", "/env?includeValues=false", bearer(plain.token))).status, 401);
  assert.equal((await call("GET", "/env?includeValues=false", bearer(CLIENT))).status, 401);
});
