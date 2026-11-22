import { createWriteStream } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ApiError } from "../../errors.js";
import { LIMITS, megabytes } from "./bundle.js";
import type { ExportedArchive } from "./index.js";

/** HTTP edges of the `.owapp` format: the upload is streamed to disk with a size cap, and the
 *  download is streamed from disk. Neither holds the archive in memory. */

const CHUNK = 256 * 1024;

const tooLarge = () => new ApiError(413, "application_bundle_too_large", `El archivo supera los ${megabytes(LIMITS.archive.uploadBytes)}.`);

/** Is this request body an archive (rather than a v1 JSON bundle)? */
export function isArchiveUpload(request: Request): boolean {
  const type = (request.headers.get("content-type") ?? "").toLowerCase();
  return type.startsWith("application/zip") || type.startsWith("application/octet-stream") || type.startsWith("application/x-zip");
}

export async function saveRequestBody(request: Request, target: string) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > LIMITS.archive.uploadBytes) throw tooLarge();
  const body = request.body;
  if (!body) throw new ApiError(400, "file_required", "Falta el archivo de la aplicación.");
  let bytes = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.byteLength;
      callback(bytes > LIMITS.archive.uploadBytes ? tooLarge() : null, chunk);
    },
  });
  // Read the body directly (as the inbox upload does): Readable.fromWeb drops bytes from large
  // bodies under Bun, and cancelling the body would hide the error response.
  const source = async function* () {
    for await (const chunk of body.values({ preventCancel: true })) yield chunk;
  };
  try {
    await pipeline(source, limit, createWriteStream(target, { flags: "wx", mode: 0o600 }), { signal: request.signal });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && "code" in error && error.code === "ENOSPC") throw new ApiError(507, "insufficient_storage", "No hay espacio en disco para importar la aplicación.");
    throw error;
  }
}

/** Stream an exported archive and remove it once it was sent (or the client went away). */
export function archiveResponse(exported: ExportedArchive): Response {
  let handle: FileHandle | null = null;
  let finished = false;
  const finish = async () => {
    if (finished) return;
    finished = true;
    await handle?.close().catch(() => undefined);
    await exported.cleanup().catch(() => undefined);
  };
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        handle ??= await open(exported.file, "r");
        const buffer = Buffer.alloc(CHUNK);
        const { bytesRead } = await handle.read(buffer, 0, CHUNK, null);
        // Clean up before closing, so the scratch copy is gone once the client has every byte.
        if (!bytesRead) { await finish(); controller.close(); return; }
        controller.enqueue(buffer.subarray(0, bytesRead));
      } catch (error) {
        controller.error(error);
        await finish();
      }
    },
    async cancel() { await finish(); },
  });
  const ascii = exported.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(exported.size),
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(exported.fileName)}`,
      "Cache-Control": "no-store",
    },
  });
}
