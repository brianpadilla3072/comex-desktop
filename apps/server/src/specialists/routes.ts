import { ensureComexWorkspace } from "../comex/seed.js";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { specialistApplicationsEnabled, specialistIntegrationsEnabled, specialistLibraryEnabled, scheduledTasksEnabled } from "../comex/features.js";
import { registerIntegrationRoutes } from "./integrations/routes.js";
import { addRoute, type RequestContext, type Route } from "../routes/registry.js";
import { applicationInput, specialistDirectory, specialistStore } from "./store.js";
import { builtInComexPack, inspectSpecialistPack, saveSpecialistPack } from "./packs.js";
import { registerSpecialistToolRoutes } from "./library-tool-api.js";
import { listProposals, removeProposal, proposalSchema } from "./proposals.js";
import {
  agentInput, createLibraryAgent, createLibrarySkill, contextInput, deleteLibraryFile,
  libraryFileInput, listSpecialistLibrary, readLibraryFile, readSpecialistContext, skillInput,
  writeLibraryFile, writeSpecialistContext,
} from "./library.js";
import { applySpecialistLibraryChange } from "./sync.js";
import { createTask, deleteTask, listRuns, listTasks, taskInputSchema, updateTask } from "./tasks.js";
import { currentSpecialistScheduler } from "./scheduler.js";
import type { ServerConfig } from "../types.js";
import type { SpecialistApplication } from "./store.js";

export function registerSpecialistRoutes(options: {
  routes: Route[]; config: ServerConfig;
  readJsonBody: (request: Request) => Promise<Record<string, unknown>>;
  jsonResponse: (body: unknown, status?: number) => Response;
  ensureWritable: (config: ServerConfig) => void;
  createWorkspace: (ctx: RequestContext, payload: Record<string, unknown>) => Promise<string>;
}) {
  const { routes, config, readJsonBody, jsonResponse, ensureWritable, createWorkspace } = options;
  registerIntegrationRoutes(options);
  registerSpecialistToolRoutes(options);
  function requireFeature(write = false) {
    if (!specialistApplicationsEnabled()) throw new ApiError(404, "specialists_disabled", "Los perfiles especialistas están desactivados.");
    if (write) ensureWritable(config);
  }
  function requireLibrary(write = false) {
    requireFeature(write);
    if (!specialistLibraryEnabled()) throw new ApiError(404, "specialist_library_disabled", "La biblioteca de la aplicación está desactivada.");
  }
  /** After any library change: refresh SQLite counts and materialize into the application's live projects. */
  async function applyLibraryChange(app: SpecialistApplication) {
    return applySpecialistLibraryChange(config, app);
  }
  const catalog = async () => {
    if (!specialistApplicationsEnabled()) return { enabled: false, libraryEnabled: false, scheduledTasksEnabled: false, user: null, applications: [] };
    const store = await specialistStore(config);
    const value = store.list();
    // Workspaces removed from the host are not advertised as usable projects.
    return { enabled: true, libraryEnabled: specialistLibraryEnabled(), scheduledTasksEnabled: scheduledTasksEnabled(), integrationsEnabled: specialistIntegrationsEnabled(), ...value, applications: value.applications.map(app => ({ ...app, workspaceIds: app.workspaceIds.filter(id => config.workspaces.some(workspace => workspace.id === id)) })) };
  };
  addRoute(routes, "GET", "/specialist-applications", "client", async () => jsonResponse(await catalog()));
  addRoute(routes, "POST", "/specialist-applications/preview-pack", "host", async ctx => {
    requireFeature();
    const body = await readJsonBody(ctx.request);
    const path = body.template === "comex" ? builtInComexPack() : typeof body.packPath === "string" ? body.packPath : "";
    const pack = await inspectSpecialistPack(path);
    return jsonResponse(pack.summary);
  });
  addRoute(routes, "POST", "/specialist-applications", "host", async ctx => {
    requireFeature(true);
    const body = await readJsonBody(ctx.request);
    const parsed = applicationInput.safeParse(body);
    if (!parsed.success) throw new ApiError(422, "invalid_application", "Revisá tu nombre, el nombre de la aplicación, la especialidad y la personalidad.");
    const store = await specialistStore(config);
    const before = store.list();
    if (!before.user && !parsed.data.userName) throw new ApiError(422, "user_name_required", "Ingresá tu nombre.");
    const id = `app_${randomUUID()}`;
    const source = parsed.data.packPath ?? (parsed.data.template === "comex" ? builtInComexPack() : null);
    const pack = source ? await inspectSpecialistPack(source) : null;
    let app;
    try {
      await saveSpecialistPack(config, id, pack);
      app = store.create(parsed.data, { agents: pack?.summary.agents.length ?? 0, skills: pack?.summary.skills.length ?? 0 }, id);
    }
    catch (error) { await rm(join(specialistDirectory(config), id), { recursive: true, force: true }); throw error; }
    let workspaceId: string;
    if (before.applications.length === 0 && parsed.data.template === "comex" && !parsed.data.packPath && config.workspaces.length) {
      const local = config.workspaces.filter(workspace => workspace.workspaceType === "local");
      for (const workspace of local) { await ensureComexWorkspace(workspace.path); store.bind(workspace.id, id, workspace.path); }
      workspaceId = local.find(workspace => workspace.id === body.preferredWorkspaceId)?.id ?? local[0]?.id ?? "";
    } else workspaceId = "";
    if (!workspaceId) {
      const folderPath = join(specialistDirectory(config), id, "projects", "Principal");
      workspaceId = await createWorkspace(ctx, { folderPath, name: app.name, preset: "specialist", applicationId: id });
    }
    return jsonResponse({ application: app, workspaceId, catalog: await catalog() }, 201);
  });
  addRoute(routes, "POST", "/specialist-applications/:id/activate", "host", async ctx => {
    requireFeature(true);
    (await specialistStore(config)).activate(ctx.params.id);
    return jsonResponse(await catalog());
  });
  addRoute(routes, "PATCH", "/specialist-applications/:id", "host", async ctx => {
    requireFeature(true);
    const parsed = applicationInput.pick({ name: true, specialty: true, personality: true }).safeParse(await readJsonBody(ctx.request));
    if (!parsed.success) throw new ApiError(422, "invalid_application", "Revisá el nombre, la especialidad y la personalidad.");
    const app = (await specialistStore(config)).update(ctx.params.id, parsed.data);
    return jsonResponse({ application: app, catalog: await catalog() });
  });
  addRoute(routes, "POST", "/specialist-applications/:id/projects", "host", async ctx => {
    requireFeature(true);
    const store = await specialistStore(config);
    const app = store.application(ctx.params.id);
    const parsed = z.object({ name: z.string().trim().min(1).max(80) }).safeParse(await readJsonBody(ctx.request));
    if (!parsed.success) throw new ApiError(422, "invalid_project", "Ingresá el nombre del proyecto.");
    const folderPath = join(specialistDirectory(config), app.id, "projects", randomUUID());
    await mkdir(folderPath, { recursive: true });
    const workspaceId = await createWorkspace(ctx, { folderPath, name: parsed.data.name, preset: "specialist", applicationId: app.id });
    store.activate(app.id);
    return jsonResponse({ workspaceId, catalog: await catalog() }, 201);
  });
  addRoute(routes, "GET", "/specialist-applications/:id/library", "client", async ctx => {
    requireLibrary();
    const store = await specialistStore(config);
    const app = store.application(ctx.params.id);
    return jsonResponse({ application: { id: app.id, name: app.name }, ...(await listSpecialistLibrary(config, app.id)) });
  });
  addRoute(routes, "GET", "/specialist-applications/:id/library/file", "client", async ctx => {
    requireLibrary();
    const store = await specialistStore(config);
    const app = store.application(ctx.params.id);
    const path = ctx.url.searchParams.get("path") ?? "";
    return jsonResponse(await readLibraryFile(config, app.id, path));
  });
  addRoute(routes, "PUT", "/specialist-applications/:id/library/file", "host", async ctx => {
    requireLibrary(true);
    const store = await specialistStore(config);
    const app = store.application(ctx.params.id);
    const parsed = z.object({ path: libraryFileInput.shape.path, content: libraryFileInput.shape.content }).safeParse(await readJsonBody(ctx.request));
    if (!parsed.success) throw new ApiError(422, "invalid_library_file", "Revisá la ruta y el contenido del archivo.");
    const item = await writeLibraryFile(config, app.id, parsed.data.path, parsed.data.content);
    return jsonResponse({ item, ...(await applyLibraryChange(app)) });
  });
  addRoute(routes, "DELETE", "/specialist-applications/:id/library/file", "host", async ctx => {
    requireLibrary(true);
    const store = await specialistStore(config);
    const app = store.application(ctx.params.id);
    const deleted = await deleteLibraryFile(config, app.id, ctx.url.searchParams.get("path") ?? "");
    return jsonResponse({ deleted, ...(await applyLibraryChange(app)), catalog: await catalog() });
  });
  addRoute(routes, "POST", "/specialist-applications/:id/library/agents", "host", async ctx => {
    requireLibrary(true);
    const store = await specialistStore(config);
    const app = store.application(ctx.params.id);
    const parsed = agentInput.safeParse(await readJsonBody(ctx.request));
    if (!parsed.success) throw new ApiError(422, "invalid_agent", "El nombre debe ser kebab-case y la descripción tener entre 1 y 1024 caracteres.");
    const item = await createLibraryAgent(config, app.id, parsed.data);
    return jsonResponse({ item, ...(await applyLibraryChange(app)), catalog: await catalog() }, 201);
  });
  addRoute(routes, "POST", "/specialist-applications/:id/library/skills", "host", async ctx => {
    requireLibrary(true);
    const store = await specialistStore(config);
    const app = store.application(ctx.params.id);
    const parsed = skillInput.safeParse(await readJsonBody(ctx.request));
    if (!parsed.success) throw new ApiError(422, "invalid_skill", "El nombre debe ser kebab-case y la descripción tener entre 1 y 1024 caracteres.");
    const item = await createLibrarySkill(config, app.id, parsed.data);
    return jsonResponse({ item, ...(await applyLibraryChange(app)), catalog: await catalog() }, 201);
  });
  addRoute(routes, "GET", "/specialist-applications/:id/context", "client", async ctx => {
    requireLibrary();
    const store = await specialistStore(config);
    const app = store.application(ctx.params.id);
    return jsonResponse({ content: await readSpecialistContext(config, app.id) });
  });
  addRoute(routes, "PUT", "/specialist-applications/:id/context", "host", async ctx => {
    requireLibrary(true);
    const store = await specialistStore(config);
    const app = store.application(ctx.params.id);
    const parsed = z.object({ content: contextInput }).safeParse(await readJsonBody(ctx.request));
    if (!parsed.success) throw new ApiError(422, "invalid_context", "El contexto no puede superar 8.000 caracteres.");
    const content = await writeSpecialistContext(config, app.id, parsed.data.content);
    return jsonResponse({ content });
  });
  addRoute(routes, "GET", "/specialist-applications/:id/library/proposals", "client", async ctx => {
    requireLibrary();
    const store = await specialistStore(config);
    const app = store.application(ctx.params.id);
    return jsonResponse({ proposals: await listProposals(config, app.id) });
  });
  addRoute(routes, "POST", "/specialist-applications/:id/library/proposals/:proposalId/accept", "host", async ctx => {
    requireLibrary(true);
    const store = await specialistStore(config);
    const app = store.application(ctx.params.id);
    const proposal = proposalSchema.parse(await removeProposal(config, app.id, ctx.params.proposalId));
    if (proposal.kind === "context") await writeSpecialistContext(config, app.id, proposal.content);
    else if (proposal.kind === "agent") await createLibraryAgent(config, app.id, { name: proposal.name, description: proposal.description, content: proposal.content });
    else await createLibrarySkill(config, app.id, { name: proposal.name, description: proposal.description, content: proposal.content });
    return jsonResponse({ accepted: proposal.id, ...(await applyLibraryChange(app)), catalog: await catalog() });
  });
  addRoute(routes, "DELETE", "/specialist-applications/:id/library/proposals/:proposalId", "host", async ctx => {
    requireLibrary(true);
    const store = await specialistStore(config);
    const app = store.application(ctx.params.id);
    await removeProposal(config, app.id, ctx.params.proposalId);
    return jsonResponse({ dismissed: ctx.params.proposalId });
  });

  /** Scheduled tasks: recurring local runs of a saved prompt (feature: scheduledTasks). */
  function requireTasks(write = false) {
    requireFeature(write);
    if (!scheduledTasksEnabled()) throw new ApiError(404, "scheduled_tasks_disabled", "Las tareas programadas están desactivadas.");
  }
  addRoute(routes, "GET", "/specialist-applications/:id/tasks", "client", async ctx => {
    requireTasks();
    const store = await specialistStore(config);
    const app = store.application(ctx.params.id);
    return jsonResponse({ tasks: await listTasks(config, app.id) });
  });
  addRoute(routes, "GET", "/specialist-applications/:id/tasks/:taskId/runs", "client", async ctx => {
    requireTasks();
    const store = await specialistStore(config);
    const app = store.application(ctx.params.id);
    return jsonResponse({ runs: await listRuns(config, app.id, ctx.params.taskId) });
  });
  addRoute(routes, "POST", "/specialist-applications/:id/tasks", "host", async ctx => {
    requireTasks(true);
    const store = await specialistStore(config);
    const app = store.application(ctx.params.id);
    const parsed = taskInputSchema.safeParse(await readJsonBody(ctx.request));
    if (!parsed.success) throw new ApiError(422, "invalid_task", "Revisá el nombre, el prompt y el horario de la tarea.");
    const task = await createTask(config, app.id, parsed.data);
    return jsonResponse({ task, tasks: await listTasks(config, app.id) });
  });
  addRoute(routes, "PUT", "/specialist-applications/:id/tasks/:taskId", "host", async ctx => {
    requireTasks(true);
    const store = await specialistStore(config);
    const app = store.application(ctx.params.id);
    const parsed = taskInputSchema.partial().extend({ enabled: z.boolean().optional() }).safeParse(await readJsonBody(ctx.request));
    if (!parsed.success) throw new ApiError(422, "invalid_task", "Revisá los campos de la tarea.");
    const task = await updateTask(config, app.id, ctx.params.taskId, parsed.data);
    return jsonResponse({ task, tasks: await listTasks(config, app.id) });
  });
  addRoute(routes, "DELETE", "/specialist-applications/:id/tasks/:taskId", "host", async ctx => {
    requireTasks(true);
    const store = await specialistStore(config);
    const app = store.application(ctx.params.id);
    await deleteTask(config, app.id, ctx.params.taskId);
    return jsonResponse({ deleted: ctx.params.taskId, tasks: await listTasks(config, app.id) });
  });
  addRoute(routes, "POST", "/specialist-applications/:id/tasks/:taskId/run-now", "host", async ctx => {
    requireTasks(true);
    const store = await specialistStore(config);
    const app = store.application(ctx.params.id);
    const scheduler = currentSpecialistScheduler();
    if (!scheduler) throw new ApiError(503, "scheduler_unavailable", "El planificador no está corriendo en este server.");
    const result = await scheduler.trigger(app.id, ctx.params.taskId);
    return jsonResponse({ started: result.ok, detail: result.detail ?? null, tasks: await listTasks(config, app.id) });
  });
}
