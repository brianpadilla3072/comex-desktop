import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { ApiError } from "../../errors.js";

/** The file format of an exported specialist application. Bump VERSION only for breaking changes;
 *  new data goes in a new section, which older readers skip and report. */
export const BUNDLE_FORMAT = "openwork.specialist-application";
export const BUNDLE_VERSION = 1;

export const LIMITS = { files: 2_000, bytes: 50 * 1024 * 1024, fileBytes: 5 * 1024 * 1024, depth: 12 } as const;

export const failure = (message: string) => new ApiError(422, "invalid_application_bundle", message);

/** A relative, forward-slash path with no hidden, parent or empty segments. */
export const bundlePath = z.string().min(1).max(1_024).refine(value => {
  if (value.startsWith("/") || value.includes("\\") || /^[a-zA-Z]:/.test(value)) return false;
  const segments = value.split("/");
  return segments.length <= LIMITS.depth && segments.every(segment => segment !== "" && segment !== "." && segment !== ".." && !segment.startsWith("."));
}, "Ruta no válida dentro del paquete.");

export const bundleFile = z.object({
  path: bundlePath,
  encoding: z.enum(["utf8", "base64"]),
  content: z.string(),
});
export type BundleFile = z.infer<typeof bundleFile>;

export const bundleSchema = z.object({
  format: z.literal(BUNDLE_FORMAT),
  version: z.number().int().min(1),
  exportedAt: z.string().optional(),
  application: z.object({
    name: z.string().trim().min(1).max(80),
    specialty: z.string().trim().min(1).max(500),
    personality: z.string().trim().max(8_000),
    template: z.enum(["comex", "custom"]),
  }),
  sections: z.record(z.string(), z.unknown()),
});
export type ApplicationBundle = z.infer<typeof bundleSchema>;

export function parseBundle(value: unknown): ApplicationBundle {
  const format = z.object({ format: z.string(), version: z.number() }).safeParse(value);
  if (!format.success || format.data.format !== BUNDLE_FORMAT) throw failure("El archivo no es una aplicación exportada de OpenWork.");
  if (format.data.version > BUNDLE_VERSION) throw failure("El archivo es de una versión más nueva de la app. Actualizá la app para importarlo.");
  const parsed = bundleSchema.safeParse(value);
  if (!parsed.success) throw failure("El archivo de la aplicación está incompleto o dañado.");
  return parsed.data;
}

function decode(file: BundleFile): Buffer {
  return file.encoding === "base64" ? Buffer.from(file.content, "base64") : Buffer.from(file.content, "utf8");
}

/** Within one folder, a path must not repeat or be both a file and a folder ("a" and "a/b"). */
export function assertNoPathConflicts(files: BundleFile[]) {
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

/** Size and count limits across every file of every section, checked before anything is written. */
export function assertFileBudget(groups: BundleFile[][]) {
  let count = 0;
  let bytes = 0;
  for (const file of groups.flat()) {
    const size = decode(file).byteLength;
    count += 1;
    bytes += size;
    if (size > LIMITS.fileBytes) throw failure(`El archivo ${file.path} supera los 5 MB.`);
    if (count > LIMITS.files || bytes > LIMITS.bytes) throw failure("La aplicación supera los límites de importación (2.000 archivos / 50 MB).");
  }
}

function encode(path: string, data: Buffer): BundleFile {
  const text = data.toString("utf8");
  // Keep text readable in the JSON; anything that does not round-trip as UTF-8 travels as base64.
  return Buffer.from(text, "utf8").equals(data) && !text.includes("\u0000")
    ? { path, encoding: "utf8", content: text }
    : { path, encoding: "base64", content: data.toString("base64") };
}

/** Every regular file under `root`, skipping hidden entries. Symlinks are never followed or exported. */
export async function readTree(root: string): Promise<BundleFile[]> {
  const files: BundleFile[] = [];
  let bytes = 0;
  async function walk(prefix: string, depth: number) {
    if (depth >= LIMITS.depth) return;
    let entries;
    try { entries = await readdir(join(root, prefix), { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      const stat = await lstat(join(root, path));
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) { await walk(path, depth + 1); continue; }
      if (!stat.isFile()) continue;
      if (stat.size > LIMITS.fileBytes) throw failure(`No se puede exportar ${path}: supera los 5 MB.`);
      bytes += stat.size;
      if (files.length >= LIMITS.files || bytes > LIMITS.bytes) throw failure("La aplicación supera los límites de exportación (2.000 archivos / 50 MB).");
      files.push(encode(path, await readFile(join(root, path))));
    }
  }
  await walk("", 0);
  return files;
}

/** Write validated bundle files under `root`, creating folders as needed and refusing to pass
 *  through an existing symlink. Existing files are replaced. */
export async function writeTree(root: string, files: BundleFile[]) {
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
      await writeFile(target, decode(file), { mode: 0o600 });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "error";
      throw failure(`No se pudo escribir ${path} (${code}).`);
    }
  }
}
