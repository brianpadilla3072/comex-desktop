import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const STATE_ROOT = join(REPO_ROOT, "tmp", "dev-agent");

const NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;

export function sessionName(value = "default") {
  if (!NAME.test(value)) throw new Error(`Session names use lowercase letters, digits and dashes (got "${value}").`);
  return value;
}

export const sessionDir = name => join(STATE_ROOT, sessionName(name));
const sessionFile = name => join(sessionDir(name), "session.json");

/** Electron dev profiles are `com.differentai.openwork.dev.<profile>` under the user config dir. */
export function electronProfileDir(profile) {
  const config = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), process.platform === "darwin" ? "Library/Application Support" : ".config");
  return join(config, `com.differentai.openwork.dev.${profile}`);
}

export function readSession(name) {
  const file = sessionFile(name);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8"));
}

export function writeSession(name, value) {
  mkdirSync(sessionDir(name), { recursive: true });
  writeFileSync(sessionFile(name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

export function removeSessionDir(name) {
  rmSync(sessionDir(name), { recursive: true, force: true });
}

export function listSessions() {
  if (!existsSync(STATE_ROOT)) return [];
  return readdirSync(STATE_ROOT).filter(name => NAME.test(name) && existsSync(sessionFile(name))).map(name => readSession(name));
}

/** The CDP address printed by the desktop dev banner or by `pnpm world up`. */
export function parseCdpUrl(text) {
  return text.match(/cdp[=\s]+(http:\/\/127\.0\.0\.1:\d+)/)?.[1] ?? null;
}

export function parseWebUrl(text) {
  return text.match(/webUrl\s+(http:\/\/[^\s]+)/)?.[1] ?? null;
}

export function processAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** Stop a detached process group we started; never touches other processes. */
export async function stopGroup(pid, { graceMs = 8_000 } = {}) {
  if (!processAlive(pid)) return "not running";
  try { process.kill(-pid, "SIGTERM"); } catch { try { process.kill(pid, "SIGTERM"); } catch {} }
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!processAlive(pid)) return "stopped";
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  try { process.kill(-pid, "SIGKILL"); } catch { try { process.kill(pid, "SIGKILL"); } catch {} }
  return "killed";
}

/** Environment for an isolated Electron dev session. Shells inside VS Code (and other Electron
 *  hosts) export ELECTRON_RUN_AS_NODE=1, which makes the electron binary run as plain Node
 *  ("bad option: --no-sandbox") so the session never starts: it is always removed. */
export function electronSessionEnv(baseEnv, offlineEnv, profile) {
  const env = {
    ...baseEnv, ...offlineEnv, OPENWORK_DEV_MODE: "1", OPENWORK_DEV_PROFILE: profile, OPENWORK_ELECTRON_USE_MOCK_KEYCHAIN: "1",
    OPENWORK_ELECTRON_REMOTE_DEBUG_PORT: "0", PORT: "0",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}
