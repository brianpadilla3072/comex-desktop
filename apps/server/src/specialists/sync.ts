import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { sha256, statOrNull } from "./digest.js";
import { libraryRoot, MANIFEST_FILE, listSpecialistLibrary, walkLibrary } from "./library.js";
import { specialistStore, type SpecialistApplication } from "./store.js";
import type { ServerConfig } from "../types.js";

export const SYNC_RECORD = join(".opencode", "specialist-sync.json");

type SyncRecord = { version: 1; files: Record<string, string> };
export type WorkspaceSyncResult = {
  workspaceId: string; installed: number; updated: number; removed: number;
  conflicts: string[]; nuevo: string[]; error?: string;
};

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try { return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>; }
  catch { return null; }
}

async function readRecord(root: string): Promise<SyncRecord> {
  const value = await readJson(join(root, SYNC_RECORD));
  const files = value && typeof value.files === "object" && value.files !== null && !Array.isArray(value.files)
    ? Object.fromEntries(Object.entries(value.files as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    : {};
  return { version: 1, files };
}

export async function writeSyncRecord(root: string, record: SyncRecord) {
  const target = join(root, SYNC_RECORD);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(record), { mode: 0o600 });
  await rename(temporary, target);
}

/** Materialize the application library into a project's .opencode. User edits inside the project are never overwritten: they get a .nuevo update. */
export async function syncSpecialistWorkspace(config: Pick<ServerConfig, "configPath">, app: SpecialistApplication, root: string, workspaceId = ""): Promise<WorkspaceSyncResult> {
  const result: WorkspaceSyncResult = { workspaceId, installed: 0, updated: 0, removed: 0, conflicts: [], nuevo: [] };
  try {
    const marker = await readJson(join(root, ".opencode", "specialist-application.json"));
    if (!marker || marker.applicationId !== app.id) return result;
    const library = await walkLibrary(libraryRoot(config, app.id));
    const manifest = (await readJson(join(libraryRoot(config, app.id), MANIFEST_FILE))) ?? {};
    const record = await readRecord(root);
    const next = { ...record.files };
    const byPath = new Map(library.map(file => [file.path, file]));
    for (const file of library) {
      const target = join(root, ".opencode", file.path);
      const hash = sha256(file.data);
      const current = await statOrNull(target);
      const currentHash = current?.isFile() ? sha256(await readFile(target)) : undefined;
      if (current === null) {
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, file.data, { mode: 0o600 });
        next[file.path] = hash;
        result.installed += 1;
        continue;
      }
      if (!current.isFile()) { result.conflicts.push(file.path); continue; }
      let recorded = next[file.path];
      if (recorded === undefined) {
        if (currentHash === hash) { next[file.path] = hash; continue; }
        const originalValue = manifest[file.path];
        const original = typeof originalValue === "string" ? originalValue : undefined;
        if (original !== undefined && currentHash === original) recorded = original; // legacy official install without record
        else {
          await writeFile(`${target}.nuevo`, file.data, { mode: 0o600 });
          result.nuevo.push(file.path); result.conflicts.push(file.path);
          continue;
        }
      }
      if (currentHash === recorded) {
        if (hash !== currentHash) {
          await writeFile(target, file.data, { mode: 0o600 });
          next[file.path] = hash;
          result.updated += 1;
        }
      } else if (hash !== recorded) {
        await writeFile(`${target}.nuevo`, file.data, { mode: 0o600 });
        result.nuevo.push(file.path); result.conflicts.push(file.path);
      }
    }
    for (const [path, hash] of Object.entries(record.files)) {
      if (byPath.has(path)) continue;
      const target = join(root, ".opencode", path);
      const current = await statOrNull(target);
      if (current?.isFile()) {
        if (sha256(await readFile(target)) === hash) { await rm(target); result.removed += 1; }
        else result.conflicts.push(path);
      }
      delete next[path];
    }
    await writeSyncRecord(root, { version: 1, files: next });
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }
  return result;
}

/** After any library change: refresh SQLite counts and materialize into the application's live projects. */
export async function applySpecialistLibraryChange(config: Pick<ServerConfig, "configPath" | "workspaces">, app: SpecialistApplication) {
  const store = await specialistStore(config);
  const listing = await listSpecialistLibrary(config, app.id);
  store.updatePackCounts(app.id, listing.counts);
  const sync: WorkspaceSyncResult[] = [];
  for (const project of store.projectsFor(app.id)) {
    const workspace = config.workspaces.find(entry => entry.id === project.workspaceId);
    if (!workspace) continue;
    sync.push(await syncSpecialistWorkspace(config, app, workspace.path, workspace.id));
  }
  return { counts: listing.counts, sync };
}
