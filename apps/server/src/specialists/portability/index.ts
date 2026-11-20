import { lstat, readFile, rm } from "node:fs/promises";
import { join, relative, isAbsolute, resolve } from "node:path";
import { ApiError } from "../../errors.js";
import type { ServerConfig } from "../../types.js";
import { ensureProjectDataDir } from "../project-data.js";
import { specialistDirectory, type SpecialistApplication, specialistStore } from "../store.js";
import { z } from "zod";
import { BUNDLE_FORMAT, BUNDLE_VERSION, assertFileBudget, bundleFile, failure, parseBundle, type ApplicationBundle, type BundleFile } from "./bundle.js";
import { SECTIONS, ensureFolder, newProjectFolder, type PortableProject, type PreparedSection } from "./sections.js";

type Store = Awaited<ReturnType<typeof specialistStore>>;
type Config = Pick<ServerConfig, "configPath" | "workspaces">;

const MARKER = join(".opencode", "specialist-application.json");

function isInside(parent: string, child: string) {
  const path = relative(resolve(parent), resolve(child));
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function workspaceName(config: Config, workspaceId: string, fallback: string) {
  const workspace = config.workspaces.find(entry => entry.id === workspaceId);
  return workspace?.displayName?.trim() || workspace?.name?.trim() || fallback;
}

async function readMarker(path: string): Promise<unknown> {
  try { return JSON.parse(await readFile(path, "utf8")) as unknown; }
  catch { return null; }
}

export async function exportApplication(config: Config, store: Store, id: string): Promise<ApplicationBundle> {
  const app = store.application(id);
  // Only projects whose workspace is still registered here; removed ones have no folder to read.
  const projects: PortableProject[] = store.projectsFor(id)
    .filter(project => config.workspaces.some(workspace => workspace.id === project.workspaceId))
    .map(project => ({ ...project, name: workspaceName(config, project.workspaceId, app.name) }));
  const sections: Record<string, unknown> = {};
  for (const section of SECTIONS) {
    const value = await section.export({ config, app, projects });
    if (value !== undefined) sections[section.key] = value;
  }
  // The same whole-bundle limits as import, so an export can always be imported back.
  assertFileBudget(Object.values(sections).flatMap(bundleFilesOf));
  return {
    format: BUNDLE_FORMAT, version: BUNDLE_VERSION, exportedAt: new Date().toISOString(),
    application: { name: app.name, specialty: app.specialty, personality: app.personality, template: app.template },
    sections,
  };
}

/** Every bundle file a section value carries (library files, project data files). */
function bundleFilesOf(value: unknown): BundleFile[][] {
  const found: BundleFile[][] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== "object") return;
    const parsed = z.object({ files: z.array(bundleFile) }).safeParse(node);
    if (parsed.success) found.push(parsed.data.files);
    for (const child of Object.values(node)) visit(child);
  };
  visit(value);
  return found;
}

function availableName(store: Store, name: string) {
  const taken = new Set(store.list().applications.map(app => app.name.toLocaleLowerCase()));
  if (!taken.has(name.toLocaleLowerCase())) return name;
  for (let index = 1; index < 100; index += 1) {
    const suffix = index === 1 ? " (importada)" : ` (importada ${index})`;
    const candidate = `${name.slice(0, 80 - suffix.length)}${suffix}`;
    if (!taken.has(candidate.toLocaleLowerCase())) return candidate;
  }
  throw failure("Ya hay demasiadas aplicaciones con ese nombre.");
}

export type ImportResult = { application: SpecialistApplication; workspaceId: string; skippedSections: string[]; warnings: string[] };

export async function importApplication(input: {
  config: Config;
  store: Store;
  raw: unknown;
  userName?: string;
  createWorkspace: (payload: { folderPath: string; name: string; preset: "specialist"; applicationId: string }) => Promise<string>;
  removeWorkspace: (workspaceId: string) => Promise<void>;
}): Promise<ImportResult> {
  const { config, store } = input;
  const bundle = parseBundle(input.raw);
  // Validate every section before writing anything.
  const known = new Set(SECTIONS.map(section => section.key));
  const skippedSections = Object.keys(bundle.sections).filter(key => !known.has(key));
  const prepared: PreparedSection[] = [];
  try {
    for (const section of SECTIONS) {
      if (bundle.sections[section.key] === undefined) continue;
      prepared.push(await section.prepare(bundle.sections[section.key]));
    }
    assertFileBudget(prepared.map(entry => entry.files));

    const app = store.create({
      userName: input.userName?.trim() || undefined,
      name: availableName(store, bundle.application.name),
      specialty: bundle.application.specialty,
      personality: bundle.application.personality,
      template: bundle.application.template,
    }, { agents: 0, skills: 0 });
    const warnings: string[] = [];
    const workspaceIds: string[] = [];
    try {
      const createProject = async (name: string) => {
        const folderPath = newProjectFolder(config, app.id);
        await ensureFolder(folderPath);
        const workspaceId = await input.createWorkspace({ folderPath, name, preset: "specialist", applicationId: app.id });
        workspaceIds.push(workspaceId);
        await ensureProjectDataDir(folderPath);
        return { workspaceId, root: folderPath };
      };
      for (const entry of prepared) {
        await entry.apply({ config, app, createProject, warnings, setPackCounts: counts => store.updatePackCounts(app.id, counts) });
      }
      if (!workspaceIds.length) await createProject("Principal");
      return { application: store.application(app.id), workspaceId: workspaceIds[0] ?? "", skippedSections, warnings };
    } catch (error) {
      // Never leave a half-imported application behind.
      await deleteApplication({ config, store, id: app.id, removeWorkspace: input.removeWorkspace }).catch(() => undefined);
      throw error;
    }
  } finally {
    await Promise.all(prepared.map(entry => entry.cleanup?.()));
  }
}

/** Remove an application. Projects inside its folder go away with it; projects elsewhere keep
 *  every file and only lose the binding marker, staying as ordinary workspaces. */
export async function deleteApplication(input: {
  config: Config;
  store: Store;
  id: string;
  removeWorkspace: (workspaceId: string) => Promise<void>;
}): Promise<{ removedWorkspaceIds: string[]; keptWorkspaceIds: string[] }> {
  const { config, store, id } = input;
  store.application(id);
  const appDir = join(specialistDirectory(config), id);
  const removedWorkspaceIds: string[] = [];
  const keptWorkspaceIds: string[] = [];
  for (const project of store.projectsFor(id)) {
    if (isInside(appDir, project.rootPath)) {
      if (config.workspaces.some(workspace => workspace.id === project.workspaceId)) await input.removeWorkspace(project.workspaceId);
      removedWorkspaceIds.push(project.workspaceId);
      continue;
    }
    keptWorkspaceIds.push(project.workspaceId);
    const marker = join(project.rootPath, MARKER);
    const stat = await lstat(marker).catch(() => null);
    if (!stat?.isFile()) continue;
    // An unreadable or corrupt marker is not provably ours: leave it, never abort the deletion.
    const value = await readMarker(marker);
    // Only our own marker: a folder rebound to another application keeps its binding.
    if (value && typeof value === "object" && "applicationId" in value && value.applicationId === id) await rm(marker, { force: true });
  }
  // Files first, with retries: a project still installing `.opencode/node_modules` makes a single
  // recursive rm fail with ENOTEMPTY. The profile goes last, so a failure can simply be retried.
  try {
    await rm(appDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    throw new ApiError(409, "application_files_busy", "No se pudieron borrar todos los archivos de la aplicación porque todavía se están usando. Esperá unos segundos y volvé a intentar.");
  }
  store.remove(id);
  return { removedWorkspaceIds, keptWorkspaceIds };
}
