import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { externalFetch } from "../server-fetch.js";
import { workspaceIdForPath } from "../workspaces.js";
import {
  deleteArtifact, listArtifacts, mutateArtifactContent, mutateArtifactMeta, mutateArtifactMetadata,
  readArtifact, readArtifactFull, revertArtifact, writeArtifact, type ArtifactMeta,
} from "./artifacts.js";
import { applyDocBlockOperation, docBlocks, formatDocSelection, outputToMarkdown } from "./doc-blocks.js";
import { exportDoc, readDocImportFile, saveDocExport } from "./doc-export.js";
import { docFind, docOutline, docWrite, formatForContent, type DocFormat } from "./doc-model.js";
import { auditOutputCitations, extractCitations, readOutput } from "./outputs.js";
import { listSources, readCitation } from "./sources.js";

/** Agent-facing tools for the native document viewer. Content writes are atomic and versioned;
 *  viewer state, comments and source metadata never create a content version. Public schemas stay
 *  provider-safe: no 300 KB maxLength (the artifact store enforces the real byte limit). */

const artifactId = z.string().min(1).max(120).describe("id del artefacto documento (art-…), visible en specialist_doc_list");
const lineNumber = z.number().int().min(1).describe("Número de línea 1-based");
const formatValue = z.enum(["md", "mdx"]);
const exportFormatValue = z.enum(["md", "mdx", "html", "docx", "pdf"]);

export const docListSchema = z.object({});
export const docCreateSchema = z.object({
  title: z.string().trim().min(1).max(200).describe("Título legible del documento nuevo"),
  content: z.string().min(1).describe("Contenido Markdown o MDX; si no tiene título se agrega el título del documento"),
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
  content: z.string().min(1).describe("Texto a escribir; en replace es el documento completo"),
});
export const docBlocksSchema = z.object({
  artifactId,
  action: z.enum(["list", "insert", "update", "move", "duplicate", "delete"]),
  blockId: z.string().max(40).optional().describe("Bloque actual, obtenido con action=list"),
  position: z.enum(["start", "end", "before", "after"]).optional(),
  targetBlockId: z.string().max(40).optional().describe("Bloque destino para insert/move"),
  content: z.string().min(1).optional().describe("Contenido nuevo para insert/update"),
  type: z.enum(["heading", "paragraph", "list", "table", "code", "image", "quote", "hr", "unknown"]).optional(),
  level: z.number().int().min(1).max(6).optional().describe("Nivel de título cuando type=heading"),
});
export const docFormatSchema = z.object({
  artifactId,
  query: z.string().min(1).max(2_000).describe("Texto exacto de la selección"),
  style: z.enum(["bold", "italic", "strike", "code", "link", "clear"]),
  url: z.string().url().optional().describe("URL para style=link"),
  all: z.boolean().default(false).describe("Aplicar a todas las apariciones exactas"),
});
export const docFindSchema = z.object({
  artifactId,
  query: z.string().min(1).max(300).describe("Texto a buscar (o regex si regex=true)"),
  regex: z.boolean().default(false),
  limit: z.number().int().min(1).max(500).default(100),
});
export const docImportSchema = z.object({
  title: z.string().trim().max(200).optional(),
  sourceKind: z.enum(["path", "url", "output"]),
  path: z.string().trim().min(1).max(500).optional().describe("Ruta relativa al proyecto para sourceKind=path"),
  url: z.string().url().max(2_000).optional().describe("URL pública https para sourceKind=url"),
  outputId: z.string().min(1).max(120).optional().describe("Id de salida del mini-Studio para sourceKind=output"),
  format: formatValue.optional(),
});
export const docRenameSchema = z.object({ artifactId, title: z.string().trim().min(1).max(200) });
export const docDeleteSchema = z.object({
  artifactId,
  mode: z.enum(["archive", "delete"]),
  confirm: z.boolean().optional().describe("Debe ser true para mode=delete"),
});
export const docCommentsSchema = z.object({
  artifactId,
  action: z.enum(["list", "add", "update", "resolve", "delete"]),
  commentId: z.string().max(80).optional(),
  quote: z.string().min(1).max(2_000).optional().describe("Texto ancla del documento"),
  blockId: z.string().max(40).optional(),
  text: z.string().min(1).max(8_000).optional(),
  resolved: z.boolean().optional(),
});
export const docCitationsSchema = z.object({
  artifactId,
  action: z.enum(["list", "audit", "add", "remove", "insert"]),
  sourceId: z.string().min(1).max(120).optional(),
  label: z.string().max(300).optional(),
  chunk: z.number().int().min(0).optional(),
  query: z.string().min(1).max(2_000).optional().describe("Texto exacto donde insertar la cita"),
});
export const docExportSchema = z.object({
  artifactId,
  format: exportFormatValue.default("md"),
  path: z.string().trim().min(1).max(500).optional().describe("Ruta relativa para guardar el archivo en el proyecto; requerido para PDF/Word"),
});
export const docVersionsSchema = z.object({
  artifactId,
  action: z.enum(["list", "revert"]),
  versionId: z.string().min(1).max(40).optional().describe("id de la versión a recuperar, visible con action=list"),
});
export const docViewSchema = z.object({
  artifactId,
  action: z.enum(["set", "reset"]).default("set"),
  theme: z.enum(["light", "dark"]).optional(),
  zoom: z.number().int().min(50).max(200).optional(),
  wrap: z.boolean().optional(),
  outline: z.boolean().optional(),
  scrollTo: z.string().min(1).max(200).optional(),
  format: formatValue.optional(),
  mode: z.enum(["preview", "edit"]).optional(),
  search: z.string().max(300).optional(),
  fullscreen: z.boolean().optional(),
});

export const DOC_TOOL_NAMES = [
  "specialist_doc_list", "specialist_doc_create", "specialist_doc_read", "specialist_doc_write",
  "specialist_doc_blocks", "specialist_doc_format", "specialist_doc_find", "specialist_doc_import",
  "specialist_doc_rename", "specialist_doc_delete", "specialist_doc_comments", "specialist_doc_citations",
  "specialist_doc_export", "specialist_doc_versions", "specialist_doc_view",
] as const;
export type DocToolName = typeof DOC_TOOL_NAMES[number];

export const DOC_TOOL_SCHEMAS = {
  specialist_doc_list: docListSchema,
  specialist_doc_create: docCreateSchema,
  specialist_doc_read: docReadSchema,
  specialist_doc_write: docWriteSchema,
  specialist_doc_blocks: docBlocksSchema,
  specialist_doc_format: docFormatSchema,
  specialist_doc_find: docFindSchema,
  specialist_doc_import: docImportSchema,
  specialist_doc_rename: docRenameSchema,
  specialist_doc_delete: docDeleteSchema,
  specialist_doc_comments: docCommentsSchema,
  specialist_doc_citations: docCitationsSchema,
  specialist_doc_export: docExportSchema,
  specialist_doc_versions: docVersionsSchema,
  specialist_doc_view: docViewSchema,
} satisfies Record<DocToolName, z.ZodType>;

type DocInput = Record<string, unknown>;
type Viewer = NonNullable<ArtifactMeta["metadata"]["viewer"]>;
type DocToolDeps = { fetch?: typeof externalFetch; lookup?: typeof lookup };

function requireDocMeta(meta: { type: string }) {
  if (meta.type !== "doc") throw new ApiError(422, "not_a_doc", "Ese artefacto no es un documento; usá specialist_doc_list para encontrar uno.");
}

function viewerOf(metadata: ArtifactMeta["metadata"]): Viewer { return metadata.viewer ?? {}; }
function formatOf(metadata: ArtifactMeta["metadata"]): DocFormat { return viewerOf(metadata).format ?? "md"; }
function ensureHeading(content: string, title: string): string { return /^#{1,6}\s+\S/m.test(content) ? content : `# ${title}\n\n${content.trim()}\n`; }

function summarize(meta: ArtifactMeta, content: string, format: DocFormat) {
  return {
    title: meta.title,
    format,
    lines: content.split(/\r?\n/).length,
    blocks: docBlocks(content).length,
    outlineCount: docOutline(content).length,
    comments: meta.metadata.comments?.filter(comment => !comment.resolved).length ?? 0,
  };
}

async function auditDoc(directory: string, id: string, content: string) {
  const found = extractCitations(content);
  const invalid: Array<{ sourceId: string; chunk: number; reason: string }> = [];
  for (const citation of found) {
    const resolved = await readCitation(directory, citation.sourceId, citation.chunk).catch((error: unknown) => ({
      ok: false as const, error: error instanceof ApiError ? error.message : "fuente ilegible",
    }));
    if (!resolved.ok) invalid.push({ ...citation, reason: resolved.error });
  }
  return {
    total: found.length,
    valid: found.length - invalid.length,
    invalid,
    ...(found.length === 0 ? { note: "sin anclas: este documento no cita fuentes del proyecto" } : {}),
  };
}

function privateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b !== undefined && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b !== undefined && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || b === 0));
  }
  if (isIP(address) === 6) {
    const lower = address.toLowerCase();
    return lower === "::1" || lower === "::" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80:") || lower.startsWith("::ffff:");
  }
  return false;
}

async function assertPublicUrl(raw: string, lookupImpl: typeof lookup = lookup): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new ApiError(422, "invalid_doc_import_url", "La URL de importación debe ser https pública.");
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal") || privateAddress(hostname)) {
    throw new ApiError(422, "invalid_doc_import_url", "No se importa desde loopback, red privada ni dominios internos.");
  }
  const addresses = await lookupImpl(hostname, { all: true }).catch(() => []);
  if (addresses.length && addresses.some(address => privateAddress(address.address))) {
    throw new ApiError(422, "invalid_doc_import_url", "La URL resuelve a una red privada o loopback.");
  }
  return url;
}

async function importFromUrl(raw: string, deps: DocToolDeps): Promise<{ content: string; format: DocFormat }> {
  const url = await assertPublicUrl(raw, deps.lookup);
  const response = await (deps.fetch ?? externalFetch)(url.toString(), {
    redirect: "error", signal: AbortSignal.timeout(15_000), headers: { Accept: "text/markdown,text/plain,text/html,application/xhtml+xml" },
  });
  if (!response.ok) throw new ApiError(422, "doc_import_failed", `La URL respondió ${response.status}; no se creó el documento.`);
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  const extension = (url.pathname.split(".").pop() ?? "").toLowerCase();
  const html = contentType.includes("text/html") || contentType.includes("application/xhtml+xml") || ["html", "htm"].includes(extension);
  const markdown = contentType.includes("text/markdown") || ["md", "mdx"].includes(extension);
  if (!html && !markdown && !contentType.startsWith("text/plain") && !["txt"].includes(extension)) {
    throw new ApiError(422, "invalid_doc_import_format", "La URL no devolvió Markdown, texto o HTML.");
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > 300 * 1024) throw new ApiError(422, "doc_import_too_big", "La URL supera 300 KB de texto.");
  if (html) {
    const TurndownService = (await import("turndown")).default;
    return { content: new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" }).turndown(text), format: "md" };
  }
  return { content: text, format: extension === "mdx" ? "mdx" : "md" };
}

export async function runDocTool(directory: string, name: DocToolName, rawInput: DocInput, deps: DocToolDeps = {}) {
  switch (name) {
    case "specialist_doc_list": {
      docListSchema.parse(rawInput);
      const docs = (await listArtifacts(directory)).filter(artifact => artifact.type === "doc").map(artifact => ({
        id: artifact.id, title: artifact.title, status: artifact.status,
        version: artifact.versions.at(-1)?.id ?? "", format: formatOf(artifact.metadata),
        comments: artifact.metadata.comments?.filter(comment => !comment.resolved).length ?? 0,
        updatedAt: artifact.updatedAt, workspaceId: artifact.metadata.workspaceId,
      }));
      return { docs, note: docs.length ? "Usá specialist_doc_read o specialist_doc_blocks con un id." : "Todavía no hay documentos; podés crear uno con specialist_doc_create o specialist_doc_import." };
    }
    case "specialist_doc_create": {
      const input = docCreateSchema.parse(rawInput);
      const content = ensureHeading(input.content, input.title);
      const format = formatForContent(content, input.format);
      const created = await writeArtifact(directory, {
        type: "doc", title: input.title, content,
        metadata: { workspaceId: workspaceIdForPath(directory), schemaVersion: 1, viewer: { format } },
        label: "Creado por el agente",
      });
      return { artifactId: created.meta.id, version: created.meta.versions.at(-1)?.id ?? "", ...summarize(created.meta, content, format), note: "El documento ya está en Artefactos; abrilo desde Resultados o pedí specialist_doc_view." };
    }
    case "specialist_doc_read": {
      const input = docReadSchema.parse(rawInput);
      const artifact = await readArtifact(directory, input.artifactId);
      requireDocMeta(artifact.meta);
      const lines = artifact.content.split(/\r?\n/);
      const from = Math.max(1, input.start ?? 1);
      const to = Math.min(lines.length, input.end ?? from + input.limit - 1);
      const selected = lines.slice(from - 1, to).map((text, index) => ({ line: from + index, text }));
      return {
        artifactId: input.artifactId, version: artifact.meta.versions.at(-1)?.id ?? "", format: formatOf(artifact.meta.metadata),
        totalLines: lines.length, truncated: artifact.truncated || to < lines.length, lines: selected,
        ...(input.outline ? { outline: docOutline(artifact.content) } : {}),
      };
    }
    case "specialist_doc_write": {
      const input = docWriteSchema.parse(rawInput);
      if ((input.mode === "before" || input.mode === "after") && !input.heading) throw new ApiError(422, "doc_heading_required", "Los modos before/after necesitan el parámetro heading.");
      const saved = await mutateArtifactContent(directory, input.artifactId, (content, meta) => {
        requireDocMeta(meta);
        const next = docWrite(content, input.mode, input.heading, input.content);
        return next === null ? null : ensureHeading(next, meta.title);
      }, "Edición del agente");
      const artifact = await readArtifact(directory, input.artifactId);
      return { artifactId: input.artifactId, version: saved.meta.versions.at(-1)?.id ?? "", changed: saved.changed, ...summarize(artifact.meta, artifact.content, formatOf(artifact.meta.metadata)) };
    }
    case "specialist_doc_blocks": {
      const input = docBlocksSchema.parse(rawInput);
      const saved = await mutateArtifactContent(directory, input.artifactId, (content, meta) => {
        requireDocMeta(meta);
        if (input.action === "list") return null;
        const result = applyDocBlockOperation(content, {
          action: input.action, position: input.position,
          blockId: input.blockId, targetBlockId: input.targetBlockId, content: input.content,
          type: input.type, level: input.level,
        });
        return ensureHeading(result.content, meta.title);
      }, "Edición de bloques");
      const artifact = await readArtifact(directory, input.artifactId);
      const blocks = docBlocks(artifact.content);
      return { artifactId: input.artifactId, version: saved.meta.versions.at(-1)?.id ?? "", changed: saved.changed, blocks };
    }
    case "specialist_doc_format": {
      const input = docFormatSchema.parse(rawInput);
      const saved = await mutateArtifactContent(directory, input.artifactId, (content, meta) => {
        requireDocMeta(meta);
        return formatDocSelection(content, input.query, input.style, input.url, input.all).content;
      }, "Formato de selección");
      return { artifactId: input.artifactId, version: saved.meta.versions.at(-1)?.id ?? "", changed: saved.changed };
    }
    case "specialist_doc_find": {
      const input = docFindSchema.parse(rawInput);
      const artifact = await readArtifact(directory, input.artifactId);
      requireDocMeta(artifact.meta);
      const matches = docFind(artifact.content, input.query, input.regex, input.limit);
      return { artifactId: input.artifactId, total: matches.length, matches, note: "Para ir a una línea en el visor, usá specialist_doc_view con scrollTo; para formatear, specialist_doc_format." };
    }
    case "specialist_doc_import": {
      const input = docImportSchema.parse(rawInput);
      let content = "";
      let format: DocFormat = input.format ?? "md";
      let title = input.title?.trim() || "Documento importado";
      let sources: ArtifactMeta["sources"] = [];
      let metadata: ArtifactMeta["metadata"] = { workspaceId: workspaceIdForPath(directory), schemaVersion: 1 };
      if (input.sourceKind === "path") {
        if (!input.path) throw new ApiError(422, "doc_import_path_required", "Indicá path para importar un archivo.");
        const imported = await readDocImportFile(directory, input.path);
        content = imported.content; format = input.format ?? imported.format;
        title = input.title?.trim() || input.path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") || title;
      } else if (input.sourceKind === "url") {
        if (!input.url) throw new ApiError(422, "doc_import_url_required", "Indicá url para importar una página.");
        const imported = await importFromUrl(input.url, deps);
        content = imported.content; format = input.format ?? imported.format;
        title = input.title?.trim() || decodeURIComponent(new URL(input.url).pathname.split("/").filter(Boolean).pop() ?? "Documento web");
      } else {
        if (!input.outputId) throw new ApiError(422, "doc_import_output_required", "Indicá outputId para importar una salida.");
        const output = await readOutput(directory, input.outputId);
        content = outputToMarkdown(output.meta.kind, output.content);
        title = input.title?.trim() || output.meta.title;
        sources = output.meta.fromSources.map((sourceId): ArtifactMeta["sources"][number] => ({ kind: "source", id: sourceId, label: sourceId }));
        const audit = await auditOutputCitations(directory, output.meta.id);
        metadata = { ...metadata, audit, focus: output.meta.focus };
      }
      content = ensureHeading(content, title);
      metadata = { ...metadata, viewer: { ...viewerOf(metadata), format } };
      const created = await writeArtifact(directory, { type: "doc", title, content, sources, metadata, label: "Importado por el agente" });
      return { artifactId: created.meta.id, version: created.meta.versions.at(-1)?.id ?? "", sourceKind: input.sourceKind, ...summarize(created.meta, content, format) };
    }
    case "specialist_doc_rename": {
      const input = docRenameSchema.parse(rawInput);
      const meta = await mutateArtifactMeta(directory, input.artifactId, current => {
        requireDocMeta(current);
        return { ...current, title: input.title };
      });
      return { artifactId: input.artifactId, title: meta.title };
    }
    case "specialist_doc_delete": {
      const input = docDeleteSchema.parse(rawInput);
      const artifact = await readArtifact(directory, input.artifactId);
      requireDocMeta(artifact.meta);
      if (input.mode === "delete" && input.confirm !== true) throw new ApiError(422, "doc_delete_confirm_required", "El borrado definitivo necesita confirm=true y un pedido explícito de la persona.");
      if (input.mode === "archive") {
        const meta = await mutateArtifactMeta(directory, input.artifactId, current => {
          requireDocMeta(current);
          return { ...current, status: "archived" };
        });
        return { artifactId: input.artifactId, status: meta.status };
      }
      await deleteArtifact(directory, input.artifactId);
      return { artifactId: input.artifactId, deleted: true };
    }
    case "specialist_doc_comments": {
      const input = docCommentsSchema.parse(rawInput);
      if (input.action === "add") {
        const artifact = await readArtifact(directory, input.artifactId);
        requireDocMeta(artifact.meta);
        if (input.quote && !artifact.content.includes(input.quote)) throw new ApiError(404, "doc_comment_anchor_not_found", "La cita del comentario no aparece en el documento.");
      }
      const meta = await mutateArtifactMeta(directory, input.artifactId, current => {
        requireDocMeta(current);
        const comments = [...(current.metadata.comments ?? [])];
        if (input.action === "list") return current;
        if (input.action === "add") {
          if (!input.quote || !input.text) throw new ApiError(422, "doc_comment_required", "Un comentario necesita quote y text.");
          if (comments.length >= 200) throw new ApiError(409, "doc_comment_limit", "El documento ya tiene 200 comentarios.");
          const now = Date.now();
          comments.push({ id: `com_${randomUUID().slice(0, 8)}`, quote: input.quote, text: input.text, blockId: input.blockId, author: "agent", resolved: false, createdAt: now, updatedAt: now });
        } else {
          const index = comments.findIndex(comment => comment.id === input.commentId);
          if (index < 0) throw new ApiError(404, "doc_comment_not_found", "Ese comentario no existe; pedí action=list.");
          if (input.action === "delete") comments.splice(index, 1);
          else if (input.action === "update") {
            if (!input.text) throw new ApiError(422, "doc_comment_required", "Indicá el nuevo text del comentario.");
            comments[index] = { ...comments[index]!, text: input.text, updatedAt: Date.now() };
          } else if (input.action === "resolve") comments[index] = { ...comments[index]!, resolved: input.resolved ?? true, updatedAt: Date.now() };
        }
        return { ...current, metadata: { ...current.metadata, comments } };
      });
      return { artifactId: input.artifactId, comments: meta.metadata.comments ?? [] };
    }
    case "specialist_doc_citations": {
      const input = docCitationsSchema.parse(rawInput);
      const artifact = await readArtifact(directory, input.artifactId);
      requireDocMeta(artifact.meta);
      if (input.action === "audit") {
        const audit = await auditDoc(directory, input.artifactId, artifact.content);
        const meta = await mutateArtifactMeta(directory, input.artifactId, current => ({ ...current, metadata: { ...current.metadata, audit } }));
        return { artifactId: input.artifactId, audit: meta.metadata.audit };
      }
      if (input.action === "insert") {
        if (!input.sourceId || input.chunk === undefined || !input.query) throw new ApiError(422, "doc_citation_required", "Para insertar indicá sourceId, chunk y query.");
        const resolved = await readCitation(directory, input.sourceId, input.chunk);
        if (!resolved.ok) throw new ApiError(422, "doc_citation_invalid", resolved.error);
        const saved = await mutateArtifactContent(directory, input.artifactId, (content, meta) => {
          requireDocMeta(meta);
          const index = content.indexOf(input.query!);
          if (index < 0) throw new ApiError(404, "doc_selection_not_found", "Ese texto no aparece en el documento.");
          return content.slice(0, index + input.query!.length) + ` [fuente:${input.sourceId}#${input.chunk}]` + content.slice(index + input.query!.length);
        }, "Cita insertada");
        return { artifactId: input.artifactId, version: saved.meta.versions.at(-1)?.id ?? "", citation: { sourceId: input.sourceId, chunk: input.chunk } };
      }
      if (input.action === "add" && input.sourceId && !(await listSources(directory)).some(source => source.id === input.sourceId)) {
        throw new ApiError(404, "source_not_found", "Esa fuente no está registrada en el proyecto.");
      }
      const meta = await mutateArtifactMeta(directory, input.artifactId, current => {
        requireDocMeta(current);
        if (input.action === "list") return current;
        if (!input.sourceId) throw new ApiError(422, "doc_source_required", "Indicá sourceId.");
        const sources = current.sources.filter(source => !(source.kind === "source" && source.id === input.sourceId));
        if (input.action === "add") sources.push({ kind: "source", id: input.sourceId, label: input.label ?? input.sourceId! });
        return { ...current, sources };
      });
      const citations = extractCitations(artifact.content);
      return { artifactId: input.artifactId, sources: meta.sources, citations, audit: meta.metadata.audit ?? null, availableSources: (await listSources(directory)).map(source => ({ id: source.id, title: source.title, chunks: source.chunks })) };
    }
    case "specialist_doc_export": {
      const input = docExportSchema.parse(rawInput);
      const artifact = await readArtifactFull(directory, input.artifactId);
      requireDocMeta(artifact.meta);
      const exported = await exportDoc(directory, artifact.meta.title, artifact.content, input.format);
      if (input.path) {
        const path = await saveDocExport(directory, input.path, exported.bytes);
        return { artifactId: input.artifactId, format: input.format, path, bytes: exported.bytes.length, note: "Archivo guardado en el proyecto; la persona puede abrirlo o descargarlo." };
      }
      if (input.format === "docx" || input.format === "pdf") throw new ApiError(422, "doc_export_path_required", "PDF/Word necesitan path para guardar el archivo binario en el proyecto.");
      return { artifactId: input.artifactId, format: input.format, content: exported.bytes.toString("utf8"), note: "Contenido listo para guardar con tu herramienta de archivos." };
    }
    case "specialist_doc_versions": {
      const input = docVersionsSchema.parse(rawInput);
      const artifact = await readArtifact(directory, input.artifactId);
      requireDocMeta(artifact.meta);
      if (input.action === "list") return {
        artifactId: input.artifactId,
        versions: artifact.meta.versions.map(version => ({ id: version.id, createdAt: version.createdAt, label: version.label ?? "", author: version.author })),
      };
      if (!input.versionId) throw new ApiError(422, "doc_version_required", "Indicá versionId con action=revert.");
      await revertArtifact(directory, input.artifactId, input.versionId);
      return { artifactId: input.artifactId, note: "El contenido volvió a esa versión; no se borraron las posteriores." };
    }
    case "specialist_doc_view": {
      const input = docViewSchema.parse(rawInput);
      const artifact = await readArtifact(directory, input.artifactId);
      requireDocMeta(artifact.meta);
      const keys = ["theme", "zoom", "wrap", "outline", "scrollTo", "format", "mode", "search", "fullscreen"] as const;
      const changes = keys.filter(key => input[key] !== undefined);
      if (input.action === "set" && !changes.length) throw new ApiError(422, "doc_view_empty", "Indicá al menos una opción de visor o action=reset.");
      const meta = await mutateArtifactMetadata(directory, input.artifactId, metadata => {
        const current = viewerOf(metadata);
        return {
          ...metadata,
          viewer: input.action === "reset"
            ? { format: current.format ?? "md", theme: "light", zoom: 100, wrap: true, outline: false, mode: "preview", search: "", fullscreen: false }
            : { ...current, ...Object.fromEntries(changes.map(key => [key, input[key]])) },
        };
      });
      return { artifactId: input.artifactId, viewer: viewerOf(meta.metadata), note: "La app refleja el cambio al actualizar el artefacto (15 s como máximo)." };
    }
  }
}
