import { randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import type { ServerConfig } from "../../types.js";
import { libraryRoot, readSpecialistContext, writeSpecialistContext, contextInput } from "../library.js";
import { inspectSpecialistPack, saveSpecialistPack } from "../packs.js";
import { LEGACY_DATA_DIR, PROJECT_DATA_DIR, resolveDataDir } from "../project-data.js";
import { listSources } from "../sources.js";
import { specialistDirectory, type SpecialistApplication } from "../store.js";
import { createTask, listTasks, taskInputSchema } from "../tasks.js";
import { LIMITS, assertNoPathConflicts, bundleFile, failure, filesUnder, inlineFiles, isBundlePath, listTree, megabytes, readTree, writeTree, type FileLimits, type SourceFile, type TreeFile } from "./bundle.js";

export type PortableProject = { workspaceId: string; rootPath: string; name: string };

export type ExportContext = {
  config: Pick<ServerConfig, "configPath">;
  app: SpecialistApplication;
  projects: PortableProject[];
  /** Per-file and total limits of the format being written. */
  limits: FileLimits;
};

export type ImportContext = {
  config: Pick<ServerConfig, "configPath">;
  app: SpecialistApplication;
  /** Create a project folder and workspace for the new application; returns its root. */
  createProject: (name: string) => Promise<{ workspaceId: string; root: string }>;
  /** Roots of the projects created so far, in bundle order (filled by the projects section). */
  projectRoots: string[];
  /** Called after the library is saved so the profile shows the right counts. */
  setPackCounts: (counts: { agents: number; skills: number }) => void;
  warnings: string[];
};

/** A validated section, ready to write. */
export type PreparedSection = { apply: (ctx: ImportContext) => Promise<void>; cleanup?: () => Promise<void> };

/** What a section exports: JSON metadata for the manifest plus files on disk, whose `path` is
 *  relative to the section's archive folder. */
export type SectionExport = { meta: unknown; files: TreeFile[] };

/** One family of application data. `prepare` must not write outside a temporary folder:
 *  every section of a bundle is validated before any of them is applied.
 *  In a `.owapp` archive the section's files live under `folder/`; in a v1 JSON bundle they
 *  are inlined in the section value (`fromJson` splits them out, `exportJson` inlines them). */
export type Section = {
  key: string;
  folder?: string;
  export: (ctx: ExportContext) => Promise<SectionExport | undefined>;
  /** `files` are this section's files with the folder prefix removed; `sections` holds every
   *  section's metadata, for checks that span sections. */
  prepare: (meta: unknown, files: SourceFile[], sections: Record<string, unknown>) => Promise<PreparedSection>;
  /** v1 JSON export (flag `specialistAppZipBundle` off). Absent: the section is archive-only. */
  exportJson?: (ctx: ExportContext) => Promise<unknown | undefined>;
  /** v1 JSON import. Absent: the section does not exist in v1 and is skipped like an unknown one. */
  fromJson?: (raw: unknown) => { meta: unknown; files: SourceFile[] };
};

const library: Section = {
  key: "library",
  folder: "library",
  async export({ config, app, limits }) {
    const files = await listTree(libraryRoot(config, app.id), { limits });
    return files.length ? { meta: {}, files } : undefined;
  },
  async exportJson({ config, app }) {
    const files = await readTree(libraryRoot(config, app.id));
    return files.length ? { files } : undefined;
  },
  fromJson(raw) {
    const parsed = z.object({ files: z.array(bundleFile).max(LIMITS.json.files) }).safeParse(raw);
    if (!parsed.success) throw failure("La biblioteca del archivo está dañada.");
    assertNoPathConflicts(parsed.data.files);
    return { meta: {}, files: inlineFiles(parsed.data.files) };
  },
  async prepare(meta, files) {
    if (!z.object({}).safeParse(meta).success) throw failure("La biblioteca del archivo está dañada.");
    assertNoPathConflicts(files);
    // Same checks as importing a pack folder: frontmatter, names, layout and limits.
    const staging = await mkdtemp(join(tmpdir(), "openwork-app-import-"));
    const cleanup = () => rm(staging, { recursive: true, force: true });
    try {
      await writeTree(staging, files);
      const pack = await inspectSpecialistPack(staging);
      return {
        cleanup,
        async apply({ config, app, setPackCounts }) {
          await rm(libraryRoot(config, app.id), { recursive: true, force: true });
          await saveSpecialistPack(config, app.id, pack);
          setPackCounts({ agents: pack.summary.agents.length, skills: pack.summary.skills.length });
        },
      };
    } catch (error) { await cleanup(); throw error; }
  },
};

const contextMeta = z.object({ content: contextInput });
const context: Section = {
  key: "context",
  async export({ config, app }) {
    const content = await readSpecialistContext(config, app.id);
    return content ? { meta: { content }, files: [] } : undefined;
  },
  async exportJson(ctx) { return (await context.export(ctx))?.meta; },
  fromJson: raw => ({ meta: raw, files: [] }),
  async prepare(meta) {
    const parsed = contextMeta.safeParse(meta);
    if (!parsed.success) throw failure("El contexto del archivo no es válido (máximo 8.000 caracteres).");
    const content = parsed.data.content;
    return { async apply({ config, app }) { if (content) await writeSpecialistContext(config, app.id, content); } };
  },
};

const tasks: Section = {
  key: "tasks",
  async export({ config, app }) {
    const list = await listTasks(config, app.id);
    if (!list.length) return undefined;
    return { meta: { tasks: list.map(task => ({ name: task.name, prompt: task.prompt, schedule: task.schedule, model: task.model, catchUp: task.catchUp })) }, files: [] };
  },
  async exportJson(ctx) { return (await tasks.export(ctx))?.meta; },
  fromJson: raw => ({ meta: raw, files: [] }),
  async prepare(meta) {
    const parsed = z.object({ tasks: z.array(taskInputSchema).max(20) }).safeParse(meta);
    if (!parsed.success) throw failure("Las tareas programadas del archivo no son válidas.");
    const list = parsed.data.tasks;
    return {
      async apply({ config, app, warnings }) {
        // Imported tasks start paused: nothing runs on the new computer until the person reviews it.
        for (const task of [...list].reverse()) {
          try { await createTask(config, app.id, task, { enabled: false }); }
          catch { warnings.push(`No se importó la tarea "${task.name}" (por ejemplo, una ejecución única que ya pasó).`); }
        }
      },
    };
  },
};

/** Split `<index>/<path>` files into one group per project index, checking every index. */
function groupByProject(files: SourceFile[], projectCount: number, what: string): SourceFile[][] {
  const groups: SourceFile[][] = Array.from({ length: projectCount }, () => []);
  for (const file of files) {
    const slash = file.path.indexOf("/");
    const head = slash > 0 ? file.path.slice(0, slash) : "";
    const index = /^(0|[1-9][0-9]{0,3})$/.test(head) ? Number(head) : -1;
    const group = groups[index];
    if (!group) throw failure(`${what}: ${file.path} no pertenece a ningún proyecto del archivo.`);
    group.push({ ...file, path: file.path.slice(slash + 1) });
  }
  for (const group of groups) assertNoPathConflicts(group);
  return groups;
}

const projectMeta = z.object({ name: z.string().trim().min(1).max(80), dataDir: z.enum([PROJECT_DATA_DIR, LEGACY_DATA_DIR]) });
const projectsMeta = z.object({ projects: z.array(projectMeta).max(100) });
const portableProjectJson = projectMeta.extend({ files: z.array(bundleFile).max(LIMITS.json.files) });
const projects: Section = {
  key: "projects",
  folder: "projects",
  async export({ projects: list, limits }) {
    if (!list.length) return undefined;
    const meta = [];
    const files: TreeFile[] = [];
    for (const [index, project] of list.entries()) {
      const dataDir = resolveDataDir(project.rootPath);
      // The whole data folder: memory, session summaries, datasets, sources, outputs, artifacts.
      meta.push({ name: project.name, dataDir });
      for (const file of await listTree(join(project.rootPath, dataDir), { limits })) files.push({ ...file, path: `${index}/${file.path}` });
    }
    return { meta: { projects: meta }, files };
  },
  async exportJson({ projects: list }) {
    const exported = [];
    for (const project of list) {
      const dataDir = resolveDataDir(project.rootPath);
      exported.push({ name: project.name, dataDir, files: await readTree(join(project.rootPath, dataDir)) });
    }
    return exported.length ? { projects: exported } : undefined;
  },
  fromJson(raw) {
    const parsed = z.object({ projects: z.array(portableProjectJson).max(100) }).safeParse(raw);
    if (!parsed.success) throw failure("Los proyectos del archivo no son válidos.");
    const files: SourceFile[] = [];
    for (const [index, project] of parsed.data.projects.entries()) {
      assertNoPathConflicts(project.files);
      files.push(...inlineFiles(project.files, `${index}/`));
    }
    return { meta: { projects: parsed.data.projects.map(({ name, dataDir }) => ({ name, dataDir })) }, files };
  },
  async prepare(meta, files) {
    const parsed = projectsMeta.safeParse(meta);
    if (!parsed.success) throw failure("Los proyectos del archivo no son válidos.");
    const list = parsed.data.projects;
    const groups = groupByProject(files, list.length, "Proyectos");
    return {
      async apply({ createProject, projectRoots }) {
        for (const [index, project] of list.entries()) {
          const { root } = await createProject(project.name);
          projectRoots.push(root);
          // The new project already has its own data folder (from the app's template); restore into it.
          await writeTree(join(root, resolveDataDir(root)), groups[index] ?? []);
        }
      },
    };
  },
};

/** Folders that are rebuilt or machine-specific, never a person's work. Hidden entries
 *  (`.opencode`, `.git`, `.venv`, caches) are always skipped by listTree. */
const SKIPPED_WORK_FOLDERS = new Set(["node_modules", "__pycache__"]);
const skippedWorkFile = z.object({ project: z.number().int().min(0), path: z.string().min(1).max(1_024), size: z.number().int().min(0) });
const workFilesMeta = z.object({ skipped: z.array(skippedWorkFile).max(1_000).default([]) });
/** The files of each project folder outside its data folder (documents, spreadsheets, drafts),
 *  so moving computers keeps the actual work. Archive-only (v2). */
const workFiles: Section = {
  key: "workFiles",
  folder: "work",
  async export({ projects: list, limits }) {
    const files: TreeFile[] = [];
    const skipped: Array<z.infer<typeof skippedWorkFile>> = [];
    for (const [index, project] of list.entries()) {
      const dataDir = resolveDataDir(project.rootPath);
      const found = await listTree(project.rootPath, {
        limits,
        skipFolder: path => path === dataDir || SKIPPED_WORK_FOLDERS.has(path.split("/").pop() ?? ""),
        // A single huge file must not block moving everything else; the import reports it.
        onOversize: file => { if (skipped.length < 1_000) skipped.push({ project: index, path: file.path, size: file.size }); },
      });
      for (const file of found) files.push({ ...file, path: `${index}/${file.path}` });
    }
    return files.length || skipped.length ? { meta: { skipped }, files } : undefined;
  },
  async prepare(meta, files, sections) {
    const parsed = workFilesMeta.safeParse(meta);
    if (!parsed.success) throw failure("Los archivos de trabajo del archivo no son válidos.");
    const projectList = projectsMeta.safeParse(sections.projects);
    const count = projectList.success ? projectList.data.projects.length : 0;
    const groups = groupByProject(files, count, "Archivos de trabajo");
    const skipped = parsed.data.skipped;
    return {
      async apply({ projectRoots, warnings }) {
        for (const [index, group] of groups.entries()) {
          const root = projectRoots[index];
          if (!root) throw failure("Los archivos de trabajo no tienen proyecto de destino.");
          await writeTree(root, group);
        }
        for (const file of skipped) warnings.push(`El archivo ${file.path} no viajó porque supera los ${megabytes(LIMITS.archive.fileBytes)}; cópialo a mano si lo necesitas.`);
      },
    };
  },
};

/** Order matters on import: the library must exist before projects sync it, and projects
 *  must exist before their work files are restored. */
export const SECTIONS: readonly Section[] = [library, context, tasks, projects, workFiles];

/** Sources of an imported project whose evidence file did not travel (for example a local
 *  file that was never inside the project). The import still succeeds; the person is told. */
export async function missingSourceWarnings(root: string): Promise<string[]> {
  let sources;
  try { sources = await listSources(root); } catch { return []; }
  const warnings: string[] = [];
  for (const source of sources) {
    const path = source.evidencePath;
    const inside = !isAbsolute(path) && isBundlePath(path);
    const found = inside ? await lstat(join(root, ...path.split("/"))).then(info => info.isFile(), () => false) : false;
    if (!found) warnings.push(`La fuente "${source.title}" apunta a un archivo que no viajó (${path}); vuelve a registrarla en esta computadora.`);
  }
  return warnings;
}

export function newProjectFolder(config: Pick<ServerConfig, "configPath">, appId: string) {
  return join(specialistDirectory(config), appId, "projects", randomUUID());
}

export async function ensureFolder(path: string) {
  await mkdir(path, { recursive: true });
}
