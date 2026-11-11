import { chmod } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { openworkConfigDir } from "@openwork/paths";
import type { Database as BunDatabase } from "bun:sqlite";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type { DatabaseSync } from "node:sqlite";
import type { ServerConfig } from "./types.js";
import { ensureDir } from "./utils.js";

export type RuntimeBunSqliteDatabase = {
  kind: "bun";
  sqlite: BunDatabase;
  db: BunSQLiteDatabase;
  close: () => void;
};

export type RuntimeNodeSqliteDatabase = {
  kind: "node";
  sqlite: DatabaseSync;
  close: () => void;
};

export type RuntimeSqliteDatabase = RuntimeBunSqliteDatabase | RuntimeNodeSqliteDatabase;

/**
 * Kept opaque so Bun's loader never eagerly pre-resolves the Node-only
 * builtin (Bun lacks node:sqlite and its speculative resolution can surface
 * as an unhandled rejection even though the guarded branch never runs).
 */
export const NODE_SQLITE_SPECIFIER = "node:sqlite";

export function importNodeSqlite(): Promise<typeof import("node:sqlite")> {
  return import(NODE_SQLITE_SPECIFIER);
}

export function runtimeDbPath(config: Pick<ServerConfig, "configPath">): string {
  // An explicit config path always wins: it is the caller's statement about where this server's
  // state lives. The environment override exists for hosts that start the server without a
  // config file. Letting the override hijack an explicit path made every store that honoured
  // configPath collide with an unrelated override (tests running in one process proved it).
  const configPath = config.configPath?.trim();
  if (configPath) return join(dirname(configPath), "runtime.sqlite");
  const override = process.env.OPENWORK_RUNTIME_DB?.trim();
  if (override) return resolve(override);
  return join(openworkConfigDir(), "runtime.sqlite");
}

/** Directory holding runtime state (the SQLite DB and derived files). */
export function runtimeStorageDir(config: Pick<ServerConfig, "configPath">): string {
  return dirname(runtimeDbPath(config));
}

export async function openRuntimeSqliteDatabase(path: string): Promise<RuntimeSqliteDatabase> {
  await ensureDir(dirname(path));
  if (typeof process.versions.bun === "string") {
    const { Database } = await import("bun:sqlite");
    const { drizzle } = await import("drizzle-orm/bun-sqlite");
    const sqlite = new Database(path, { create: true });
    try { await chmod(path, 0o600); } catch (error) { sqlite.close(); throw error; }
    sqlite.exec("PRAGMA journal_mode=WAL");
    sqlite.exec("PRAGMA busy_timeout=5000");
    return {
      kind: "bun",
      sqlite,
      db: drizzle(sqlite),
      close: () => sqlite.close(),
    };
  }

  const { DatabaseSync } = await importNodeSqlite();
  const sqlite = new DatabaseSync(path);
  try { await chmod(path, 0o600); } catch (error) { sqlite.close(); throw error; }
  sqlite.exec("PRAGMA journal_mode=WAL");
  sqlite.exec("PRAGMA busy_timeout=5000");
  return {
    kind: "node",
    sqlite,
    close: () => sqlite.close(),
  };
}
