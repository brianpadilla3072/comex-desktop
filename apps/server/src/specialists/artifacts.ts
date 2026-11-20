import { familyLock, withFileLock } from "./file-lock.js";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { dataPath } from "./project-data.js";

/** Artifacts are workspace FILES under <datos>/artefactos/<id>/, never a DB table or
 *  localStorage. Same atomic-write discipline as outputs.ts, plus immutable versions:
 *  `Guardar` creates a new version and `Descartar` can go back to the last saved one. */

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

async function writeArtifactUnlocked(directory: string, input: ArtifactInput): Promise<{ meta: ArtifactMeta; created: boolean }> {
  if (input.id && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(input.id)) throw failure("El id del artefacto no es válido.");
  const problem = validateContent(input.type, input.content);
  if (problem) throw failure(problem);
  const title = input.title.trim();
  if (!title || title.length > 200) throw failure("El título del artefacto debe tener entre 1 y 200 caracteres.");
  const artifacts = await readIndex(directory);
  const existing = input.id ? artifacts.find(entry => entry.id === input.id) : undefined;
  if (input.id && !existing) throw new ApiError(404, "artifact_not_found", "Ese artefacto no existe.");
  if (!existing && artifacts.length >= ARTIFACT_LIMIT) throw new ApiError(409, "artifact_limit", `Hay ${ARTIFACT_LIMIT} artefactos; depurá el proyecto.`);

  const id = existing?.id ?? `art-${randomUUID().slice(0, 8)}`;
  const dir = artifactDir(directory, id);
  await mkdir(join(dir, "versions"), { recursive: true });
  const now = Date.now();
  const nextVersion = (existing?.versions.length ?? 0) + 1;
  const extension = contentFile(input.type);
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
    status: input.status ?? "draft",
    sources: input.sources ?? existing?.sources ?? [],
    versions: [...(existing?.versions ?? []), version],
    metadata: { ...input.metadata, schemaVersion: 1 },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await writeFile(join(dir, "artifact.json"), JSON.stringify(meta, null, 2), { mode: 0o600 });
  await writeIndex(directory, existing ? artifacts.map(entry => entry.id === id ? meta : entry) : [meta, ...artifacts]);
  return { meta, created: !existing };
}

export async function readArtifact(directory: string, id: string): Promise<{ meta: ArtifactMeta; content: string; truncated: boolean }> {
  const meta = (await readIndex(directory)).find(entry => entry.id === id);
  if (!meta) throw new ApiError(404, "artifact_not_found", "Ese artefacto no existe.");
  const content = await readFile(join(artifactDir(directory, id), contentFile(meta.type)), "utf8")
    .catch(async () => {
      const last = meta.versions.at(-1);
      if (!last) return null;
      return readFile(join(artifactDir(directory, id), last.contentRef), "utf8").catch(() => null);
    });
  if (content === null) throw new ApiError(409, "artifact_content_missing", "El contenido del artefacto no está (¿se borró a mano?).");
  return { meta, content: content.slice(0, 60_000), truncated: content.length > 60_000 };
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

/** Create an artifact from a mini-Studio output: no copy of audit logic, no client trust. */
export async function createArtifactFromOutput(
  directory: string,
  appId: string,
  workspaceId: string,
  output: { id: string; kind: "mindmap" | "report" | "flashcards" | "quiz" | "table"; title: string; fromSources: string[]; focus: string },
  content: string,
  audit: { total: number; valid: number; invalid: Array<{ sourceId: string; chunk: number; reason: string }>; note?: string },
): Promise<{ meta: ArtifactMeta; created: boolean }> {
  const type: ArtifactType = output.kind === "report" || output.kind === "mindmap" ? "doc" : "data";
  // Opening the same output again reuses its artifact (a new version only when the content
  // changed). Creating one per click filled the project's 40-artifact limit for good.
  const existing = (await listArtifacts(directory)).find(entry => entry.metadata.outputRef?.appId === appId && entry.metadata.outputRef?.outputId === output.id && entry.type === type);
  if (existing) {
    const current = await readArtifact(directory, existing.id).catch(() => null);
    if (current && current.content === content) return { meta: existing, created: false };
  }
  return writeArtifact(directory, {
    ...(existing ? { id: existing.id } : {}),
    type,
    title: output.title,
    content,
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
