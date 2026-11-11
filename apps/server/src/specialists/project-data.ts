import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

/** Where a project keeps its auditable data: memory, sessions, datasets, sources, outputs and
 *  task runs. New projects use `proyecto/`; a project that already has `comex/` (Comercio
 *  Exterior, or anything created before this rename) keeps using it, so no file moves and no
 *  citation breaks. Resolution is by what is on disk, so every caller needs nothing but the
 *  project path. */
export const PROJECT_DATA_DIR = "proyecto";
export const LEGACY_DATA_DIR = "comex";

export function resolveDataDir(directory: string): string {
  if (existsSync(join(directory, PROJECT_DATA_DIR))) return PROJECT_DATA_DIR;
  if (existsSync(join(directory, LEGACY_DATA_DIR))) return LEGACY_DATA_DIR;
  return PROJECT_DATA_DIR;
}

/** Absolute path inside the project's data folder: `dataPath(root, "fuentes", id)`. */
export function dataPath(directory: string, ...parts: string[]): string {
  return join(directory, resolveDataDir(directory), ...parts);
}

/** Same location as a workspace-relative path ("proyecto/fuentes/tavily/x.json"). */
export function dataRelative(directory: string, ...parts: string[]): string {
  return [resolveDataDir(directory), ...parts].join("/");
}

/** Create the data folder for a brand-new project so the first write lands in the right place
 *  (and the agent never guesses `comex/` for an app that is not about trade). */
export async function ensureProjectDataDir(directory: string): Promise<string> {
  const dir = resolveDataDir(directory);
  await mkdir(join(directory, dir), { recursive: true });
  return dir;
}

/** The two accepted prefixes when validating a path that must live inside the data folder. */
export function isInsideDataDir(directory: string, relativePath: string): boolean {
  const dir = resolveDataDir(directory);
  return relativePath.startsWith(`${dir}/`) && !relativePath.includes("..");
}

/** Paths a local source may not point at (its own snapshots or the datasets folder). */
export function reservedDataPaths(directory: string): string[] {
  const dir = resolveDataDir(directory);
  return [`${dir}/fuentes/`, `${dir}/datasets/`];
}
