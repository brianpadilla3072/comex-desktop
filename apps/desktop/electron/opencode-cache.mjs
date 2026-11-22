import { lstat, rm } from "node:fs/promises";
import { resolveNukeEnvironment } from "./nuke.mjs";

/**
 * OpenCode's cache folders for the engine this app runs: the dev profile's
 * isolated XDG cache in dev mode, the person's cache otherwise. Only folders
 * named `opencode` under a cache root; never configuration or data.
 */
export function opencodeCacheCandidates({ env = process.env, homedir, platform = process.platform, userDataPath }) {
  const resolved = resolveNukeEnvironment({ env, homedir, platform, userDataPath });
  const join = platform === "win32" ? (...parts) => parts.join("\\") : (...parts) => parts.join("/");
  const candidates = [];
  const cacheHome = resolved.env.XDG_CACHE_HOME?.trim();
  if (cacheHome) candidates.push(join(cacheHome, "opencode"));
  candidates.push(join(resolved.homedir, ".cache", "opencode"));
  if (platform === "darwin") candidates.push(join(resolved.homedir, "Library", "Caches", "opencode"));
  const localAppData = resolved.env.LOCALAPPDATA?.trim();
  if (platform === "win32" && localAppData) candidates.push(join(localAppData, "opencode"));
  return [...new Set(candidates)];
}

/** Delete the candidates that exist. A symlink is reported, never followed. */
export async function resetOpencodeCache(candidates, fs = { lstat, rm }) {
  const removed = [];
  const missing = [];
  const errors = [];
  for (const path of candidates) {
    const stat = await fs.lstat(path).catch(() => null);
    if (!stat) { missing.push(path); continue; }
    if (stat.isSymbolicLink()) { errors.push(`${path} is a symbolic link; not removed.`); continue; }
    try {
      await fs.rm(path, { recursive: true, force: true });
      removed.push(path);
    } catch (error) {
      errors.push(`Failed to remove ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { removed, missing, errors };
}
