import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { ApiError } from "../../errors.js";
import { createGitWorktree, removeReviewedGitWorktree, reviewGitWorkspace } from "../../comex/git.js";
import { specialistDirectory } from "../store.js";
import type { ServerConfig } from "../../types.js";
import {
  ABSENT, ISOLATION_LIMITS, TEMPORARY_PREFIX, classifyChange, fileTypeLabel, isDiffableText,
  isExcludedDirectory, isExcludedPath, lineDiff, relativePathProblem, sameState, diffHunkSchema,
  type FileState,
} from "./core.js";

/** Isolated working copies for specialist tasks and conversations, and the per-file review that
 *  brings their changes back (docs/features/task-isolation-review).
 *
 *  On disk, per application: `<specialists>/<appId>/isolations/<isoId>/`
 *    - `record.json`  isolationRecordSchema (version 1)
 *    - `base.json`    baseManifestSchema: every copied file as it was when the copy was made
 *    - `copy/`        the snapshot copy (folders that are not git repositories), or
 *    - `comex-worktrees/<hash>/<uuid>/` a detached git worktree of the project's HEAD. */

const isolationId = z.string().regex(/^iso_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
export const isIsolationId = (value: string) => isolationId.safeParse(value).success;

export const isolationOriginSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("task_run"), taskId: z.string(), runAt: z.number().int() }),
  z.object({ kind: z.literal("session"), sessionId: z.string() }),
]);
export type IsolationOrigin = z.infer<typeof isolationOriginSchema>;

export const isolationRecordSchema = z.object({
  version: z.literal(1),
  id: isolationId,
  applicationId: z.string(),
  workspaceId: z.string(),
  projectRoot: z.string(),
  mode: z.enum(["git", "snapshot"]),
  copyPath: z.string(),
  gitHead: z.string().nullable(),
  origin: isolationOriginSchema,
  /** The engine session working in the copy, once known. */
  sessionId: z.string().nullable(),
  status: z.enum(["active", "closed"]),
  createdAt: z.number().int(),
  closedAt: z.number().int().nullable(),
  /** Paths already reviewed; they leave the change list. */
  resolved: z.record(z.string(), z.enum(["accepted", "discarded"])),
});
export type IsolationRecord = z.infer<typeof isolationRecordSchema>;

const manifestEntrySchema = z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), size: z.number().int().nonnegative(), mtimeMs: z.number() });
export const baseManifestSchema = z.object({ version: z.literal(1), files: z.record(z.string(), manifestEntrySchema) });
type BaseManifest = z.infer<typeof baseManifestSchema>;

export const changeSchema = z.object({
  path: z.string(),
  change: z.enum(["added", "modified", "deleted"]),
  /** "text" when both sides can be shown as a line diff. */
  kind: z.enum(["text", "binary"]),
  type: z.string(),
  size: z.number().int().nullable(),
  baseSize: z.number().int().nullable(),
  conflict: z.boolean(),
  alreadyApplied: z.boolean(),
});
export type IsolationChange = z.infer<typeof changeSchema>;

export const fileDiffSchema = z.object({
  path: z.string(),
  change: z.enum(["added", "modified", "deleted"]),
  kind: z.enum(["text", "binary"]),
  type: z.string(),
  conflict: z.boolean(),
  /** Compared against the project file as it is now (the base, unless it conflicts). */
  before: z.object({ size: z.number().int().nullable(), sha256: z.string().nullable() }),
  after: z.object({ size: z.number().int().nullable(), sha256: z.string().nullable() }),
  hunks: z.array(diffHunkSchema),
  truncated: z.boolean(),
});

const failure = (status: number, code: string, message: string, details?: unknown) => new ApiError(status, code, message, details);
const isolationsDirectory = (config: Pick<ServerConfig, "configPath">, applicationId: string) => join(specialistDirectory(config), applicationId, "isolations");
const isolationDirectory = (config: Pick<ServerConfig, "configPath">, applicationId: string, id: string) => {
  if (!isIsolationId(id)) throw failure(404, "task_isolation_not_found", "Esa copia aislada ya no está.");
  return join(isolationsDirectory(config, applicationId), id);
};

// Owner: this module. Lifetime: the server process. One promise chain per isolation id so a
// review action never interleaves with another on the same copy (R7).
const chains = new Map<string, Promise<unknown>>();
function serialize<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve();
  const current = previous.then(work, work);
  const settled = current.then(() => undefined, () => undefined);
  chains.set(key, settled);
  void settled.then(() => { if (chains.get(key) === settled) chains.delete(key); });
  return current;
}

async function writeJsonAtomic(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(temporary, path);
}

async function readJsonFile(path: string): Promise<unknown> {
  const text = await readFile(path, "utf8");
  return z.unknown().parse(JSON.parse(text));
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on("data", chunk => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve());
  });
  return hash.digest("hex");
}

type WalkedFile = { size: number; mtimeMs: number };
/** Regular files under `root`, as forward-slash relative paths. Never follows links; skips the
 *  excluded folders and files; stops with 413 past the limits. */
async function walkFiles(root: string, options: { enforceSize: boolean }): Promise<Map<string, WalkedFile>> {
  const files = new Map<string, WalkedFile>();
  let total = 0;
  const pending: string[] = [""];
  while (pending.length) {
    const relative = pending.pop() ?? "";
    const entries = await readdir(relative ? join(root, relative) : root, { withFileTypes: true });
    for (const entry of entries) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { if (!isExcludedDirectory(path)) pending.push(path); continue; }
      if (!entry.isFile() || isExcludedPath(path) || relativePathProblem(path)) continue;
      const info = await lstat(join(root, path));
      if (!info.isFile()) continue;
      if (files.size >= ISOLATION_LIMITS.maxFiles) throw failure(413, "task_isolation_too_large", `El proyecto tiene más de ${ISOLATION_LIMITS.maxFiles} archivos; no se puede aislar.`);
      if (options.enforceSize) {
        if (info.size > ISOLATION_LIMITS.maxFileBytes) throw failure(413, "task_isolation_too_large", `«${path}» es demasiado grande para copiarlo en un trabajo aislado.`);
        total += info.size;
        if (total > ISOLATION_LIMITS.maxTotalBytes) throw failure(413, "task_isolation_too_large", "El proyecto ocupa demasiado espacio para copiarlo en un trabajo aislado.");
      }
      files.set(path, { size: info.size, mtimeMs: info.mtimeMs });
    }
  }
  return files;
}

/** Walk every folder from `root` to `relative`'s parent without following links. Returns the
 *  absolute path, or null when a parent is missing. `create` makes missing folders. */
async function safeTarget(root: string, relative: string, create: boolean): Promise<string | null> {
  const segments = relative.split("/");
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    current = join(current, segment);
    const info = await lstat(current).catch(() => null);
    if (!info) {
      if (!create) return null;
      await mkdir(current);
      continue;
    }
    if (info.isSymbolicLink() || !info.isDirectory()) throw failure(409, "task_isolation_unsafe_path", `«${relative}» pasa por un enlace o un archivo; no se modifica.`);
  }
  return join(current, segments[segments.length - 1] ?? "");
}

async function fileState(root: string, relative: string): Promise<FileState> {
  let target: string | null;
  try { target = await safeTarget(root, relative, false); }
  catch { return { kind: "other" }; }
  if (!target) return ABSENT;
  const info = await lstat(target).catch(() => null);
  if (!info) return ABSENT;
  if (!info.isFile() || info.isSymbolicLink()) return { kind: "other" };
  return { kind: "file", sha256: await sha256File(target), size: info.size };
}

async function buildManifest(root: string): Promise<BaseManifest> {
  const files: BaseManifest["files"] = {};
  for (const [path, info] of await walkFiles(root, { enforceSize: false })) {
    files[path] = { sha256: await sha256File(join(root, path)), size: info.size, mtimeMs: info.mtimeMs };
  }
  return { version: 1, files };
}

async function snapshotCopy(source: string, target: string) {
  const files = await walkFiles(source, { enforceSize: true });
  await mkdir(target, { recursive: true, mode: 0o700 });
  for (const path of [...files.keys()].sort()) {
    const destination = await safeTarget(target, path, true);
    if (!destination) continue;
    // Reflink where the file system supports it (copy-on-write), a plain copy elsewhere.
    await copyFile(join(source, path), destination, constants.COPYFILE_FICLONE | constants.COPYFILE_EXCL);
  }
}

/** A git worktree is a faithful base only for a repository root with a commit and no pending
 *  changes; any other folder gets a snapshot copy. */
async function gitBase(root: string): Promise<string | null> {
  try {
    const review = await reviewGitWorkspace(root);
    if (!review.head || review.status.length) return null;
    if (await realpath(review.root) !== root) return null;
    return review.head;
  } catch { return null; }
}

export async function readIsolation(config: Pick<ServerConfig, "configPath">, applicationId: string, id: string): Promise<IsolationRecord> {
  const path = join(isolationDirectory(config, applicationId, id), "record.json");
  let value: unknown;
  try { value = await readJsonFile(path); }
  catch { throw failure(404, "task_isolation_not_found", "Esa copia aislada ya no está."); }
  const parsed = isolationRecordSchema.safeParse(value);
  if (!parsed.success || parsed.data.applicationId !== applicationId || parsed.data.id !== id) throw failure(409, "task_isolation_unreadable", "El registro de la copia aislada está dañado.");
  return parsed.data;
}

export async function listIsolations(config: Pick<ServerConfig, "configPath">, applicationId: string): Promise<IsolationRecord[]> {
  const entries = await readdir(isolationsDirectory(config, applicationId), { withFileTypes: true }).catch(() => []);
  const records: IsolationRecord[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isIsolationId(entry.name)) continue;
    const record = await readIsolation(config, applicationId, entry.name).catch(() => null);
    if (record) records.push(record);
  }
  return records.sort((a, b) => b.createdAt - a.createdAt);
}

/** Make an isolated copy of a project for a task run or a conversation. */
export async function createIsolation(config: Pick<ServerConfig, "configPath">, input: {
  applicationId: string; workspaceId: string; projectRoot: string; origin: IsolationOrigin; sessionId?: string | null;
}): Promise<IsolationRecord> {
  if (!config.configPath) throw failure(503, "task_isolation_unavailable", "No hay una carpeta de configuración para guardar la copia aislada.");
  const root = await realpath(input.projectRoot).catch(() => null);
  const rootInfo = root ? await lstat(root).catch(() => null) : null;
  if (!root || !rootInfo?.isDirectory()) throw failure(404, "task_isolation_project_missing", "La carpeta del proyecto no existe.");
  const active = (await listIsolations(config, input.applicationId)).filter(record => record.status === "active");
  if (active.length >= ISOLATION_LIMITS.maxActive) throw failure(409, "task_isolation_limit", `Ya hay ${ISOLATION_LIMITS.maxActive} copias aisladas pendientes de revisión en esta aplicación. Revisa alguna antes de crear otra.`);
  const id = `iso_${randomUUID()}`;
  const parent = isolationsDirectory(config, input.applicationId);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const directory = join(await realpath(parent), id);
  await mkdir(directory, { mode: 0o700 });
  try {
    const head = await gitBase(root);
    let copyPath: string;
    if (head) copyPath = (await createGitWorktree(root, directory, head)).path;
    else { copyPath = join(directory, "copy"); await snapshotCopy(root, copyPath); }
    const manifest = await buildManifest(copyPath);
    await writeJsonAtomic(join(directory, "base.json"), manifest);
    const record: IsolationRecord = {
      version: 1, id, applicationId: input.applicationId, workspaceId: input.workspaceId, projectRoot: root,
      mode: head ? "git" : "snapshot", copyPath, gitHead: head, origin: input.origin, sessionId: input.sessionId ?? null,
      status: "active", createdAt: Date.now(), closedAt: null, resolved: {},
    };
    await writeJsonAtomic(join(directory, "record.json"), record);
    return record;
  } catch (error) {
    await removeCopy({ directory, projectRoot: root }).catch(() => undefined);
    throw error;
  }
}

/** Undo a failed creation: unregister any worktree it added, then remove its folder. */
async function removeCopy(input: { directory: string; projectRoot: string }) {
  const worktrees = join(input.directory, "comex-worktrees");
  for (const hashed of await readdir(worktrees).catch(() => [])) {
    for (const leaf of await readdir(join(worktrees, hashed)).catch(() => [])) await removeReviewedGitWorktree(input.projectRoot, join(worktrees, hashed, leaf)).catch(() => undefined);
  }
  await rm(input.directory, { recursive: true, force: true });
}

type Evaluated = IsolationChange & { base: FileState; copy: FileState; project: FileState };

async function readManifest(config: Pick<ServerConfig, "configPath">, record: IsolationRecord): Promise<BaseManifest> {
  try { return baseManifestSchema.parse(await readJsonFile(join(isolationDirectory(config, record.applicationId, record.id), "base.json"))); }
  catch { throw failure(409, "task_isolation_unreadable", "La base de la copia aislada está dañada; descártala."); }
}

/** The change set: every file that differs between the base and the copy, minus the paths
 *  already reviewed, each compared with the project as it is now. */
async function evaluate(config: Pick<ServerConfig, "configPath">, record: IsolationRecord): Promise<Evaluated[]> {
  if (record.status !== "active") return [];
  const manifest = await readManifest(config, record);
  const current = await walkFiles(record.copyPath, { enforceSize: false }).catch(error => {
    if (error instanceof ApiError) throw error;
    throw failure(409, "task_isolation_copy_missing", "La copia aislada ya no está en el disco; descártala.");
  });
  const paths = new Set([...Object.keys(manifest.files), ...current.keys()]);
  const changes: Evaluated[] = [];
  for (const path of [...paths].sort()) {
    if (record.resolved[path]) continue;
    const baseEntry = manifest.files[path];
    const copyEntry = current.get(path);
    const base: FileState = baseEntry ? { kind: "file", sha256: baseEntry.sha256, size: baseEntry.size } : ABSENT;
    // Unchanged size and modification time: the copy still holds the base bytes.
    if (baseEntry && copyEntry && baseEntry.size === copyEntry.size && baseEntry.mtimeMs === copyEntry.mtimeMs) continue;
    const copy: FileState = copyEntry ? await fileState(record.copyPath, path) : ABSENT;
    if (sameState(base, copy)) continue;
    const project = await fileState(record.projectRoot, path);
    const classified = classifyChange(base, copy, project);
    if (!classified.change) continue;
    const textual = await bothTextual(record, path, copy, project);
    changes.push({
      path, change: classified.change, kind: textual ? "text" : "binary", type: fileTypeLabel(path),
      size: copy.kind === "file" ? copy.size : null, baseSize: base.kind === "file" ? base.size : null,
      conflict: classified.conflict, alreadyApplied: classified.alreadyApplied, base, copy, project,
    });
  }
  return changes;
}

async function readSide(root: string, path: string, state: FileState): Promise<Uint8Array | null> {
  if (state.kind !== "file") return new Uint8Array();
  if (state.size > ISOLATION_LIMITS.maxDiffBytes) return null;
  const target = await safeTarget(root, path, false).catch(() => null);
  if (!target) return null;
  return readFile(target).catch(() => null);
}

async function bothTextual(record: IsolationRecord, path: string, copy: FileState, project: FileState): Promise<boolean> {
  for (const [root, state] of [[record.copyPath, copy], [record.projectRoot, project]] as const) {
    if (state.kind === "other") return false;
    const bytes = await readSide(root, path, state);
    if (!bytes || !isDiffableText(bytes)) return false;
  }
  return true;
}

const publicChange = (change: Evaluated): IsolationChange => changeSchema.parse({ ...change });

export async function isolationChanges(config: Pick<ServerConfig, "configPath">, record: IsolationRecord): Promise<IsolationChange[]> {
  return (await evaluate(config, record)).map(publicChange);
}

function requirePath(path: string): string {
  const problem = relativePathProblem(path);
  if (problem) throw failure(422, "task_isolation_invalid_path", "Ruta inválida.", { path, problem });
  return path;
}

export async function isolationFileDiff(config: Pick<ServerConfig, "configPath">, record: IsolationRecord, path: string) {
  requirePath(path);
  const change = (await evaluate(config, record)).find(entry => entry.path === path);
  if (!change) throw failure(404, "task_isolation_path_unknown", "Ese archivo no tiene cambios pendientes.");
  const side = (state: FileState) => ({ size: state.kind === "file" ? state.size : null, sha256: state.kind === "file" ? state.sha256 : null });
  let hunks: z.infer<typeof diffHunkSchema>[] = [];
  let truncated = false;
  if (change.kind === "text") {
    const decoder = new TextDecoder("utf-8");
    const before = await readSide(record.projectRoot, path, change.project);
    const after = await readSide(record.copyPath, path, change.copy);
    const diff = lineDiff(decoder.decode(before ?? new Uint8Array()), decoder.decode(after ?? new Uint8Array()));
    hunks = diff.hunks; truncated = diff.truncated;
  }
  return fileDiffSchema.parse({
    path, change: change.change, kind: change.kind, type: change.type, conflict: change.conflict,
    before: side(change.project), after: side(change.copy), hunks, truncated,
  });
}

function requestedPaths(record: IsolationRecord, changes: Evaluated[], paths: string[]): Evaluated[] {
  const byPath = new Map(changes.map(change => [change.path, change]));
  return [...new Set(paths)].map(path => {
    requirePath(path);
    const change = byPath.get(path);
    if (!change) throw failure(404, "task_isolation_path_unknown", "Ese archivo no tiene cambios pendientes.", { path, isolation: record.id });
    return change;
  });
}

async function saveRecord(config: Pick<ServerConfig, "configPath">, record: IsolationRecord) {
  await writeJsonAtomic(join(isolationDirectory(config, record.applicationId, record.id), "record.json"), isolationRecordSchema.parse(record));
}

/** Write one accepted file into the project: temp file next to the target, re-check, rename. */
async function applyOne(record: IsolationRecord, change: Evaluated, overwrite: boolean) {
  const project = await fileState(record.projectRoot, change.path);
  if (sameState(project, change.copy)) return;
  if (!overwrite && !sameState(project, change.base)) throw failure(409, "task_isolation_conflict", "El archivo cambió en el proyecto mientras lo revisabas.", { conflicts: [change.path] });
  if (project.kind === "other") throw failure(409, "task_isolation_unsafe_path", `«${change.path}» no es un archivo común en el proyecto; no se modifica.`);
  if (change.copy.kind === "absent") {
    const target = await safeTarget(record.projectRoot, change.path, false);
    if (target) await rm(target, { force: true });
    return;
  }
  const source = await safeTarget(record.copyPath, change.path, false);
  const sourceInfo = source ? await lstat(source).catch(() => null) : null;
  if (!source || !sourceInfo?.isFile()) throw failure(409, "task_isolation_copy_changed", `«${change.path}» cambió en la copia; actualiza la revisión.`);
  const target = await safeTarget(record.projectRoot, change.path, true);
  if (!target) throw failure(409, "task_isolation_unsafe_path", `No se pudo preparar la carpeta de «${change.path}».`);
  const temporary = join(dirname(target), `${TEMPORARY_PREFIX}${randomUUID()}.tmp`);
  try {
    await copyFile(source, temporary, constants.COPYFILE_EXCL);
    if (change.copy.kind === "file" && await sha256File(temporary) !== change.copy.sha256) throw failure(409, "task_isolation_copy_changed", `«${change.path}» cambió en la copia; actualiza la revisión.`);
    const latest = await fileState(record.projectRoot, change.path);
    if (!sameState(latest, project)) throw failure(409, "task_isolation_conflict", "El archivo cambió en el proyecto mientras lo revisabas.", { conflicts: [change.path] });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export type ReviewHooks = {
  /** True while the run or conversation that owns the copy is still writing to it. */
  isBusy?: (record: IsolationRecord) => Promise<boolean>;
  /** Move the conversation back to the project before its copy is removed. */
  releaseSession?: (record: IsolationRecord) => Promise<void>;
};

async function ensureReviewable(record: IsolationRecord, hooks: ReviewHooks) {
  if (record.status !== "active") throw failure(409, "task_isolation_closed", "Esta copia aislada ya se revisó.");
  if (await hooks.isBusy?.(record)) throw failure(409, "task_isolation_busy", "La tarea sigue trabajando en la copia. Espera a que termine para revisar.");
}

/** Close when nothing is left to review and the copy belongs to a finished task run. */
async function closeIfDone(config: Pick<ServerConfig, "configPath">, record: IsolationRecord, hooks: ReviewHooks): Promise<IsolationRecord> {
  if (record.origin.kind !== "task_run") return record;
  if ((await evaluate(config, record)).length) return record;
  return close(config, record, hooks);
}

async function close(config: Pick<ServerConfig, "configPath">, record: IsolationRecord, hooks: ReviewHooks): Promise<IsolationRecord> {
  if (record.sessionId && hooks.releaseSession) {
    try { await hooks.releaseSession(record); }
    catch (error) {
      // A conversation must not keep pointing at a folder that is about to disappear.
      if (record.origin.kind === "session") throw error instanceof ApiError ? error : failure(409, "task_isolation_release_failed", "No se pudo devolver la conversación al proyecto; la copia se conserva.");
    }
  }
  const directory = isolationDirectory(config, record.applicationId, record.id);
  if (record.mode === "git") await removeReviewedGitWorktree(record.projectRoot, record.copyPath).catch(() => undefined);
  await rm(join(directory, "copy"), { recursive: true, force: true });
  await rm(join(directory, "comex-worktrees"), { recursive: true, force: true });
  await rm(join(directory, "base.json"), { force: true });
  const closed: IsolationRecord = { ...record, status: "closed", closedAt: Date.now() };
  await saveRecord(config, closed);
  return closed;
}

export function acceptIsolationFiles(config: Pick<ServerConfig, "configPath">, applicationId: string, id: string, paths: string[], options: { overwrite?: boolean } = {}, hooks: ReviewHooks = {}) {
  return serialize(id, async () => {
    let record = await readIsolation(config, applicationId, id);
    await ensureReviewable(record, hooks);
    const selected = requestedPaths(record, await evaluate(config, record), paths);
    const conflicts = selected.filter(change => change.conflict).map(change => change.path);
    // Nothing is written when any requested file conflicts: the person decides on each.
    if (conflicts.length && !options.overwrite) throw failure(409, "task_isolation_conflict", "Algunos archivos cambiaron en el proyecto desde que empezó la tarea.", { conflicts });
    const applied: string[] = [];
    try {
      for (const change of selected) {
        await applyOne(record, change, options.overwrite === true);
        record = { ...record, resolved: { ...record.resolved, [change.path]: "accepted" } };
        applied.push(change.path);
      }
    } finally {
      await saveRecord(config, record);
    }
    record = await closeIfDone(config, record, hooks);
    return { isolation: record, applied, changes: await isolationChanges(config, record) };
  });
}

export function discardIsolationFiles(config: Pick<ServerConfig, "configPath">, applicationId: string, id: string, paths: string[], hooks: ReviewHooks = {}) {
  return serialize(id, async () => {
    let record = await readIsolation(config, applicationId, id);
    await ensureReviewable(record, hooks);
    const selected = requestedPaths(record, await evaluate(config, record), paths);
    const resolved = { ...record.resolved };
    for (const change of selected) resolved[change.path] = "discarded";
    record = { ...record, resolved };
    await saveRecord(config, record);
    record = await closeIfDone(config, record, hooks);
    return { isolation: record, discarded: selected.map(change => change.path), changes: await isolationChanges(config, record) };
  });
}

/** Discard whatever is still pending and remove the copy. */
export function closeIsolation(config: Pick<ServerConfig, "configPath">, applicationId: string, id: string, hooks: ReviewHooks = {}) {
  return serialize(id, async () => {
    const record = await readIsolation(config, applicationId, id);
    await ensureReviewable(record, hooks);
    return close(config, record, hooks);
  });
}
