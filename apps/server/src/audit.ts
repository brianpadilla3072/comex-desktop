import { dirname, join } from "node:path";
import { appendFile, readFile } from "node:fs/promises";
import { openworkServerDataDir } from "@openwork/paths";
import { z } from "zod";
import type { AuditEntry } from "./types.js";
import { ensureDir, exists } from "./utils.js";

/** One line of an audit `.jsonl` log. Extra keys are kept as written. */
const auditEntrySchema = z.looseObject({
  id: z.string(),
  workspaceId: z.string(),
  actor: z.looseObject({
    type: z.enum(["remote", "host"]),
    clientId: z.string().optional(),
    tokenHash: z.string().optional(),
    scope: z.enum(["owner", "collaborator", "viewer"]).optional(),
  }),
  action: z.string(),
  target: z.string(),
  summary: z.string(),
  timestamp: z.number(),
}) satisfies z.ZodType<AuditEntry>;

/** A malformed or foreign line is `null`, never a half-typed entry. */
function parseAuditLine(line: string): AuditEntry | null {
  try {
    const parsed = auditEntrySchema.safeParse(JSON.parse(line));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function resolveOpenworkDataDir(): string {
  return openworkServerDataDir();
}

export function auditLogPath(workspaceId: string): string {
  return join(resolveOpenworkDataDir(), "audit", `${workspaceId}.jsonl`);
}

export function openworkAuditLogPath(workspaceRoot: string): string {
  return join(workspaceRoot, ".openwork", "audit.jsonl");
}

export function legacyAuditLogPath(workspaceRoot: string): string {
  return join(workspaceRoot, ".opencode", "openwork", "audit.jsonl");
}

async function resolveReadableAuditPath(workspaceRoot: string, workspaceId: string): Promise<string | null> {
  const primary = auditLogPath(workspaceId);
  if (await exists(primary)) return primary;
  const local = openworkAuditLogPath(workspaceRoot);
  if (await exists(local)) return local;
  const legacy = legacyAuditLogPath(workspaceRoot);
  if (await exists(legacy)) return legacy;
  return null;
}

export async function recordAudit(workspaceRoot: string, entry: AuditEntry): Promise<void> {
  const workspaceId = entry.workspaceId?.trim();
  if (!workspaceId) {
    const path = openworkAuditLogPath(workspaceRoot);
    await ensureDir(dirname(path));
    await appendFile(path, JSON.stringify(entry) + "\n", "utf8");
    return;
  }

  const path = auditLogPath(workspaceId);
  await ensureDir(dirname(path));
  await appendFile(path, JSON.stringify(entry) + "\n", "utf8");
}

export async function readLastAudit(workspaceRoot: string, workspaceId: string): Promise<AuditEntry | null> {
  const path = await resolveReadableAuditPath(workspaceRoot, workspaceId);
  if (!path) return null;
  const content = await readFile(path, "utf8");
  const lines = content.trim().split("\n");
  const last = lines[lines.length - 1];
  if (!last) return null;
  return parseAuditLine(last);
}

export async function readAuditEntries(
  workspaceRoot: string,
  workspaceId: string,
  limit = 50,
): Promise<AuditEntry[]> {
  const path = await resolveReadableAuditPath(workspaceRoot, workspaceId);
  if (!path) return [];
  const content = await readFile(path, "utf8");
  const rawLines = content.trim().split("\n").filter(Boolean);
  if (!rawLines.length) return [];
  const slice = rawLines.slice(-Math.max(1, limit));
  const entries: AuditEntry[] = [];
  for (let i = slice.length - 1; i >= 0; i -= 1) {
    const entry = parseAuditLine(slice[i]);
    if (entry) entries.push(entry); // a malformed entry is skipped
  }
  return entries;
}
