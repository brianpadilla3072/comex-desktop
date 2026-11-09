import { ensureComexWorkspace } from "../comex/seed.js";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { specialistApplicationsEnabled, specialistDatasetsEnabled, specialistIntegrationsEnabled, specialistLibraryEnabled, specialistPanelsEnabled, specialistSourcesEnabled, scheduledTasksEnabled, studioOutputsEnabled } from "../comex/features.js";
import { registerIntegrationRoutes } from "./integrations/routes.js";
import { addRoute, type RequestContext, type Route } from "../routes/registry.js";
import { applicationInput, specialistDirectory, specialistStore } from "./store.js";
import { builtInComexPack, inspectSpecialistPack, saveSpecialistPack } from "./packs.js";
import { registerSpecialistToolRoutes } from "./library-tool-api.js";
import { listProposals, parsePlanProposalContent, parseTaskProposalContent, rawProposal, removeProposal, restoreProposal, proposalSchema } from "./proposals.js";
import {
  agentInput, createLibraryAgent, createLibrarySkill, contextInput, deleteLibraryFile,
  libraryFileInput, listSpecialistLibrary, readLibraryFile, readSpecialistContext, skillInput,
  writeLibraryFile, writeSpecialistContext,
} from "./library.js";
import { applySpecialistLibraryChange } from "./sync.js";
import { createTask, deleteTask, listRuns, listTasks, taskInputSchema, updateTask } from "./tasks.js";
import { deleteDataset, listDatasets, listSnapshotDates, readLatestSnapshot, registerDatasetQuery } from "./datasets.js";
import { refreshDatasetThroughResearch } from "./datasets-refresh.js";
import { deletePanel, listPanels, readPanelSpec, resolvePanel, writePanel } from "./panels.js";
import { auditOutputCitations, deleteOutput, listOutputs, outputKindSchema, readOutput, writeOutput } from "./outputs.js";
import { ensureChunks, listSources, readCitation } from "./sources.js";
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
    if (!specialistApplicationsEnabled()) return { enabled: false, libraryEnabled: false, scheduledTasksEnabled: false, datasetsEnabled: false, panelsEnabled: false, sourcesEnabled: false, outputsEnabled: false, user: null, applications: [] };
    const store = await specialistStore(config);
    const value = store.list();
    // Workspaces removed from the host are not advertised as usable projects.
    return { enabled: true, libraryEnabled: specialistLibraryEnabled(), scheduledTasksEnabled: scheduledTasksEnabled(), datasetsEnabled: specialistDatasetsEnabled(), panelsEnabled: specialistPanelsEnabled(), sourcesEnabled: specialistSourcesEnabled(), outputsEnabled: studioOutputsEnabled(), integrationsEnabled: specialistIntegrationsEnabled(), ...value, applications: value.applications.map(app => ({ ...app, workspaceIds: app.workspaceIds.filter(id => config.workspaces.some(workspace => workspace.id === id)) })) };
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
  /** Proposals are the capture seam for every family (library, tasks, datasets, panels): the inbox
   *  stays reachable while at least one of them is on, and each accepted piece is gated by its own
   *  flag so a plan can report exactly which part could not be applied. */
  function requireCapture(write = false) {
    requireFeature(write);
    if (!specialistLibraryEnabled() && !scheduledTasksEnabled() && !specialistDatasetsEnabled() && !specialistPanelsEnabled()) {
      throw new ApiError(404, "specialist_library_disabled", "La captura de la aplicación está desactivada.");
    }
  }
  addRoute(routes, "GET", "/specialist-applications/:id/library/proposals", "client", async ctx => {
    requireCapture();
    const store = await specialistStore(config);
    const app = store.application(ctx.params.id);
    return jsonResponse({ proposals: await listProposals(config, app.id) });
  });
  addRoute(routes, "POST", "/specialist-applications/:id/library/proposals/:proposalId/accept", "host", async ctx => {
    requireCapture(true);
    const store = await specialistStore(config);
    const app = store.application(ctx.params.id);
    // Validate BEFORE removing it from the inbox: a hand-edited proposal must fail with the
    // proposal still there, not vanish and leave the person wondering what happened. Removal is
    // serialized in proposals.ts, so two concurrent accepts can't both take the same id.
    const found = await rawProposal(config, app.id, ctx.params.proposalId);
    if (!found) throw new ApiError(404, "proposal_not_found", "Esa propuesta ya no está.");
    const parsedProposal = proposalSchema.safeParse(found);
    if (!parsedProposal.success) throw new ApiError(422, "invalid_proposal", "La propuesta guardada está dañada; revisala con el asistente o descartala.");
    const proposal = parsedProposal.data;
    const taskContent = proposal.kind === "task" ? parseTaskProposalContent(proposal.content) : null;
    const planContent = proposal.kind === "plan" ? parsePlanProposalContent(proposal.content) : null;
    await removeProposal(config, app.id, proposal.id);
    type AppliedPiece = { piece: string; ok: boolean; id?: string; detail?: string };
    const applied: AppliedPiece[] = [];
    const attempt = async (piece: string, work: () => Promise<{ id?: string } | void>) => {
      try { const result = await work(); applied.push({ piece, ok: true, ...(result?.id ? { id: result.id } : {}) }); }
      catch (error) { applied.push({ piece, ok: false, detail: error instanceof ApiError ? error.message : error instanceof Error ? error.message : "Falló sin detalle." }); }
    };
    const needLibrary = (piece: string) => { if (!specialistLibraryEnabled()) throw new ApiError(409, "specialist_library_disabled", `La pieza ${piece} necesita la biblioteca, que está desactivada.`); };
    const needTasks = () => { if (!scheduledTasksEnabled()) throw new ApiError(409, "scheduled_tasks_disabled", "Las tareas programadas están desactivadas."); };
    const needDatasets = () => { if (!specialistDatasetsEnabled()) throw new ApiError(409, "specialist_datasets_disabled", "Los datasets están desactivados."); };
    const needPanels = () => { if (!specialistPanelsEnabled()) throw new ApiError(409, "specialist_panels_disabled", "Los paneles están desactivados."); };

    if (proposal.kind === "context") {
      await attempt("contexto", async () => { needLibrary("contexto"); await writeSpecialistContext(config, app.id, proposal.content); });
    } else if (proposal.kind === "agent") {
      await attempt("agente", async () => { needLibrary("agente"); const item = await createLibraryAgent(config, app.id, { name: proposal.name, description: proposal.description, content: proposal.content }); return { id: item.path }; });
    } else if (proposal.kind === "skill") {
      await attempt("skill", async () => { needLibrary("skill"); const item = await createLibrarySkill(config, app.id, { name: proposal.name, description: proposal.description, content: proposal.content }); return { id: item.path }; });
    } else if (proposal.kind === "task" && taskContent) {
      await attempt("tarea", async () => { needTasks(); const task = await createTask(config, app.id, { name: proposal.name, prompt: taskContent.prompt, schedule: taskContent.schedule }, { enabled: false }); return { id: task.id }; });
    } else if (proposal.kind === "plan" && planContent) {
      if (planContent.skill) await attempt("skill", async () => { needLibrary("skill"); const item = await createLibrarySkill(config, app.id, planContent.skill!); return { id: item.path }; });
      if (planContent.dataset) await attempt("dataset", async () => {
        needDatasets();
        const target = (await datasetWorkspaces(app.id, null))[0];
        if (!target) throw new ApiError(409, "no_workspace", "La aplicación no tiene ningún proyecto disponible para guardar el dataset.");
        const dataset = await registerDatasetQuery(target.workspacePath, planContent.dataset!);
        return { id: `${target.workspaceId}/${dataset.id}` };
      });
      if (planContent.panel) await attempt("panel", async () => { needPanels(); const panel = await writePanel(config, app.id, planContent.panel!.name, planContent.panel!.spec); return { id: panel.name }; });
      if (planContent.task) await attempt("tarea", async () => { needTasks(); const task = await createTask(config, app.id, { name: proposal.name, prompt: planContent.task!.prompt, schedule: planContent.task!.schedule }, { enabled: false }); return { id: task.id }; });
    }
    const libraryChanged = applied.some(entry => entry.ok && ["contexto", "agente", "skill"].includes(entry.piece));
    // If EVERY piece failed (flags off, limits…), put the proposal back: the captured work stays
    // in the inbox so the person can fix the cause and accept again, instead of losing it.
    const kept = applied.length > 0 && applied.every(entry => !entry.ok) ? await restoreProposal(config, app.id, proposal) : false;
    return jsonResponse({ accepted: proposal.id, applied, ...(kept ? { kept: true } : {}), ...(libraryChanged ? await applyLibraryChange(app) : {}), catalog: await catalog() });
  });
  addRoute(routes, "DELETE", "/specialist-applications/:id/library/proposals/:proposalId", "host", async ctx => {
    requireCapture(true);
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

  /** Research datasets: files live per project (workspace), so the application's panels aggregate over its
   *  bound live workspaces; `?workspace=<id>` narrows a call to a single project. */
  function requireDatasets(write = false) {
    requireFeature(write);
    if (!specialistDatasetsEnabled()) throw new ApiError(404, "specialist_datasets_disabled", "Los datasets de investigación están desactivados.");
  }
  type DatasetTarget = { workspaceId: string; workspacePath: string };
  async function datasetWorkspaces(appId: string, requested: string | null): Promise<DatasetTarget[]> {
    const store = await specialistStore(config);
    const bound = store.projectsFor(appId).map(project => project.workspaceId);
    if (requested !== null) {
      const workspace = config.workspaces.find(entry => entry.id === requested);
      if (!workspace) throw new ApiError(404, "workspace_not_found", "Ese espacio de trabajo no está disponible en el server.");
      if (!bound.includes(requested)) throw new ApiError(403, "workspace_not_bound", "Ese proyecto no pertenece a esta aplicación.");
      return [{ workspaceId: workspace.id, workspacePath: workspace.path }];
    }
    // Same "live projects" filter the catalog applies: workspaces gone from the host are skipped.
    return config.workspaces.filter(workspace => bound.includes(workspace.id)).map(workspace => ({ workspaceId: workspace.id, workspacePath: workspace.path }));
  }
  async function datasetTarget(appId: string, requested: string | null, datasetId: string) {
    const targets = await datasetWorkspaces(appId, requested);
    const found = await Promise.all(targets.map(async target => ({ target, meta: (await listDatasets(target.workspacePath)).find(entry => entry.id === datasetId) ?? null })));
    const hit = found.find(entry => entry.meta);
    if (hit?.meta) return { ...hit.target, meta: hit.meta };
    throw new ApiError(404, "dataset_not_found", "Ese dataset no existe.");
  }
  const workspaceName = (path: string) => path.split("/").pop() ?? path;
  addRoute(routes, "GET", "/specialist-applications/:id/datasets", "client", async ctx => {
    requireDatasets();
    const targets = await datasetWorkspaces(ctx.params.id, ctx.url.searchParams.get("workspace"));
    const listings = await Promise.all(targets.map(async target => ({ target, entries: await listDatasets(target.workspacePath) })));
    const datasets = listings
      .flatMap(({ target, entries }) => entries.map(dataset => ({ ...dataset, workspaceId: target.workspaceId, workspaceName: workspaceName(target.workspacePath) })))
      .sort((left, right) => right.updatedAt - left.updatedAt);
    return jsonResponse({ datasets });
  });
  addRoute(routes, "GET", "/specialist-applications/:id/datasets/:datasetId", "client", async ctx => {
    requireDatasets();
    const found = await datasetTarget(ctx.params.id, ctx.url.searchParams.get("workspace"), ctx.params.datasetId);
    const snapshots = await listSnapshotDates(found.workspacePath, ctx.params.datasetId);
    // A query-only dataset (registered from a proposal) has no LATEST yet: say so, don't throw.
    const latest = found.meta.lastSnapshotAt === null ? null : await readLatestSnapshot(found.workspacePath, ctx.params.datasetId);
    const size = latest === null ? 0 : Buffer.byteLength(JSON.stringify(latest), "utf8");
    return jsonResponse({
      dataset: { ...found.meta, workspaceId: found.workspaceId, workspaceName: workspaceName(found.workspacePath) },
      snapshots,
      latest: latest !== null && size <= 200_000 ? latest : latest !== null ? { tooLarge: true } : null,
    });
  });
  addRoute(routes, "POST", "/specialist-applications/:id/datasets/:datasetId/refresh", "host", async ctx => {
    requireDatasets(true);
    const found = await datasetTarget(ctx.params.id, ctx.url.searchParams.get("workspace"), ctx.params.datasetId);
    const dataset = await refreshDatasetThroughResearch(config, found.workspacePath, ctx.params.datasetId, ctx.request.signal);
    return jsonResponse({ dataset: { ...dataset, workspaceId: found.workspaceId, workspaceName: workspaceName(found.workspacePath) } });
  });
  addRoute(routes, "DELETE", "/specialist-applications/:id/datasets/:datasetId", "host", async ctx => {
    requireDatasets(true);
    const found = await datasetTarget(ctx.params.id, ctx.url.searchParams.get("workspace"), ctx.params.datasetId);
    await deleteDataset(found.workspacePath, ctx.params.datasetId);
    return jsonResponse({ deleted: ctx.params.datasetId });
  });

  /** Citable sources ([6]): the same per-workspace aggregation as datasets. Chunks are built
   *  lazily; the detail returns the passage list so the app can show the cited text (and the
   *  model resolves anchors through specialist_source_read instead of inventing them). */
  function requireSources(write = false) {
    requireFeature(write);
    if (!specialistSourcesEnabled()) throw new ApiError(404, "specialist_sources_disabled", "Las fuentes citables están desactivadas.");
  }
  addRoute(routes, "GET", "/specialist-applications/:id/sources", "client", async ctx => {
    requireSources();
    const targets = await datasetWorkspaces(ctx.params.id, ctx.url.searchParams.get("workspace"));
    const listings = await Promise.all(targets.map(async target => ({ target, entries: await listSources(target.workspacePath) })));
    const sources = listings
      .flatMap(({ target, entries }) => entries.map(source => ({ ...source, workspaceId: target.workspaceId, workspaceName: workspaceName(target.workspacePath) })))
      .sort((left, right) => right.retrievedAt - left.retrievedAt);
    return jsonResponse({ sources });
  });
  addRoute(routes, "GET", "/specialist-applications/:id/sources/:sourceId", "client", async ctx => {
    requireSources();
    const requested = ctx.url.searchParams.get("workspace");
    for (const target of await datasetWorkspaces(ctx.params.id, requested)) {
      const meta = (await listSources(target.workspacePath)).find(entry => entry.id === ctx.params.sourceId);
      if (!meta) continue;
      const { chunks } = await ensureChunks(target.workspacePath, meta.id);
      const chunkParam = ctx.url.searchParams.get("chunk");
      if (chunkParam !== null && !/^\d+$/.test(chunkParam)) throw new ApiError(422, "invalid_chunk", "El número de pasaje no es válido.");
      const chunkIndex = chunkParam === null ? null : Number(chunkParam);
      const result = chunkIndex === null ? { ok: true as const, source: meta, chunk: null as number | null, text: null as string | null, chunks: chunks.slice(0, 50), totalChunks: chunks.length }
        : { ...(await readCitation(target.workspacePath, meta.id, chunkIndex)), source: meta };
      return jsonResponse({ ...result, workspaceId: target.workspaceId, workspaceName: workspaceName(target.workspacePath) });
    }
    throw new ApiError(404, "source_not_found", "Esa fuente no está registrada en los proyectos de esta aplicación.");
  });

  /** Declarative panels ([3]): the spec lives per application; resolution paints each bound
   *  workspace's own snapshot. `?workspace=` pins one project; without it every bound project
   *  resolves and the response carries one entry per project (failures stay per-project). */
  function requirePanels(write = false) {
    requireFeature(write);
    if (!specialistPanelsEnabled()) throw new ApiError(404, "specialist_panels_disabled", "Los paneles están desactivados.");
  }
  addRoute(routes, "GET", "/specialist-applications/:id/panels", "client", async ctx => {
    requirePanels();
    const store = await specialistStore(config);
    const app = store.application(ctx.params.id);
    return jsonResponse({ panels: await listPanels(config, app.id) });
  });
  addRoute(routes, "PUT", "/specialist-applications/:id/panels/:name", "host", async ctx => {
    requirePanels(true);
    const store = await specialistStore(config);
    const app = store.application(ctx.params.id);
    const result = await writePanel(config, app.id, ctx.params.name, await readJsonBody(ctx.request));
    return jsonResponse(result);
  });
  addRoute(routes, "DELETE", "/specialist-applications/:id/panels/:name", "host", async ctx => {
    requirePanels(true);
    const store = await specialistStore(config);
    const app = store.application(ctx.params.id);
    const deleted = await deletePanel(config, app.id, ctx.params.name);
    return jsonResponse({ deleted });
  });
  addRoute(routes, "GET", "/specialist-applications/:id/panels/:name/resolve", "client", async ctx => {
    requirePanels();
    const store = await specialistStore(config);
    const app = store.application(ctx.params.id);
    const spec = await readPanelSpec(config, app.id, ctx.params.name);
    const targets = await datasetWorkspaces(app.id, ctx.url.searchParams.get("workspace"));
    const resolutions = await Promise.all(targets.map(async target => ({
      workspaceId: target.workspaceId, workspaceName: workspaceName(target.workspacePath),
      ...(await resolvePanel(config, app.id, ctx.params.name, target.workspacePath)),
    })));
    return jsonResponse({ spec, resolutions });
  });

  /** Studio outputs ([7]): workspace files under comex/salidas/<id>/, aggregated per bound
   *  workspace like datasets. Every write is shape-validated; the audit endpoint re-checks that
   *  each [fuente:id#n] actually resolves (or says so). */
  function requireOutputs(write = false) {
    requireFeature(write);
    if (!studioOutputsEnabled()) throw new ApiError(404, "studio_outputs_disabled", "Las salidas del mini-Studio están desactivadas.");
  }
  addRoute(routes, "GET", "/specialist-applications/:id/outputs", "client", async ctx => {
    requireOutputs();
    const targets = await datasetWorkspaces(ctx.params.id, ctx.url.searchParams.get("workspace"));
    const listings = await Promise.all(targets.map(async target => ({ target, entries: await listOutputs(target.workspacePath) })));
    const outputs = listings
      .flatMap(({ target, entries }) => entries.map(output => ({ ...output, workspaceId: target.workspaceId, workspaceName: workspaceName(target.workspacePath) })))
      .sort((left, right) => right.updatedAt - left.updatedAt);
    return jsonResponse({ outputs });
  });
  const outputInputSchema = z.object({
    kind: outputKindSchema, title: z.string().trim().min(1).max(200), content: z.string().min(1),
    fromDatasets: z.array(z.string()).max(20).default([]), fromSources: z.array(z.string()).max(20).default([]),
    focus: z.string().max(500).default(""),
  });
  addRoute(routes, "POST", "/specialist-applications/:id/outputs", "host", async ctx => {
    requireOutputs(true);
    const targets = await datasetWorkspaces(ctx.params.id, ctx.url.searchParams.get("workspace"));
    const target = targets[0];
    if (!target) throw new ApiError(409, "no_workspace", "La aplicación no tiene ningún proyecto disponible para guardar la salida.");
    const parsed = outputInputSchema.safeParse(await readJsonBody(ctx.request));
    if (!parsed.success) throw new ApiError(422, "invalid_output", "Revisá el tipo, el título y el contenido de la salida.");
    const result = await writeOutput(target.workspacePath, parsed.data);
    return jsonResponse({ ...result, workspaceId: target.workspaceId, workspaceName: workspaceName(target.workspacePath) }, 201);
  });
  addRoute(routes, "PUT", "/specialist-applications/:id/outputs/:outputId", "host", async ctx => {
    requireOutputs(true);
    const parsed = outputInputSchema.safeParse(await readJsonBody(ctx.request));
    if (!parsed.success) throw new ApiError(422, "invalid_output", "Revisá el tipo, el título y el contenido de la salida.");
    for (const target of await datasetWorkspaces(ctx.params.id, ctx.url.searchParams.get("workspace"))) {
      const meta = (await listOutputs(target.workspacePath)).find(entry => entry.id === ctx.params.outputId);
      if (!meta) continue;
      const result = await writeOutput(target.workspacePath, { ...parsed.data, id: ctx.params.outputId });
      return jsonResponse({ ...result, workspaceId: target.workspaceId, workspaceName: workspaceName(target.workspacePath) });
    }
    throw new ApiError(404, "output_not_found", "Esa salida no existe.");
  });
  addRoute(routes, "GET", "/specialist-applications/:id/outputs/:outputId", "client", async ctx => {
    requireOutputs();
    for (const target of await datasetWorkspaces(ctx.params.id, ctx.url.searchParams.get("workspace"))) {
      const meta = (await listOutputs(target.workspacePath)).find(entry => entry.id === ctx.params.outputId);
      if (!meta) continue;
      const { content } = await readOutput(target.workspacePath, meta.id);
      return jsonResponse({ output: { ...meta, workspaceId: target.workspaceId, workspaceName: workspaceName(target.workspacePath) }, content: content.slice(0, 60_000), truncated: content.length > 60_000 });
    }
    throw new ApiError(404, "output_not_found", "Esa salida no existe.");
  });
  addRoute(routes, "GET", "/specialist-applications/:id/outputs/:outputId/audit", "client", async ctx => {
    requireOutputs();
    for (const target of await datasetWorkspaces(ctx.params.id, ctx.url.searchParams.get("workspace"))) {
      const meta = (await listOutputs(target.workspacePath)).find(entry => entry.id === ctx.params.outputId);
      if (!meta) continue;
      return jsonResponse({ audit: await auditOutputCitations(target.workspacePath, meta.id), workspaceId: target.workspaceId, workspaceName: workspaceName(target.workspacePath) });
    }
    throw new ApiError(404, "output_not_found", "Esa salida no existe.");
  });
  addRoute(routes, "DELETE", "/specialist-applications/:id/outputs/:outputId", "host", async ctx => {
    requireOutputs(true);
    for (const target of await datasetWorkspaces(ctx.params.id, ctx.url.searchParams.get("workspace"))) {
      const meta = (await listOutputs(target.workspacePath)).find(entry => entry.id === ctx.params.outputId);
      if (!meta) continue;
      await deleteOutput(target.workspacePath, meta.id);
      return jsonResponse({ deleted: meta.id });
    }
    throw new ApiError(404, "output_not_found", "Esa salida no existe.");
  });
}
