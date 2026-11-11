import { createReadStream } from "node:fs";
import { mkdir, readdir, lstat, copyFile, readFile, writeFile, realpath, rm } from "node:fs/promises";
import { join, resolve, relative, dirname, basename, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync, backup } from "node:sqlite";
import { pathToFileURL } from "node:url";

const MAX_FILES = 100000;
const inside = (parent, child) => { const value = relative(parent, child); return value === "" || !value.startsWith("..") && !isAbsolute(value); };
async function digest(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
const sqliteFile = path => /\.(?:db|sqlite|sqlite3)$/i.test(path);
function safeRelative(path) {
  return typeof path === "string" && path.length > 0 && !isAbsolute(path) && !path.includes("\\") && path.split("/").every(part => part && part !== "." && part !== "..");
}

/** Explicit directories only: the caller includes app state and each OpenCode store. */
export async function createBackup({ sources, destination, appClosed }) {
  if (!appClosed) throw new Error("Cerrá la app y su motor, y confirmalo con --app-closed antes de copiar.");
  if (!Array.isArray(sources) || !sources.length) throw new Error("Indicá al menos una carpeta --source.");
  const target = resolve(destination);
  const roots = await Promise.all(sources.map(source => realpath(resolve(source))));
  await mkdir(dirname(target), { recursive: true });
  const canonicalTarget = join(await realpath(dirname(target)), basename(target));
  if (roots.some(root => inside(root, canonicalTarget))) throw new Error("El respaldo debe estar fuera de las carpetas originales.");
  await mkdir(target, { mode: 0o700 }); // exclusive: never overwrite an earlier backup
  const files = [];
  const directories = [];
  const copy = async (source, path) => {
    if (files.length + directories.length >= MAX_FILES) throw new Error("El respaldo supera 100.000 entradas.");
    const info = await lstat(source);
    if (info.isSymbolicLink()) throw new Error("El respaldo no sigue enlaces simbólicos. Elegí sus carpetas reales por separado.");
    const output = join(target, path);
    if (info.isDirectory()) {
      directories.push(path);
      await mkdir(output, { mode: 0o700 });
      for (const name of (await readdir(source)).sort()) {
        // SQLite backup includes committed WAL content; raw journal files cannot be restored independently.
        if (/-(?:wal|shm|journal)$/.test(name) && sqliteFile(name.replace(/-(?:wal|shm|journal)$/, ""))) continue;
        await copy(join(source, name), `${path}/${name}`);
      }
    } else if (info.isFile()) {
      if (files.length >= MAX_FILES) throw new Error("El respaldo supera 100.000 archivos.");
      if (sqliteFile(source)) {
        const db = new DatabaseSync(source, { readOnly: true });
        try { await backup(db, output); } finally { db.close(); }
      } else await copyFile(source, output);
      const after = await lstat(source);
      if (info.size !== after.size || info.mtimeMs !== after.mtimeMs) throw new Error("Un archivo cambió durante la copia. Cerrá la aplicación y repetí el respaldo.");
      const saved = await lstat(output);
      const { chmod } = await import("node:fs/promises"); await chmod(output, 0o600);
      files.push({ path, bytes: saved.size, sha256: await digest(output) });
    } else throw new Error("El respaldo solo admite archivos regulares y carpetas.");
  };
  try {
    for (let i = 0; i < roots.length; i++) await copy(roots[i], `${i + 1}-${basename(roots[i]).replace(/[^A-Za-z0-9._-]/g, "_") || "datos"}`);
    await writeFile(join(target, "manifest.json"), JSON.stringify({ version: 1, createdAt: new Date().toISOString(), appClosed: true, directories, files }, null, 2), { mode: 0o600 });
    await verifyBackup(target);
    return { destination: target, files: files.length };
  } catch (error) { await rm(target, { recursive: true, force: true }); throw error; }
}

export async function verifyBackup(directory) {
  const root = await realpath(resolve(directory));
  const manifestInfo = await lstat(join(root, "manifest.json"));
  if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink() || manifestInfo.size > 64 * 1024 * 1024) throw new Error("Manifiesto inválido.");
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  if (manifest.version !== 1 || !Array.isArray(manifest.files) || !Array.isArray(manifest.directories) || manifest.files.length > MAX_FILES || manifest.directories.length > MAX_FILES) throw new Error("Formato de respaldo inválido.");
  const seen = new Set();
  for (const path of manifest.directories) {
    if (!safeRelative(path) || seen.has(path)) throw new Error("Ruta de respaldo inválida.");
    seen.add(path);
    const target = join(root, path); const info = await lstat(target);
    if (!info.isDirectory() || info.isSymbolicLink() || !inside(root, await realpath(target))) throw new Error("Carpeta de respaldo inválida.");
  }
  for (const entry of manifest.files) {
    if (!entry || !safeRelative(entry.path) || seen.has(entry.path) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error("Entrada de respaldo inválida.");
    seen.add(entry.path);
    const target = join(root, entry.path); const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink() || !inside(root, await realpath(target)) || info.size !== entry.bytes || await digest(target) !== entry.sha256) throw new Error("La copia no coincide con su manifiesto; no se restauró nada.");
  }
  return manifest;
}

/** Restoration is staged into a NEW directory; switching a live profile is a separate action. */
export async function restoreBackup({ directory, destination }) {
  const manifest = await verifyBackup(directory);
  const target = resolve(destination);
  await mkdir(dirname(target), { recursive: true });
  if (inside(await realpath(directory), join(await realpath(dirname(target)), basename(target)))) throw new Error("Elegí una carpeta fuera del respaldo.");
  await mkdir(target, { mode: 0o700 });
  try {
    for (const path of [...manifest.directories].sort((a, b) => a.split("/").length - b.split("/").length)) await mkdir(join(target, path), { mode: 0o700 });
    for (const entry of manifest.files) { await mkdir(dirname(join(target, entry.path)), { recursive: true, mode: 0o700 }); await copyFile(join(directory, entry.path), join(target, entry.path)); }
    return { destination: target, files: manifest.files.length };
  } catch (error) { await rm(target, { recursive: true, force: true }); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...args] = process.argv.slice(2);
  const values = name => args.flatMap((value, i) => value === name && args[i + 1] ? [args[i + 1]] : []);
  try {
    if (command === "create") console.log(await createBackup({ sources: values("--source"), destination: values("--to")[0], appClosed: args.includes("--app-closed") }));
    else if (command === "verify") console.log({ files: (await verifyBackup(values("--backup")[0])).files.length, verified: true });
    else if (command === "restore") console.log(await restoreBackup({ directory: values("--backup")[0], destination: values("--to")[0] }));
    else throw new Error("Uso: local-backup.mjs create --source CARPETA [--source OTRA] --to COPIA_NUEVA --app-closed | verify --backup COPIA | restore --backup COPIA --to CARPETA_NUEVA");
  } catch (error) { console.error(error instanceof Error ? error.message : "No se pudo completar el respaldo."); process.exitCode = 1; }
}
