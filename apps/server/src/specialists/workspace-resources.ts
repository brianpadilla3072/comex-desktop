import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { openworkConfigDir } from "@openwork/paths";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { resolveSafeChildPath } from "../routes/files.js";
import { workspaceIdForPath } from "../workspaces.js";
import { dataPath, dataRelative } from "./project-data.js";
import { listArtifacts, readArtifact } from "./artifacts.js";
import { listDatasets, readLatestSnapshot } from "./datasets.js";
import { listOutputs, readOutput } from "./outputs.js";
import { ensureChunks, listSources } from "./sources.js";

/** "Guardar en workspace" para CUALQUIER fuente: archivos, URLs, credenciales, fuentes
 *  citables, datasets, salidas y artefactos. El contenido vive en `proyecto/recursos/`
 *  (sale en la exportación .owapp y se sincroniza con la memoria de la app); los secretos
 *  NUNCA entran al workspace: van a una carpeta privada del sistema, 0700/0600, por workspace. */

const MAX_CONTENT = 8_000_000;

export const workspaceResourceInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("file"),
    path: z.string().trim().min(1).max(1000).describe("Ruta relativa del archivo dentro del workspace"),
    name: z.string().trim().min(1).max(200).optional().describe("Nombre destino opcional; por defecto el del archivo"),
    content: z.string().max(MAX_CONTENT).optional().describe("Contenido en texto cuando el archivo aún no está en disco"),
  }),
  z.object({
    kind: z.literal("url"),
    url: z.string().url().max(2000).describe("URL http/https a recordar"),
    title: z.string().trim().max(200).optional().describe("Etiqueta legible opcional"),
  }),
  z.object({
    kind: z.literal("credential"),
    origin: z.string().url().max(2000).describe("Origen del sitio (se guarda solo el origin, sin usuario ni contraseña)"),
    alias: z.string().trim().min(1).max(120).describe("Alias legible, sin secretos"),
    secret: z.string().max(20_000).optional().describe("Valor a guardar en la carpeta privada del sistema; NUNCA se copia al workspace"),
  }),
  z.object({
    kind: z.enum(["source", "dataset", "output", "artifact"]),
    id: z.string().trim().min(1).max(200).describe("Id de la fuente, dataset, salida o artefacto del proyecto"),
  }),
]);
export type WorkspaceResourceInput = z.infer<typeof workspaceResourceInputSchema>;

export const savedResourceSchema = z.object({
  id: z.string(),
  kind: z.enum(["file", "url", "credential", "source", "dataset", "output", "artifact"]),
  title: z.string(),
  savedAt: z.number(),
  path: z.string().optional(),
  url: z.string().optional(),
  origin: z.string().optional(),
  alias: z.string().optional(),
  sourceId: z.string().optional(),
  secretRef: z.string().optional(),
  sha256: z.string().optional(),
});
export type SavedResource = z.infer<typeof savedResourceSchema>;

export type WorkspaceResourceResult = {
  resource: SavedResource;
  created: boolean;
  workspacePath: string;
  note: string;
};

const resourcesDir = (directory: string) => dataPath(directory, "recursos");
const filesDir = (directory: string) => join(resourcesDir(directory), "archivos");
const indexFile = (directory: string) => join(resourcesDir(directory), "index.json");

async function readIndex(directory: string): Promise<SavedResource[]> {
  try {
    const parsed = z.array(savedResourceSchema).safeParse(JSON.parse(await readFile(indexFile(directory), "utf8")));
    return parsed.success ? parsed.data : [];
  } catch { return []; }
}

async function writeIndex(directory: string, entries: SavedResource[]) {
  const file = indexFile(directory);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(temp, JSON.stringify(entries, null, 2), { mode: 0o600 });
  await rename(temp, file);
}

function stableId(kind: string, key: string) {
  return `res_${createHash("sha256").update(`${kind}\u0000${key}`).digest("hex").slice(0, 16)}`;
}

function safeName(name: string, fallback: string) {
  const base = basename(name || fallback).replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "").slice(0, 160);
  return base || "recurso.txt";
}

async function resolveContent(directory: string, input: WorkspaceResourceInput): Promise<{ title: string; extension: string; content: Buffer; sourceId?: string; url?: string }> {
  if (input.kind === "file") {
    // The artifact panel hands us the same absolute path it uses to download; the agent usually
    // passes a workspace-relative one. Accept both, but never anything outside the workspace.
    const rooted = isAbsolute(input.path) ? relative(resolve(directory), resolve(input.path)) : input.path;
    if (!rooted || rooted.startsWith("..") || isAbsolute(rooted)) throw new ApiError(400, "invalid_path", "El archivo debe estar dentro del workspace.");
    const source = resolveSafeChildPath(directory, rooted);
    const name = safeName(input.name ?? basename(input.path), "recurso.txt");
    if (input.content !== undefined) return { title: name, extension: extname(name), content: Buffer.from(input.content, "utf8") };
    const bytes = await readFile(source);
    if (bytes.byteLength > MAX_CONTENT) throw new ApiError(422, "resource_too_big", "El archivo supera 8 MB; sube un extracto en texto.");
    return { title: name, extension: extname(name), content: bytes };
  }
  if (input.kind === "url") {
    const parsed = new URL(input.url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new ApiError(422, "invalid_url", "Solo se pueden guardar URLs http/https.");
    if (parsed.username || parsed.password) throw new ApiError(422, "invalid_url", "La URL no debe traer usuario ni contraseña; usa una credencial.");
    return { title: input.title?.trim() || parsed.hostname, extension: ".url", content: Buffer.from(`${parsed.href}\n`, "utf8"), url: parsed.href };
  }
  if (input.kind === "credential") {
    const parsed = new URL(input.origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new ApiError(422, "invalid_origin", "El origen debe ser http/https.");
    // The workspace copy carries the alias only; the secret goes to the private store below.
    return { title: input.alias, extension: ".json", content: Buffer.from(JSON.stringify({ origin: parsed.origin, alias: input.alias }, null, 2), "utf8") };
  }
  if (input.kind === "source") {
    const source = (await listSources(directory)).find(entry => entry.id === input.id);
    if (!source) throw new ApiError(404, "resource_not_found", "Esa fuente no existe en este proyecto.");
    const { chunks } = await ensureChunks(directory, input.id);
    return { title: source.title || input.id, extension: ".md", content: Buffer.from(chunks.join("\n\n---\n\n"), "utf8"), sourceId: input.id };
  }
  if (input.kind === "dataset") {
    const dataset = (await listDatasets(directory)).find(entry => entry.id === input.id);
    if (!dataset) throw new ApiError(404, "resource_not_found", "Ese dataset no existe en este proyecto.");
    const snapshot = await readLatestSnapshot(directory, input.id);
    return { title: dataset.name || input.id, extension: ".json", content: Buffer.from(JSON.stringify(snapshot, null, 2), "utf8"), sourceId: input.id };
  }
  if (input.kind === "output") {
    const { meta, content } = await readOutput(directory, input.id);
    return { title: meta.title, extension: meta.kind === "report" || meta.kind === "mindmap" ? ".md" : ".json", content: Buffer.from(content, "utf8"), sourceId: input.id };
  }
  const meta = (await listArtifacts(directory)).find(entry => entry.id === input.id);
  if (!meta) throw new ApiError(404, "resource_not_found", "Ese documento o hoja no existe en este proyecto.");
  const { content } = await readArtifact(directory, input.id);
  return { title: meta.title, extension: meta.type === "sheet" || meta.type === "data" ? ".json" : ".md", content: Buffer.from(content, "utf8"), sourceId: input.id };
}

/** Private, outside the repo and outside the workspace: one folder per workspace id. */
export function credentialStorePath(config: { configPath?: string }, workspaceId: string): string {
  const configDir = config.configPath?.trim() ? dirname(config.configPath) : openworkConfigDir();
  const safeWorkspace = createHash("sha256").update(workspaceId).digest("hex").slice(0, 24);
  return join(configDir, "workspaces", safeWorkspace, "credentials.json");
}

type CredentialStore = { schemaVersion: 1; updatedAt: number; entries: Array<{ alias: string; origin: string; secret: string; updatedAt: number }> };

async function writeCredential(config: { configPath?: string }, workspaceId: string, input: Extract<WorkspaceResourceInput, { kind: "credential" }>) {
  if (input.secret === undefined) return null;
  const origin = new URL(input.origin).origin;
  const file = credentialStorePath(config, workspaceId);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  let store: CredentialStore = { schemaVersion: 1, updatedAt: Date.now(), entries: [] };
  try {
    const parsed = z.object({
      schemaVersion: z.literal(1).catch(1), updatedAt: z.number().catch(0),
      entries: z.array(z.object({ alias: z.string(), origin: z.string(), secret: z.string(), updatedAt: z.number() })).catch([]),
    }).safeParse(JSON.parse(await readFile(file, "utf8")));
    if (parsed.success) store = parsed.data;
  } catch { /* New private store. */ }
  store.entries = [
    ...store.entries.filter(entry => entry.alias !== input.alias || entry.origin !== origin),
    { alias: input.alias, origin, secret: input.secret, updatedAt: Date.now() },
  ];
  store.updatedAt = Date.now();
  const temp = `${file}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(temp, JSON.stringify(store, null, 2), { mode: 0o600 });
  await rename(temp, file);
  return stableId("credential", `${origin}\u0000${input.alias}`);
}

export async function saveWorkspaceResource(
  config: { configPath?: string }, directory: string, input: WorkspaceResourceInput,
): Promise<WorkspaceResourceResult> {
  const { title, extension, content, sourceId, url } = await resolveContent(directory, input);
  const sha256 = createHash("sha256").update(content).digest("hex");
  const key = input.kind === "file" ? `${input.path}\u0000${sha256}`
    : input.kind === "url" ? url ?? ""
      : input.kind === "credential" ? `${new URL(input.origin).origin}\u0000${input.alias}`
        : `${input.kind}\u0000${input.id}`;
  const id = stableId(input.kind, key);
  const entries = await readIndex(directory);
  const existing = entries.find(entry => entry.id === id);
  const workspaceId = workspaceIdForPath(directory);
  // A credential's workspace copy is only an alias, so its hash never changes. Still write the
  // private value on every call: rotating a secret must not be swallowed by content dedup.
  const secretRef = input.kind === "credential" ? await writeCredential(config, workspaceId, input) : undefined;
  if (existing && existing.sha256 === sha256) {
    const note = secretRef && input.kind === "credential" && input.secret !== undefined
      ? "La referencia ya estaba; el valor privado quedó actualizado. No se duplicó nada."
      : "Ya estaba guardado con este mismo contenido: no se duplicó.";
    return { resource: existing, created: false, workspacePath: existing.path ?? dataRelative(directory, "recursos", "index.json"), note };
  }

  let relativePath: string | undefined;
  if (input.kind !== "credential") {
    const folder = filesDir(directory);
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const stem = safeName(title, "recurso").replace(/\.[^.]+$/, "");
    const fileName = existing?.path ? basename(existing.path) : `${stem}-${sha256.slice(0, 8)}${extension}`;
    const target = join(folder, fileName);
    const temp = `${target}.${randomUUID().slice(0, 8)}.tmp`;
    await writeFile(temp, content, { mode: 0o600 });
    await rename(temp, target);
    relativePath = dataRelative(directory, "recursos", "archivos", fileName);
  } else {
    relativePath = dataRelative(directory, "recursos", "index.json");
  }

  const resource: SavedResource = {
    id, kind: input.kind, title, savedAt: Date.now(), path: relativePath, sha256,
    ...(sourceId ? { sourceId } : {}), ...(url ? { url } : {}), ...(secretRef ? { secretRef } : {}),
    ...(input.kind === "credential" ? { origin: new URL(input.origin).origin, alias: input.alias } : {}),
  };
  await writeIndex(directory, [...entries.filter(entry => entry.id !== id), resource]);
  const note = input.kind === "credential"
    ? input.secret === undefined
      ? "La referencia quedó en el workspace; no se guardó ningún secreto."
      : "El alias quedó en el workspace y el valor en la carpeta privada de OpenWork, fuera del proyecto."
    : "Quedó guardado en proyecto/recursos/: viaja con la aplicación y sigue disponible al recargar.";
  return { resource, created: true, workspacePath: relativePath, note };
}

export async function listWorkspaceResources(directory: string): Promise<SavedResource[]> {
  return readIndex(directory);
}

/** Used by the file route to stream a pinned resource back to the person. */
export async function readWorkspaceResource(directory: string, id: string): Promise<{ resource: SavedResource; content: Buffer }> {
  const resource = (await readIndex(directory)).find(entry => entry.id === id);
  if (!resource) throw new ApiError(404, "resource_not_found", "Ese recurso guardado no existe.");
  if (!resource.path || resource.path === "proyecto/recursos/index.json") throw new ApiError(409, "resource_without_file", "Ese recurso no tiene archivo (es una referencia).");
  const file = resolveSafeChildPath(directory, resource.path);
  return { resource, content: await readFile(file) };
}
