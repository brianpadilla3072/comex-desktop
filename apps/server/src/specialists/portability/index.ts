import { lstat, mkdir, mkdtemp, readdir, readFile, rm, stat as fileStat } from "node:fs/promises";
import { join, relative, isAbsolute, resolve } from "node:path";
import { ApiError } from "../../errors.js";
import type { ServerConfig } from "../../types.js";
import { ensureProjectDataDir } from "../project-data.js";
import { specialistDirectory, type SpecialistApplication, specialistStore } from "../store.js";
import { z } from "zod";
import { ARCHIVE_VERSION, BUNDLE_FORMAT, BUNDLE_VERSION, LIMITS, applicationSchema, assertFileBudget, assertNoPathConflicts, bundleFile, bundlePath, failure, filesUnder, inlineFiles, parseBundle, type ApplicationBundle, type BundleApplication, type BundleFile, type SourceFile } from "./bundle.js";
import { MANIFEST_ENTRY, extractEntry, readArchiveDirectory, stagedPath, writeArchive } from "./archive.js";
import { SECTIONS, ensureFolder, missingSourceWarnings, newProjectFolder, type PortableProject, type PreparedSection } from "./sections.js";

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

/** Projects of the application whose workspace is still registered here; removed ones have no
 *  folder to read. */
function portableProjects(config: Config, store: Store, app: SpecialistApplication): PortableProject[] {
  return store.projectsFor(app.id)
    .filter(project => config.workspaces.some(workspace => workspace.id === project.workspaceId))
    .map(project => ({ ...project, name: workspaceName(config, project.workspaceId, app.name) }));
}

const applicationOf = (app: SpecialistApplication): BundleApplication => ({ name: app.name, specialty: app.specialty, personality: app.personality, template: app.template });

/** v1: the whole application as one JSON value with inlined files (flag `specialistAppZipBundle` off). */
export async function exportApplication(config: Config, store: Store, id: string): Promise<ApplicationBundle> {
  const app = store.application(id);
  const ctx = { config, app, projects: portableProjects(config, store, app), limits: LIMITS.json };
  const sections: Record<string, unknown> = {};
  for (const section of SECTIONS) {
    if (!section.exportJson) continue;
    const value = await section.exportJson(ctx);
    if (value !== undefined) sections[section.key] = value;
  }
  // The same whole-bundle limits as import, so an export can always be imported back.
  assertFileBudget(Object.values(sections).flatMap(bundleFilesOf).flatMap(files => inlineFiles(files)), LIMITS.json);
  return { format: BUNDLE_FORMAT, version: BUNDLE_VERSION, exportedAt: new Date().toISOString(), application: applicationOf(app), sections };
}

/** Every bundle file a v1 section value carries (library files, project data files). */
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

/** The `manifest.json` at the root of a `.owapp` archive. `files` indexes every other entry. */
export const manifestSchema = z.object({
  format: z.literal(BUNDLE_FORMAT),
  version: z.literal(ARCHIVE_VERSION),
  exportedAt: z.string().max(64).optional(),
  application: applicationSchema,
  sections: z.record(z.string(), z.unknown()),
  files: z.array(z.object({
    path: bundlePath,
    size: z.number().int().min(0).max(LIMITS.archive.fileBytes),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })).max(LIMITS.archive.files),
});
export type ArchiveManifest = z.infer<typeof manifestSchema>;

export function parseManifest(value: unknown): ArchiveManifest {
  const format = z.object({ format: z.string(), version: z.number() }).safeParse(value);
  if (!format.success || format.data.format !== BUNDLE_FORMAT) throw failure("El archivo no es una aplicación exportada de OpenWork.");
  if (format.data.version > ARCHIVE_VERSION) throw failure("El archivo es de una versión más nueva de la app. Actualiza la app para importarlo.");
  const parsed = manifestSchema.safeParse(value);
  if (!parsed.success) throw failure("El índice del archivo (manifest.json) está incompleto o dañado.");
  return parsed.data;
}

/** A private scratch folder for archives being written or read. It lives next to the
 *  applications on disk (not in a RAM-backed temp folder), and stale ones left by a crash are
 *  swept on the next use. */
export async function scratchFolder(config: Pick<ServerConfig, "configPath">) {
  const base = join(specialistDirectory(config), ".portability");
  await mkdir(base, { recursive: true, mode: 0o700 });
  const now = Date.now();
  for (const name of await readdir(base).catch(() => [])) {
    const info = await lstat(join(base, name)).catch(() => null);
    if (info && now - info.mtimeMs > 6 * 60 * 60_000) await rm(join(base, name), { recursive: true, force: true }).catch(() => undefined);
  }
  const path = await mkdtemp(join(base, "job-"));
  return { path, cleanup: () => rm(path, { recursive: true, force: true }) };
}

/** A file name that is safe on every OS and keeps the application's name readable. */
export function archiveFileName(name: string) {
  const clean = name.replace(/[\u0000-\u001f<>:"/\\|?*]+/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, 80);
  return `${clean || "aplicacion"}.owapp`;
}

export type ExportedArchive = { file: string; size: number; fileName: string; cleanup: () => Promise<void> };

/** v2: write the application as a `.owapp` archive in a scratch folder. The caller streams
 *  `file` to the client and must call `cleanup` afterwards. */
export async function exportApplicationArchive(config: Config, store: Store, id: string): Promise<ExportedArchive> {
  const app = store.application(id);
  const ctx = { config, app, projects: portableProjects(config, store, app), limits: LIMITS.archive };
  const sections: Record<string, unknown> = {};
  const files: Array<{ path: string; source: string; size: number }> = [];
  for (const section of SECTIONS) {
    const value = await section.export(ctx);
    if (value === undefined) continue;
    sections[section.key] = value.meta;
    const folder = section.folder;
    if (folder) files.push(...value.files.map(file => ({ ...file, path: `${folder}/${file.path}` })));
  }
  assertNoPathConflicts(files);
  // The same limits as import, so an export can always be imported back.
  assertFileBudget(files, LIMITS.archive);
  const scratch = await scratchFolder(config);
  try {
    const file = join(scratch.path, "application.owapp");
    const exportedAt = new Date().toISOString();
    await writeArchive(file, files, index => {
      // Files can change while they are read; the budget holds for what was actually written.
      assertFileBudget(index, LIMITS.archive);
      const manifest: ArchiveManifest = { format: BUNDLE_FORMAT, version: ARCHIVE_VERSION, exportedAt, application: applicationOf(app), sections, files: index };
      return Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
    });
    return { file, size: (await fileStat(file)).size, fileName: archiveFileName(app.name), cleanup: scratch.cleanup };
  } catch (error) {
    await scratch.cleanup();
    throw error;
  }
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

type ImportInput = {
  config: Config;
  store: Store;
  userName?: string;
  createWorkspace: (payload: { folderPath: string; name: string; preset: "specialist"; applicationId: string }) => Promise<string>;
  removeWorkspace: (workspaceId: string) => Promise<void>;
};

/** A bundle of either version, normalized: section metadata plus files whose paths start with
 *  the owning section's folder (`library/…`, `projects/0/…`, `work/0/…`). */
type ParsedImport = { application: BundleApplication; sections: Record<string, unknown>; files: SourceFile[]; skippedSections: string[] };

/** v1: import a JSON bundle with inlined files. */
export async function importApplication(input: ImportInput & { raw: unknown }): Promise<ImportResult> {
  const bundle = parseBundle(input.raw);
  const sections: Record<string, unknown> = {};
  const files: SourceFile[] = [];
  for (const section of SECTIONS) {
    const raw = bundle.sections[section.key];
    if (raw === undefined || !section.fromJson) continue;
    const split = section.fromJson(raw);
    sections[section.key] = split.meta;
    const folder = section.folder ?? section.key;
    files.push(...split.files.map(file => ({ ...file, path: `${folder}/${file.path}` })));
  }
  assertFileBudget(files, LIMITS.json);
  const skippedSections = Object.keys(bundle.sections).filter(key => sections[key] === undefined);
  return importParsed(input, { application: bundle.application, sections, files, skippedSections });
}

/** v2: import a `.owapp` archive already saved at `file`. Everything is checked before any
 *  application data is written: the central directory (paths, entry types, sizes, ratios),
 *  the manifest schema, the manifest index against the archive, then every entry's size, CRC
 *  and SHA-256 while it is extracted into a private staging folder. */
export async function importApplicationArchive(input: ImportInput & { file: string }): Promise<ImportResult> {
  const scratch = await scratchFolder(input.config);
  try {
    const archive = await readArchiveDirectory(input.file);
    const manifestEntry = archive.entries.find(entry => entry.path === MANIFEST_ENTRY);
    if (!manifestEntry) throw failure("El archivo no tiene manifest.json: no es una aplicación exportada de OpenWork.");
    const manifestFile = join(scratch.path, MANIFEST_ENTRY);
    await extractEntry(archive, manifestEntry, manifestFile);
    const text = await readFile(manifestFile, "utf8");
    let manifest: ArchiveManifest;
    try {
      const raw: unknown = JSON.parse(text);
      manifest = parseManifest(raw);
    }
    catch (error) {
      if (error instanceof ApiError) throw error;
      throw failure("El índice del archivo (manifest.json) no es un JSON válido.");
    }

    const declared = new Map(manifest.files.map(file => [file.path, file]));
    if (declared.size !== manifest.files.length) throw failure("El índice del archivo repite rutas.");
    const entries = archive.entries.filter(entry => entry !== manifestEntry);
    for (const entry of entries) {
      const expected = declared.get(entry.path);
      if (!expected) throw failure(`El archivo contiene ${entry.path}, que no figura en su índice.`);
      if (expected.size !== entry.size) throw failure(`El tamaño de ${entry.path} no coincide con el índice.`);
    }
    if (entries.length !== declared.size) throw failure("Faltan archivos que figuran en el índice.");
    assertNoPathConflicts(manifest.files);
    assertFileBudget(manifest.files, LIMITS.archive);

    const filesRoot = join(scratch.path, "files");
    const files: SourceFile[] = [];
    for (const entry of entries) {
      const target = stagedPath(filesRoot, entry.path);
      await extractEntry(archive, entry, target, declared.get(entry.path)?.sha256 ?? "");
      files.push({ path: entry.path, size: entry.size, kind: "staged", file: target });
    }
    const known = new Set(SECTIONS.map(section => section.key));
    const sections: Record<string, unknown> = {};
    const skippedSections: string[] = [];
    for (const [key, meta] of Object.entries(manifest.sections)) {
      if (known.has(key)) sections[key] = meta; else skippedSections.push(key);
    }
    return await importParsed(input, { application: manifest.application, sections, files, skippedSections });
  } finally {
    await scratch.cleanup();
  }
}

async function importParsed(input: ImportInput, parsed: ParsedImport): Promise<ImportResult> {
  const { config, store } = input;
  // Validate every section before writing anything.
  const prepared: PreparedSection[] = [];
  try {
    for (const section of SECTIONS) {
      const meta = parsed.sections[section.key];
      if (meta === undefined) continue;
      prepared.push(await section.prepare(meta, section.folder ? filesUnder(parsed.files, section.folder) : [], parsed.sections));
    }

    const app = store.create({
      userName: input.userName?.trim() || undefined,
      name: availableName(store, parsed.application.name),
      specialty: parsed.application.specialty,
      personality: parsed.application.personality,
      template: parsed.application.template,
    }, { agents: 0, skills: 0 });
    const warnings: string[] = [];
    const workspaceIds: string[] = [];
    const projectRoots: string[] = [];
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
        await entry.apply({ config, app, createProject, projectRoots, warnings, setPackCounts: counts => store.updatePackCounts(app.id, counts) });
      }
      if (!workspaceIds.length) await createProject("Principal");
      for (const root of projectRoots) warnings.push(...await missingSourceWarnings(root));
      return { application: store.application(app.id), workspaceId: workspaceIds[0] ?? "", skippedSections: parsed.skippedSections, warnings };
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
