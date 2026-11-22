import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { keyEvent, matchElement, pickTarget } from "./lib/cdp.mjs";
import { isV2OnlyDatabase, pickOpencodeV1Bin } from "./lib/engine.mjs";
import { electronSessionEnv, parseCdpUrl, parseWebUrl, sessionName } from "./lib/session.mjs";

test("the main window is chosen, never the hidden desktop companion", () => {
  const targets = [
    { id: "1", type: "page", title: "Asistente de escritorio", url: "http://localhost:1/companion.html" },
    { id: "2", type: "page", title: "Comex", url: "http://localhost:1/#/workspace/a" },
    { id: "3", type: "service_worker", title: "sw", url: "http://localhost:1/sw.js" },
  ];
  assert.equal(pickTarget(targets)?.id, "2");
  assert.equal(pickTarget([...targets, { id: "4", type: "page", title: "OpenWork", url: "http://localhost:1/" }])?.id, "4");
  assert.equal(pickTarget(targets, "companion"), null);
});

test("elements match by exact label or text first, then prefix, then substring, visible only", () => {
  const elements = [
    { label: "Cambiar aplicación especialista", text: "Comex", visible: true },
    { label: "", text: "Comex QA", visible: true },
    { label: "", text: "Eliminar aplicación", visible: false },
    { label: "Eliminar aplicación", text: "Eliminar aplicación", visible: true },
  ];
  assert.equal(matchElement(elements, "comex").match?.label, "Cambiar aplicación especialista");
  assert.equal(matchElement(elements, "Comex QA").match?.text, "Comex QA");
  assert.deepEqual([matchElement(elements, "eliminar aplicación").count, matchElement(elements, "eliminar aplicación").match?.visible], [1, true]);
  assert.equal(matchElement(elements, "especialista").match?.label, "Cambiar aplicación especialista");
  assert.deepEqual([matchElement(elements, "Comex QA").tier, matchElement(elements, "especialista").tier, matchElement(elements, "nada").tier], ["exact", "substring", null]);
  assert.equal(matchElement(elements, "no existe").match, null);
  assert.equal(matchElement(elements, "Comex", 5).match, null);
});

test("key chords become CDP key events", () => {
  assert.deepEqual(keyEvent("Enter"), { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", modifiers: 0 });
  assert.deepEqual(keyEvent("Control+k"), { key: "k", code: "KeyK", windowsVirtualKeyCode: 75, text: undefined, modifiers: 2 });
  assert.equal(keyEvent("Shift+a").text, "a");
  assert.throws(() => keyEvent("Hyper+x"), /Unknown modifier/);
  assert.throws(() => keyEvent("F99"), /Unknown key/);
});

test("banners and world output yield the CDP and web addresses", () => {
  assert.equal(parseCdpUrl("[openwork] dev profile=/x cdp=http://127.0.0.1:9223\n"), "http://127.0.0.1:9223");
  assert.equal(parseCdpUrl("webUrl  http://127.0.0.1:5178\ncdp  http://127.0.0.1:36479\n"), "http://127.0.0.1:36479");
  assert.equal(parseWebUrl("webUrl  http://127.0.0.1:5178\n"), "http://127.0.0.1:5178");
  assert.equal(parseCdpUrl("nothing here"), null);
  assert.equal(sessionName("qa-2"), "qa-2");
  assert.throws(() => sessionName("../x"), /lowercase/);
});

test("engine v1 is picked from the env, then a v1 opencode on PATH, then the sidecar", () => {
  const root = mkdtempSync(join(tmpdir(), "dev-agent-engine-"));
  try {
    const sidecar = join(root, "apps", "desktop", "resources", "sidecars");
    const versions = { opencode: "opencode v2.2.0", [join(sidecar, "opencode")]: "1.18.33" };
    const run = bin => ({ status: versions[bin] ? 0 : 1, stdout: versions[bin] ?? "" });
    assert.equal(pickOpencodeV1Bin({ env: {}, repoRoot: root, run }), null);
    mkdirSync(sidecar, { recursive: true }); writeFileSync(join(sidecar, "opencode"), ""); chmodSync(join(sidecar, "opencode"), 0o755);
    assert.deepEqual(pickOpencodeV1Bin({ env: {}, repoRoot: root, run }), { bin: join(sidecar, "opencode"), version: "1.18.33", source: "sidecar" });
    versions.opencode = "1.18.33";
    assert.equal(pickOpencodeV1Bin({ env: {}, repoRoot: root, run })?.source, "path");
    assert.equal(pickOpencodeV1Bin({ env: { OPENWORK_OPENCODE_BIN: "/custom/opencode" }, repoRoot: root, run })?.source, "env");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a database created by OpenCode v2 is told apart from a v1 or migrated one", () => {
  const root = mkdtempSync(join(tmpdir(), "dev-agent-db-"));
  try {
    const make = (name, tables) => { const path = join(root, name); const db = new DatabaseSync(path); for (const table of tables) db.exec(`CREATE TABLE ${table} (id TEXT)`); db.close(); return path; };
    assert.equal(isV2OnlyDatabase(make("v2.db", ["session_v2", "kv"])), true);
    assert.equal(isV2OnlyDatabase(make("v1.db", ["session", "message"])), false);
    assert.equal(isV2OnlyDatabase(make("migrated.db", ["session", "session_v2"])), false);
    assert.equal(isV2OnlyDatabase(join(root, "missing.db")), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("an Electron session never inherits ELECTRON_RUN_AS_NODE from a VS Code shell", () => {
  const env = electronSessionEnv({ ELECTRON_RUN_AS_NODE: "1", PATH: "/bin" }, { OPENWORK_COMEX_OPENCODE_MODE: "managed" }, "agent-x");
  assert.equal("ELECTRON_RUN_AS_NODE" in env, false);
  assert.equal(env.PATH, "/bin");
  assert.equal(env.OPENWORK_DEV_PROFILE, "agent-x");
  assert.equal(env.OPENWORK_COMEX_OPENCODE_MODE, "managed");
});
