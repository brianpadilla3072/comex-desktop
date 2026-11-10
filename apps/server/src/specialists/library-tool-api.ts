import { randomBytes, createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { addRoute, type RequestContext, type Route } from "../routes/registry.js";
import { workspaceIdForPath } from "../workspaces.js";
import { specialistApplicationsEnabled, specialistDatasetsEnabled, specialistLibraryEnabled, specialistPanelsEnabled, specialistSourcesEnabled, scheduledTasksEnabled, sourcesLocalFilesEnabled, studioOutputsEnabled } from "../comex/features.js";
import {
  agentInput, contextInput, createLibraryAgent, createLibrarySkill, deleteLibraryFile, libraryFileInput,
  listSpecialistLibrary, readLibraryFile, readSpecialistContext, skillInput, writeLibraryFile, writeSpecialistContext,
} from "./library.js";
import { addProposal } from "./proposals.js";
import { createTask, deleteTask, listTasks, taskModelSchema, updateTask } from "./tasks.js";
import { listDatasets, listSnapshotDates, readLatestSnapshot, registerDerivedDataset } from "./datasets.js";
import { refreshDatasetThroughResearch } from "./datasets-refresh.js";
import { ensureChunks, readCitation, registerLocalSource } from "./sources.js";
import { deletePanel, listPanels, readPanelSpec, resolvePanel, writePanel } from "./panels.js";
import { auditOutputCitations, listOutputs, readOutput, writeOutput } from "./outputs.js";
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
  "specialist_source_read", "specialist_source_add",
  "specialist_panel_list", "specialist_panel_write", "specialist_panel_read", "specialist_panel_delete",
  "specialist_openapi_propose",
  "specialist_output_generate", "specialist_output_list", "specialist_output_read",
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

export type SpecialistToolDescriptor = { directory: string; token: string; url: string };

/** The scoped credential a project's tool bridge already holds; the panel App projects the
 *  same one into its MCP connection, so a project never grows a second secret. */
export async function readSpecialistToolDescriptor(config: Pick<ServerConfig, "configPath">, directory: string): Promise<SpecialistToolDescriptor | null> {
  const found = await readDescriptor(config, resolve(directory));
  return found ? found.value : null;
}

/** Token → project folder, for the loopback endpoints that authenticate with it. */
export function specialistTokenDirectory(config: Pick<ServerConfig, "configPath">, token: string): Promise<string | null> {
  return findDescriptorDirectory(config, token);
}

/** Idempotent project-only installation, mirroring the research plugin. Never touches non-specialist folders. */
export async function syncLibraryToolPlugin(config: Pick<ServerConfig, "configPath" | "port" | "workspaces">, workspaceId: string, directory: string) {
  if (!specialistApplicationsEnabled()) return;
  const store = await specialistStore(config);
  const app = store.forWorkspace(workspaceId);
  const canonical = resolve(directory);
  const existing = await readDescriptor(config, canonical);
  const target = existing?.file ?? join(toolDirectory(config), createHash("sha256").update(canonical).digest("hex") + ".json");
  if (!app || (!specialistLibraryEnabled() && !scheduledTasksEnabled() && !specialistDatasetsEnabled() && !specialistSourcesEnabled() && !specialistPanelsEnabled() && !studioOutputsEnabled()) || !store.projectsFor(app.id).some(project => project.workspaceId === workspaceId)) {
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
  try {
    return await runLibraryToolInner(config, directory, name, input);
  } catch (error) {
    // A model that sends a slightly-off input must get a readable 422 it can self-correct from —
    // never a bare "Unexpected server error" (doctrine: fails loud but readable).
    if (error instanceof z.ZodError) throw new ApiError(422, "invalid_library_tool", "La llamada a la herramienta no trae los campos esperados; revisá el schema del tool y reintentá.");
    throw error;
  }
}
async function runLibraryToolInner(config: Pick<ServerConfig, "configPath" | "workspaces">, directory: string, name: string, input: Record<string, unknown>) {
  const app = await resolveApp(config, directory);
  // One gate per family: the plugin registers all sets, but each rides on its own feature flag.
  // Proposals are the capture seam shared by EVERY family, so they ride on "any family on" —
  // the same condition the proposals routes use (requireCapture).
  if (name === "specialist_propose") {
    if (!specialistLibraryEnabled() && !scheduledTasksEnabled() && !specialistDatasetsEnabled() && !specialistPanelsEnabled()) {
      throw new ApiError(409, "specialist_library_disabled", "La captura de propuestas está desactivada en este server.");
    }
  } else if (name.startsWith("specialist_task_")) {
    if (!scheduledTasksEnabled()) throw new ApiError(409, "scheduled_tasks_disabled", "Las tareas programadas están desactivadas en este server.");
  } else if (name.startsWith("specialist_dataset_")) {
    if (!specialistDatasetsEnabled()) throw new ApiError(409, "specialist_datasets_disabled", "Los datasets de investigación están desactivados en este server.");
  } else if (name.startsWith("specialist_source_")) {
    if (!specialistSourcesEnabled()) throw new ApiError(409, "specialist_sources_disabled", "Las fuentes citables están desactivadas en este server.");
  } else if (name.startsWith("specialist_panel_")) {
    if (!specialistPanelsEnabled()) throw new ApiError(409, "specialist_panels_disabled", "Los paneles están desactivados en este server.");
  } else if (name.startsWith("specialist_output_")) {
    if (!studioOutputsEnabled()) throw new ApiError(409, "studio_outputs_disabled", "Las salidas del mini-Studio están desactivadas en este server.");
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
      // A task can pin its model ("provider/model" or {providerID, modelID}); without one the
      // engine's default applies, which may be a pricier model than the person expects.
      const model = z.union([
        z.string().trim().regex(/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/, "Usá provider/model"),
        taskModelSchema,
      ]).nullable().optional().parse(input.model ?? null);
      const parsedModel = typeof model === "string"
        ? { providerID: model.slice(0, model.indexOf("/")), modelID: model.slice(model.indexOf("/") + 1) }
        : model ?? null;
      const task = await createTask(config, app.id, { name: input.name, prompt: input.prompt, schedule: input.schedule, model: parsedModel });
      return { task, note: `Próxima corrida: ${task.nextRunAt === null ? "—" : new Date(task.nextRunAt).toLocaleString("es-AR")}. ${task.model ? `Corre con ${task.model.providerID}/${task.model.modelID}.` : "Corre con el modelo predeterminado del motor."} Avisá a la persona que la tarea quedó en "Tareas programadas" de su aplicación, donde puede elegir el modelo.` };
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
      // Query-only datasets (registered by a plan) have no snapshot yet: say so instead of ENOENT.
      if (dataset.lastSnapshotAt === null) {
        return { dataset, snapshots, latest: null, truncated: false, note: "El dataset todavía no tuvo una corrida: su consulta está guardada y es re-ejecutable, pero no hay snapshot que leer." };
      }
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
    case "specialist_source_read": {
      const parsed = z.object({ id: z.string().min(1), chunk: z.number().int().min(0).optional() }).parse(input);
      if (parsed.chunk === undefined) {
        // Index first: the model only ever cites an anchor it has seen.
        const { source, chunks } = await ensureChunks(directory, parsed.id);
        return { source, totalChunks: chunks.length, chunks: chunks.slice(0, 30), note: "Citá como [fuente:<id>#<n>] donde n es el índice del pasaje. Antes de citar un dato, verificá el pasaje con especialist_source_read {id, chunk:n}; nunca cites de memoria." };
      }
      const resolved = await readCitation(directory, parsed.id, parsed.chunk);
      if (!resolved.ok) return { ok: false, error: resolved.error, note: "El ancla no existe: no cites este pasaje como si existiera; decilo o elegí otro." };
      return { ok: true, source: resolved.source, chunk: resolved.chunk, text: resolved.text };
    }
    case "specialist_source_add": {
      if (!sourcesLocalFilesEnabled()) throw new ApiError(409, "sources_local_files_disabled", "Las fuentes locales están desactivadas en este server.");
      const parsed = z.object({ path: z.string().trim().min(1).max(500), title: z.string().trim().max(200).optional() }).parse(input);
      const source = await registerLocalSource(directory, parsed);
      return { source, note: "Quedó registrada como fuente citable (provider file). La persona la ve en el menú de su aplicación, en Fuentes; citaila con [fuente:<id>#<n>] tras leer el pasaje con specialist_source_read." };
    }
    case "specialist_panel_list":
      return { panels: await listPanels(config, app.id) };
    case "specialist_panel_write": {
      const parsed = z.object({ name: z.string().min(1), spec: z.record(z.string(), z.unknown()) }).parse(input);
      const result = await writePanel(config, app.id, parsed.name, parsed.spec);
      return { panel: result.name, created: result.created, note: "La persona ve el panel en el menú de su aplicación, en Paneles; se redibuja solo cuando el snapshot cambia." };
    }
    case "specialist_panel_read": {
      const name = z.string().min(1).parse(input.name);
      const spec = await readPanelSpec(config, app.id, name);
      const resolution = await resolvePanel(config, app.id, name, directory);
      return { spec, resolution, note: "Si resolution.ok es false, el panel dice qué está mal en vez de dibujar en blanco: pasale el error a la persona tal cual." };
    }
    case "specialist_panel_delete": {
      const deleted = await deletePanel(config, app.id, z.string().min(1).parse(input.name));
      return { deleted };
    }
    case "specialist_openapi_propose": {
      if (!specialistLibraryEnabled() && !scheduledTasksEnabled() && !specialistDatasetsEnabled() && !specialistPanelsEnabled()) {
        throw new ApiError(409, "specialist_library_disabled", "La captura de propuestas está desactivada en este server.");
      }
      // F5: the person pasted an OpenAPI spec — pack it as a PLAN proposal the person accepts:
      // a query skill, a re-runnable dataset bound to the endpoint, and a table panel over it.
      // Credentials never ride along: the skill says auth goes through an integration, never embedded.
      const parsed = z.object({ spec: z.string().min(2).max(200_000), title: z.string().trim().max(120).optional() }).parse(input);
      let raw: unknown;
      try { raw = JSON.parse(parsed.spec); }
      catch { throw new ApiError(422, "invalid_openapi", "El spec OpenAPI debe ser JSON válido (pegá el documento completo)."); }
      if (typeof raw !== "object" || raw === null || !("paths" in raw)) throw new ApiError(422, "invalid_openapi", "El spec no tiene el objeto `paths`: ¿es un documento OpenAPI?");
      const paths = (raw as { paths: Record<string, unknown> }).paths;
      const operations = Object.entries(paths).flatMap(([path, item]) => {
        if (typeof item !== "object" || item === null) return [];
        return Object.entries(item as Record<string, unknown>)
          .filter(([method]) => method.toLowerCase() === "get")
          .map(([method, operation]) => ({ path, method, operation: (typeof operation === "object" && operation !== null && "operationId" in operation ? String((operation as { operationId: unknown }).operationId) : `${method.toUpperCase()} ${path}`) }));
      });
      if (!operations.length) throw new ApiError(422, "invalid_openapi", "El spec no expone ningún GET: el pack mínimo propone consultas de lectura.");
      const [first] = operations;
      const baseUrl = (raw as { servers?: Array<{ url?: string }> }).servers?.[0]?.url ?? "";
      const name = (parsed.title ?? (raw as { info?: { title?: string } }).info?.title ?? "api").toString().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "api";
      const skillContent = `# Consultar ${name}\n\nUsa el endpoint \`${(first?.path ?? "/")}\` de la API para responder consultas. Los datos quedan como dataset re-ejecutable \`${name}\`.\n\n## Pasos\n1. Llamá al endpoint con los parámetros que pida la persona (autenticación: las credenciales viven en la integración del usuario, NUNCA embebidas en este skill ni en el dataset).\n2. Guardá la respuesta como snapshot del dataset y citá [fuente:<id>#<n>] tras leer cada pasaje con specialist_source_read.\n3. Si la API falla, decilo en voz alta: nunca inventes cifras.`;
      const planContent = JSON.stringify({
        skill: { name: `consultar-${name}`.slice(0, 64), description: `Consulta la API de ${name} y deja sus datos como dataset re-ejecutable.`, content: skillContent },
        dataset: { name, query: { provider: "openapi", operation: "fetch", input: { url: `${baseUrl}${first?.path ?? ""}`, method: "GET", operationId: first?.operation ?? null, specNote: "Consulta re-ejecutable sobre la API; autenticación vía integración del usuario, nunca embebida." } } },
        panel: { name: `${name}-panel`.slice(0, 64), spec: { title: name, source: { dataset: name }, refresh: { watch: "latest" }, blocks: [{ type: "table", limit: 50 }] } },
      });
      const { proposals, replaced } = await addProposal(config, app.id, { kind: "plan", name: `api-${name}`.slice(0, 120), description: `Pack de consulta para la API de ${name} (${operations.length} GET).`, content: planContent, reason: parsed.title ? "La persona pegó el spec OpenAPI." : "Propuesto desde el spec OpenAPI." });
      return { proposal: proposals[0], total: proposals.length, replaced, operations: operations.length, note: `La persona ve el plan en el menú de su aplicación; al aceptarlo se aplican skill + dataset (provider openapi, re-ejecutable) + panel de tabla. Las credenciales de la API NO quedaron guardadas: el skill indica que van por la integración del usuario.` };
    }
    case "specialist_output_generate": {
      const parsed = z.object({
        kind: z.enum(["mindmap", "report", "flashcards", "quiz", "table"]),
        title: z.string().trim().min(1).max(200),
        content: z.string().min(1),
        fromDatasets: z.array(z.string()).max(20).default([]),
        fromSources: z.array(z.string()).max(20).default([]),
        focus: z.string().max(500).default(""),
        id: z.string().min(1).optional(),
      }).parse(input);
      const result = await writeOutput(directory, parsed);
      // The citation audit rides with the result: never hand over a Studio output whose anchors
      // do not resolve without saying so.
      const audit = await auditOutputCitations(directory, result.output.id);
      return {
        output: result.output, created: result.created, audit,
        note: audit.total === 0
          ? "La salida quedó SIN anclas [fuente:…]: avisale a la persona que no está anclada a fuentes del proyecto."
          : audit.invalid.length ? `La salida tiene ${audit.invalid.length} cita${audit.invalid.length === 1 ? "" : "s"} que no resuelven: ${audit.invalid[0]!.reason} Revisalas antes de darla por buena.` : "Toda cita de la salida resuelve a un pasaje real del proyecto.",
      };
    }
    case "specialist_output_list":
      return { outputs: await listOutputs(directory) };
    case "specialist_output_read": {
      const id = z.string().min(1).parse(input.id);
      const { meta, content } = await readOutput(directory, id);
      const audit = await auditOutputCitations(directory, id);
      return { output: meta, content: content.slice(0, 60_000), truncated: content.length > 60_000, audit };
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
    if (!specialistApplicationsEnabled() || (!specialistLibraryEnabled() && !scheduledTasksEnabled() && !specialistDatasetsEnabled() && !specialistSourcesEnabled() && !specialistPanelsEnabled() && !studioOutputsEnabled())) throw new ApiError(404, "specialist_library_disabled", "La biblioteca de la aplicación está desactivada.");
    const bearer = ctx.request.headers.get("authorization") ?? "";
    const token = bearer.startsWith("Bearer ") ? bearer.slice(7) : "";
    if (token.length < 16) throw new ApiError(401, "library_tool_unauthorized", "Falta la credencial de la biblioteca.");
    const directory = await findDescriptorDirectory(config, token);
    if (!directory) throw new ApiError(401, "library_tool_unauthorized", "La credencial de la biblioteca no corresponde a este proyecto.");
    const parsedCall = toolCallSchema.safeParse(await readJsonBody(ctx.request));
    if (!parsedCall.success) throw new ApiError(422, "invalid_library_tool", "La llamada no trae un nombre de herramienta válido ni el input esperado.");
    const result = await runLibraryTool(config, directory, parsedCall.data.name, parsedCall.data.input);
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
