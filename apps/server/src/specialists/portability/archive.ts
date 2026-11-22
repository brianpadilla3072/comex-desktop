import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, type WriteStream } from "node:fs";
import { mkdir, open, stat, type FileHandle } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { once } from "node:events";
import { createInflateRaw } from "node:zlib";
import { Zip, ZipDeflate, ZipPassThrough } from "fflate";
import { ApiError } from "../../errors.js";
import { LIMITS, failure, isBundlePath, megabytes } from "./bundle.js";

/**
 * The `.owapp` container: a plain ZIP (stored or deflate entries, no ZIP64, no encryption).
 * Writing uses fflate's streaming `Zip`; reading parses the central directory here so every
 * entry can be checked (path, type, sizes, ratio) before a single byte is inflated, and then
 * inflates one entry at a time from disk with node:zlib. Rust equivalent: the `zip` crate.
 */

export const MANIFEST_ENTRY = "manifest.json";

/** One file of the archive as listed in the manifest. */
export type ArchiveIndexEntry = { path: string; size: number; sha256: string };

const CHUNK = 256 * 1024;
/** Formats that are already compressed travel stored: deflating them again only costs time. */
const STORED = new Set([".zip", ".owapp", ".xlsx", ".xlsm", ".docx", ".pptx", ".odt", ".ods", ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".mp3", ".mp4", ".mov", ".m4a", ".gz", ".7z", ".rar"]);

// ---------------------------------------------------------------------------
// CRC-32 (IEEE), used to check every inflated entry against its header.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array, previous = 0): number {
  let crc = ~previous >>> 0;
  for (let index = 0; index < data.length; index += 1) crc = (CRC_TABLE[(crc ^ (data[index] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8);
  return ~crc >>> 0;
}

// ---------------------------------------------------------------------------
// Writing

async function drain(out: WriteStream, pending: Uint8Array[]) {
  while (pending.length) {
    const chunk = pending.shift();
    if (chunk && !out.write(chunk)) await once(out, "drain");
  }
}

/** Write `files` (archive path + absolute source) into a new ZIP at `target`, then the manifest
 *  built from the index of what was actually read. Each file is read in chunks; nothing holds
 *  the whole archive. Files that grow past the per-file limit while being read fail the export. */
export async function writeArchive(target: string, files: Array<{ path: string; source: string }>, manifest: (index: ArchiveIndexEntry[]) => Uint8Array): Promise<ArchiveIndexEntry[]> {
  const out = createWriteStream(target, { flags: "wx", mode: 0o600 });
  const pending: Uint8Array[] = [];
  let zipError: Error | null = null;
  let finished = false;
  const zip = new Zip((error, chunk, final) => {
    if (error) zipError = error;
    else pending.push(chunk);
    if (final) finished = true;
  });
  const flush = async () => {
    await drain(out, pending);
    if (zipError) throw zipError;
  };
  const index: ArchiveIndexEntry[] = [];
  try {
    for (const file of files) {
      const entry = STORED.has(extname(file.path).toLowerCase()) ? new ZipPassThrough(file.path) : new ZipDeflate(file.path, { level: 6 });
      zip.add(entry);
      const hash = createHash("sha256");
      let size = 0;
      const handle = await open(file.source, "r");
      try {
        for (;;) {
          // A fresh buffer per read: the stored path hands the same bytes to the output queue.
          const buffer = Buffer.alloc(CHUNK);
          const { bytesRead } = await handle.read(buffer, 0, CHUNK, null);
          if (!bytesRead) break;
          const chunk = buffer.subarray(0, bytesRead);
          size += bytesRead;
          if (size > LIMITS.archive.fileBytes) throw failure(`No se puede exportar ${file.path}: supera los ${megabytes(LIMITS.archive.fileBytes)}.`);
          hash.update(chunk);
          entry.push(chunk);
          await flush();
        }
      } finally { await handle.close(); }
      entry.push(new Uint8Array(0), true);
      await flush();
      index.push({ path: file.path, size, sha256: hash.digest("hex") });
    }
    const data = manifest(index);
    if (data.byteLength > LIMITS.archive.manifestBytes) throw failure("La aplicación tiene demasiados archivos para exportarla.");
    const entry = new ZipDeflate(MANIFEST_ENTRY, { level: 6 });
    zip.add(entry);
    entry.push(data, true);
    zip.end();
    await flush();
    if (!finished) throw new Error("zip stream did not finish");
    out.end();
    await once(out, "finish");
    return index;
  } catch (error) {
    zip.terminate();
    out.destroy();
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Reading

/** One central-directory entry that passed every structural check. */
export type ArchiveEntry = {
  path: string;
  method: 0 | 8;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
};

export type ArchiveDirectory = { file: string; entries: ArchiveEntry[]; directoryOffset: number };

const damaged = () => failure("El archivo .owapp está dañado o no es un archivo de OpenWork.");
const UTF8 = new TextDecoder("utf-8", { fatal: true });

async function readAt(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  if (bytesRead !== length) throw damaged();
  return buffer;
}

/** Why an entry name is unsafe, or null when it is a normal relative path. Exported for the
 *  contract vectors: the same rules apply to any implementation. */
export function unsafeEntryReason(name: string): string | null {
  if (name.includes("\\")) return "backslash";
  if (name.startsWith("/")) return "absolute";
  if (/^[a-zA-Z]:/.test(name)) return "drive";
  if (name.split("/").some(segment => segment === "..")) return "parent";
  if (!isBundlePath(name)) return "invalid";
  return null;
}

/** Parse and check the central directory. Nothing is inflated or written. */
export async function readArchiveDirectory(file: string): Promise<ArchiveDirectory> {
  const info = await stat(file);
  if (info.size > LIMITS.archive.uploadBytes) throw failure(`El archivo supera los ${megabytes(LIMITS.archive.uploadBytes)}.`);
  if (info.size < 22) throw damaged();
  const handle = await open(file, "r");
  try {
    const tailLength = Math.min(info.size, 22 + 0xffff);
    const tail = await readAt(handle, info.size - tailLength, tailLength);
    let end = -1;
    for (let index = tail.length - 22; index >= 0; index -= 1) {
      if (tail.readUInt32LE(index) === 0x06054b50) { end = index; break; }
    }
    if (end < 0) throw damaged();
    const endOffset = info.size - tailLength + end;
    const disk = tail.readUInt16LE(end + 4);
    const directoryDisk = tail.readUInt16LE(end + 6);
    const onDisk = tail.readUInt16LE(end + 8);
    const count = tail.readUInt16LE(end + 10);
    const directorySize = tail.readUInt32LE(end + 12);
    const directoryOffset = tail.readUInt32LE(end + 16);
    if (disk !== 0 || directoryDisk !== 0 || onDisk !== count) throw damaged();
    if (count === 0xffff || directoryOffset === 0xffffffff || directorySize === 0xffffffff) throw failure("El archivo usa un formato ZIP64 que no se admite.");
    if (count > LIMITS.archive.files + 1) throw failure(`El archivo tiene más de ${LIMITS.archive.files.toLocaleString("es")} archivos.`);
    if (directoryOffset + directorySize > endOffset) throw damaged();
    const directory = await readAt(handle, directoryOffset, directorySize);
    const entries: ArchiveEntry[] = [];
    const names = new Set<string>();
    let total = 0;
    let offset = 0;
    for (let index = 0; index < count; index += 1) {
      if (offset + 46 > directory.length || directory.readUInt32LE(offset) !== 0x02014b50) throw damaged();
      const madeBy = directory.readUInt16LE(offset + 4) >>> 8;
      const flags = directory.readUInt16LE(offset + 8);
      const method = directory.readUInt16LE(offset + 10);
      const crc = directory.readUInt32LE(offset + 16);
      const compressedSize = directory.readUInt32LE(offset + 20);
      const size = directory.readUInt32LE(offset + 24);
      const nameLength = directory.readUInt16LE(offset + 28);
      const extraLength = directory.readUInt16LE(offset + 30);
      const commentLength = directory.readUInt16LE(offset + 32);
      const external = directory.readUInt32LE(offset + 38);
      const localOffset = directory.readUInt32LE(offset + 42);
      const nameEnd = offset + 46 + nameLength;
      if (nameEnd > directory.length) throw damaged();
      let name: string;
      try { name = UTF8.decode(directory.subarray(offset + 46, nameEnd)); }
      catch { throw failure("El archivo tiene nombres de archivo con una codificación no válida."); }
      offset = nameEnd + extraLength + commentLength;

      const isDirectory = name.endsWith("/");
      const path = isDirectory ? name.slice(0, -1) : name;
      const reason = unsafeEntryReason(path);
      if (reason) throw failure(`El archivo contiene una ruta no permitida: ${JSON.stringify(name.slice(0, 200))}.`);
      // Unix hosts keep the file type in the upper half of the external attributes.
      const mode = madeBy === 3 ? external >>> 16 : 0;
      const type = mode & 0o170000;
      if (type === 0o120000) throw failure(`El archivo contiene un enlace simbólico (${path}); no se admite.`);
      if (type !== 0 && type !== 0o100000 && type !== 0o040000) throw failure(`El archivo contiene una entrada especial (${path}); no se admite.`);
      if (isDirectory || type === 0o040000 || (madeBy === 0 && external & 0x10)) {
        if (size !== 0) throw damaged();
        continue;
      }
      if (flags & 0x41) throw failure("El archivo está cifrado; no se admite.");
      if (method !== 0 && method !== 8) throw failure(`El archivo usa una compresión que no se admite (${path}).`);
      if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) throw failure("El archivo usa un formato ZIP64 que no se admite.");
      if (method === 0 && compressedSize !== size) throw damaged();
      if (names.has(path)) throw failure(`El archivo repite la ruta ${path}.`);
      names.add(path);
      const limit = path === MANIFEST_ENTRY ? LIMITS.archive.manifestBytes : LIMITS.archive.fileBytes;
      if (size > limit) throw failure(`El archivo ${path} supera los ${megabytes(limit)}.`);
      total += path === MANIFEST_ENTRY ? 0 : size;
      if (total > LIMITS.archive.bytes) throw failure(`La aplicación supera los ${megabytes(LIMITS.archive.bytes)} sin comprimir.`);
      if (size > LIMITS.archive.ratioFloorBytes && size / Math.max(compressedSize, 1) > LIMITS.archive.compressionRatio) {
        throw failure(`El archivo ${path} está comprimido de forma sospechosa (posible bomba ZIP).`);
      }
      if (localOffset + 30 > directoryOffset) throw damaged();
      entries.push({ path, method: method === 8 ? 8 : 0, crc, compressedSize, size, localOffset });
    }
    return { file, entries, directoryOffset };
  } finally { await handle.close(); }
}

/** Inflate one entry into `target` (a new file), checking size, CRC and, when given, SHA-256.
 *  Output beyond the declared size aborts at once, so a lying header cannot fill the disk. */
export async function extractEntry(archive: ArchiveDirectory, entry: ArchiveEntry, target: string, sha256?: string) {
  const handle = await open(archive.file, "r");
  let start: number;
  try {
    const header = await readAt(handle, entry.localOffset, 30);
    if (header.readUInt32LE(0) !== 0x04034b50) throw damaged();
    const nameLength = header.readUInt16LE(26);
    const extraLength = header.readUInt16LE(28);
    const name = await readAt(handle, entry.localOffset + 30, nameLength);
    // The local header must describe the same entry as the central directory.
    if (name.toString("utf8") !== entry.path && name.toString("utf8") !== `${entry.path}/`) throw damaged();
    start = entry.localOffset + 30 + nameLength + extraLength;
    if (start + entry.compressedSize > archive.directoryOffset) throw damaged();
  } finally { await handle.close(); }

  await mkdir(dirname(target), { recursive: true });
  const hash = createHash("sha256");
  let crc = 0;
  let bytes = 0;
  const guard = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.byteLength;
      if (bytes > entry.size) { callback(failure(`El contenido de ${entry.path} es más grande de lo declarado (posible bomba ZIP).`)); return; }
      hash.update(chunk);
      crc = crc32(chunk, crc);
      callback(null, chunk);
    },
  });
  const out = createWriteStream(target, { flags: "wx", mode: 0o600 });
  try {
    if (entry.compressedSize === 0) {
      await pipeline(async function* () { /* empty entry */ }, guard, out);
    } else {
      const source = createReadStream(archive.file, { start, end: start + entry.compressedSize - 1 });
      if (entry.method === 8) await pipeline(source, createInflateRaw(), guard, out);
      else await pipeline(source, guard, out);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw failure(`No se pudo leer ${entry.path} del archivo: está dañado.`);
  }
  if (bytes !== entry.size || crc !== entry.crc) throw failure(`El contenido de ${entry.path} no coincide con el archivo: está dañado.`);
  if (sha256 !== undefined && hash.digest("hex") !== sha256) throw failure(`La suma de verificación de ${entry.path} no coincide.`);
}

/** Where an archive entry lands inside a staging folder. Paths were checked by readArchiveDirectory. */
export const stagedPath = (root: string, path: string) => join(root, ...path.split("/"));
