import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** `opencode --version` → "1.18.33" (or null when it cannot run). */
export function binaryVersion(bin, run = spawnSync) {
  const result = run(bin, ["--version"], { encoding: "utf8", timeout: 10_000 });
  if (result.error || result.status !== 0) return null;
  return String(result.stdout ?? "").trim().replace(/^opencode\s+/i, "").replace(/^v/, "") || null;
}

/**
 * The OpenCode binary for engine v1, which the OpenWork server boots first.
 * Order: OPENWORK_OPENCODE_BIN, then `opencode` on PATH when it is v1, then the
 * desktop sidecar of this checkout. Returns null when none is v1.
 */
export function pickOpencodeV1Bin({ env, repoRoot, run = spawnSync }) {
  if (env.OPENWORK_OPENCODE_BIN?.trim()) return { bin: env.OPENWORK_OPENCODE_BIN.trim(), version: binaryVersion(env.OPENWORK_OPENCODE_BIN.trim(), run), source: "env" };
  const sidecar = join(repoRoot, "apps", "desktop", "resources", "sidecars", process.platform === "win32" ? "opencode.exe" : "opencode");
  for (const [bin, source] of [["opencode", "path"], [sidecar, "sidecar"]]) {
    if (source === "sidecar" && !existsSync(bin)) continue;
    const version = binaryVersion(bin, run);
    if (version?.startsWith("1.")) return { bin, version, source };
  }
  return null;
}

/** True when the SQLite file was created by OpenCode v2 (session_v2 without the v1 session table). */
export function isV2OnlyDatabase(path) {
  if (!existsSync(path)) return false;
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const tables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => String(row.name)));
    return tables.has("session_v2") && !tables.has("session");
  } finally {
    database.close();
  }
}
