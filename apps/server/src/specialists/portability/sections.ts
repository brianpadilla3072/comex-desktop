import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { ServerConfig } from "../../types.js";
import { libraryRoot, readSpecialistContext, writeSpecialistContext, contextInput } from "../library.js";
import { inspectSpecialistPack, saveSpecialistPack } from "../packs.js";
import { resolveDataDir } from "../project-data.js";
import { specialistDirectory, type SpecialistApplication } from "../store.js";
import { createTask, listTasks, taskInputSchema } from "../tasks.js";
import { assertNoPathConflicts, bundleFile, failure, readTree, writeTree, type BundleFile } from "./bundle.js";

export type PortableProject = { workspaceId: string; rootPath: string; name: string };

export type ExportContext = {
  config: Pick<ServerConfig, "configPath">;
  app: SpecialistApplication;
  projects: PortableProject[];
};

export type ImportContext = {
  config: Pick<ServerConfig, "configPath">;
  app: SpecialistApplication;
  /** Create a project folder and workspace for the new application; returns its root. */
  createProject: (name: string) => Promise<{ workspaceId: string; root: string }>;
  /** Called after the library is saved so the profile shows the right counts. */
  setPackCounts: (counts: { agents: number; skills: number }) => void;
  warnings: string[];
};

/** A validated section, ready to write. */
export type PreparedSection = { files: BundleFile[]; apply: (ctx: ImportContext) => Promise<void>; cleanup?: () => Promise<void> };

/** One family of application data. `prepare` must not write outside a temporary folder:
 *  every section of a bundle is validated before any of them is applied. */
export type Section = {
  key: string;
  export: (ctx: ExportContext) => Promise<unknown | undefined>;
  prepare: (raw: unknown) => Promise<PreparedSection>;
};

const filesSchema = z.object({ files: z.array(bundleFile).max(2_000) });

const library: Section = {
  key: "library",
  async export({ config, app }) {
    const files = await readTree(libraryRoot(config, app.id));
    return files.length ? { files } : undefined;
  },
  async prepare(raw) {
    const parsed = filesSchema.safeParse(raw);
    if (!parsed.success) throw failure("La biblioteca del archivo está dañada.");
    assertNoPathConflicts(parsed.data.files);
    // Same checks as importing a pack folder: frontmatter, names, layout and limits.
    const staging = await mkdtemp(join(tmpdir(), "openwork-app-import-"));
    const cleanup = () => rm(staging, { recursive: true, force: true });
    try {
      await writeTree(staging, parsed.data.files);
      const pack = await inspectSpecialistPack(staging);
      return {
        files: parsed.data.files, cleanup,
        async apply({ config, app, setPackCounts }) {
          await rm(libraryRoot(config, app.id), { recursive: true, force: true });
          await saveSpecialistPack(config, app.id, pack);
          setPackCounts({ agents: pack.summary.agents.length, skills: pack.summary.skills.length });
        },
      };
    } catch (error) { await cleanup(); throw error; }
  },
};

const context: Section = {
  key: "context",
  async export({ config, app }) {
    const content = await readSpecialistContext(config, app.id);
    return content ? { content } : undefined;
  },
  async prepare(raw) {
    const parsed = z.object({ content: contextInput }).safeParse(raw);
    if (!parsed.success) throw failure("El contexto del archivo no es válido (máximo 8.000 caracteres).");
    const content = parsed.data.content;
    return { files: [], async apply({ config, app }) { if (content) await writeSpecialistContext(config, app.id, content); } };
  },
};

const tasks: Section = {
  key: "tasks",
  async export({ config, app }) {
    const list = await listTasks(config, app.id);
    if (!list.length) return undefined;
    return { tasks: list.map(task => ({ name: task.name, prompt: task.prompt, schedule: task.schedule, model: task.model, catchUp: task.catchUp })) };
  },
  async prepare(raw) {
    const parsed = z.object({ tasks: z.array(taskInputSchema).max(20) }).safeParse(raw);
    if (!parsed.success) throw failure("Las tareas programadas del archivo no son válidas.");
    const list = parsed.data.tasks;
    return {
      files: [],
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

const portableProject = z.object({
  name: z.string().trim().min(1).max(80),
  dataDir: z.enum(["proyecto", "comex"]),
  files: z.array(bundleFile).max(2_000),
});
const projects: Section = {
  key: "projects",
  async export({ projects: list }) {
    const exported = [];
    for (const project of list) {
      const dataDir = resolveDataDir(project.rootPath);
      // The whole data folder: memory, session summaries, datasets, sources, outputs, artifacts.
      exported.push({ name: project.name, dataDir, files: await readTree(join(project.rootPath, dataDir)) });
    }
    return exported.length ? { projects: exported } : undefined;
  },
  async prepare(raw) {
    const parsed = z.object({ projects: z.array(portableProject).max(100) }).safeParse(raw);
    if (!parsed.success) throw failure("Los proyectos del archivo no son válidos.");
    const list = parsed.data.projects;
    for (const project of list) assertNoPathConflicts(project.files);
    return {
      files: list.flatMap(project => project.files),
      async apply({ createProject }) {
        for (const project of list) {
          const { root } = await createProject(project.name);
          // The new project already has its own data folder (from the app's template); restore into it.
          await writeTree(join(root, resolveDataDir(root)), project.files);
        }
      },
    };
  },
};

/** Order matters on import: the library must exist before projects sync it. */
export const SECTIONS: readonly Section[] = [library, context, tasks, projects];

export function newProjectFolder(config: Pick<ServerConfig, "configPath">, appId: string) {
  return join(specialistDirectory(config), appId, "projects", randomUUID());
}

export async function ensureFolder(path: string) {
  await mkdir(path, { recursive: true });
}
