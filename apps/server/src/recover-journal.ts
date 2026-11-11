import { createHash } from "node:crypto";
import type { z } from "zod";
import { createWorkspaceKvStore } from "./workspace-kv-store.js";
import type { ServerConfig } from "./types.js";

const quarantine = createWorkspaceKvStore<string>({ tableName: "recovery_quarantine", valueColumn: "raw_json", parse: value => value, serialize: value => value });

export function parseRecoveryJournal<T>(json: string, schema: z.ZodType<T>, limit = 1000) {
  let input: unknown;
  try { input = JSON.parse(json); } catch { return { records: [], rejected: 1 }; }
  if (!Array.isArray(input)) return { records: [], rejected: 1 };
  const records: T[] = [];
  let rejected = 0;
  for (const row of input) {
    const parsed = schema.safeParse(row);
    if (parsed.success && records.length < limit) records.push(parsed.data);
    else rejected++;
  }
  return { records, rejected };
}

/** Preserve the exact original privately, including unknown schema versions. Never logs raw errors. */
export async function recoverJournal<T>(config: ServerConfig, name: string, json: string | undefined, schema: z.ZodType<T>) {
  if (json === undefined) return [];
  const parsed = parseRecoveryJournal(json, schema);
  if (parsed.rejected && !config.readOnly) {
    const id = `${name}:${createHash("sha256").update(json).digest("hex")}`;
    await quarantine.set(config, id, json);
    console.warn(`[recovery] ${name}: ${parsed.rejected} incompatible entries preserved in local quarantine.`);
  }
  return parsed.records;
}
