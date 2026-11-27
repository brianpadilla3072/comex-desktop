import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { createPairingRegistry, PAIRING_CODE_TTL_MS, PAIRING_MAX_FAILURES } from "../src/device-pairing.js";

// Remote devices (a phone, a laptop over Tailscale) get their own revocable owner token by
// redeeming a one-time code or the optional reusable code shown on the desktop.
const dir = mkdtempSync(join(tmpdir(), "device-pairing-"));
const HOST = "pairing-host";
const CLIENT = "pairing-client";
const REMOTE_STORE = join(dir, "remote-pairing-code.json");
const overrides: Record<string, string | undefined> = {
  OPENWORK_DATA_DIR: join(dir, "openwork"), OPENWORK_RUNTIME_DB: join(dir, "runtime.sqlite"),
  OPENCODE_DB: join(dir, "v1.db"), OPENWORK_ENGINE_AUTO_UPGRADE: "0",
  // Never the person's own ~/.config/openwork/env.json: the env routes write user-level variables.
  OPENWORK_ENV_STORE: join(dir, "env.json"),
  OPENWORK_TOKEN_STORE: join(dir, "tokens.json"),
  OPENWORK_REMOTE_PAIRING_CODE_STORE: REMOTE_STORE,
  DEN_FEATURE_REMOTE_DEVICE_PAIRING: "true",
  DEN_FEATURE_REMOTE_PAIRING_CODE: "false",
  OPENWORK_DEV_MODE: "0",
  OPENWORK_DEV_PAIRING_CODE: undefined,
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
const issuedRemote = z.object({ code: z.string(), createdAt: z.number() });
const redeemed = z.object({ id: z.string(), token: z.string(), scope: z.literal("owner") });
const disabledStatus = {
  enabled: true,
  remoteCodeEnabled: false,
  remoteCodeConfigured: false,
  remoteCodeSource: "none",
};

async function withRemotePairingMode(
  options: { dev?: boolean; devCode?: string },
  run: () => Promise<void>,
): Promise<void> {
  const oldFeature = process.env.DEN_FEATURE_REMOTE_PAIRING_CODE;
  const oldDevMode = process.env.OPENWORK_DEV_MODE;
  const oldDevCode = process.env.OPENWORK_DEV_PAIRING_CODE;
  process.env.DEN_FEATURE_REMOTE_PAIRING_CODE = "true";
  process.env.OPENWORK_DEV_MODE = options.dev === true ? "1" : "0";
  if (options.devCode === undefined) delete process.env.OPENWORK_DEV_PAIRING_CODE;
  else process.env.OPENWORK_DEV_PAIRING_CODE = options.devCode;
  try {
    await call("DELETE", "/pairing/remote-code", host);
    await call("DELETE", "/pairing/codes", host);
    await run();
  } finally {
    await call("DELETE", "/pairing/codes", host);
    await call("DELETE", "/pairing/remote-code", host);
    if (oldFeature === undefined) delete process.env.DEN_FEATURE_REMOTE_PAIRING_CODE;
    else process.env.DEN_FEATURE_REMOTE_PAIRING_CODE = oldFeature;
    if (oldDevMode === undefined) delete process.env.OPENWORK_DEV_MODE;
    else process.env.OPENWORK_DEV_MODE = oldDevMode;
    if (oldDevCode === undefined) delete process.env.OPENWORK_DEV_PAIRING_CODE;
    else process.env.OPENWORK_DEV_PAIRING_CODE = oldDevCode;
  }
}

test("the reusable-code feature is additive and leaves the one-time flow available when off", async () => {
  assert.deepEqual((await call("GET", "/pairing/status")).json, disabledStatus);
  assert.equal((await call("POST", "/pairing/remote-code", host)).status, 404);
  assert.equal((await call("DELETE", "/pairing/remote-code", host)).status, 404);
  assert.equal((await call("POST", "/pairing/redeem", {}, { code: "3570", deviceName: "Sin feature" })).status, 410);
  const { code } = issued.parse((await call("POST", "/pairing/codes", host)).json);
  const temporary = redeemed.parse((await call("POST", "/pairing/redeem", {}, { code, deviceName: "Temporal" })).json);
  assert.equal((await call("DELETE", `/pairing/devices/${temporary.id}`, host)).status, 200);
});

test("a redeemed code gives the device owner access that works on host routes and can be revoked", async () => {
  assert.deepEqual((await call("GET", "/pairing/status")).json, disabledStatus);
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

test("an explicit development 3570 fallback works until a stored code replaces it, and deleting restores it", async () => {
  await withRemotePairingMode({ dev: true, devCode: "3570" }, async () => {
    assert.deepEqual((await call("GET", "/pairing/status")).json, {
      enabled: true,
      remoteCodeEnabled: true,
      remoteCodeConfigured: false,
      remoteCodeSource: "development",
    });
    const first = redeemed.parse((await call("POST", "/pairing/redeem", {}, { code: "3570", deviceName: "Dev uno" })).json);
    const second = redeemed.parse((await call("POST", "/pairing/redeem", {}, { code: "3570", deviceName: "Dev dos" })).json);
    assert.notEqual(first.id, second.id);
    assert.notEqual(first.token, second.token);
    assert.equal((await call("DELETE", `/pairing/devices/${first.id}`, host)).status, 200);
    assert.equal((await call("GET", "/tokens", bearer(first.token))).status, 401);
    assert.equal((await call("GET", "/tokens", bearer(second.token))).status, 200);

    const generated = issuedRemote.parse((await call("POST", "/pairing/remote-code", host)).json);
    assert.match(generated.code, /^[A-Z2-7]{16}$/);
    assert.deepEqual((await call("GET", "/pairing/status")).json, {
      enabled: true,
      remoteCodeEnabled: true,
      remoteCodeConfigured: true,
      remoteCodeSource: "stored",
    });
    assert.equal((await call("POST", "/pairing/redeem", {}, { code: "3570", deviceName: "Fallback viejo" })).status, 400);
    assert.equal((await call("POST", "/pairing/redeem", {}, { code: generated.code, deviceName: "Stored" })).status, 201);

    assert.equal((await call("DELETE", "/pairing/remote-code", host)).status, 200);
    assert.deepEqual((await call("GET", "/pairing/status")).json, {
      enabled: true,
      remoteCodeEnabled: true,
      remoteCodeConfigured: false,
      remoteCodeSource: "development",
    });
    assert.equal((await call("POST", "/pairing/redeem", {}, { code: "3570", deviceName: "Fallback restaurado" })).status, 201);
  });
});

test("OPENWORK_DEV_PAIRING_CODE replaces the default development fallback", async () => {
  await withRemotePairingMode({ dev: true, devCode: "eval-code" }, async () => {
    assert.equal((await call("POST", "/pairing/redeem", {}, { code: "EVALCODE", deviceName: "Override" })).status, 201);
    assert.equal((await call("POST", "/pairing/redeem", {}, { code: "3570", deviceName: "Default viejo" })).status, 400);
  });
});

test("dev mode without OPENWORK_DEV_PAIRING_CODE accepts no known fallback", async () => {
  await withRemotePairingMode({ dev: true }, async () => {
    assert.deepEqual((await call("GET", "/pairing/status")).json, {
      enabled: true,
      remoteCodeEnabled: true,
      remoteCodeConfigured: false,
      remoteCodeSource: "none",
    });
    assert.equal((await call("POST", "/pairing/redeem", {}, { code: "3570", deviceName: "Sin override" })).status, 410);
  });
});

test("an empty OPENWORK_DEV_PAIRING_CODE disables the development fallback", async () => {
  await withRemotePairingMode({ dev: true, devCode: "" }, async () => {
    assert.deepEqual((await call("GET", "/pairing/status")).json, {
      enabled: true,
      remoteCodeEnabled: true,
      remoteCodeConfigured: false,
      remoteCodeSource: "none",
    });
    assert.equal((await call("POST", "/pairing/redeem", {}, { code: "3570", deviceName: "Sin fallback" })).status, 410);
  });
});

test("a corrupt reusable-code store fails closed with a stable 409 until it is deleted", async () => {
  await withRemotePairingMode({ dev: true, devCode: "3570" }, async () => {
    writeFileSync(REMOTE_STORE, "{not-json", { mode: 0o600 });
    const invalidStore = z.object({ code: z.literal("remote_pairing_code_store_invalid") });
    for (const response of [
      await call("GET", "/pairing/status"),
      await call("POST", "/pairing/redeem", {}, { code: "3570", deviceName: "No fallback" }),
      await call("POST", "/pairing/remote-code", host, { code: "replacement-code" }),
    ]) {
      assert.equal(response.status, 409);
      invalidStore.parse(response.json);
    }
    assert.equal((await call("DELETE", "/pairing/remote-code", host)).status, 200);
    assert.deepEqual((await call("GET", "/pairing/status")).json, {
      enabled: true,
      remoteCodeEnabled: true,
      remoteCodeConfigured: false,
      remoteCodeSource: "development",
    });
    assert.equal((await call("POST", "/pairing/redeem", {}, { code: "3570", deviceName: "Fallback reparado" })).status, 201);
  });
});

test("production rejects 3570, validates chosen codes, and never returns a stored code in status", async () => {
  await withRemotePairingMode({ dev: false }, async () => {
    assert.deepEqual((await call("GET", "/pairing/status")).json, {
      enabled: true,
      remoteCodeEnabled: true,
      remoteCodeConfigured: false,
      remoteCodeSource: "none",
    });
    assert.equal((await call("POST", "/pairing/redeem", {}, { code: "3570", deviceName: "Producción" })).status, 410);
    assert.equal((await call("POST", "/pairing/remote-code", host, { code: "muy-corto" })).status, 400);
    assert.deepEqual((await call("GET", "/pairing/status")).json, {
      enabled: true,
      remoteCodeEnabled: true,
      remoteCodeConfigured: false,
      remoteCodeSource: "none",
    });

    const configured = issuedRemote.parse((await call("POST", "/pairing/remote-code", host, { code: "ab cd-efgh ijkl" })).json);
    assert.equal(configured.code, "ABCDEFGHIJKL");
    assert.deepEqual((await call("GET", "/pairing/status")).json, {
      enabled: true,
      remoteCodeEnabled: true,
      remoteCodeConfigured: true,
      remoteCodeSource: "stored",
    });
    const first = redeemed.parse((await call("POST", "/pairing/redeem", {}, { code: "abcd-efgh ijkl", deviceName: "Primero" })).json);
    const second = redeemed.parse((await call("POST", "/pairing/redeem", {}, { code: configured.code, deviceName: "Segundo" })).json);
    assert.notEqual(first.token, second.token);

    const rotated = issuedRemote.parse((await call("POST", "/pairing/remote-code", host, { code: "rotated-code-1234" })).json);
    assert.equal((await call("POST", "/pairing/redeem", {}, { code: configured.code, deviceName: "Código viejo" })).status, 400);
    assert.equal((await call("GET", "/tokens", bearer(first.token))).status, 200);
    assert.equal((await call("POST", "/pairing/redeem", {}, { code: rotated.code, deviceName: "Rotado" })).status, 201);
  });
});

test("only the desktop host can configure, rotate, or delete the reusable code", async () => {
  await withRemotePairingMode({ dev: false }, async () => {
    const configured = issuedRemote.parse((await call("POST", "/pairing/remote-code", host, { code: "host-only-code" })).json);
    const device = redeemed.parse((await call("POST", "/pairing/redeem", {}, { code: configured.code, deviceName: "Pareado" })).json);
    assert.equal((await call("POST", "/pairing/remote-code", bearer(device.token), { code: "another-host-code" })).status, 403);
    assert.equal((await call("DELETE", "/pairing/remote-code", bearer(device.token))).status, 403);
    assert.equal((await call("POST", "/pairing/remote-code", {}, { code: "anonymous-code" })).status, 401);
    assert.equal((await call("DELETE", "/pairing/remote-code")).status, 401);
  });
});

test("the one-time code still works while the reusable feature is enabled", async () => {
  await withRemotePairingMode({ dev: false }, async () => {
    const temporary = issued.parse((await call("POST", "/pairing/codes", host)).json);
    assert.equal((await call("POST", "/pairing/redeem", {}, { code: temporary.code, deviceName: "Temporal compatible" })).status, 201);
    assert.deepEqual((await call("GET", "/pairing/status")).json, {
      enabled: true,
      remoteCodeEnabled: true,
      remoteCodeConfigured: false,
      remoteCodeSource: "none",
    });
  });
});

test("five failed reusable guesses block the next reusable attempt globally for five minutes", async () => {
  await withRemotePairingMode({ dev: false }, async () => {
    const configured = issuedRemote.parse((await call("POST", "/pairing/remote-code", host, { code: "rate-limit-code" })).json);
    const temporary = issued.parse((await call("POST", "/pairing/codes", host)).json);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert.equal((await call("POST", "/pairing/redeem", { "x-forwarded-for": `198.51.100.${attempt + 1}` }, { code: "WRONG-CODE", deviceName: "Intruso" })).status, 400);
    }
    assert.equal((await call("POST", "/pairing/redeem", { "x-forwarded-for": "203.0.113.99" }, { code: configured.code, deviceName: "Bloqueado" })).status, 429);
    // The throttle applies to the reusable path, not to a valid one-time code.
    const replacement = issued.parse((await call("POST", "/pairing/codes", host)).json);
    assert.equal((await call("POST", "/pairing/redeem", {}, { code: replacement.code, deviceName: "Temporal durante bloqueo" })).status, 201);
    assert.notEqual(temporary.code, replacement.code);
  });
});

test("concurrent redemptions of one reusable code each persist an independent owner token", async () => {
  await withRemotePairingMode({ dev: false }, async () => {
    const configured = issuedRemote.parse((await call("POST", "/pairing/remote-code", host, { code: "concurrent-code" })).json);
    const responses = await Promise.all(Array.from({ length: 12 }, (_, index) =>
      call("POST", "/pairing/redeem", {}, { code: configured.code, deviceName: `Concurrent-${index}` }),
    ));
    assert.equal(responses.every(response => response.status === 201), true);
    const devices = responses.map(response => redeemed.parse(response.json));
    assert.equal(new Set(devices.map(device => device.id)).size, devices.length);
    assert.equal(new Set(devices.map(device => device.token)).size, devices.length);
    const listed = z.object({ items: z.array(z.object({ name: z.string() })) }).parse((await call("GET", "/pairing/devices", host)).json);
    const concurrentNames = listed.items.map(item => item.name).filter(name => name.startsWith("Concurrent-"));
    assert.equal(concurrentNames.length, devices.length);
  });
});
