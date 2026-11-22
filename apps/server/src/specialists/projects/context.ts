import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { lstat, mkdir, readdir, realpath, rename, rm } from "node:fs/promises";
import { join, sep } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { PROJECT_LIMITS, projectUsagePercent, type ProjectContextEntry, type ProjectUsage } from "@openwork/types/projects";
import { ApiError } from "../../errors.js";
import { resolveSafeChildPath } from "../../routes/files.js";
import { familyLock, withFileLock } from "../file-lock.js";
import { dataRelative, ensureProjectDataDir, resolveDataDir } from "../project-data.js";
import { checkUpload, normalizeContextPath, uploadByteBudget } from "./core.js";

/**
 * A project's context area: plain files under `<data folder>/contexto/` (`proyecto/contexto/`,
 * or `comex/contexto/` in older projects). They live in the project, so the agent reads them with
 * its normal file tools, and they travel when the application is exported. Hidden names and
 * symbolic links are never listed, counted, read through or written through.
 */

export const CONTEXT_FOLDER = "contexto";
const ERRORS = {
  path_required: "Indica la ruta dentro del contexto.",
  path_invalid: "Ese nombre o ruta no se puede usar en el contexto.",
  path_hidden: "Los nombres que empiezan con punto no se pueden usar en el contexto.",
  path_too_deep: `El contexto admite hasta ${PROJECT_LIMITS.contextDepth} niveles de carpetas.`,
  name_too_long: "El nombre es demasiado largo.",
} as const;

export function contextPath(input: string, allowRoot: boolean): string {
  const result = normalizeContextPath(input, { allowRoot });
  if (!result.ok) throw new ApiError(422, `context_${result.code}`, ERRORS[result.code]);
  return result.path;
}

/** Workspace-relative folder the agent reads. */
export const contextAgentPath = (projectRoot: string) => dataRelative(projectRoot, CONTEXT_FOLDER);

const isMissing = (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT";

/** The context root, verified to be a real folder inside the project (created when asked). */
async function contextRoot(projectRoot: string, create: boolean): Promise<string | null> {
  if (create) await ensureProjectDataDir(projectRoot);
  const dataDir = join(projectRoot, resolveDataDir(projectRoot));
  const root = join(dataDir, CONTEXT_FOLDER);
  for (const folder of [dataDir, root]) {
    const info = await lstat(folder).catch(error => { if (isMissing(error)) return null; throw error; });
    if (!info) {
      if (!create) return null;
      await mkdir(folder, { recursive: false, mode: 0o700 }).catch(error => { if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error; });
      continue;
    }
    if (info.isSymbolicLink() || !info.isDirectory()) throw new ApiError(409, "context_unsafe_folder", "La carpeta de contexto del proyecto no es una carpeta local segura.");
  }
  const [realProject, realRoot] = await Promise.all([realpath(projectRoot), realpath(root)]);
  if (!realRoot.startsWith(realProject + sep)) throw new ApiError(409, "context_unsafe_folder", "La carpeta de contexto del proyecto no es una carpeta local segura.");
  return root;
}

/** Absolute path of `relative` inside the context root; every existing step must be a real entry. */
async function inside(root: string, relative: string): Promise<string> {
  if (!relative) return root;
  let current = root;
  for (const part of relative.split("/")) {
    current = join(current, part);
    const info = await lstat(current).catch(error => { if (isMissing(error)) return null; throw error; });
    if (!info) break;
    if (info.isSymbolicLink()) throw new ApiError(409, "context_unsafe_path", "Esa ruta pasa por un enlace simbólico; no se usa en el contexto.");
  }
  // The files routes' own guard (text and real-path containment) as the last word.
  return resolveSafeChildPath(root, relative);
}

type Tally = { files: number; bytes: number; folders: number };

/** Files, bytes and folders below `folder` (hidden entries and links skipped). */
async function tally(folder: string): Promise<Tally> {
  const total: Tally = { files: 0, bytes: 0, folders: 0 };
  const walk = async (path: string, depth: number) => {
    if (depth > PROJECT_LIMITS.contextDepth + 1) return;
    const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const child = join(path, entry.name);
      if (entry.isDirectory()) { total.folders += 1; await walk(child, depth + 1); }
      else if (entry.isFile()) {
        const info = await lstat(child).catch(() => null);
        if (info?.isFile()) { total.files += 1; total.bytes += info.size; }
      }
    }
  };
  await walk(folder, 1);
  return total;
}

const usageOf = (total: Pick<Tally, "files" | "bytes">): ProjectUsage => ({
  files: total.files, bytes: total.bytes,
  capacityBytes: PROJECT_LIMITS.contextBytes, capacityFiles: PROJECT_LIMITS.contextFiles,
  usedPercent: projectUsagePercent(total),
});

export async function contextUsage(projectRoot: string): Promise<ProjectUsage> {
  const root = await contextRoot(projectRoot, false);
  return usageOf(root ? await tally(root) : { files: 0, bytes: 0 });
}

async function describe(root: string, relative: string): Promise<ProjectContextEntry | null> {
  const absolute = await inside(root, relative);
  const info = await lstat(absolute).catch(error => { if (isMissing(error)) return null; throw error; });
  if (!info || info.isSymbolicLink()) return null;
  const name = relative.split("/").pop() ?? relative;
  if (info.isDirectory()) {
    const children = (await readdir(absolute, { withFileTypes: true })).filter(entry => !entry.name.startsWith(".") && !entry.isSymbolicLink() && (entry.isDirectory() || entry.isFile()));
    return { kind: "folder", name, path: relative, size: (await tally(absolute)).bytes, items: children.length, updatedAt: Math.floor(info.mtimeMs) };
  }
  if (!info.isFile()) return null;
  return { kind: "file", name, path: relative, size: info.size, items: null, updatedAt: Math.floor(info.mtimeMs) };
}

export async function listContext(projectRoot: string, input: string) {
  const path = contextPath(input, true);
  const root = await contextRoot(projectRoot, false);
  const agentPath = contextAgentPath(projectRoot);
  if (!root) {
    if (path) throw new ApiError(404, "context_not_found", "Esa carpeta del contexto no existe.");
    return { path, entries: [], usage: usageOf({ files: 0, bytes: 0 }), agentPath };
  }
  const folder = await inside(root, path);
  const info = await lstat(folder).catch(error => { if (isMissing(error)) return null; throw error; });
  if (!info?.isDirectory()) throw new ApiError(404, "context_not_found", "Esa carpeta del contexto no existe.");
  const names = (await readdir(folder, { withFileTypes: true })).filter(entry => !entry.name.startsWith(".") && !entry.isSymbolicLink()).map(entry => entry.name);
  const entries = (await Promise.all(names.map(name => describe(root, path ? `${path}/${name}` : name)))).flatMap(entry => entry ? [entry] : []);
  entries.sort((left, right) => left.kind !== right.kind ? (left.kind === "folder" ? -1 : 1) : left.name.localeCompare(right.name, "es", { sensitivity: "base" }));
  return { path, entries, usage: usageOf(await tally(root)), agentPath };
}

export async function createContextFolder(projectRoot: string, input: string) {
  const path = contextPath(input, false);
  return withFileLock(familyLock(projectRoot, CONTEXT_FOLDER), async () => {
    const root = await contextRoot(projectRoot, true);
    if (!root) throw new ApiError(409, "context_unsafe_folder", "No se pudo preparar la carpeta de contexto.");
    const total = await tally(root);
    if (total.folders >= PROJECT_LIMITS.contextFolders) throw new ApiError(409, "context_capacity_folders", `El contexto admite hasta ${PROJECT_LIMITS.contextFolders} carpetas.`);
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const parentInfo = await lstat(await inside(root, parent)).catch(() => null);
    if (!parentInfo?.isDirectory()) throw new ApiError(404, "context_not_found", "La carpeta donde quieres crearla no existe.");
    const target = await inside(root, path);
    try { await mkdir(target, { mode: 0o700 }); }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") throw new ApiError(409, "context_exists", "Ya hay un archivo o carpeta con ese nombre.");
      throw error;
    }
    return { entry: await describe(root, path), usage: usageOf(await tally(root)) };
  });
}

export async function deleteContextEntry(projectRoot: string, input: string) {
  const path = contextPath(input, false);
  return withFileLock(familyLock(projectRoot, CONTEXT_FOLDER), async () => {
    const root = await contextRoot(projectRoot, false);
    const target = root ? await inside(root, path) : null;
    const info = target ? await lstat(target).catch(() => null) : null;
    if (!root || !target || !info || info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) throw new ApiError(404, "context_not_found", "Ese archivo o carpeta ya no está.");
    await rm(target, { recursive: info.isDirectory(), force: false });
    return { entry: null, usage: usageOf(await tally(root)) };
  });
}

/**
 * Stream an upload into `folder/name`. The size is checked against the declared length first and
 * then while streaming (never more than the remaining capacity is written); the file appears
 * only once complete (temporary hidden file + rename). `replace` overwrites a file of that name.
 */
export async function uploadContextFile(projectRoot: string, input: { folder: string; name: string; replace: boolean; body: ReadableStream<Uint8Array> | null; declaredBytes: number | null; signal: AbortSignal }) {
  const folder = contextPath(input.folder, true);
  const name = contextPath(input.name, false);
  if (name.includes("/")) throw new ApiError(422, "context_path_invalid", "El nombre del archivo no puede tener carpetas; indícalas en la carpeta de destino.");
  if (!input.body) throw new ApiError(400, "context_file_required", "Falta el contenido del archivo.");
  const body = input.body;
  const path = folder ? `${folder}/${name}` : name;
  return withFileLock(familyLock(projectRoot, CONTEXT_FOLDER), async () => {
    const root = await contextRoot(projectRoot, true);
    if (!root) throw new ApiError(409, "context_unsafe_folder", "No se pudo preparar la carpeta de contexto.");
    const folderInfo = await lstat(await inside(root, folder)).catch(() => null);
    if (!folderInfo?.isDirectory()) throw new ApiError(404, "context_not_found", "La carpeta de destino no existe.");
    const target = await inside(root, path);
    const existing = await lstat(target).catch(error => { if (isMissing(error)) return null; throw error; });
    if (existing && !existing.isFile()) throw new ApiError(409, "context_exists", "Ya hay una carpeta con ese nombre.");
    if (existing && !input.replace) throw new ApiError(409, "context_exists", "Ya hay un archivo con ese nombre.");
    const replacing = existing ? existing.size : null;
    const usage = await tally(root);
    const refuse = (code: string) => new ApiError(413, code, code === "context_file_too_large"
      ? `Cada archivo puede pesar hasta ${Math.round(PROJECT_LIMITS.contextFileBytes / 1024 / 1024)} MB.`
      : code === "context_capacity_files"
        ? `El contexto del proyecto admite hasta ${PROJECT_LIMITS.contextFiles} archivos.`
        : `El archivo no entra en la capacidad del proyecto (${Math.round(PROJECT_LIMITS.contextBytes / 1024 / 1024)} MB).`);
    const declared = input.declaredBytes !== null && Number.isFinite(input.declaredBytes) && input.declaredBytes >= 0 ? input.declaredBytes : 0;
    const early = checkUpload(usage, declared, replacing);
    if (!early.ok) throw refuse(early.code);
    const budget = uploadByteBudget(usage, replacing);
    const temporary = join(await inside(root, folder), `.upload-${randomUUID()}.tmp`);
    let bytes = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.byteLength;
        if (bytes <= budget) { callback(null, chunk); return; }
        const late = checkUpload(usage, bytes, replacing);
        callback(refuse(late.ok ? "context_capacity_bytes" : late.code));
      },
    });
    // Read the body directly, as the inbox and the application import do: Readable.fromWeb drops
    // bytes from large bodies under Bun, and cancelling the body would hide the error response.
    const source = async function* () {
      for await (const chunk of body.values({ preventCancel: true })) yield chunk;
    };
    try {
      await pipeline(source, limit, createWriteStream(temporary, { flags: "wx", mode: 0o600 }), { signal: input.signal });
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      if (error instanceof ApiError) throw error;
      if (error instanceof Error && "code" in error && error.code === "ENOSPC") throw new ApiError(507, "insufficient_storage", "No hay espacio en disco para guardar el archivo.");
      throw error;
    }
    return { entry: await describe(root, path), usage: usageOf(await tally(root)) };
  });
}

/** Up to `limit` context file paths (workspace-relative), for the agent's instructions. */
export async function contextFileIndex(projectRoot: string, limit: number): Promise<{ files: string[]; total: number }> {
  const root = await contextRoot(projectRoot, false).catch(() => null);
  if (!root) return { files: [], total: 0 };
  const base = contextAgentPath(projectRoot);
  const files: string[] = [];
  let total = 0;
  const walk = async (path: string, relative: string, depth: number) => {
    if (depth > PROJECT_LIMITS.contextDepth + 1) return;
    const entries = (await readdir(path, { withFileTypes: true }).catch(() => [])).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const nextRelative = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(join(path, entry.name), nextRelative, depth + 1);
      else if (entry.isFile()) { total += 1; if (files.length < limit) files.push(`${base}/${nextRelative}`); }
    }
  };
  await walk(root, "", 1);
  return { files, total };
}
