import { z } from "zod";
import { ApiError } from "../errors.js";
import { workspaceIdForPath } from "../workspaces.js";
import {
  listArtifacts, mutateArtifactContent, mutateArtifactMetadata, readArtifact, revertArtifact, writeArtifact,
  type ArtifactMeta,
} from "./artifacts.js";
import { docFind, docOutline, docWrite, formatForContent, type DocFormat, type DocWriteMode } from "./doc-model.js";

/** Agent-facing tools for the native document viewer. Same family, token and
 *  loopback bridge as the sheet tools: every content write is one atomic,
 *  versioned artifact save. Viewer settings live in metadata and do NOT create
 *  a content version — changing the theme is not editing the document. */

const artifactId = z.string().min(1).max(120).describe("id del artefacto documento (art-…), visible en specialist_doc_list");
const lineNumber = z.number().int().min(1).describe("Número de línea 1-based");
const formatValue = z.enum(["md", "mdx"]);

export const docListSchema = z.object({});
export const docCreateSchema = z.object({
  title: z.string().trim().min(1).max(200).describe("Título legible del documento nuevo"),
  content: z.string().min(1).max(300_000).describe("Contenido Markdown o MDX; necesita al menos un título Markdown (# …)"),
  format: formatValue.optional().describe("md (default) o mdx; si se omite se detecta por el contenido"),
});
export const docReadSchema = z.object({
  artifactId,
  start: lineNumber.optional().describe("Primera línea a devolver (1-based)"),
  end: lineNumber.optional().describe("Última línea a devolver (inclusive)"),
  limit: z.number().int().min(1).max(500).default(200).describe("Máximo de líneas devueltas cuando no se da un rango"),
  outline: z.boolean().default(true).describe("Incluye el índice de títulos con su número de línea"),
});
export const docWriteSchema = z.object({
  artifactId,
  mode: z.enum(["replace", "append", "prepend", "before", "after"]).describe("replace reemplaza todo; before/after insertan junto a un título"),
  heading: z.string().min(1).max(200).optional().describe("Título destino para before/after; coincide por texto exacto o parcial"),
  content: z.string().min(1).max(300_000).describe("Texto a escribir; en replace es el documento completo"),
});
export const docFindSchema = z.object({
  artifactId,
  query: z.string().min(1).max(300).describe("Texto a buscar (o regex si regex=true)"),
  regex: z.boolean().default(false),
  limit: z.number().int().min(1).max(500).default(100),
});
export const docExportSchema = z.object({
  artifactId,
  format: formatValue.optional().describe("Etiqueta de formato a devolver; por defecto la guardada en el artefacto"),
});
export const docVersionsSchema = z.object({
  artifactId,
  action: z.enum(["list", "revert"]),
  versionId: z.string().min(1).max(40).optional().describe("id de la versión a recuperar, visible con action=list"),
});
export const docViewSchema = z.object({
  artifactId,
  theme: z.enum(["light", "dark"]).optional().describe("Tema del visor; el cambio se guarda en el artefacto para que la app lo refleje"),
  zoom: z.number().int().min(50).max(200).optional().describe("Zoom del visor en porcentaje (50..200)"),
  wrap: z.boolean().optional().describe("Ajustar líneas largas en los bloques de código"),
  outline: z.boolean().optional().describe("Mostrar u ocultar el índice de títulos"),
  scrollTo: z.string().min(1).max(200).optional().describe("Título al que debe desplazarse el visor; coincide por texto"),
  format: formatValue.optional().describe("Renderizar como md o mdx"),
});

export const DOC_TOOL_NAMES = [
  "specialist_doc_list", "specialist_doc_create", "specialist_doc_read", "specialist_doc_write",
  "specialist_doc_find", "specialist_doc_export", "specialist_doc_versions", "specialist_doc_view",
] as const;
export type DocToolName = typeof DOC_TOOL_NAMES[number];

export const DOC_TOOL_SCHEMAS = {
  specialist_doc_list: docListSchema,
  specialist_doc_create: docCreateSchema,
  specialist_doc_read: docReadSchema,
  specialist_doc_write: docWriteSchema,
  specialist_doc_find: docFindSchema,
  specialist_doc_export: docExportSchema,
  specialist_doc_versions: docVersionsSchema,
  specialist_doc_view: docViewSchema,
} satisfies Record<DocToolName, z.ZodType>;

type DocInput = Record<string, unknown>;
type Viewer = NonNullable<ArtifactMeta["metadata"]["viewer"]>;

function requireDocMeta(meta: { type: string }) {
  if (meta.type !== "doc") throw new ApiError(422, "not_a_doc", "Ese artefacto no es un documento; usá specialist_doc_list para encontrar uno.");
}

function viewerOf(metadata: ArtifactMeta["metadata"]): Viewer {
  return metadata.viewer ?? {};
}

function formatOf(metadata: ArtifactMeta["metadata"]): DocFormat {
  return viewerOf(metadata).format ?? "md";
}

function summarize(meta: ArtifactMeta, content: string, format: DocFormat) {
  return {
    title: meta.title,
    format,
    lines: content.split(/\r?\n/).length,
    outlineCount: docOutline(content).length,
  };
}

export async function runDocTool(directory: string, name: DocToolName, rawInput: DocInput) {
  const input = DOC_TOOL_SCHEMAS[name].parse(rawInput) as Record<string, unknown>;
  const id = typeof input.artifactId === "string" ? input.artifactId : "";

  switch (name) {
    case "specialist_doc_list": {
      const docs = (await listArtifacts(directory)).filter(artifact => artifact.type === "doc").map(artifact => ({
        id: artifact.id,
        title: artifact.title,
        version: artifact.versions.at(-1)?.id ?? "",
        format: formatOf(artifact.metadata),
        updatedAt: artifact.updatedAt,
        workspaceId: artifact.metadata.workspaceId,
      }));
      return { docs, note: docs.length ? "Usá specialist_doc_read con un id para ver líneas y el índice de títulos." : "Todavía no hay documentos; podés crear uno con specialist_doc_create." };
    }
    case "specialist_doc_create": {
      const content = input.content as string;
      const format = formatForContent(content, input.format as DocFormat | undefined);
      const created = await writeArtifact(directory, {
        type: "doc",
        title: input.title as string,
        content,
        metadata: { workspaceId: workspaceIdForPath(directory), schemaVersion: 1, viewer: { format } },
        label: "Creado por el agente",
      });
      return { artifactId: created.meta.id, version: created.meta.versions.at(-1)?.id ?? "", ...summarize(created.meta, content, format), note: "El documento ya está en Artefactos; el visor integrado lo abre sin iframe." };
    }
    case "specialist_doc_read": {
      const artifact = await readArtifact(directory, id);
      requireDocMeta(artifact.meta);
      const lines = artifact.content.split(/\r?\n/);
      const from = Math.max(1, (input.start as number | undefined) ?? 1);
      const to = Math.min(lines.length, (input.end as number | undefined) ?? from + (input.limit as number) - 1);
      const selected = lines.slice(from - 1, to).map((text, index) => ({ line: from + index, text }));
      return {
        artifactId: id,
        version: artifact.meta.versions.at(-1)?.id ?? "",
        format: formatOf(artifact.meta.metadata),
        totalLines: lines.length,
        truncated: artifact.truncated || to < lines.length,
        lines: selected,
        ...(input.outline ? { outline: docOutline(artifact.content) } : {}),
      };
    }
    case "specialist_doc_write": {
      const mode = input.mode as DocWriteMode;
      if ((mode === "before" || mode === "after") && !input.heading) throw new ApiError(422, "doc_heading_required", "Los modos before/after necesitan el parámetro heading.");
      const saved = await mutateArtifactContent(directory, id, (content, meta) => {
        requireDocMeta(meta);
        return docWrite(content, mode, input.heading as string | undefined, input.content as string);
      }, "Edición del agente");
      const artifact = await readArtifact(directory, id);
      return {
        artifactId: id,
        version: saved.meta.versions.at(-1)?.id ?? "",
        changed: saved.changed,
        ...summarize(artifact.meta, artifact.content, formatOf(artifact.meta.metadata)),
      };
    }
    case "specialist_doc_find": {
      const artifact = await readArtifact(directory, id);
      requireDocMeta(artifact.meta);
      const matches = docFind(artifact.content, input.query as string, input.regex as boolean, input.limit as number);
      return { artifactId: id, total: matches.length, matches, note: "Para ir a una línea en el visor, usá specialist_doc_view con scrollTo." };
    }
    case "specialist_doc_export": {
      const artifact = await readArtifact(directory, id);
      requireDocMeta(artifact.meta);
      const format = (input.format as DocFormat | undefined) ?? formatOf(artifact.meta.metadata);
      return { artifactId: id, format, content: artifact.content, note: "El texto vuelve en la respuesta: guardalo con tu herramienta de archivos si hace falta un .md/.mdx." };
    }
    case "specialist_doc_versions": {
      const artifact = await readArtifact(directory, id);
      requireDocMeta(artifact.meta);
      if (input.action === "list") return {
        artifactId: id,
        versions: artifact.meta.versions.map(version => ({ id: version.id, createdAt: version.createdAt, label: version.label ?? "", author: version.author })),
      };
      if (typeof input.versionId !== "string" || !input.versionId) throw new ApiError(422, "doc_version_required", "Indicá versionId con action=revert.");
      await revertArtifact(directory, id, input.versionId);
      return { artifactId: id, note: "El contenido volvió a esa versión; no se borraron las posteriores." };
    }
    case "specialist_doc_view": {
      const keys = ["theme", "zoom", "wrap", "outline", "scrollTo", "format"] as const;
      const changes = keys.filter(key => input[key] !== undefined);
      if (!changes.length) throw new ApiError(422, "doc_view_empty", "Indicá al menos una opción de visor: theme, zoom, wrap, outline, scrollTo o format.");
      const meta = await mutateArtifactMetadata(directory, id, metadata => ({
        ...metadata,
        viewer: { ...viewerOf(metadata), ...Object.fromEntries(changes.map(key => [key, input[key]])) },
      }));
      return { artifactId: id, viewer: viewerOf(meta.metadata), note: "La app refleja el cambio al actualizar el artefacto (15 s como máximo)." };
    }
  }
}
