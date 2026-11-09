import { randomBytes, createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { addRoute, type RequestContext, type Route } from "../routes/registry.js";
import { workspaceIdForPath } from "../workspaces.js";
import { specialistApplicationsEnabled, specialistDatasetsEnabled, specialistLibraryEnabled, scheduledTasksEnabled } from "../comex/features.js";
import {
  agentInput, contextInput, createLibraryAgent, createLibrarySkill, deleteLibraryFile, libraryFileInput,
  listSpecialistLibrary, readLibraryFile, readSpecialistContext, skillInput, writeLibraryFile, writeSpecialistContext,
} from "./library.js";
import { addProposal } from "./proposals.js";
import { createTask, deleteTask, listTasks, updateTask } from "./tasks.js";
import { listDatasets, listSnapshotDates, readLatestSnapshot, registerDerivedDataset } from "./datasets.js";
import { refreshDatasetThroughResearch } from "./datasets-refresh.js";
import { applySpecialistLibraryChange } from "./sync.js";
import { specialistDirectory, specialistStore, type SpecialistApplication } from "./store.js";
import type { ServerConfig } from "../types.js";

const MARKER = "// Managed by Comex: specialist-library-v1\n";
const descriptorSchema = z.object({ directory: z.string(), token: z.string().min(16), url: z.string().url() });
const toolCallSchema = z.object({ name: z.enum([
  "specialist_library_list", "specialist_library_read", "specialist_library_write", "specialist_library_delete",
  "specialist_agent_create", "specialist_skill_create", "specialist_context_write", "specialist_propose",
  "specialist_task_create", "specialist_task_list", "specialist_task_pause", "specialist_task_delete",
  "specialist_dataset_list", "specialist_dataset_read", "specialist_dataset_refresh", "specialist_dataset_derive",
]), input: z.record(z.string(), z.unknown()) });

const toolDirectory = (config: Pick<ServerConfig, "configPath">) => join(specialistDirectory(config), "tool");

async function readDescriptor(config: Pick<ServerConfig, "configPath">, directory: string) {
  const file = join(toolDirectory(config), createHash("sha256").update(directory).digest("hex") + ".json");
  try { return { file, value: descriptorSchema.parse(JSON.parse(await readFile(file, "utf8"))) }; }
  catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null; throw error; }
}

async function writeDescriptor(file: string, value: { directory: string; token: string; url: string }) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, JSON.stringify(value), { mode: 0o600 });
}

/** Idempotent project-only installation, mirroring the research plugin. Never touches non-specialist folders. */
export async function syncLibraryToolPlugin(config: Pick<ServerConfig, "configPath" | "port" | "workspaces">, workspaceId: string, directory: string) {
  if (!specialistApplicationsEnabled()) return;
  const store = await specialistStore(config);
  const app = store.forWorkspace(workspaceId);
  const canonical = resolve(directory);
  const existing = await readDescriptor(config, canonical);
  const target = existing?.file ?? join(toolDirectory(config), createHash("sha256").update(canonical).digest("hex") + ".json");
  if (!app || (!specialistLibraryEnabled() && !scheduledTasksEnabled() && !specialistDatasetsEnabled()) || !store.projectsFor(app.id).some(project => project.workspaceId === workspaceId)) {
    if (existing) await writeDescriptor(target, { directory: canonical, token: "00000000000000000000000000000000", url: `http://127.0.0.1:${config.port}/specialist-tool` }).catch(() => undefined);
    return;
  }
  const token = existing && existing.value.token !== "00000000000000000000000000000000" ? existing.value.token : randomBytes(24).toString("base64url");
  await writeDescriptor(target, { directory: canonical, token, url: `http://127.0.0.1:${config.port}/specialist-tool` });
  let folder = canonical;
  for (const part of [".opencode", "plugins", "comex-library"]) {
    folder = join(folder, part);
    await mkdir(folder, { recursive: true });
    const stat = await lstat(folder);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ApiError(409, "library_plugin_conflict", "La biblioteca no admite carpetas de proyecto enlazadas.");
  }
  const path = join(folder, "server.js");
  const module = new URL(import.meta.url.endsWith(".ts") ? "./library-plugin.ts" : "./library-plugin.js", import.meta.url).href;
  const source = `${MARKER}import { createSpecialistLibraryPlugin } from ${JSON.stringify(module)};\nexport default createSpecialistLibraryPlugin(${JSON.stringify(target)});\n`;
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new ApiError(409, "library_plugin_conflict", "El proyecto ya tiene una biblioteca personalizada; se conservó sin cambios.");
    const current = await readFile(path, "utf8");
    if (!current.startsWith(MARKER)) throw new ApiError(409, "library_plugin_conflict", "El proyecto ya tiene una biblioteca personalizada; se conservó sin cambios.");
    if (current !== source) await writeFile(path, source, { mode: 0o600 });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") await writeFile(path, source, { mode: 0o600, flag: "wx" });
    else throw error;
  }
}

async function resolveApp(config: Pick<ServerConfig, "configPath">, directory: string): Promise<SpecialistApplication> {
  const store = await specialistStore(config);
  const app = store.forWorkspace(workspaceIdForPath(directory));
  if (!app) throw new ApiError(409, "library_no_application", "Esta carpeta no pertenece a una aplicación especialista.");
  return app;
}

const proposalInput = z.object({
  kind: z.enum(["skill", "agent", "context", "task", "plan"]),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(1024),
  content: z.string().min(1).max(200_000),
  reason: z.string().trim().max(500).default(""),
});

export async function runLibraryTool(config: Pick<ServerConfig, "configPath" | "workspaces">, directory: string, name: string, input: Record<string, unknown>) {
  const app = await resolveApp(config, directory);
  // One gate per family: the plugin registers both sets, but each rides on its own feature flag.
  if (name.startsWith("specialist_task_")) {
    if (!scheduledTasksEnabled()) throw new ApiError(409, "scheduled_tasks_disabled", "Las tareas programadas están desactivadas en este server.");
  } else if (name.startsWith("specialist_dataset_")) {
    if (!specialistDatasetsEnabled()) throw new ApiError(409, "specialist_datasets_disabled", "Los datasets de investigación están desactivados en este server.");
  } else if (!specialistLibraryEnabled()) throw new ApiError(409, "specialist_library_disabled", "La biblioteca de la aplicación está desactivada.");
  switch (name) {
    case "specialist_library_list": {
      const listing = await listSpecialistLibrary(config, app.id);
      return { application: { id: app.id, name: app.name, specialty: app.specialty }, ...listing, context: await readSpecialistContext(config, app.id) };
    }
    case "specialist_library_read":
      return readLibraryFile(config, app.id, libraryFileInput.shape.path.parse(input.path));
    case "specialist_library_write": {
      const parsed = libraryFileInput.parse({ path: input.path, content: input.content });
      const item = await writeLibraryFile(config, app.id, parsed.path, parsed.content);
      return { item, ...(await applySpecialistLibraryChange(config, app)) };
    }
    case "specialist_library_delete": {
      const deleted = await deleteLibraryFile(config, app.id, libraryFileInput.shape.path.parse(input.path));
      return { deleted, ...(await applySpecialistLibraryChange(config, app)) };
    }
    case "specialist_agent_create": {
      const parsed = agentInput.parse({ name: input.name, description: input.description, ...(input.content !== undefined ? { content: input.content } : {}) });
      const item = await createLibraryAgent(config, app.id, parsed);
      return { item, ...(await applySpecialistLibraryChange(config, app)) };
    }
    case "specialist_skill_create": {
      const parsed = skillInput.parse({ name: input.name, description: input.description, ...(input.content !== undefined ? { content: input.content } : {}) });
      const item = await createLibrarySkill(config, app.id, parsed);
      return { item, ...(await applySpecialistLibraryChange(config, app)) };
    }
    case "specialist_context_write":
      return { content: await writeSpecialistContext(config, app.id, contextInput.parse(input.content ?? "")) };
    case "specialist_propose": {
      const parsed = proposalInput.parse(input);
      // Task/plan payloads are JSON strings; keep them as text in the proposal so the inbox stays
      // a simple file and the accept route re-validates before anything runs.
      const { proposals, replaced } = await addProposal(config, app.id, parsed.kind === "context" ? { ...parsed, name: "contexto" } : parsed);
      const note = parsed.kind === "task"
        ? "Avisá a la persona que la tarea propuesta quedó en el menú de su aplicación; si la acepta, se crea PAUSADA para que la revise antes de dejarla correr."
        : parsed.kind === "plan"
          ? "Avisá a la persona que el plan quedó en el menú de su aplicación; al aceptarlo se aplican sus piezas (skill, dataset, tarea pausada, panel) y se informa cuáles fallaron."
          : "Avisá a la persona que la propuesta quedó en el menú de su aplicación, en Contexto, agentes y skills; vos no la guardás.";
      return { proposal: proposals[0], total: proposals.length, replaced, note };
    }
    case "specialist_task_create": {
      const task = await createTask(config, app.id, { name: input.name, prompt: input.prompt, schedule: input.schedule });
      return { task, note: `Próxima corrida: ${task.nextRunAt === null ? "—" : new Date(task.nextRunAt).toLocaleString("es-AR")}. Avisá a la persona que la tarea quedó en "Tareas programadas" de su aplicación.` };
    }
    case "specialist_task_list":
      return { tasks: await listTasks(config, app.id) };
    case "specialist_task_pause": {
      const task = await updateTask(config, app.id, z.string().parse(input.taskId), { enabled: false });
      return { task };
    }
    case "specialist_task_delete": {
      const deleted = await deleteTask(config, app.id, z.string().parse(input.taskId));
      return { deleted: deleted.id };
    }
    case "specialist_dataset_list":
      return { datasets: await listDatasets(directory), note: "La persona ve estos datasets en el menú de su aplicación, en Contexto, agentes y skills → Datos." };
    case "specialist_dataset_read": {
      const id = z.string().min(1).parse(input.id);
      const dataset = (await listDatasets(directory)).find(entry => entry.id === id);
      if (!dataset) throw new ApiError(404, "dataset_not_found", "Ese dataset no existe en este proyecto.");
      const snapshots = await listSnapshotDates(directory, id);
      const preview = JSON.stringify(await readLatestSnapshot(directory, id));
      // Same guard as the research tools: a huge snapshot arrives as a bounded preview, never as a flood.
      const truncated = preview.length > 40_000;
      return {
        dataset, snapshots, truncated,
        latest: truncated ? preview.slice(0, 40_000) : JSON.parse(preview) as unknown,
        ...(truncated ? { note: "El snapshot supera 40 KB: recibís un recorte. El resto está en comex/datasets del proyecto." } : {}),
      };
    }
    case "specialist_dataset_refresh": {
      // Same path as the panel's "Actualizar" button: re-runs the stored query through Tavily and records a new snapshot.
      const dataset = await refreshDatasetThroughResearch(config, directory, z.string().min(1).parse(input.id));
      return { dataset, note: `Consulta re-ejecutada: el dataset ${dataset.id} quedó con un snapshot nuevo. La persona lo ve en Contexto, agentes y skills → Datos. Si el proveedor no está conectado, avisale en voz alta y no inventes cifras.` };
    }
    case "specialist_dataset_derive": {
      const parsed = z.object({
        sourceId: z.string().min(1),
        name: z.string().trim().min(1).max(120),
        payload: z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]),
      }).parse(input);
      if (Buffer.byteLength(JSON.stringify(parsed.payload), "utf8") > 1_000_000) throw new ApiError(422, "invalid_dataset", "El payload del dataset derivado no puede superar 1 MB.");
      const dataset = await registerDerivedDataset(directory, parsed.sourceId, parsed.name, parsed.payload);
      return { dataset, note: "Quedó registrado como dataset derivado, con linaje a su origen. La persona lo ve en Contexto, agentes y skills → Datos." };
    }
    default: throw new ApiError(404, "library_tool_unknown", "Esa herramienta de biblioteca no existe.");
  }
}

/** Bearer-token scoped to one project folder; the plugin's descriptor carries it. */
export function registerSpecialistToolRoutes(options: {
  routes: Route[]; config: ServerConfig;
  readJsonBody: (request: Request) => Promise<Record<string, unknown>>;
  jsonResponse: (body: unknown, status?: number) => Response;
}) {
  const { routes, config, readJsonBody, jsonResponse } = options;
  addRoute(routes, "POST", "/specialist-tool", "none", async (ctx: RequestContext) => {
    if (!specialistApplicationsEnabled() || (!specialistLibraryEnabled() && !scheduledTasksEnabled() && !specialistDatasetsEnabled())) throw new ApiError(404, "specialist_library_disabled", "La biblioteca de la aplicación está desactivada.");
    const bearer = ctx.request.headers.get("authorization") ?? "";
    const token = bearer.startsWith("Bearer ") ? bearer.slice(7) : "";
    if (token.length < 16) throw new ApiError(401, "library_tool_unauthorized", "Falta la credencial de la biblioteca.");
    const directory = await findDescriptorDirectory(config, token);
    if (!directory) throw new ApiError(401, "library_tool_unauthorized", "La credencial de la biblioteca no corresponde a este proyecto.");
    const call = toolCallSchema.parse(await readJsonBody(ctx.request));
    const result = await runLibraryTool(config, directory, call.name, call.input);
    return jsonResponse({ ok: true, result });
  });
}

async function findDescriptorDirectory(config: Pick<ServerConfig, "configPath">, token: string): Promise<string | null> {
  const cache = descriptorCache(config);
  const known = [...cache.entries()].find(([, value]) => value === token);
  if (known) return known[0];
  let files: string[] = [];
  try { files = await readdir(toolDirectory(config)); } catch { return null; }
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const value = descriptorSchema.parse(JSON.parse(await readFile(join(toolDirectory(config), file), "utf8")));
      if (value.directory && cache.get(value.directory) !== value.token) {
        cache.set(value.directory, value.token);
        if (value.token === token && token !== "00000000000000000000000000000000") return value.directory;
      }
    } catch { /* Descriptor for another project or disabled state. */ }
  }
  return null;
}

const caches = new Map<string, Map<string, string>>();
function descriptorCache(config: Pick<ServerConfig, "configPath">) {
  const key = join(specialistDirectory(config), "tool");
  let cache = caches.get(key);
  if (!cache) { cache = new Map(); caches.set(key, cache); }
  return cache;
}
