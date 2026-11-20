import { opendir, mkdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { z } from "zod";
import { webFolderBrowserEnabled } from "./comex/features.js";
import { ApiError } from "./errors.js";
import { addRoute, type Route } from "./routes/registry.js";
import type { ServerConfig } from "./types.js";

/**
 * Folder browser for the web app (docs/features/web-folder-browser). A browser cannot open a
 * native folder picker on the server's machine, so owners (the desktop host token or a paired
 * device) list subfolders of allowed roots here and pick one to create a workspace.
 */

/** Most folders returned in one listing; `truncated` tells the UI there were more. */
export const FOLDER_BROWSER_MAX_ENTRIES = 500;
/** Directory entries read before giving up on a huge folder (files count too). */
export const FOLDER_BROWSER_MAX_SCAN = 20_000;
/** Folder creations allowed per window, across all callers of this server. */
export const FOLDER_BROWSER_CREATE_LIMIT = 30;
export const FOLDER_BROWSER_CREATE_WINDOW_MS = 60_000;
const MAX_NAME_BYTES = 255;

export const folderEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  isGitRepo: z.boolean(),
  hasOpencode: z.boolean(),
});
export const folderListingSchema = z.object({
  path: z.string(),
  parent: z.string().nullable(),
  root: z.string(),
  roots: z.array(z.object({ name: z.string(), path: z.string() })),
  entries: z.array(folderEntrySchema),
  truncated: z.boolean(),
});
export type FolderListing = z.infer<typeof folderListingSchema>;
const createFolderBodySchema = z.object({ parent: z.string().min(1), name: z.string() });

// ---- Pure rules (contracts/folder-browser/v1/vectors.json) ----

/** Error code for an invalid new folder name, or null when the name is acceptable. */
export function folderNameProblem(name: string): string | null {
  if (!name.trim() || name !== name.trim()) return "folder_name_invalid";
  if (name === "." || name === "..") return "folder_name_invalid";
  if (/[/\\\u0000-\u001f\u007f]/.test(name)) return "folder_name_invalid";
  if (Buffer.byteLength(name, "utf8") > MAX_NAME_BYTES) return "folder_name_too_long";
  return null;
}

/** The root that contains `candidate` (both already canonical), or null. */
export function containingRoot(candidate: string, roots: readonly string[], separator: string = sep): string | null {
  for (const root of roots) {
    if (candidate === root) return root;
    const prefix = root.endsWith(separator) ? root : root + separator;
    if (candidate.startsWith(prefix)) return root;
  }
  return null;
}

/** Drop roots nested inside another root so each folder belongs to exactly one root. */
export function collapseRoots(roots: readonly string[], separator: string = sep): string[] {
  const unique = Array.from(new Set(roots));
  return unique.filter(root => !unique.some(other => other !== root && containingRoot(root, [other], separator) !== null));
}

/** Folder names to show: hidden ones only on request, sorted case-insensitively, capped. */
export function visibleFolderNames(names: readonly string[], options: { showHidden: boolean; max: number }): { names: string[]; truncated: boolean } {
  const filtered = names.filter(name => options.showHidden || !name.startsWith("."));
  const sorted = [...filtered].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
  return { names: sorted.slice(0, options.max), truncated: sorted.length > options.max };
}

// ---- Edges (file system, environment) ----

/**
 * Allowed roots, canonical (realpath). `OPENWORK_FOLDER_BROWSER_ROOTS` (path-delimiter separated)
 * replaces the default. Otherwise the server user's home directory plus every authorized root
 * (workspace folders), so workspaces outside home stay reachable.
 */
export async function folderBrowserRoots(config: ServerConfig, env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const configured = (env.OPENWORK_FOLDER_BROWSER_ROOTS ?? "").split(delimiter).map(entry => entry.trim()).filter(entry => entry && isAbsolute(entry));
  const candidates = configured.length ? configured : [homedir(), ...config.authorizedRoots];
  const resolved: string[] = [];
  for (const candidate of candidates) {
    const real = await realpath(resolve(candidate)).catch(() => null);
    if (!real) continue;
    const info = await stat(real).catch(() => null);
    if (info?.isDirectory()) resolved.push(real);
  }
  return collapseRoots(resolved);
}

async function isDirectory(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null))?.isDirectory() ?? false;
}

/** Canonical path for `input` that must exist, be a directory and stay inside a root. */
async function resolveAllowedDirectory(input: string, roots: readonly string[]): Promise<{ path: string; root: string }> {
  if (!isAbsolute(input)) throw new ApiError(400, "folder_path_invalid", "The path must be absolute.");
  const lexical = resolve(input);
  // Reject lexically first so a missing folder outside the roots never reveals whether it exists.
  const real = await realpath(lexical).catch(() => null);
  if (!real) {
    if (!containingRoot(lexical, roots)) throw new ApiError(403, "folder_outside_roots", "This folder is outside the folders you can browse.");
    throw new ApiError(404, "folder_not_found", "The folder does not exist.");
  }
  // realpath follows symlinks: a link inside a root that points elsewhere lands outside and is refused.
  const root = containingRoot(real, roots);
  if (!root) throw new ApiError(403, "folder_outside_roots", "This folder is outside the folders you can browse.");
  if (!(await isDirectory(real))) throw new ApiError(400, "folder_not_directory", "The path is not a folder.");
  return { path: real, root };
}

export async function listFolder(config: ServerConfig, options: { path?: string | null; showHidden?: boolean }, env: NodeJS.ProcessEnv = process.env): Promise<FolderListing> {
  const roots = await folderBrowserRoots(config, env);
  if (!roots.length) throw new ApiError(404, "folder_roots_unavailable", "There are no folders to browse on this server.");
  const requested = options.path?.trim() || roots[0];
  const { path, root } = await resolveAllowedDirectory(requested, roots);

  const names: string[] = [];
  let scanned = 0;
  const handle = await opendir(path).catch(() => {
    throw new ApiError(403, "folder_unreadable", "This folder cannot be read.");
  });
  // Dirent types come from lstat: symlinks are neither listed nor followed.
  for await (const entry of handle) {
    scanned += 1;
    if (entry.isDirectory()) names.push(entry.name);
    if (scanned >= FOLDER_BROWSER_MAX_SCAN) break;
  }
  const visible = visibleFolderNames(names, { showHidden: options.showHidden === true, max: FOLDER_BROWSER_MAX_ENTRIES });
  const entries = await Promise.all(visible.names.map(async name => {
    const childPath = join(path, name);
    const [git, opencode] = await Promise.all([
      stat(join(childPath, ".git")).then(() => true, () => false),
      isDirectory(join(childPath, ".opencode")),
    ]);
    return { name, path: childPath, isGitRepo: git, hasOpencode: opencode };
  }));
  const home = await realpath(homedir()).catch(() => homedir());
  return {
    path,
    parent: path === root ? null : dirname(path),
    root,
    roots: roots.map(entry => ({ name: entry === home ? "~" : basename(entry) || entry, path: entry })),
    entries,
    truncated: visible.truncated || scanned >= FOLDER_BROWSER_MAX_SCAN,
  };
}

/** Fixed-window counter for folder creation. Owned by the route registration below and lives as
 *  long as the server process (docs/rust-readiness.md, R7). */
export function createFolderRateLimiter(options: { limit: number; windowMs: number; now?: () => number }) {
  const now = options.now ?? Date.now;
  let windowStart = 0;
  let count = 0;
  return {
    take(): boolean {
      const current = now();
      if (current - windowStart >= options.windowMs) { windowStart = current; count = 0; }
      if (count >= options.limit) return false;
      count += 1;
      return true;
    },
  };
}

export async function createFolder(config: ServerConfig, input: { parent: string; name: string }, env: NodeJS.ProcessEnv = process.env): Promise<{ path: string }> {
  const problem = folderNameProblem(input.name);
  if (problem) throw new ApiError(400, problem, "Choose a different folder name.");
  const roots = await folderBrowserRoots(config, env);
  const { path: parent } = await resolveAllowedDirectory(input.parent, roots);
  const target = join(parent, input.name);
  try {
    await mkdir(target);
  } catch (error) {
    const code = z.object({ code: z.string() }).safeParse(error);
    if (code.success && code.data.code === "EEXIST") throw new ApiError(409, "folder_exists", "A folder with that name already exists.");
    throw new ApiError(403, "folder_create_failed", "The folder could not be created here.");
  }
  return { path: target };
}

interface RegisterFolderBrowserRoutesOptions {
  routes: Route[];
  config: ServerConfig;
  jsonResponse: (data: unknown, status?: number) => Response;
  readJsonBody: (request: Request) => Promise<Record<string, unknown>>;
  ensureWritable: (config: ServerConfig) => void;
}

function ensureEnabled(): void {
  if (!webFolderBrowserEnabled()) throw new ApiError(404, "web_folder_browser_disabled", "The folder browser is turned off.");
}

export function registerFolderBrowserRoutes(options: RegisterFolderBrowserRoutesOptions): void {
  const { routes, config, jsonResponse, readJsonBody, ensureWritable } = options;
  const limiter = createFolderRateLimiter({ limit: FOLDER_BROWSER_CREATE_LIMIT, windowMs: FOLDER_BROWSER_CREATE_WINDOW_MS });
  addRoute(routes, "GET", "/folders/browse", "host", async ctx => {
    ensureEnabled();
    const showHidden = ["1", "true"].includes(ctx.url.searchParams.get("hidden") ?? "");
    return jsonResponse(await listFolder(config, { path: ctx.url.searchParams.get("path"), showHidden }));
  });
  addRoute(routes, "POST", "/folders/browse", "host", async ctx => {
    ensureEnabled();
    ensureWritable(config);
    const parsed = createFolderBodySchema.safeParse(await readJsonBody(ctx.request));
    if (!parsed.success) throw new ApiError(400, "invalid_payload", "parent and name are required.");
    if (!limiter.take()) throw new ApiError(429, "folder_create_rate_limited", "Too many folders created; wait a minute and try again.");
    return jsonResponse(await createFolder(config, parsed.data), 201);
  });
}
