import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { readCitation } from "./sources.js";

/** Studio outputs ([7] del plan): one dataset/source, many digestions (mindmap, report, cards,
 *  quiz, table). Every output is a workspace FILE under comex/salidas/<id>/ — versionable,
 *  pack-portable, and never hostage of a cloud. The AI authors the content with a template;
 *  this store validates the per-kind shape and checks that citations actually resolve:
 *  an output that claims sources without a single valid anchor says so (fallar en voz alta). */

const OUTPUT_LIMIT = 40;
const CONTENT_LIMIT = 300 * 1024;

export const outputKindSchema = z.enum(["mindmap", "report", "flashcards", "quiz", "table"]);
export type SpecialistOutputKind = z.infer<typeof outputKindSchema>;

const CITATION = /\[fuente:([A-Za-z0-9_-]+)#(\d+)\]/g;
export const extractCitations = (content: string) => {
  const found: Array<{ sourceId: string; chunk: number }> = [];
  for (const match of content.matchAll(CITATION)) found.push({ sourceId: match[1]!, chunk: Number(match[2]) });
  return found;
};

export const outputMetaSchema = z.object({
  id: z.string(),
  kind: outputKindSchema,
  title: z.string(),
  fromDatasets: z.array(z.string()).default([]),
  fromSources: z.array(z.string()).default([]),
  focus: z.string().max(500).default(""),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type SpecialistOutputMeta = z.infer<typeof outputMetaSchema>;

const failure = (message: string) => new ApiError(422, "invalid_output", message);
const salidasRoot = (directory: string) => join(directory, "comex", "salidas");
const outputDir = (directory: string, id: string) => {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) throw failure("El id de la salida no es válido.");
  return join(salidasRoot(directory), id);
};

async function readIndex(directory: string): Promise<SpecialistOutputMeta[]> {
  try {
    const value: unknown = JSON.parse(await readFile(join(salidasRoot(directory), "index.json"), "utf8"));
    if (!Array.isArray(value)) return [];
    return value.flatMap(entry => { try { return [outputMetaSchema.parse(entry)]; } catch { return []; } });
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

async function writeIndex(directory: string, outputs: SpecialistOutputMeta[]) {
  await mkdir(salidasRoot(directory), { recursive: true });
  const file = join(salidasRoot(directory), "index.json");
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(outputs, null, 2), { mode: 0o600 });
  await rename(temporary, file);
}

/** The first complete JSON value in a string, ignoring anything a provider appends after it.
 *  Some OpenAI-compatible providers trail a stray word after a tool argument (`…}]Conformément`);
 *  the JSON the model wrote is intact, and the extra text is not part of anyone's content. */
export function firstJsonValue(text: string): string | null {
  const start = text.search(/[\[{]/);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === "{" || char === "[") depth += 1;
    else if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

/** JSON kinds are stored normalized: a provider's trailing word never lands in the workspace file. */
function normalizeJsonContent(kind: SpecialistOutputKind, content: string): string {
  if (kind === "report" || kind === "mindmap") return content;
  try { JSON.parse(content); return content; }
  catch {
    const first = firstJsonValue(content);
    if (first === null) return content;
    try { return JSON.stringify(JSON.parse(first)); } catch { return content; }
  }
}

/** Per-kind content shape. Keeps the Studio honest: a quiz without answers or a mindmap
 *  without the mermaid fence is rejected at write time, not at render time. */
export function validateOutputContent(kind: SpecialistOutputKind, content: string): string | null {
  if (!content.trim()) return "La salida está vacía.";
  if (Buffer.byteLength(content) > CONTENT_LIMIT) return "La salida supera 300 KB.";
  if (kind === "mindmap") return /^\s*(graph|mindmap)\b/m.test(content) ? null : "El mapa mental debe ser Mermaid (fence mindmap o graph).";
  if (kind === "report") return /^#{1,3}\s+\S/m.test(content) ? null : "El informe necesita al menos un título Markdown.";
  if (kind === "table") {
    try { const rows: unknown = JSON.parse(content); return Array.isArray(rows) ? null : "La tabla necesita un array de filas (JSON)."; }
    catch { return "La tabla necesita filas JSON válidas."; }
  }
  try {
    const value: unknown = JSON.parse(content);
    if (kind === "flashcards") {
      const cards = z.array(z.object({ front: z.string().min(1), back: z.string().min(1) })).safeParse(value);
      return cards.success && cards.data.length > 0 ? null : "Flashcards necesitan un array {front,back} no vacío.";
    }
    const questions = z.array(z.object({ question: z.string().min(1), options: z.array(z.string().min(1)).min(2).max(6), answer: z.number().int().min(0) })).safeParse(value);
    if (!questions.success) return "El quiz necesita preguntas {question,options[2..6],answer} en JSON.";
    return questions.data.every(q => q.answer < q.options.length) ? null : "Cada respuesta del quiz debe ser un índice válido de sus opciones.";
  } catch { return "Esta salida necesita JSON."; }
}

export async function listOutputs(directory: string) {
  return (await readIndex(directory)).sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function writeOutput(directory: string, input: { kind: SpecialistOutputKind; title: string; content: string; fromDatasets?: string[]; fromSources?: string[]; focus?: string; id?: string }) {
  const content = normalizeJsonContent(input.kind, input.content);
  const problem = validateOutputContent(input.kind, content);
  if (problem) throw failure(problem);
  const title = input.title.trim();
  if (!title || title.length > 200) throw failure("El título de la salida debe tener entre 1 y 200 caracteres.");
  const outputs = await readIndex(directory);
  const existing = input.id ? outputs.find(entry => entry.id === input.id) : undefined;
  if (input.id && !existing) throw new ApiError(404, "output_not_found", "Esa salida no existe; creá una nueva o pasá el id correcto.");
  if (!existing && outputs.length >= OUTPUT_LIMIT) throw new ApiError(409, "output_limit", `Hay ${OUTPUT_LIMIT} salidas; depurá el proyecto.`);
  const id = existing?.id ?? `out-${input.kind}-${randomUUID().slice(0, 8)}`;
  const dir = await mkdir(outputDir(directory, id), { recursive: true }).then(() => outputDir(directory, id));
  const meta: SpecialistOutputMeta = {
    id, kind: input.kind, title,
    fromDatasets: input.fromDatasets ?? existing?.fromDatasets ?? [],
    fromSources: input.fromSources ?? existing?.fromSources ?? [],
    focus: input.focus ?? existing?.focus ?? "",
    createdAt: existing?.createdAt ?? Date.now(), updatedAt: Date.now(),
  };
  const extension = input.kind === "report" || input.kind === "mindmap" ? "md" : "json";
  await writeFile(join(dir, `content.${extension}`), content, { mode: 0o600 });
  if (existing) {
    const other = `content.${existing.kind === "report" || existing.kind === "mindmap" ? "md" : "json"}`;
    if (other !== `content.${extension}`) await rm(join(dir, other), { force: true }).catch(() => undefined);
  }
  await writeFile(join(dir, "output.json"), JSON.stringify(meta, null, 2), { mode: 0o600 });
  await writeIndex(directory, existing ? outputs.map(entry => entry.id === id ? meta : entry) : [meta, ...outputs]);
  return { output: meta, created: !existing };
}

export async function readOutput(directory: string, id: string) {
  const meta = (await readIndex(directory)).find(entry => entry.id === id);
  if (!meta) throw new ApiError(404, "output_not_found", "Esa salida no existe.");
  const extension = meta.kind === "report" || meta.kind === "mindmap" ? "md" : "json";
  const content = await readFile(join(outputDir(directory, id), `content.${extension}`), "utf8").catch(() => null);
  if (content === null) throw new ApiError(409, "output_content_missing", "El archivo de contenido de la salida no está (¿se borró a mano?).");
  return { meta, content };
}

export async function deleteOutput(directory: string, id: string) {
  const outputs = await readIndex(directory);
  if (!outputs.some(entry => entry.id === id)) throw new ApiError(404, "output_not_found", "Esa salida no existe.");
  await rm(outputDir(directory, id), { recursive: true, force: true });
  await writeIndex(directory, outputs.filter(entry => entry.id !== id));
}

export type OutputAudit = { total: number; valid: number; invalid: Array<{ sourceId: string; chunk: number; reason: string }>; note?: string };

/** Every [fuente:id#chunk] in the content must resolve in THIS project's evidence — the trust
 *  story of [7]. No citations at all is not an error, it is a declared condition. */
export async function auditOutputCitations(directory: string, id: string): Promise<OutputAudit> {
  const { meta, content } = await readOutput(directory, id);
  const found = extractCitations(content);
  const invalid: OutputAudit["invalid"] = [];
  for (const citation of found) {
    const resolved = await readCitation(directory, citation.sourceId, citation.chunk).catch((error: unknown) =>
      ({ ok: false as const, error: error instanceof ApiError ? error.message : "fuente ilegible" }));
    if (!resolved.ok) invalid.push({ ...citation, reason: resolved.error });
  }
  return {
    total: found.length,
    valid: found.length - invalid.length,
    invalid,
    ...(found.length === 0 ? { note: "sin anclas: esta salida no está anclada a fuentes del proyecto" } : {}),
    ...(meta.fromSources.length && found.length === 0 ? { note: "declaró fuentes pero no cita ninguna — el lector no puede verificar" } : {}),
  };
}
