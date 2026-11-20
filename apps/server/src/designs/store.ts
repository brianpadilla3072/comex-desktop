import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import {
  DESIGN_LIMITS, boardSchema, designIdSchema, designManifestSchema, designTokensSchema, pageIdSchema,
  type DesignKind, type DesignManifest, type DesignPage,
} from "@openwork/types/designs";
import { ApiError } from "../errors.js";
import { resolveSafeChildPath } from "../routes/files.js";
import { familyLock, withFileLock } from "../specialists/file-lock.js";
import { dataPath, dataRelative, ensureProjectDataDir } from "../specialists/project-data.js";
import { bumpedTime, checkDesignPath, designIdFor, fileByteLimit, insertPage, isPng, nextPageId, pageSize, reorderPages } from "./core.js";
import { blankPageHtml, boardTemplate, firstPageHtml, systemTokens } from "./templates.js";

/**
 * Designs on disk: `<project>/<data>/diseno/<designId>/` (layout in packages/types/src/designs.ts).
 * Every read of `design.json` goes through `designManifestSchema`; every manifest write is
 * serialized per design (`withFileLock`) and atomic (temporary file + rename). Links are never
 * followed: a design folder, a file or any folder on the way that is a symbolic link is refused.
 */

export const DESIGNS_DIR = "diseno";
export const MANIFEST_FILE = "design.json";
const CHATS_FILE = "chats.json";
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_CHAT_BINDINGS = 2_000;

export const designsRoot = (projectRoot: string) => dataPath(projectRoot, DESIGNS_DIR);
/** Workspace-relative folder of a design, as the agent sees it ("proyecto/diseno/<id>"). */
export const designAgentPath = (projectRoot: string, designId: string) => dataRelative(projectRoot, DESIGNS_DIR, designId);

const notFound = () => new ApiError(404, "design_not_found", "Ese diseño no existe.");
const unsafe = () => new ApiError(409, "design_unsafe_path", "La carpeta del diseño no es una carpeta local segura.");

async function lstatOrNull(path: string) {
  return lstat(path).catch(() => null);
}

/** The design folder, verified: a real directory (not a link) whose real location stays in the project. */
export async function designDir(projectRoot: string, designId: string): Promise<string> {
  if (!designIdSchema.safeParse(designId).success) throw notFound();
  const root = designsRoot(projectRoot);
  const rootInfo = await lstatOrNull(root);
  if (!rootInfo) throw notFound();
  if (!rootInfo.isDirectory()) throw unsafe();
  const dir = join(root, designId);
  const info = await lstatOrNull(dir);
  if (!info) throw notFound();
  if (!info.isDirectory()) throw unsafe();
  const [realProject, realDir] = await Promise.all([realpath(projectRoot), realpath(dir)]);
  if (!realDir.startsWith(realProject + sep)) throw unsafe();
  return dir;
}

/** Atomic write: a temporary sibling, then rename over the target. */
async function atomicWrite(path: string, bytes: Uint8Array | string) {
  const temporary = join(dirname(path), `.tmp-${randomUUID()}`);
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }).catch(() => undefined); }
}

const parseJson = (text: string): unknown => {
  try { return z.unknown().parse(JSON.parse(text)); } catch { return undefined; }
};

async function readManifestAt(dir: string, designId: string): Promise<DesignManifest> {
  const path = join(dir, MANIFEST_FILE);
  const info = await lstatOrNull(path);
  if (!info) throw notFound();
  if (!info.isFile() || info.size > MAX_MANIFEST_BYTES) throw new ApiError(422, "design_manifest_invalid", "El archivo design.json del diseño no es válido.");
  const parsed = designManifestSchema.safeParse(parseJson(await readFile(path, "utf8")));
  if (!parsed.success || parsed.data.id !== designId) throw new ApiError(422, "design_manifest_invalid", "El archivo design.json del diseño no es válido.");
  return parsed.data;
}

export async function readManifest(projectRoot: string, designId: string): Promise<DesignManifest> {
  return readManifestAt(await designDir(projectRoot, designId), designId);
}

const manifestLock = (dir: string) => familyLock(dir, "design-manifest");

async function writeManifestAt(dir: string, manifest: DesignManifest) {
  await atomicWrite(join(dir, MANIFEST_FILE), `${JSON.stringify(designManifestSchema.parse(manifest), null, 2)}\n`);
}

/** Read, change and save the manifest under its lock; `updatedAt` always moves forward. */
export async function updateManifest(projectRoot: string, designId: string, change: (manifest: DesignManifest) => DesignManifest | Promise<DesignManifest>, now = Date.now()): Promise<DesignManifest> {
  const dir = await designDir(projectRoot, designId);
  return withFileLock(manifestLock(dir), async () => {
    const current = await readManifestAt(dir, designId);
    const next = designManifestSchema.parse({ ...(await change(current)), id: current.id, kind: current.kind, createdAt: current.createdAt, updatedAt: bumpedTime(current.updatedAt, now) });
    await writeManifestAt(dir, next);
    return next;
  });
}

/** Every valid design of the project; folders that are links or carry no valid manifest are skipped. */
export async function listDesigns(projectRoot: string): Promise<DesignManifest[]> {
  const root = designsRoot(projectRoot);
  const info = await lstatOrNull(root);
  if (!info?.isDirectory()) return [];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const designs: DesignManifest[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !designIdSchema.safeParse(entry.name).success) continue;
    const manifest = await readManifest(projectRoot, entry.name).catch(() => null);
    if (manifest) designs.push(manifest);
  }
  return designs;
}

export async function createDesign(projectRoot: string, input: { kind: DesignKind; title: string }, now = Date.now()): Promise<DesignManifest> {
  await ensureProjectDataDir(projectRoot);
  const root = designsRoot(projectRoot);
  const rootInfo = await lstatOrNull(root);
  if (rootInfo && !rootInfo.isDirectory()) throw unsafe();
  if (!rootInfo) await mkdir(root, { recursive: true });
  return withFileLock(familyLock(projectRoot, "designs"), async () => {
    const entries = await readdir(root, { withFileTypes: true });
    if (entries.filter(entry => entry.isDirectory()).length >= DESIGN_LIMITS.designsPerProject) {
      throw new ApiError(409, "design_capacity", `Un proyecto puede tener hasta ${DESIGN_LIMITS.designsPerProject} diseños.`);
    }
    const id = designIdFor(input.title, new Set(entries.map(entry => entry.name)));
    const dir = join(root, id);
    // Not recursive: a folder created in between by someone else is a conflict, never shared.
    await mkdir(dir);
    try {
      await mkdir(join(dir, "pages"));
      await mkdir(join(dir, "assets"));
      const page: DesignPage = { id: "p-1", title: input.kind === "slides" ? "Portada" : input.kind === "system" ? "Overview" : input.kind === "board" ? "Pizarra" : "Pantalla 1", file: "pages/p-1.html", ...pageSize(input.kind) };
      await writeFile(join(dir, page.file), firstPageHtml(input.kind, input.title), { mode: 0o600 });
      if (input.kind === "board") await writeFile(join(dir, "board.json"), `${JSON.stringify(boardTemplate(), null, 2)}\n`, { mode: 0o600 });
      if (input.kind === "system") await writeFile(join(dir, "tokens.json"), `${JSON.stringify(systemTokens(), null, 2)}\n`, { mode: 0o600 });
      const manifest = designManifestSchema.parse({
        format: "openwork.design", version: 1, id, kind: input.kind, title: input.title,
        createdAt: now, updatedAt: now, pages: [page], systemId: null, thumbnail: null,
      });
      await writeManifestAt(dir, manifest);
      return manifest;
    } catch (error) {
      await rm(dir, { recursive: true, force: true });
      throw error;
    }
  });
}

export async function deleteDesign(projectRoot: string, designId: string): Promise<void> {
  const dir = await designDir(projectRoot, designId);
  await withFileLock(manifestLock(dir), () => rm(dir, { recursive: true, force: true }));
  await unbindDesignChats(projectRoot, designId);
}

/**
 * A file inside a design: the path must pass `checkDesignPath`, stay inside the folder after
 * resolving links (`resolveSafeChildPath`) and no existing segment may be a link.
 */
export async function designFilePath(projectRoot: string, designId: string, input: string) {
  const checked = checkDesignPath(input);
  if (!checked.ok) throw new ApiError(400, "design_path_invalid", "La ruta debe ser relativa a la carpeta del diseño, sin carpetas ocultas ni \"..\".");
  const dir = await designDir(projectRoot, designId);
  let path: string;
  try { path = resolveSafeChildPath(dir, checked.path); } catch { throw new ApiError(400, "design_path_invalid", "La ruta sale de la carpeta del diseño."); }
  let walk = dir;
  for (const part of relative(dir, path).split(sep)) {
    walk = join(walk, part);
    const info = await lstatOrNull(walk);
    if (!info) break;
    if (info.isSymbolicLink()) throw new ApiError(400, "design_path_invalid", "Los enlaces simbólicos no se siguen.");
  }
  return { dir, path, relativePath: checked.path, role: checked.role };
}

export async function readDesignFile(projectRoot: string, designId: string, input: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; relativePath: string }> {
  const file = await designFilePath(projectRoot, designId, input);
  const info = await lstatOrNull(file.path);
  if (!info?.isFile()) throw new ApiError(404, "design_file_not_found", "Ese archivo no existe en el diseño.");
  if (info.size > fileByteLimit(file.role)) throw new ApiError(413, "design_file_too_large", "El archivo supera el tamaño permitido.");
  return { bytes: new Uint8Array(await readFile(file.path)), relativePath: file.relativePath };
}

/** Bytes used by every regular file of the folder (links are not counted, nor followed). */
async function folderBytes(dir: string): Promise<number> {
  let total = 0;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) total += await folderBytes(path);
    else if (entry.isFile()) total += (await lstatOrNull(path))?.size ?? 0;
  }
  return total;
}

/** The files of a design (relative, forward slashes), skipping hidden names and links. */
export async function designFiles(dir: string, prefix = ""): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(join(dir, prefix), { withFileTypes: true }).catch(() => []);
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".")) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await designFiles(dir, rel));
    else if (entry.isFile()) files.push(rel);
  }
  return files;
}

/** Validate the JSON files with a schema of their own before they land. */
function validateKnownJson(role: string, bytes: Uint8Array) {
  if (role !== "board" && role !== "tokens") return;
  const value = parseJson(new TextDecoder().decode(bytes));
  const ok = role === "board" ? boardSchema.safeParse(value).success : designTokensSchema.safeParse(value).success;
  if (!ok) throw new ApiError(422, role === "board" ? "design_board_invalid" : "design_tokens_invalid", role === "board" ? "El archivo board.json no tiene el formato de una pizarra." : "El archivo tokens.json no tiene el formato de un sistema de diseño.");
}

export async function writeDesignFile(projectRoot: string, designId: string, input: string, bytes: Uint8Array, now = Date.now()): Promise<DesignManifest> {
  const file = await designFilePath(projectRoot, designId, input);
  if (file.role === "manifest") throw new ApiError(409, "design_manifest_reserved", "El manifiesto se cambia con las acciones del diseño, no como archivo.");
  if (bytes.byteLength > fileByteLimit(file.role)) throw new ApiError(413, "design_file_too_large", "El archivo supera el tamaño permitido.");
  if (file.role === "thumbnail" && !isPng(bytes)) throw new ApiError(415, "design_thumbnail_not_png", "La miniatura debe ser una imagen PNG.");
  validateKnownJson(file.role, bytes);
  return withFileLock(manifestLock(file.dir), async () => {
    const existing = await lstatOrNull(file.path);
    if (existing && !existing.isFile()) throw unsafe();
    if (await folderBytes(file.dir) - (existing?.size ?? 0) + bytes.byteLength > DESIGN_LIMITS.designBytes) {
      throw new ApiError(413, "design_capacity_bytes", "El diseño supera el espacio permitido.");
    }
    await mkdir(dirname(file.path), { recursive: true });
    // The folders just created could not be links; the check above already covered existing ones.
    await atomicWrite(file.path, bytes);
    const current = await readManifestAt(file.dir, designId);
    const next = designManifestSchema.parse({ ...current, updatedAt: bumpedTime(current.updatedAt, now), ...(file.role === "thumbnail" ? { thumbnail: file.relativePath } : {}) });
    await writeManifestAt(file.dir, next);
    return next;
  });
}

export async function addPage(projectRoot: string, designId: string, input: { title?: string; afterPageId?: string; html?: string }, now = Date.now()): Promise<DesignManifest> {
  const dir = await designDir(projectRoot, designId);
  if (input.html !== undefined && new TextEncoder().encode(input.html).byteLength > DESIGN_LIMITS.pageBytes) {
    throw new ApiError(413, "design_file_too_large", "La página supera el tamaño permitido.");
  }
  return withFileLock(manifestLock(dir), async () => {
    const current = await readManifestAt(dir, designId);
    if (current.pages.length >= DESIGN_LIMITS.pages) throw new ApiError(409, "design_pages_capacity", `Un diseño puede tener hasta ${DESIGN_LIMITS.pages} páginas.`);
    let id = nextPageId(current.pages);
    // A leftover file from a removed page is never overwritten.
    while (await lstatOrNull(join(dir, "pages", `${id}.html`))) id = nextPageId([...current.pages, { id }]);
    const title = input.title?.trim() || `Página ${current.pages.length + 1}`;
    const page: DesignPage = { id, title, file: `pages/${id}.html`, ...pageSize(current.kind) };
    const pagesInfo = await lstatOrNull(join(dir, "pages"));
    if (pagesInfo && !pagesInfo.isDirectory()) throw unsafe();
    await mkdir(join(dir, "pages"), { recursive: true });
    await atomicWrite(join(dir, page.file), input.html ?? blankPageHtml(current.kind, title));
    const next = designManifestSchema.parse({ ...current, pages: insertPage(current.pages, page, input.afterPageId), updatedAt: bumpedTime(current.updatedAt, now) });
    await writeManifestAt(dir, next);
    return next;
  });
}

export async function reorderDesignPages(projectRoot: string, designId: string, pageIds: string[], now = Date.now()) {
  return updateManifest(projectRoot, designId, current => {
    const pages = reorderPages(current.pages, pageIds);
    if (!pages) throw new ApiError(422, "design_pages_mismatch", "El nuevo orden debe incluir cada página una vez.");
    return { ...current, pages };
  }, now);
}

export async function deleteDesignPage(projectRoot: string, designId: string, pageId: string, now = Date.now()) {
  if (!pageIdSchema.safeParse(pageId).success) throw new ApiError(404, "design_page_not_found", "Esa página no existe.");
  const dir = await designDir(projectRoot, designId);
  return withFileLock(manifestLock(dir), async () => {
    const current = await readManifestAt(dir, designId);
    const page = current.pages.find(entry => entry.id === pageId);
    if (!page) throw new ApiError(404, "design_page_not_found", "Esa página no existe.");
    if (current.pages.length === 1) throw new ApiError(409, "design_last_page", "Un diseño necesita al menos una página.");
    const pages = current.pages.filter(entry => entry.id !== pageId);
    const next = designManifestSchema.parse({ ...current, pages, updatedAt: bumpedTime(current.updatedAt, now) });
    await writeManifestAt(dir, next);
    // The document goes too, unless another page still uses it.
    if (!pages.some(entry => entry.file === page.file)) {
      const target = resolve(dir, page.file);
      const info = await lstatOrNull(target);
      if (info?.isFile() && target.startsWith(dir + sep)) await rm(target, { force: true });
    }
    return next;
  });
}

// ---- Chats bound to a design (which session works on which design) ----

const chatsSchema = z.object({
  format: z.literal("openwork.design-chats"),
  version: z.literal(1),
  /** sessionId → designId, oldest first. */
  sessions: z.record(z.string().min(1).max(200), designIdSchema),
});
type Chats = z.infer<typeof chatsSchema>;

async function readChats(projectRoot: string): Promise<Chats> {
  const path = join(designsRoot(projectRoot), CHATS_FILE);
  const info = await lstatOrNull(path);
  if (!info?.isFile() || info.size > MAX_MANIFEST_BYTES) return { format: "openwork.design-chats", version: 1, sessions: {} };
  const parsed = chatsSchema.safeParse(parseJson(await readFile(path, "utf8").catch(() => "")));
  return parsed.success ? parsed.data : { format: "openwork.design-chats", version: 1, sessions: {} };
}

async function changeChats(projectRoot: string, change: (sessions: Record<string, string>) => Record<string, string>) {
  return withFileLock(familyLock(projectRoot, "design-chats"), async () => {
    const root = designsRoot(projectRoot);
    const info = await lstatOrNull(root);
    if (!info) return;
    if (!info.isDirectory()) throw unsafe();
    const current = await readChats(projectRoot);
    const entries = Object.entries(change({ ...current.sessions }));
    const sessions = Object.fromEntries(entries.slice(Math.max(0, entries.length - MAX_CHAT_BINDINGS)));
    await atomicWrite(join(root, CHATS_FILE), `${JSON.stringify(chatsSchema.parse({ ...current, sessions }), null, 2)}\n`);
  });
}

/** Bind a chat session to a design: from then on its prompts carry the design guidance. */
export async function bindDesignChat(projectRoot: string, designId: string, sessionId: string) {
  await designDir(projectRoot, designId);
  await changeChats(projectRoot, sessions => {
    delete sessions[sessionId];
    return { ...sessions, [sessionId]: designId };
  });
}

async function unbindDesignChats(projectRoot: string, designId: string) {
  await changeChats(projectRoot, sessions => Object.fromEntries(Object.entries(sessions).filter(([, id]) => id !== designId)));
}

/** The chat sessions of a design, newest binding first. */
export async function designChats(projectRoot: string, designId: string): Promise<string[]> {
  const { sessions } = await readChats(projectRoot);
  return Object.entries(sessions).filter(([, id]) => id === designId).map(([sessionId]) => sessionId).reverse();
}

/** The design a session is bound to, or null. */
export async function designForSession(projectRoot: string, sessionId: string): Promise<string | null> {
  const { sessions } = await readChats(projectRoot);
  return sessions[sessionId] ?? null;
}
