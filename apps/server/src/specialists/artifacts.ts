import { familyLock, withFileLock } from "./file-lock.js";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { dataPath } from "./project-data.js";

/** Artifacts are workspace FILES under <datos>/artefactos/<id>/, never a DB table or
 *  localStorage. Same atomic-write discipline as outputs.ts, plus immutable versions:
 *  a real content change creates a new version and `Descartar` can go back to it.
 *  Saving byte-identical content does NOT append a version: debounced autosaves were
 *  filling projects with dozens of identical "vN" entries. */

const ARTIFACT_LIMIT = 40;
const CONTENT_LIMIT = 300 * 1024;

export const artifactTypeSchema = z.enum(["doc", "slides", "sheet", "board", "data"]);
export type ArtifactType = z.infer<typeof artifactTypeSchema>;

export const artifactStatusSchema = z.enum(["streaming", "draft", "saved", "archived"]);
export type ArtifactStatus = z.infer<typeof artifactStatusSchema>;

const sourceRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("source"), id: z.string(), label: z.string() }),
  z.object({ kind: z.literal("dataset"), id: z.string(), label: z.string() }),
  z.object({ kind: z.literal("output"), id: z.string(), appId: z.string(), label: z.string() }),
]);

const versionSchema = z.object({
  id: z.string(),
  createdAt: z.number(),
  author: z.enum(["agent", "user"]),
  contentRef: z.string(),
  label: z.string().optional(),
});

const auditSchema = z.object({
  total: z.number(),
  valid: z.number(),
  invalid: z.array(z.object({ sourceId: z.string(), chunk: z.number(), reason: z.string() })),
  note: z.string().optional(),
});

const metadataSchema = z.object({
  workspaceId: z.string(),
  workspaceName: z.string().optional(),
  schemaVersion: z.literal(1),
  outputRef: z.object({ appId: z.string(), outputId: z.string(), workspaceId: z.string() }).optional(),
  audit: auditSchema.optional(),
  focus: z.string().max(500).optional(),
  format: z.enum(["report", "dashboard", "compact", "table", "deck", "canvas"]).optional(),
  theme: z.string().optional(),
  /** Native document-viewer state. Changing the theme/zoom is not a content edit:
   *  it lives in metadata and never creates a version. */
  viewer: z.object({
    format: z.enum(["md", "mdx"]).optional(),
    theme: z.enum(["light", "dark"]).optional(),
    zoom: z.number().int().min(50).max(200).optional(),
    wrap: z.boolean().optional(),
    outline: z.boolean().optional(),
    scrollTo: z.string().max(200).optional(),
  }).optional(),
});

export const artifactMetaSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  type: artifactTypeSchema,
  title: z.string(),
  status: artifactStatusSchema,
  sources: z.array(sourceRefSchema).default([]),
  versions: z.array(versionSchema).default([]),
  metadata: metadataSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type ArtifactMeta = z.infer<typeof artifactMetaSchema>;

export type ArtifactInput = {
  type: ArtifactType;
  title: string;
  content: string;
  status?: ArtifactStatus;
  sources?: ArtifactMeta["sources"];
  metadata: ArtifactMeta["metadata"];
  id?: string;
  label?: string;
};

const failure = (message: string) => new ApiError(422, "invalid_artifact", message);
const artifactsRoot = (directory: string) => dataPath(directory, "artefactos");
const artifactDir = (directory: string, id: string) => {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) throw failure("El id del artefacto no es válido.");
  return join(artifactsRoot(directory), id);
};
const contentFile = (type: ArtifactType) => (type === "doc" ? "content.md" : "content.json");

async function readIndex(directory: string): Promise<ArtifactMeta[]> {
  try {
    const value: unknown = JSON.parse(await readFile(join(artifactsRoot(directory), "index.json"), "utf8"));
    if (!Array.isArray(value)) return [];
    return value.flatMap(entry => { try { return [artifactMetaSchema.parse(entry)]; } catch { return []; } });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function writeIndex(directory: string, artifacts: ArtifactMeta[]) {
  await mkdir(artifactsRoot(directory), { recursive: true });
  const file = join(artifactsRoot(directory), "index.json");
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(artifacts, null, 2), { mode: 0o600 });
  await rename(temporary, file);
}

function validateContent(type: ArtifactType, content: string): string | null {
  if (!content.trim()) return "El artefacto está vacío.";
  if (Buffer.byteLength(content) > CONTENT_LIMIT) return "El artefacto supera 300 KB.";
  if (type === "doc" && !/^#{1,3}\s+\S/m.test(content)) return "El documento necesita al menos un título Markdown.";
  if (type !== "doc") {
    try { JSON.parse(content); } catch { return "Este tipo de artefacto necesita JSON válido."; }
  }
  return null;
}

export async function listArtifacts(directory: string): Promise<ArtifactMeta[]> {
  return (await readIndex(directory)).sort((left, right) => right.updatedAt - left.updatedAt);
}

async function writeArtifactUnlocked(directory: string, input: ArtifactInput): Promise<{ meta: ArtifactMeta; created: boolean; changed: boolean }> {
  if (input.id && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(input.id)) throw failure("El id del artefacto no es válido.");
  const problem = validateContent(input.type, input.content);
  if (problem) throw failure(problem);
  const title = input.title.trim();
  if (!title || title.length > 200) throw failure("El título del artefacto debe tener entre 1 y 200 caracteres.");
  const artifacts = await readIndex(directory);
  const existing = input.id ? artifacts.find(entry => entry.id === input.id) : undefined;
  if (input.id && !existing) throw new ApiError(404, "artifact_not_found", "Ese artefacto no existe.");
  if (!existing && artifacts.length >= ARTIFACT_LIMIT) throw new ApiError(409, "artifact_limit", `Hay ${ARTIFACT_LIMIT} artefactos; depura el proyecto.`);

  const id = existing?.id ?? `art-${randomUUID().slice(0, 8)}`;
  const dir = artifactDir(directory, id);
  const extension = contentFile(input.type);
  const now = Date.now();

  // Autosave may write the same bytes many times. Only a real content change earns a version.
  if (existing) {
    const current = await readFile(join(dir, extension), "utf8").catch(async () => {
      const last = existing.versions.at(-1);
      return last ? readFile(join(dir, last.contentRef), "utf8").catch(() => null) : null;
    });
    if (current === input.content) {
      const next: ArtifactMeta = {
        ...existing,
        title,
        status: input.status ?? existing.status,
        sources: input.sources ?? existing.sources,
        metadata: { ...input.metadata, schemaVersion: 1 },
      };
      const metadataChanged = next.title !== existing.title
        || next.status !== existing.status
        || JSON.stringify(next.sources) !== JSON.stringify(existing.sources)
        || JSON.stringify(next.metadata) !== JSON.stringify(existing.metadata);
      if (!metadataChanged) return { meta: existing, created: false, changed: false };
      next.updatedAt = now;
      await writeFile(join(dir, "artifact.json"), JSON.stringify(next, null, 2), { mode: 0o600 });
      await writeIndex(directory, artifacts.map(entry => entry.id === id ? next : entry));
      return { meta: next, created: false, changed: false };
    }
  }

  await mkdir(join(dir, "versions"), { recursive: true });
  const nextVersion = (existing?.versions.length ?? 0) + 1;
  const version: z.infer<typeof versionSchema> = {
    id: `v${nextVersion}`,
    createdAt: now,
    author: "agent",
    contentRef: `versions/v${nextVersion}.${extension}`,
    ...(input.label ? { label: input.label } : {}),
  };
  await writeFile(join(dir, version.contentRef), input.content, { mode: 0o600 });
  await writeFile(join(dir, extension), input.content, { mode: 0o600 });

  const meta: ArtifactMeta = {
    schemaVersion: 1,
    id,
    type: input.type,
    title,
    status: input.status ?? existing?.status ?? "draft",
    sources: input.sources ?? existing?.sources ?? [],
    versions: [...(existing?.versions ?? []), version],
    metadata: { ...input.metadata, schemaVersion: 1 },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await writeFile(join(dir, "artifact.json"), JSON.stringify(meta, null, 2), { mode: 0o600 });
  await writeIndex(directory, existing ? artifacts.map(entry => entry.id === id ? meta : entry) : [meta, ...artifacts]);
  return { meta, created: !existing, changed: true };
}

async function readArtifactRaw(directory: string, id: string): Promise<{ meta: ArtifactMeta; content: string }> {
  const meta = (await readIndex(directory)).find(entry => entry.id === id);
  if (!meta) throw new ApiError(404, "artifact_not_found", "Ese artefacto no existe.");
  const content = await readFile(join(artifactDir(directory, id), contentFile(meta.type)), "utf8")
    .catch(async () => {
      const last = meta.versions.at(-1);
      if (!last) return null;
      return readFile(join(artifactDir(directory, id), last.contentRef), "utf8").catch(() => null);
    });
  if (content === null) throw new ApiError(409, "artifact_content_missing", "El contenido del artefacto no está (¿se borró a mano?).");
  return { meta: meta, content: content };
}

export async function readArtifact(directory: string, id: string): Promise<{ meta: ArtifactMeta; content: string; truncated: boolean }> {
  const { meta, content } = await readArtifactRaw(directory, id);
  return { meta: meta, content: content.slice(0, 60_000), truncated: content.length > 60_000 };
}

/** Read–modify–write one artifact under the SAME lock used by UI saves. Without
 *  it an agent edit and a debounced UI save could read the same version and the
 *  second write would silently drop the first one. `mutate` receives the full,
 *  untruncated content and returns the new content (or null to leave it alone). */
export async function mutateArtifactContent(
  directory: string,
  id: string,
  mutate: (content: string, meta: ArtifactMeta) => string | null,
  label?: string,
): Promise<{ meta: ArtifactMeta; changed: boolean }> {
  return withFileLock(familyLock(directory, "artefactos"), async () => {
    const { meta, content } = await readArtifactRaw(directory, id);
    const next = mutate(content, meta);
    if (next === null) return { meta: meta, changed: false };
    const result = await writeArtifactUnlocked(directory, {
      id: meta.id,
      type: meta.type,
      title: meta.title,
      content: next,
      status: meta.status,
      sources: meta.sources,
      metadata: meta.metadata,
      ...(label ? { label: label } : {}),
    });
    return { meta: result.meta, changed: result.changed };
  });
}

/** Update only the metadata (viewer settings) under the same family lock used
 *  by content saves and UI writes. No content version: presentation is not an edit. */
export async function mutateArtifactMetadata(
  directory: string,
  id: string,
  mutate: (metadata: ArtifactMeta["metadata"]) => ArtifactMeta["metadata"],
): Promise<ArtifactMeta> {
  return withFileLock(familyLock(directory, "artefactos"), async () => {
    const artifacts = await readIndex(directory);
    const meta = artifacts.find(entry => entry.id === id);
    if (!meta) throw new ApiError(404, "artifact_not_found", "Ese artefacto no existe.");
    const next = metadataSchema.parse(mutate(meta.metadata));
    const updated: ArtifactMeta = { ...meta, metadata: next, updatedAt: Date.now() };
    await writeFile(join(artifactDir(directory, id), "artifact.json"), JSON.stringify(updated, null, 2), { mode: 0o600 });
    await writeIndex(directory, artifacts.map(entry => entry.id === id ? updated : entry));
    return updated;
  });
}

/** Revert the working content to a saved version, without losing later versions. */
async function revertArtifactUnlocked(directory: string, id: string, versionId: string): Promise<ArtifactMeta> {
  const artifacts = await readIndex(directory);
  const meta = artifacts.find(entry => entry.id === id);
  if (!meta) throw new ApiError(404, "artifact_not_found", "Ese artefacto no existe.");
  const version = meta.versions.find(entry => entry.id === versionId);
  if (!version) throw new ApiError(404, "artifact_version_not_found", "Esa versión no existe.");
  const content = await readFile(join(artifactDir(directory, id), version.contentRef), "utf8").catch(() => null);
  if (content === null) throw new ApiError(409, "artifact_content_missing", "El archivo de esa versión no está.");
  await writeFile(join(artifactDir(directory, id), contentFile(meta.type)), content, { mode: 0o600 });
  const updated: ArtifactMeta = { ...meta, status: "draft", updatedAt: Date.now() };
  await writeFile(join(artifactDir(directory, id), "artifact.json"), JSON.stringify(updated, null, 2), { mode: 0o600 });
  await writeIndex(directory, artifacts.map(entry => entry.id === id ? updated : entry));
  return updated;
}

/** Spreadsheet column label from a zero-based index (0 → A, 25 → Z, 26 → AA). */
function columnLabel(index: number): string {
  let label = "";
  let n = index;
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

/** A table output is a JSON array of row objects. The sheet renderer expects
 *  `{ sheets: [{ id, name, cells }] }`; convert once, deterministically, so the
 *  artifact opens in the sheet panel with real tabs instead of failing the
 *  `data` panel-spec validation (`422 invalid_artifact`). */
export function tableRowsToSheetContent(content: string): string {
  const rows: unknown = JSON.parse(content);
  if (!Array.isArray(rows)) throw new ApiError(422, "invalid_artifact", "La tabla necesita filas JSON para volverse hoja.");
  const objects = rows.filter(row => typeof row === "object" && row !== null) as Array<Record<string, unknown>>;
  const keys = objects.length ? Object.keys(objects[0]) : [];
  const cells: Record<string, { value: string }> = {};
  keys.forEach((key, column) => { cells[`${columnLabel(column)}1`] = { value: key }; });
  objects.forEach((row, rowIndex) => {
    keys.forEach((key, column) => {
      const value = row[key];
      cells[`${columnLabel(column)}${rowIndex + 2}`] = { value: value === null || value === undefined ? "" : String(value) };
    });
  });
  return JSON.stringify({ sheets: [{ id: "sheet-1", name: "Datos", cells }] });
}

/** Create an artifact from a mini-Studio output: no copy of audit logic, no client trust. */
export async function createArtifactFromOutput(
  directory: string,
  appId: string,
  workspaceId: string,
  output: { id: string; kind: "mindmap" | "report" | "flashcards" | "quiz" | "table"; title: string; fromSources: string[]; focus: string },
  content: string,
  audit: { total: number; valid: number; invalid: Array<{ sourceId: string; chunk: number; reason: string }>; note?: string },
): Promise<{ meta: ArtifactMeta; created: boolean }> {
  const type: ArtifactType = output.kind === "report" || output.kind === "mindmap" ? "doc" : output.kind === "table" ? "sheet" : "data";
  // A table output becomes a sheet artifact with converted cells; other kinds keep their content.
  const artifactContent = type === "sheet" ? tableRowsToSheetContent(content) : content;
  // Opening the same output again reuses its artifact (a new version only when the content
  // changed). Creating one per click filled the project's 40-artifact limit for good.
  const existing = (await listArtifacts(directory)).find(entry => entry.metadata.outputRef?.appId === appId && entry.metadata.outputRef?.outputId === output.id && entry.type === type);
  if (existing) {
    const current = await readArtifact(directory, existing.id).catch(() => null);
    if (current && current.content === artifactContent) return { meta: existing, created: false };
  }
  return writeArtifact(directory, {
    ...(existing ? { id: existing.id } : {}),
    type,
    title: output.title,
    content: artifactContent,
    status: "draft",
    sources: [
      ...output.fromSources.map(sourceId => ({ kind: "source" as const, id: sourceId, label: sourceId })),
    ],
    metadata: {
      workspaceId,
      schemaVersion: 1,
      outputRef: { appId, outputId: output.id, workspaceId },
      audit,
      focus: output.focus,
    },
    label: "Desde salida del mini-Studio",
  });
}

/** Serialized with every other write to this project's artefactos index (see file-lock.ts). */
export const writeArtifact = (...args: Parameters<typeof writeArtifactUnlocked>) => withFileLock(familyLock(args[0], "artefactos"), () => writeArtifactUnlocked(...args));

/** Serialized with every other write to this project's artefactos index (see file-lock.ts). */
export const revertArtifact = (...args: Parameters<typeof revertArtifactUnlocked>) => withFileLock(familyLock(args[0], "artefactos"), () => revertArtifactUnlocked(...args));
