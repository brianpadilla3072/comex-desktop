#!/usr/bin/env node
/**
 * Resource-cleanup guard: detects resources a task registered but never released.
 *
 * It NEVER kills a process, closes a tab or deletes a path. Ownership comes from
 * an explicit JSON record written when a resource is opened; without a record a
 * process is invisible here on purpose (other agents and the user own them).
 * Ports and paths are verified against the live system so an agent that cleaned
 * up but forgot to mark `released` does not get a false positive. A PID whose
 * cmdline no longer matches is spared, not reported: PIDs can be reused.
 *
 * Usage:
 *   node scripts/check-resource-cleanup.mjs check
 *   node scripts/check-resource-cleanup.mjs add <session> <pid|port|path|tab> <value> [cmdline|note]
 *   node scripts/check-resource-cleanup.mjs release <session> <kind> <value>
 *
 * OPENWORK_RESOURCE_OWNERS_DIR overrides the registry directory (used in tests).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { connect } from "node:net";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DIR = resolve(REPO_ROOT, "tmp", "resource-cleanup");
const DEV_AGENT_DIR = resolve(REPO_ROOT, "tmp", "dev-agent");
const WORLD_SNAPSHOT_DIR = resolve(REPO_ROOT, "evals", "results", ".worlds", "scripts");
const WORLD_SNAPSHOT_SESSION = /^(dev-app-web|dev-headless)(?:[.-]|$)/;
const KINDS = new Set(["pid", "port", "path", "tab"]);
const DEV_AGENT_SESSION = /^[a-z0-9][a-z0-9-]{0,40}$/;

export function ownersDir(override = process.env.OPENWORK_RESOURCE_OWNERS_DIR) {
  return resolve(override || DEFAULT_DIR);
}

const recordFile = (dir, session) => resolve(dir, `${sessionName(session)}.json`);

function sessionName(value) {
  const name = String(value ?? "");
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) {
    throw new Error(`Session names use lowercase letters, digits and dashes (got "${name}").`);
  }
  return name;
}

function normalizeResource(kind, value, extra) {
  if (!KINDS.has(kind)) throw new Error(`Unknown resource kind "${kind}" (use ${[...KINDS].join(", ")})`);
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error(`Missing value for ${kind}`);
  const parsed = kind === "pid" || kind === "port" ? Number(raw) : raw;
  if (kind === "pid" || kind === "port") {
    if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${kind} must be a positive integer (got "${raw}")`);
  }
  const resource = { kind, value: parsed, released: false };
  if (kind === "pid" && extra) resource.cmdline = extra;
  if (kind !== "pid" && extra) resource.note = extra;
  return resource;
}

function sameResource(a, b) {
  return a.kind === b.kind && String(a.value) === String(b.value);
}

function readRecord(file) {
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  if (parsed?.version !== 1 || typeof parsed.session !== "string" || !Array.isArray(parsed.resources)) {
    throw new Error(`Invalid resource record: ${file}`);
  }
  return parsed;
}

function writeRecord(dir, session, record) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(recordFile(dir, session), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
}

export function addResource(dir, session, kind, value, extra) {
  const resource = normalizeResource(kind, value, extra);
  const file = recordFile(dir, session);
  const record = existsSync(file) ? readRecord(file) : { version: 1, session: sessionName(session), resources: [] };
  if (!record.resources.some(item => sameResource(item, resource))) record.resources.push(resource);
  writeRecord(dir, session, record);
  return resource;
}

export function releaseResource(dir, session, kind, value) {
  const file = recordFile(dir, session);
  if (!existsSync(file)) return false;
  const record = readRecord(file);
  const target = normalizeResource(kind, value);
  let changed = false;
  for (const item of record.resources) {
    if (sameResource(item, target) && !item.released) {
      item.released = true;
      changed = true;
    }
  }
  if (changed) writeRecord(dir, session, record);
  return changed;
}

/**
 * `dev:agent` already records ownership in tmp/dev-agent/<session>/session.json.
 * Reading that registry too makes the rule hard: a process started through the
 * toolkit is visible to the guard even if the agent forgot to call `add`.
 * A session marked `stoppedAt` counts as released; dead PIDs/ports are later
 * filtered by the live probes, so a stale session is not a false positive.
 */
export function devAgentRecords(root = DEV_AGENT_DIR) {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter(name => DEV_AGENT_SESSION.test(name) && existsSync(resolve(root, name, "session.json")))
    .sort()
    .map(name => {
      const state = JSON.parse(readFileSync(resolve(root, name, "session.json"), "utf8"));
      const released = Boolean(state.stoppedAt);
      const resources = [];
      const add = (kind, value) => {
        if (Number.isInteger(value) && value > 0) resources.push({ kind, value, released });
      };
      add("pid", state.pid);
      add("pid", state.watcherPid);
      add("pid", state.fakeModelPid);
      add("port", state.fakeModelPort);
      let cdpPort = 0;
      try { cdpPort = state.cdp ? Number(new URL(state.cdp).port) : 0; } catch { cdpPort = 0; }
      add("port", cdpPort);
      return { version: 1, session: `dev-agent-${name}`, resources };
    });
}

function portFromUrl(value) {
  try {
    const port = Number(new URL(String(value ?? "")).port);
    return Number.isInteger(port) && port > 0 ? port : 0;
  } catch {
    return 0;
  }
}

/**
 * `pnpm world up dev-app-web` writes a snapshot under evals/results/.worlds/scripts
 * while the world is held; hold.ts writes it on boot and unlinks it on stop/down.
 * Adopting the dev-verification worlds makes their pid and ports visible without
 * the agent remembering to call `add`. Only numeric ports are read from the URLs:
 * tokens, workspace paths and the runtime manifest path stay out of the registry.
 * A dead snapshot pid marks the record released, so a world killed with SIGKILL
 * (which leaves the snapshot behind) is not reported as a leak.
 * `isAlive` is injectable so tests never probe real processes.
 */
export function worldRecords(root = process.env.OPENWORK_WORLD_SNAPSHOT_DIR ?? WORLD_SNAPSHOT_DIR, isAlive = pidAlive) {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter(file => file.endsWith(".json"))
    .sort()
    .flatMap(file => {
      let snapshot;
      try { snapshot = JSON.parse(readFileSync(resolve(root, file), "utf8")); } catch { return []; }
      if (!snapshot || typeof snapshot !== "object") return [];
      const name = typeof snapshot.name === "string" ? snapshot.name : "";
      if (!WORLD_SNAPSHOT_SESSION.test(name)) return [];
      const pid = Number(snapshot.pid);
      const validPid = Number.isInteger(pid) && pid > 0 ? pid : 0;
      const outputs = snapshot.outputs && typeof snapshot.outputs === "object" ? snapshot.outputs : {};
      const released = validPid > 0 ? !isAlive(validPid) : true;
      const resources = [];
      const addResourceRecord = (kind, value) => {
        if (Number.isInteger(value) && value > 0) resources.push({ kind, value, released });
      };
      addResourceRecord("pid", validPid);
      addResourceRecord("port", portFromUrl(outputs.webUrl));
      addResourceRecord("port", portFromUrl(outputs.openworkUrl));
      addResourceRecord("port", portFromUrl(outputs.cdp));
      if (resources.length === 0) return [];
      const session = `world-${name.replace(/[^a-z0-9-]/g, "-").slice(0, 56)}`;
      return [{ version: 1, session, resources }];
    });
}

export function listRecords(dir = ownersDir()) {
  const own = existsSync(dir)
    ? readdirSync(dir).filter(file => file.endsWith(".json")).sort().map(file => readRecord(resolve(dir, file)))
    : [];
  // Only the real registry merges the toolkit and held worlds. An explicit
  // override (tests, CI or a caller inspecting one session) stays isolated.
  return resolve(dir) === ownersDir()
    ? [...own, ...devAgentRecords(), ...worldRecords()]
    : own;
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function cmdlineOf(pid) {
  try { return readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ").trim(); } catch { return null; }
}

/** Returns a Set of listening ports, or null when `ss` is unavailable. */
function ssPorts() {
  const result = spawnSync("ss", ["-ltnp"], { encoding: "utf8" });
  if (result.error || result.status !== 0) return null;
  const ports = new Set();
  for (const line of result.stdout.split("\n")) {
    const match = line.match(/:(\d{1,5})\s/);
    if (match) ports.add(Number(match[1]));
  }
  return ports;
}

function portListening(port, host = "127.0.0.1") {
  return new Promise(resolveFn => {
    const socket = connect({ host, port });
    const done = alive => { socket.destroy(); resolveFn(alive); };
    socket.setTimeout(400);
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.once("timeout", () => done(false));
  });
}

/**
 * Returns { leaks, clean, spared }. `probes` is injectable so tests can audit
 * without touching the host: { pidAlive, cmdlineOf, listeningPorts, portListening, pathExists }.
 */
export async function audit(records, probes = {}) {
  const result = { leaks: [], clean: [], spared: [] };
  const listening = probes.listeningPorts ? await probes.listeningPorts() : ssPorts();
  for (const record of records) {
    for (const resource of record.resources) {
      const entry = { session: record.session, ...resource };
      if (resource.released) {
        result.clean.push(entry);
        continue;
      }
      let alive = false;
      let note = "";
      if (resource.kind === "pid") {
        alive = await (probes.pidAlive ?? pidAlive)(Number(resource.value));
        if (alive && resource.cmdline) {
          const cmd = await (probes.cmdlineOf ?? cmdlineOf)(Number(resource.value));
          if (cmd && !cmd.includes(resource.cmdline)) {
            alive = false;
            note = "PID reutilizado: cmdline no coincide";
          }
        }
      } else if (resource.kind === "port") {
        alive = listening
          ? listening.has(Number(resource.value))
          : await (probes.portListening ?? portListening)(Number(resource.value));
      } else if (resource.kind === "path") {
        alive = (probes.pathExists ?? existsSync)(String(resource.value));
      } else {
        // A browser tab cannot be probed from Node; it needs an explicit release.
        alive = true;
        note = "pestaña sin liberar (requiere browser_close)";
      }
      if (alive) result.leaks.push({ ...entry, note });
      else if (note) result.spared.push({ ...entry, note });
      else result.clean.push(entry);
    }
  }
  return result;
}

function report(result, dir) {
  const lines = [`Registro de recursos: ${dir}`];
  if (result.leaks.length === 0 && result.spared.length === 0) lines.push("Sin recursos pendientes.");
  for (const item of result.spared) lines.push(`SPARED ${item.session} ${item.kind}=${item.value} — ${item.note}`);
  for (const item of result.leaks) {
    lines.push(`LEAK ${item.session} ${item.kind}=${item.value}${item.note ? ` — ${item.note}` : ""}${item.cmdline ? ` [${item.cmdline}]` : ""}`);
  }
  return lines.join("\n");
}

async function main() {
  const [command = "check", ...args] = process.argv.slice(2);
  const dir = ownersDir();
  if (command === "check") {
    const result = await audit(listRecords(dir));
    console.log(report(result, dir));
    process.exitCode = result.leaks.length > 0 ? 1 : 0;
    return;
  }
  if (command === "add") {
    const [session, kind, value, extra] = args;
    const resource = addResource(dir, session, kind, value, extra);
    console.log(`Registrado ${session}: ${resource.kind}=${resource.value}`);
    return;
  }
  if (command === "release") {
    const [session, kind, value] = args;
    const changed = releaseResource(dir, session, kind, value);
    console.log(changed ? `Liberado ${session}: ${kind}=${value}` : `Sin cambio (no registrado o ya liberado): ${session} ${kind}=${value}`);
    return;
  }
  console.error("Uso: check-resource-cleanup.mjs check|add <session> <kind> <value> [extra]|release <session> <kind> <value>");
  process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
