// Files and messages the desktop reads are checked against their schemas: corrupt or foreign data
// falls back exactly as before and never reaches callers half-typed.
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { createConnectLinkReplayGuard, verifyConnectLinkToken } from "../electron/connect-link.mjs";
import { companionPreferences } from "../electron/desktop-companion.mjs";
import { registerMigrationIpc } from "../electron/migration.mjs";
import { helperEvent } from "../electron/native-dictation.mjs";
import { readRecoveryState } from "../electron/recovery.mjs";
import { createSessionPins } from "../electron/session-pins.mjs";
import { createWindowStateStore } from "../electron/window-state.mjs";

const root = mkdtempSync(path.join(tmpdir(), "openwork-stored-json-"));
after(() => rmSync(root, { recursive: true, force: true }));
let counter = 0;
const scratchDir = () => mkdtempSync(path.join(root, "case-"));

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

test("a connect token whose header or payload is not a JSON object is refused with invalid_token", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeys = { k1: publicKey.export({ type: "spki", format: "pem" }).toString() };
  for (const header of [[1, 2], 7, "text"]) {
    const result = verifyConnectLinkToken({ token: `${b64(header)}.${b64({})}.AAAA`, publicKeys });
    assert.deepEqual(result, { ok: false, code: "invalid_token", message: "Token header is not an object." });
  }
  const header = b64({ alg: "EdDSA", kid: "k1" });
  for (const payload of [[1], 3, null]) {
    const body = b64(payload);
    const signature = sign(null, Buffer.from(`${header}.${body}`), privateKey).toString("base64url");
    const result = verifyConnectLinkToken({ token: `${header}.${body}.${signature}`, publicKeys });
    assert.deepEqual(result, { ok: false, code: "invalid_token", message: "Token payload is not an object." });
  }
});

test("a replay guard file that is not a list of ids starts empty", async () => {
  const dir = scratchDir();
  for (const content of ["{\"jti\": true}", "not json", "[\"used\", 5]"]) {
    const filePath = path.join(dir, `${counter += 1}.json`);
    writeFileSync(filePath, content);
    const guard = createConnectLinkReplayGuard({ filePath });
    assert.equal(await guard.has("used"), content.startsWith("["));
    assert.equal(await guard.has("5"), false);
  }
});

test("companion preferences keep valid fields and default the rest", () => {
  const defaults = { mascot: "sprout", image: "", motion: true, openOnHover: false, autoClose: 15, alerts: true };
  assert.deepEqual(companionPreferences(null), defaults);
  assert.deepEqual(companionPreferences([1]), defaults);
  assert.deepEqual(companionPreferences({ mascot: "ember", image: "x", motion: false, openOnHover: true, autoClose: 7, alerts: 0 }),
    { mascot: "ember", image: "", motion: false, openOnHover: true, autoClose: 15, alerts: true });
});

test("speech helper lines outside the known events are dropped", () => {
  assert.equal(helperEvent("{oops"), null);
  assert.equal(helperEvent("{\"type\":\"other\"}"), null);
  assert.equal(helperEvent("{\"type\":\"result\",\"segments\":[1]}"), null);
  assert.deepEqual(helperEvent("{\"type\":\"error\",\"code\":\"weird\"}"), { type: "error", code: "network" });
  assert.deepEqual(helperEvent("{\"type\":\"result\",\"segments\":[\"hola\"],\"extra\":1}"), { type: "result", segments: ["hola"] });
  assert.deepEqual(helperEvent("{\"type\":\"end\"}"), { type: "end" });
});

test("a corrupt window-state file restores nothing", () => {
  const directory = scratchDir();
  const store = createWindowStateStore({ directory, screen: { getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }] } });
  for (const content of ["[]", "{\"version\":1,\"bounds\":{\"x\":0,\"y\":0,\"width\":-5,\"height\":10}}", "nope"]) {
    writeFileSync(path.join(directory, "window-state.json"), content);
    assert.deepEqual(store.initialOptions({ width: 800, height: 600 }), { options: { width: 800, height: 600 }, maximized: false });
  }
});

test("session pins fall back to the backup when the primary is malformed", () => {
  const directory = scratchDir();
  writeFileSync(path.join(directory, "session-pins.v1.json"), JSON.stringify({ version: 1, pinnedIds: ["a", 3] }));
  writeFileSync(path.join(directory, "session-pins.v1.json.backup"), JSON.stringify({ version: 1, pinnedIds: ["a", "b", "a"] }));
  assert.deepEqual(createSessionPins(directory).read(), ["a", "b"]);
  writeFileSync(path.join(directory, "session-pins.v1.json.backup"), JSON.stringify({ version: 2, pinnedIds: [] }));
  assert.throws(() => createSessionPins(directory).read(), /could not be recovered/);
});

test("recovery state from another distribution or a bad file has no versions", async () => {
  const userData = scratchDir();
  const app = { getPath: () => userData };
  const file = path.join(userData, "app-recovery.v1.json");
  writeFileSync(file, JSON.stringify({ distribution: "standard", currentVersion: "v1.2.3", previousVersion: 4 }));
  assert.deepEqual(await readRecoveryState(app, "standard"), { currentVersion: "1.2.3", previousVersion: null });
  assert.deepEqual(await readRecoveryState(app, "enterprise"), { currentVersion: null, previousVersion: null });
  writeFileSync(file, "[\"standard\"]");
  assert.deepEqual(await readRecoveryState(app, "standard"), { currentVersion: null, previousVersion: null });
});

test("a migration snapshot without version 1 is ignored", async () => {
  const userData = scratchDir();
  const handlers = new Map();
  registerMigrationIpc({ app: { getPath: () => userData }, ipcMain: { handle: (name, handler) => handlers.set(name, handler) } });
  const read = handlers.get("openwork:migration:read");
  const file = path.join(userData, "migration-snapshot.v1.json");
  writeFileSync(file, JSON.stringify({ version: 2, keys: {} }));
  assert.equal(await read(), null);
  writeFileSync(file, JSON.stringify({ version: 1, source: "tauri", keys: { "openwork.a": "1" } }));
  assert.deepEqual(await read(), { version: 1, source: "tauri", keys: { "openwork.a": "1" } });
});
