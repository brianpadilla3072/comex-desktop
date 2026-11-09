import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { ApiError } from "../errors.js";

/** Sources ([6] del plan): every piece of retrieved material gets an identity so a citation like
 *  [fuente:<id>#<chunk>] can jump to the exact passage. Registry and chunk files live in the
 *  project workspace (comex/fuentes/) beside the raw evidence; chunks are built lazily the first
 *  time something cites a source. Citations must never lie: a missing or stale anchor fails loud. */

const SOURCE_LIMIT = 300;
const CHUNK_CHARS = 1200;

export const sourceMetaSchema = z.object({
  id: z.string(),
  provider: z.string(),
  title: z.string(),
  url: z.string().nullable(),
  evidencePath: z.string(),
  datasetId: z.string().nullable().default(null),
  retrievedAt: z.number(),
  chunks: z.number().int().nonnegative().default(0),
});
export type SpecialistSourceMeta = z.infer<typeof sourceMetaSchema>;

const failure = (message: string) => new ApiError(422, "invalid_source", message);
const fuentesRoot = (directory: string) => join(directory, "comex", "fuentes");

async function ensureFolder(path: string) {
  await mkdir(path, { recursive: true });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw failure("La carpeta comex/fuentes no puede ser un enlace simbólico.");
  return path;
}

async function readIndex(directory: string): Promise<SpecialistSourceMeta[]> {
  try {
    const value: unknown = JSON.parse(await readFile(join(fuentesRoot(directory), "index.json"), "utf8"));
    if (!Array.isArray(value)) return [];
    return value.flatMap(entry => { try { return [sourceMetaSchema.parse(entry)]; } catch { return []; } });
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

async function writeIndex(directory: string, sources: SpecialistSourceMeta[]) {
  await ensureFolder(fuentesRoot(directory));
  const file = join(fuentesRoot(directory), "index.json");
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(sources, null, 2), { mode: 0o600 });
  await rename(temporary, file);
}

export async function listSources(directory: string) {
  return (await readIndex(directory)).sort((left, right) => right.retrievedAt - left.retrievedAt);
}

/** Register evidence as a citable source; idempotent by evidencePath (re-register refreshes meta). */
export async function registerSource(directory: string, input: { provider: string; evidencePath: string; title?: string; url?: string | null; datasetId?: string | null }) {
  if (!input.evidencePath.startsWith("comex/fuentes/") || input.evidencePath.includes("..")) throw failure("La evidencia debe vivir bajo comex/fuentes/.");
  await ensureFolder(fuentesRoot(directory));
  const stat = await lstat(join(directory, input.evidencePath)).catch(() => null);
  if (!stat || !stat.isFile() || stat.isSymbolicLink()) throw failure("El archivo de evidencia no existe o es un enlace.");
  const sources = await readIndex(directory);
  const existing = sources.find(source => source.evidencePath === input.evidencePath);
  const meta: SpecialistSourceMeta = {
    id: existing?.id ?? `src_${randomUUID()}`,
    provider: input.provider,
    title: (input.title ?? "").trim().slice(0, 300) || input.evidencePath.split("/").pop()!,
    url: input.url ?? existing?.url ?? null,
    evidencePath: input.evidencePath,
    datasetId: input.datasetId ?? existing?.datasetId ?? null,
    retrievedAt: existing?.retrievedAt ?? Date.now(),
    chunks: existing?.chunks ?? 0,
  };
  if (!existing && sources.length >= SOURCE_LIMIT) throw new ApiError(409, "source_limit", `Hay ${SOURCE_LIMIT} fuentes registradas; depurá el proyecto.`);
  await writeIndex(directory, existing ? sources.map(source => source.id === meta.id ? meta : source) : [meta, ...sources]);
  return meta;
}

/** Walk any JSON payload and pull the substantial text out of it (provider results, answers, pages). */
function collectText(value: unknown, out: string[]) {
  if (typeof value === "string") { if (value.length >= 40) out.push(value); return; }
  if (Array.isArray(value)) { for (const entry of value) collectText(entry, out); return; }
  if (typeof value === "object" && value !== null) { for (const entry of Object.values(value)) collectText(entry, out); }
}

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const sentence of text.split(/(?<=[.!?。])\s+/)) {
    if (current.length && current.length + sentence.length > CHUNK_CHARS) { chunks.push(current.trim()); current = ""; }
    current += sentence + " ";
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

/** Build (and cache) the chunk file so citations have stable anchors. Idempotent. */
export async function ensureChunks(directory: string, id: string) {
  const sources = await readIndex(directory);
  const source = sources.find(entry => entry.id === id);
  if (!source) throw new ApiError(404, "source_not_found", "Esa fuente no está registrada en este proyecto.");
  const chunkFile = join(fuentesRoot(directory), `${source.id}.chunks.json`);
  const cached = await readFile(chunkFile, "utf8").catch((error: NodeJS.ErrnoException) => (error.code === "ENOENT" ? null : Promise.reject(error)));
  if (cached !== null) {
    try { return { source, chunks: z.array(z.string()).parse(JSON.parse(cached)) }; } catch { /* rebuild below */ }
  }
  const evidenceText = await readFile(join(directory, source.evidencePath), "utf8").catch(() => null);
  if (evidenceText === null) return { source, chunks: [] as string[] };
  let payload: unknown = evidenceText;
  try { payload = JSON.parse(evidenceText); } catch { /* treat the raw text itself as the content */ }
  const texts: string[] = [];
  collectText(payload, texts);
  const chunks = texts.flatMap(chunkText);
  await mkdir(dirname(chunkFile), { recursive: true });
  const temporary = `${chunkFile}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(chunks), { mode: 0o600 });
  await rename(temporary, chunkFile);
  await writeIndex(directory, (await readIndex(directory)).map(entry => entry.id === id ? { ...entry, chunks: chunks.length } : entry));
  return { source, chunks };
}

/** Resolve one citation anchor. Fails loud — never substitutes model memory ([6]/[3]). */
export async function readCitation(directory: string, id: string, chunk: number) {
  const { source, chunks } = await ensureChunks(directory, id);
  if (!Number.isInteger(chunk) || chunk < 0 || chunk >= chunks.length) {
    return { ok: false as const, error: chunk >= chunks.length
      ? `La fuente ${id} tiene ${chunks.length} pasajes; el ancla #${chunk} no existe (¿se reescribió la evidencia desde la cita?).`
      : "El número de pasaje no es válido." };
  }
  return { ok: true as const, source, chunk, text: chunks[chunk]! };
}
