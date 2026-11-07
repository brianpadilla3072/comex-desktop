import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

const MAX_BYTES = 48 * 1024;
const note = z.string().trim().min(1).max(800);
export const checkpointInput = z.strictObject({
  objective: z.string().trim().max(1600),
  decisions: z.array(note).max(16),
  progress: z.array(note).max(16),
  pending: z.array(note).max(16),
  artifacts: z.array(z.strictObject({ path: note, evidence: note })).max(16),
});
const storedCheckpoint = checkpointInput.extend({
  version: z.literal(1), revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  sessionId: z.string(), updatedAt: z.iso.datetime(),
});
export type CheckpointInput = z.infer<typeof checkpointInput>;
export type Checkpoint = z.infer<typeof storedCheckpoint>;
export type CheckpointRead = { status: "missing" | "invalid"; revision: 0; checkpoint: null } | { status: "ready"; revision: number; checkpoint: Checkpoint };

export class ContinuityError extends Error {
  constructor(public readonly code: "conflict" | "invalid" | "unsafe_path" | "busy", message: string) { super(message); }
}

/** Defense in depth for common credentials; this is not a general PII classifier. */
export function redactMemorySecrets(text: string): string {
  return text
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, "[secreto omitido]")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|AKIA[A-Z0-9]{16})\b/g, "[secreto omitido]")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, "$1 [secreto omitido]")
    .replace(/\b((?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|contraseña|secret)["']?\s*[:=]\s*)(?:\[secreto omitido\]|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;]+)/gi, "$1[secreto omitido]")
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[credenciales omitidas]@");
}

export function checkpointPath(sessionId: string): string {
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(sessionId)) throw new ContinuityError("invalid", "Identificador de sesión inválido.");
  return `comex/sesiones/${sessionId}.checkpoint.json`;
}

function cleanInput(input: CheckpointInput): CheckpointInput {
  return {
    objective: redactMemorySecrets(input.objective),
    decisions: input.decisions.map(redactMemorySecrets), progress: input.progress.map(redactMemorySecrets),
    pending: input.pending.map(redactMemorySecrets),
    artifacts: input.artifacts.map(item => ({ path: redactMemorySecrets(item.path), evidence: redactMemorySecrets(item.evidence) })),
  };
}

async function safeTarget(root: string, sessionId: string): Promise<string> {
  const canonical = await realpath(root);
  const parts = checkpointPath(sessionId).split("/");
  let target = canonical;
  for (const part of parts) {
    target = join(target, part);
    const entry = await lstat(target).catch(error => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (entry?.isSymbolicLink()) throw new ContinuityError("unsafe_path", "La continuidad no acepta enlaces simbólicos.");
  }
  return target;
}

export async function readComexCheckpoint(root: string, sessionId: string): Promise<CheckpointRead> {
  const path = await safeTarget(root, sessionId);
  const entry = await lstat(path).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  if (entry && !entry.isFile()) return { status: "invalid", revision: 0, checkpoint: null };
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(error => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!handle) return { status: "missing", revision: 0, checkpoint: null };
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_BYTES) return { status: "invalid", revision: 0, checkpoint: null };
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_BYTES) return { status: "invalid", revision: 0, checkpoint: null };
    const parsed = storedCheckpoint.safeParse(JSON.parse(buffer.subarray(0, bytesRead).toString("utf8")));
    if (!parsed.success || parsed.data.sessionId !== sessionId) return { status: "invalid", revision: 0, checkpoint: null };
    // Redact again on read, including files changed by another program.
    const checkpoint = { ...parsed.data, ...cleanInput(parsed.data) };
    return { status: "ready", revision: checkpoint.revision, checkpoint };
  } catch (error) {
    if (error instanceof SyntaxError) return { status: "invalid", revision: 0, checkpoint: null };
    throw error;
  } finally { await handle.close(); }
}

/** Revision compare-and-swap and an exclusive cross-process lock prevent lost
 * updates. A crash leaves a lock that must be inspected/removed by the host;
 * never steal a lock based on its age while a slow writer may still own it. */
export async function writeComexCheckpoint(root: string, sessionId: string, input: unknown, expectedRevision: number): Promise<Checkpoint> {
  const parsed = checkpointInput.safeParse(input);
  if (!parsed.success || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new ContinuityError("invalid", "Checkpoint o revisión inválidos.");
  const target = await safeTarget(root, sessionId);
  await mkdir(dirname(target), { recursive: true });
  await safeTarget(root, sessionId);
  const lockPath = `${target}.lock`;
  const lock = await open(lockPath, "wx", 0o600).catch(error => {
    if (error.code === "EEXIST") throw new ContinuityError("busy", "Hay otro guardado en curso. Volvé a leer antes de reintentar.");
    throw error;
  });
  const temp = `${target}.${randomUUID()}.tmp`;
  try {
    const previous = await readComexCheckpoint(root, sessionId);
    if (previous.status === "invalid") throw new ContinuityError("invalid", "El checkpoint existente es inválido; conservado para recuperación manual.");
    if (previous.revision !== expectedRevision) throw new ContinuityError("conflict", "La memoria cambió. Volvé a leer y reconciliá las decisiones antes de guardar.");
    const clean = checkpointInput.safeParse(cleanInput(parsed.data));
    if (!clean.success || expectedRevision === Number.MAX_SAFE_INTEGER) throw new ContinuityError("invalid", "Resumí las notas antes de guardar; se alcanzó un límite del checkpoint.");
    const checkpoint = storedCheckpoint.parse({ ...clean.data, version: 1, revision: expectedRevision + 1, sessionId, updatedAt: new Date().toISOString() });
    const encoded = JSON.stringify(checkpoint, null, 2) + "\n";
    if (Buffer.byteLength(encoded) > MAX_BYTES) throw new ContinuityError("invalid", "El checkpoint supera el límite de memoria. Resumí los avances.");
    const file = await open(temp, "wx", 0o600);
    try { await file.writeFile(encoded); await file.sync(); } finally { await file.close(); }
    await safeTarget(root, sessionId);
    await rename(temp, target);
    return checkpoint;
  } finally {
    await rm(temp, { force: true });
    await lock.close();
    await rm(lockPath, { force: true });
  }
}
