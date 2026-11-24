import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { addResource, audit, devAgentRecords, listRecords, ownersDir, releaseResource, worldRecords } from "../check-resource-cleanup.mjs";

const ROOT = "/tmp/opencode";
mkdirSync(ROOT, { recursive: true });
const DIR = mkdtempSync(resolve(ROOT, "resource-cleanup-test-"));
const SCRIPT = fileURLToPath(new URL("../check-resource-cleanup.mjs", import.meta.url));

after(() => rmSync(DIR, { recursive: true, force: true }));

const session = name => {
  const dir = resolve(DIR, name);
  mkdirSync(dir, { recursive: true });
  return dir;
};

const probes = ({ pids = new Set(), cmds = {}, ports = new Set(), paths = new Set() } = {}) => ({
  pidAlive: async pid => pids.has(pid),
  cmdlineOf: async pid => cmds[pid] ?? null,
  listeningPorts: async () => ports,
  pathExists: path => paths.has(path),
});

test("add is idempotent and release marks the resource instead of deleting it", () => {
  const dir = session("registry");
  addResource(dir, "one-task", "pid", 4242, "node scripts/dev-server.mjs");
  addResource(dir, "one-task", "pid", "4242", "node scripts/dev-server.mjs");
  const [record] = listRecords(dir);
  assert.equal(record.resources.length, 1);
  assert.equal(record.resources[0].cmdline, "node scripts/dev-server.mjs");

  assert.equal(releaseResource(dir, "one-task", "pid", 4242), true);
  assert.equal(releaseResource(dir, "one-task", "pid", 4242), false);
  assert.deepEqual(listRecords(dir)[0].resources.map(item => item.released), [true]);
  assert.equal(existsSync(resolve(dir, "one-task.json")), true);
});

test("session names cannot escape the registry directory", () => {
  assert.throws(() => addResource(session("safe"), "../escape", "path", "/tmp/opencode/x"), /Session names/);
  assert.throws(() => addResource(session("safe"), "task", "socket", 1234), /Unknown resource kind/);
  assert.throws(() => addResource(session("safe"), "task", "port", "0"), /positive integer/);
  assert.deepEqual(listRecords(session("safe")), []);
});

test("audit detects each unreleased kind with injected probes", async () => {
  const dir = session("leaks");
  addResource(dir, "task-leaks", "pid", 11, "my-dev-server");
  addResource(dir, "task-leaks", "port", 5178);
  addResource(dir, "task-leaks", "path", "/tmp/opencode/task-leaks");
  addResource(dir, "task-leaks", "tab", "tab-1");
  const result = await audit(listRecords(dir), probes({
    pids: new Set([11]),
    cmds: { 11: "node my-dev-server.js" },
    ports: new Set([5178]),
    paths: new Set(["/tmp/opencode/task-leaks"]),
  }));
  assert.deepEqual(result.leaks.map(item => item.kind), ["pid", "port", "path", "tab"]);
  assert.match(result.leaks.find(item => item.kind === "tab").note, /browser_close/);
  assert.deepEqual(result.spared, []);
});

test("a reused PID is spared and a released resource is clean", async () => {
  const dir = session("spared");
  addResource(dir, "task-spared", "pid", 22, "my-old-server");
  addResource(dir, "task-spared", "pid", 23, "my-live-server");
  releaseResource(dir, "task-spared", "pid", 23);
  const result = await audit(listRecords(dir), probes({
    pids: new Set([22, 23]),
    cmds: { 22: "node somebody-else.js", 23: "node my-live-server.js" },
  }));
  assert.deepEqual(result.leaks, []);
  assert.deepEqual(result.spared.map(item => item.value), [22]);
  assert.deepEqual(result.clean.map(item => item.value), [23]);
});

test("dev-agent sessions are adopted as owned resources, stopped ones as released", () => {
  const root = session("dev-agent-registry");
  mkdirSync(resolve(root, "live"), { recursive: true });
  mkdirSync(resolve(root, "finished"), { recursive: true });
  const live = { name: "live", kind: "electron", pid: 801, watcherPid: 802, fakeModelPid: 803, fakeModelPort: 8791, cdp: "http://127.0.0.1:9823" };
  writeFileSync(resolve(root, "live", "session.json"), JSON.stringify(live));
  writeFileSync(resolve(root, "finished", "session.json"), JSON.stringify({ ...live, name: "finished", stoppedAt: "2026-11-23T00:00:00.000Z" }));

  const records = devAgentRecords(root);
  assert.deepEqual(records.map(record => record.session), ["dev-agent-finished", "dev-agent-live"]);
  assert.deepEqual(records[0].resources.map(resource => [resource.kind, resource.value, resource.released]), [
    ["pid", 801, true], ["pid", 802, true], ["pid", 803, true], ["port", 8791, true], ["port", 9823, true],
  ]);
  assert.deepEqual(records[1].resources.map(resource => resource.released), [false, false, false, false, false]);
  assert.equal(devAgentRecords(resolve(root, "missing")).length, 0);
});

test("an isolated registry never adopts dev-agent sessions", () => {
  const dir = session("isolated");
  addResource(dir, "isolated-task", "tab", "tab-x");
  assert.deepEqual(listRecords(dir).map(record => record.session), ["isolated-task"]);
});

test("held dev worlds are adopted from their snapshot: pid and URL ports only, no secrets", () => {
  const root = session("world-registry");
  const snapshot = {
    version: 2, kind: "script", name: "dev-app-web", pid: 4242,
    outputs: {
      webUrl: "http://127.0.0.1:5178",
      openworkUrl: "http://127.0.0.1:8778",
      cdp: "http://127.0.0.1:9823/json/version",
      workspace: "/ruta/privada/del/usuario",
      runtimeManifest: "/ruta/privada/del/usuario/tmp/dev-headless-web.json",
      token: "super-secreto",
    },
  };
  writeFileSync(resolve(root, "dev-app-web.json"), JSON.stringify(snapshot));
  // Un mundo de otro propósito no debe adoptarse aunque tenga snapshot.
  writeFileSync(resolve(root, "preview-full.json"), JSON.stringify({ ...snapshot, name: "preview-full", pid: 4243 }));

  const records = worldRecords(root, () => true);
  assert.deepEqual(records.map(record => record.session), ["world-dev-app-web"]);
  assert.deepEqual(records[0].resources.map(resource => [resource.kind, resource.value, resource.released]), [
    ["pid", 4242, false], ["port", 5178, false], ["port", 8778, false], ["port", 9823, false],
  ]);
  const raw = JSON.stringify(records);
  assert.equal(raw.includes("super-secreto"), false);
  assert.equal(raw.includes("privada"), false);
  assert.equal(worldRecords(resolve(root, "missing")).length, 0);
});

test("a world snapshot with a dead pid is released; an isolated registry adopts no worlds", () => {
  const root = session("world-dead");
  writeFileSync(resolve(root, "dev-app-web.json"), JSON.stringify({
    name: "dev-app-web", pid: 4242,
    outputs: { webUrl: "http://127.0.0.1:5178", openworkUrl: "http://127.0.0.1:8778" },
  }));
  assert.deepEqual(worldRecords(root, () => false)[0].resources.map(resource => resource.released), [true, true, true]);

  const dir = session("world-isolated");
  addResource(dir, "world-isolated-task", "tab", "tab-x");
  assert.deepEqual(listRecords(dir).map(record => record.session), ["world-isolated-task"]);
});

test("CLI check fails on a leak and passes after release, without touching processes", () => {
  const dir = session("cli");
  const env = { ...process.env, OPENWORK_RESOURCE_OWNERS_DIR: dir };
  assert.equal(ownersDir(dir), dir);

  const add = spawnSync(process.execPath, [SCRIPT, "add", "cli-task", "tab", "tab-9"], { env, encoding: "utf8" });
  assert.equal(add.status, 0, add.stderr);

  const leaking = spawnSync(process.execPath, [SCRIPT, "check"], { env, encoding: "utf8" });
  assert.equal(leaking.status, 1, leaking.stderr);
  assert.match(leaking.stdout, /LEAK cli-task tab=tab-9/);

  const release = spawnSync(process.execPath, [SCRIPT, "release", "cli-task", "tab", "tab-9"], { env, encoding: "utf8" });
  assert.equal(release.status, 0, release.stderr);
  const clean = spawnSync(process.execPath, [SCRIPT, "check"], { env, encoding: "utf8" });
  assert.equal(clean.status, 0, clean.stderr);
  assert.match(clean.stdout, /Sin recursos pendientes/);
  assert.equal(readFileSync(resolve(dir, "cli-task.json"), "utf8").includes('"released": true'), true);
});
