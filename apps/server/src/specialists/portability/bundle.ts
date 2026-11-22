import { copyFile, lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { ApiError } from "../../errors.js";

/** The file format of an exported specialist application. Bump a version only for breaking
 *  changes; new data goes in a new section, which older readers skip and report.
 *  v1: one JSON file with every file inlined (utf8 or base64).
 *  v2: a `.owapp` ZIP archive with `manifest.json` and real file entries (see archive.ts). */
export const BUNDLE_FORMAT = "openwork.specialist-application";
export const BUNDLE_VERSION = 1;
export const ARCHIVE_VERSION = 2;

const MB = 1024 * 1024;

/** Every portability limit, in one place. */
export const LIMITS = {
  /** Folder depth inside any section. */
  depth: 12,
  /** v1 JSON bundles: every file is held in memory as text or base64. */
  json: { files: 2_000, bytes: 50 * MB, fileBytes: 5 * MB },
  /** v2 `.owapp` archives: files stream to and from disk. */
  archive: {
    files: 10_000,
    /** Total uncompressed size of every file. */
    bytes: 200 * MB,
    fileBytes: 50 * MB,
    /** The uploaded archive itself (compressed), with room for headers and the manifest. */
    uploadBytes: 220 * MB,
    manifestBytes: 8 * MB,
    /** Uncompressed/compressed ratio allowed per entry once it is larger than `ratioFloorBytes`. */
    compressionRatio: 100,
    ratioFloorBytes: 1 * MB,
  },
} as const;

export type FileLimits = { files: number; bytes: number; fileBytes: number };

export const failure = (message: string) => new ApiError(422, "invalid_application_bundle", message);

export const megabytes = (bytes: number) => `${Math.round(bytes / MB)} MB`;

/** A relative, forward-slash path with no hidden, parent or empty segments. */
export function isBundlePath(value: string): boolean {
  if (!value || value.length > 1_024) return false;
  if (value.startsWith("/") || value.includes("\\") || value.includes("\u0000") || /^[a-zA-Z]:/.test(value)) return false;
  const segments = value.split("/");
  return segments.length <= LIMITS.depth && segments.every(segment => segment !== "" && segment !== "." && segment !== ".." && !segment.startsWith("."));
}

export const bundlePath = z.string().min(1).max(1_024).refine(isBundlePath, "Ruta no válida dentro del paquete.");

export const bundleFile = z.object({
  path: bundlePath,
  encoding: z.enum(["utf8", "base64"]),
  content: z.string(),
});
export type BundleFile = z.infer<typeof bundleFile>;

export const applicationSchema = z.object({
  name: z.string().trim().min(1).max(80),
  specialty: z.string().trim().min(1).max(500),
  personality: z.string().trim().max(8_000),
  template: z.enum(["comex", "custom"]),
});
export type BundleApplication = z.infer<typeof applicationSchema>;

export const bundleSchema = z.object({
  format: z.literal(BUNDLE_FORMAT),
  version: z.number().int().min(1),
  exportedAt: z.string().optional(),
  application: applicationSchema,
  sections: z.record(z.string(), z.unknown()),
});
export type ApplicationBundle = z.infer<typeof bundleSchema>;

export function parseBundle(value: unknown): ApplicationBundle {
  const format = z.object({ format: z.string(), version: z.number() }).safeParse(value);
  if (!format.success || format.data.format !== BUNDLE_FORMAT) throw failure("El archivo no es una aplicación exportada de OpenWork.");
  if (format.data.version > BUNDLE_VERSION) throw failure("El archivo es de una versión más nueva de la app. Actualiza la app para importarlo.");
  const parsed = bundleSchema.safeParse(value);
  if (!parsed.success) throw failure("El archivo de la aplicación está incompleto o dañado.");
  return parsed.data;
}

/** A file ready to be written on import: decoded from a v1 JSON bundle, or already extracted
 *  (and checksum-verified) from a v2 archive into a private staging folder. */
export type SourceFile =
  | { path: string; size: number; kind: "inline"; data: Buffer }
  | { path: string; size: number; kind: "staged"; file: string };

function decode(file: BundleFile): Buffer {
  return file.encoding === "base64" ? Buffer.from(file.content, "base64") : Buffer.from(file.content, "utf8");
}

export function inlineFiles(files: BundleFile[], prefix = ""): SourceFile[] {
  return files.map(file => {
    const data = decode(file);
    return { path: `${prefix}${file.path}`, size: data.byteLength, kind: "inline", data };
  });
}

/** Files under `folder/`, with that prefix removed. */
export function filesUnder<T extends { path: string }>(files: T[], folder: string): T[] {
  const prefix = `${folder}/`;
  return files.filter(file => file.path.startsWith(prefix)).map(file => ({ ...file, path: file.path.slice(prefix.length) }));
}

/** Within one folder, a path must not repeat or be both a file and a folder ("a" and "a/b"). */
export function assertNoPathConflicts(files: Array<{ path: string }>) {
  const seen = new Set<string>();
  const folders = new Set<string>();
  for (const file of files) {
    if (seen.has(file.path) || folders.has(file.path)) throw failure(`El paquete repite la ruta ${file.path}.`);
    seen.add(file.path);
    const segments = file.path.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      const folder = segments.slice(0, index).join("/");
      if (seen.has(folder)) throw failure(`El paquete usa ${folder} como archivo y como carpeta.`);
      folders.add(folder);
    }
  }
}

/** Size and count limits across every file, checked before anything is written. */
export function assertFileBudget(files: Array<{ path: string; size: number }>, limits: FileLimits) {
  let count = 0;
  let bytes = 0;
  for (const file of files) {
    count += 1;
    bytes += file.size;
    if (file.size > limits.fileBytes) throw failure(`El archivo ${file.path} supera los ${megabytes(limits.fileBytes)}.`);
    if (count > limits.files || bytes > limits.bytes) throw failure(`La aplicación supera los límites (${limits.files.toLocaleString("es")} archivos / ${megabytes(limits.bytes)}).`);
  }
}

function encode(path: string, data: Buffer): BundleFile {
  const text = data.toString("utf8");
  // Keep text readable in the JSON; anything that does not round-trip as UTF-8 travels as base64.
  return Buffer.from(text, "utf8").equals(data) && !text.includes("\u0000")
    ? { path, encoding: "utf8", content: text }
    : { path, encoding: "base64", content: data.toString("base64") };
}

/** A regular file found on disk for export: `path` is relative to the walked root. */
export type TreeFile = { path: string; source: string; size: number };

export type TreeOptions = {
  limits: FileLimits;
  /** Skip a folder (relative path) entirely. Hidden entries and symlinks are always skipped. */
  skipFolder?: (path: string) => boolean;
  /** Called for a file over the per-file limit instead of failing the export. */
  onOversize?: (file: TreeFile) => void;
};

/** Every regular file under `root`, skipping hidden entries. Symlinks are never followed or exported. */
export async function listTree(root: string, options: TreeOptions): Promise<TreeFile[]> {
  const files: TreeFile[] = [];
  let bytes = 0;
  const { limits } = options;
  async function walk(prefix: string, depth: number) {
    if (depth >= LIMITS.depth) return;
    let entries;
    try { entries = await readdir(join(root, prefix), { withFileTypes: true }); }
    catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!isBundlePath(path)) continue;
      const source = join(root, path);
      const stat = await lstat(source);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) { if (!options.skipFolder?.(path)) await walk(path, depth + 1); continue; }
      if (!stat.isFile()) continue;
      const file = { path, source, size: stat.size };
      if (stat.size > limits.fileBytes) {
        if (options.onOversize) { options.onOversize(file); continue; }
        throw failure(`No se puede exportar ${path}: supera los ${megabytes(limits.fileBytes)}.`);
      }
      bytes += stat.size;
      if (files.length >= limits.files || bytes > limits.bytes) throw failure(`La aplicación supera los límites de exportación (${limits.files.toLocaleString("es")} archivos / ${megabytes(limits.bytes)}).`);
      files.push(file);
    }
  }
  await walk("", 0);
  return files;
}

/** v1 JSON export: every file under `root`, inlined. */
export async function readTree(root: string): Promise<BundleFile[]> {
  const files = await listTree(root, { limits: LIMITS.json });
  const result: BundleFile[] = [];
  for (const file of files) result.push(encode(file.path, await readFile(file.source)));
  return result;
}

/** Write validated files under `root`, creating folders as needed and refusing to pass through
 *  an existing symlink. Existing files are replaced. */
export async function writeTree(root: string, files: SourceFile[]) {
  for (const file of files) {
    const path = bundlePath.parse(file.path);
    let current = root;
    for (const segment of path.split("/").slice(0, -1)) {
      current = join(current, segment);
      const stat = await lstat(current).catch(() => null);
      if (stat?.isSymbolicLink()) throw failure(`La carpeta de destino de ${path} es un enlace simbólico.`);
    }
    const target = join(root, path);
    const existing = await lstat(target).catch(() => null);
    if (existing && !existing.isFile()) throw failure(`No se puede escribir ${path}: ya existe y no es un archivo.`);
    try {
      await mkdir(dirname(target), { recursive: true });
      if (file.kind === "inline") await writeFile(target, file.data, { mode: 0o600 });
      else await copyFile(file.file, target);
    } catch (error) {
      const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "error";
      throw failure(`No se pudo escribir ${path} (${code}).`);
    }
  }
}
