import { ensureComexWorkspace } from "../comex/seed.js";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { comexArtifactsEnabled, projectsExperienceEnabled, specialistAppPortabilityEnabled, specialistAppZipBundleEnabled, specialistApplicationsEnabled, specialistDatasetsEnabled, specialistIntegrationsEnabled, specialistLibraryEnabled, specialistPanelAppsEnabled, specialistPanelsEnabled, specialistSourcesEnabled, scheduledTasksEnabled, sourcesLocalFilesEnabled, studioOutputsEnabled, taskDryRunEnabled, taskIsolationReviewEnabled } from "../comex/features.js";
import { registerIntegrationRoutes } from "./integrations/routes.js";
import { registerProjectRoutes } from "./projects/routes.js";
import { ownerTaskSettings } from "./projects/tasks-view.js";
import { addRoute, type RequestContext, type Route } from "../routes/registry.js";
import { applicationInput, displayText, specialistDirectory, specialistStore } from "./store.js";
import { builtInComexPack, inspectSpecialistPack, saveSpecialistPack } from "./packs.js";
import { ensureProjectDataDir } from "./project-data.js";
import { registerSpecialistToolRoutes, syncLibraryToolPlugin } from "./library-tool-api.js";
import { deleteApplication, exportApplication, exportApplicationArchive, importApplication, importApplicationArchive, scratchFolder } from "./portability/index.js";
import { archiveResponse, isArchiveUpload, saveRequestBody } from "./portability/http.js";
import { registerSpecialistMcpRoutes, syncPanelAppMcpEntry } from "./panel-app.js";
import { listProposals, parsePlanProposalContent, parseTaskProposalContent, rawProposal, removeProposal, restoreProposal, proposalSchema } from "./proposals.js";
import {
  agentInput, createLibraryAgent, createLibrarySkill, contextInput, deleteLibraryFile,
  libraryFileInput, listSpecialistLibrary, readLibraryFile, readSpecialistContext, skillInput,
  writeLibraryFile, writeSpecialistContext,
} from "./library.js";
import { applySpecialistLibraryChange } from "./sync.js";
import { createTask, deleteTask, estimateTaskBudget, listRuns, listTasks, taskInputSchema, updateTask } from "./tasks.js";
import { deleteDataset, listDatasets, listSnapshotDates, readLatestSnapshot, registerDatasetQuery } from "./datasets.js";
import { refreshDatasetThroughResearch } from "./datasets-refresh.js";
import { deletePanel, listPanels, panelBodySchema, readPanelSpec, resolvePanel, resolvePanelSpec, writePanel } from "./panels.js";
import { auditOutputCitations, deleteOutput, listOutputs, outputKindSchema, readOutput, writeOutput } from "./outputs.js";
import { artifactMetaSchema, artifactTypeSchema, createArtifactFromOutput, listArtifacts, readArtifact, revertArtifact, writeArtifact } from "./artifacts.js";
import { ensureChunks, listSources, readCitation, registerLocalSource } from "./sources.js";
import { currentSpecialistScheduler } from "./scheduler.js";
import { readIsolation } from "./isolation/service.js";
import type { ServerConfig } from "../types.js";
import type { SpecialistApplication } from "./store.js";

/** A workspace seeded by the Comex pack before specialist applications existed. */
async function hasLegacyComexInstall(root: string): Promise<boolean> {
  const hashes = await lstat(join(root, ".opencode", ".comex-pack-hashes.json")).catch(() => null);
  if (!hashes?.isFile()) return false;
  // A project already bound to a specialist application is not legacy.
  return !(await lstat(join(root, ".opencode", "specialist-application.json")).catch(() => null));
}

export function registerSpecialistRoutes(options: {
  routes: Route[]; config: ServerConfig;
  readJsonBody: (request: Request) => Promise<Record<string, unknown>>;
  jsonResponse: (body: unknown, status?: number) => Response;
  ensureWritable: (config: ServerConfig) => void;
  createWorkspace: (ctx: RequestContext, payload: Record<string, unknown>) => Promise<string>;
  /** Remove a workspace from the host (as DELETE /workspaces/:id); never deletes its files. */
  removeWorkspace?: (ctx: RequestContext, workspaceId: string) => Promise<void>;
  /** Set a workspace's display name (as PATCH /workspaces/:id/display-name). */
  renameWorkspace?: (ctx: RequestContext, workspaceId: string, name: string) => Promise<void>;
}) {
  const { routes, config, readJsonBody, jsonResponse, ensureWritable, createWorkspace } = options;
  const removeWorkspace = options.removeWorkspace ?? (async () => {});
  registerIntegrationRoutes(options);
  registerSpecialistToolRoutes(options);
  registerSpecialistMcpRoutes(options);
  registerProjectRoutes(options);
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
    if (!specialistApplicationsEnabled()) return { enabled: false, libraryEnabled: false, scheduledTasksEnabled: false, datasetsEnabled: false, panelsEnabled: false, panelAppsEnabled: false, sourcesEnabled: false, outputsEnabled: false, user: null, applications: [] };
    const store = await specialistStore(config);
    const value = store.list();
    // Workspaces removed from the host are not advertised as usable projects.
    return { enabled: true, portabilityEnabled: specialistAppPortabilityEnabled(), zipBundleEnabled: specialistAppPortabilityEnabled() && specialistAppZipBundleEnabled(), libraryEnabled: specialistLibraryEnabled(), scheduledTasksEnabled: scheduledTasksEnabled(), taskDryRunEnabled: taskDryRunEnabled(), datasetsEnabled: specialistDatasetsEnabled(), panelsEnabled: specialistPanelsEnabled(), panelAppsEnabled: specialistPanelAppsEnabled(), sourcesEnabled: specialistSourcesEnabled(), sourcesLocalFilesEnabled: sourcesLocalFilesEnabled(), outputsEnabled: studioOutputsEnabled(), integrationsEnabled: specialistIntegrationsEnabled(), ...value, applications: value.applications.map(app => ({ ...app, workspaceIds: app.workspaceIds.filter(id => config.workspaces.some(workspace => workspace.id === id)), taskIsolationReviewEnabled: taskIsolationReviewEnabled() })) };
  };
  // `writable`: whether this caller may create or change applications (host routes). The web app
  // only holds a collaborator token, so it must not offer creation it cannot complete.
  addRoute(routes, "GET", "/specialist-applications", "client", async ctx => jsonResponse({ ...(await catalog()), writable: ctx.actor?.type === "host" || ctx.actor?.scope === "owner" }));
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
    if (!parsed.success) throw new ApiError(422, "invalid_application", "Revisa tu nombre, el nombre de la aplicación, la especialidad y la personalidad.");
    const store = await specialistStore(config);
    const before = store.list();
    if (!before.user && !parsed.data.userName) throw new ApiError(422, "user_name_required", "Ingresa tu nombre.");
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
      // Adopt only the workspaces that already ran the legacy Comex pack. Any
      // other open project belongs to the person: installing the pack there
      // would add agents, a `comex/` folder and AGENTS.md instructions to it.
      const legacy = [];
      for (const workspace of config.workspaces) {
        if (workspace.workspaceType === "local" && await hasLegacyComexInstall(workspace.path)) legacy.push(workspace);
      }
      for (const workspace of legacy) { await ensureComexWorkspace(workspace.path); store.bind(workspace.id, id, workspace.path); }
      workspaceId = legacy.find(workspace => workspace.id === body.preferredWorkspaceId)?.id ?? legacy[0]?.id ?? "";
    } else workspaceId = "";
    if (!workspaceId) {
      const folderPath = join(specialistDirectory(config), id, "projects", "Principal");
      try {
        workspaceId = await createWorkspace(ctx, { folderPath, name: app.name, preset: "specialist", applicationId: id });
        // A new app's data folder (`proyecto/`) exists from the start, so memory, datasets and
        // outputs never land in a `comex/` folder for an app that is not about trade.
        await ensureProjectDataDir(folderPath);
      } catch (error) {
        // Without its first project the app is unusable and its name taken: undo it entirely.
        await deleteApplication({ config, store, id, removeWorkspace: workspace => removeWorkspace(ctx, workspace) }).catch(() => undefined);
        throw error;
      }
    }
    return jsonResponse({ application: app, workspaceId, catalog: await catalog() }, 201);
  });
  /** Export, import and delete (feature: specialistAppPortability). */
  function requirePortability(write = false) {
    requireFeature(write);
    if (!specialistAppPortabilityEnabled()) throw new ApiError(404, "specialist_portability_disabled", "Exportar e importar aplicaciones está desactivado.");
  }
  addRoute(routes, "GET", "/specialist-applications/:id/export", "host", async ctx => {
    requirePortability();
    const store = await specialistStore(config);
    // `.owapp` archive (feature: specialistAppZipBundle); `?format=json` keeps the v1 JSON bundle.
    if (specialistAppZipBundleEnabled() && ctx.url.searchParams.get("format") !== "json") {
      return archiveResponse(await exportApplicationArchive(config, store, ctx.params.id));
    }
    return jsonResponse(await exportApplication(config, store, ctx.params.id));
  });
  addRoute(routes, "POST", "/specialist-applications/import", "host", async ctx => {
    requirePortability(true);
    const store = await specialistStore(config);
    const handlers = {
      createWorkspace: (payload: Record<string, unknown>) => createWorkspace(ctx, payload),
      removeWorkspace: (workspaceId: string) => removeWorkspace(ctx, workspaceId),
    };
    let result;
    if (isArchiveUpload(ctx.request)) {
      // A `.owapp` archive as the raw body, with the person's name (first application only) in the query.
      if (!specialistAppZipBundleEnabled()) throw new ApiError(415, "application_archive_disabled", "Importar archivos .owapp está desactivado; usa un archivo .json.");
      const userName = ctx.url.searchParams.get("userName") ?? undefined;
      const scratch = await scratchFolder(config);
      try {
        const file = join(scratch.path, "upload.owapp");
        await saveRequestBody(ctx.request, file);
        result = await importApplicationArchive({ config, store, file, userName, ...handlers });
      } finally { await scratch.cleanup(); }
    } else {
      const body = await readJsonBody(ctx.request);
      const userName = typeof body.userName === "string" ? body.userName : undefined;
      result = await importApplication({ config, store, raw: body.bundle, userName, ...handlers });
    }
    store.activate(result.application.id);
    return jsonResponse({ ...result, catalog: await catalog() }, 201);
  });
  addRoute(routes, "DELETE", "/specialist-applications/:id", "host", async ctx => {
    requirePortability(true);
    const store = await specialistStore(config);
    const result = await deleteApplication({ config, store, id: ctx.params.id, removeWorkspace: workspaceId => removeWorkspace(ctx, workspaceId) });
    return jsonResponse({ ...result, catalog: await catalog() });
  });
  addRoute(routes, "POST", "/specialist-applications/:id/activate", "host", async ctx => {
    requireFeature(true);
    (await specialistStore(config)).activate(ctx.params.id);
    return jsonResponse(await catalog());
  });
  addRoute(routes, "PATCH", "/specialist-applications/:id", "host", async ctx => {
    requireFeature(true);
    const parsed = applicationInput.pick({ name: true, specialty: true, personality: true }).safeParse(await readJsonBody(ctx.request));
    if (!parsed.success) throw new ApiError(422, "invalid_application", "Revisa el nombre, la especialidad y la personalidad.");
    const store = await specialistStore(config);
    const previous = store.application(ctx.params.id);
    const app = store.update(ctx.params.id, parsed.data);
    // Projects that still carry the application's old name (its first project is named after it)
    // follow the rename; projects the person renamed keep their own name.
    // Only the application's own first project ("projects/Principal", named after the app at
    // creation) follows the rename, and only while it still carries the old name: matching any
    // project by name also captured projects the person had renamed to that name.
    if (options.renameWorkspace && previous.name !== app.name) {
      const principal = join(specialistDirectory(config), app.id, "projects", "Principal");
      for (const project of store.projectsFor(app.id)) {
        if (resolve(project.rootPath) !== resolve(principal)) continue;
        const workspace = config.workspaces.find(entry => entry.id === project.workspaceId);
        if ((workspace?.displayName?.trim() || workspace?.name?.trim()) === previous.name) await options.renameWorkspace(ctx, project.workspaceId, app.name);
      }
    }
    return jsonResponse({ application: app, catalog: await catalog() });
  });
  addRoute(routes, "POST", "/specialist-applications/:id/projects", "host", async ctx => {
    requireFeature(true);
    const store = await specialistStore(config);
    const app = store.application(ctx.params.id);
    const parsed = z.object({ name: displayText(80) }).safeParse(await readJsonBody(ctx.request));
    if (!parsed.success) throw new ApiError(422, "invalid_project", "Ingresa el nombre del proyecto.");
    const folderPath = join(specialistDirectory(config), app.id, "projects", randomUUID());
    await mkdir(folderPath, { recursive: true });
    const workspaceId = await createWorkspace(ctx, { folderPath, name: parsed.data.name, preset: "specialist", applicationId: app.id });
    await ensureProjectDataDir(folderPath);
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
    if (!parsed.success) throw new ApiError(422, "invalid_library_file", "Revisa la ruta y el contenido del archivo.");
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
    if (!parsedProposal.success) throw new ApiError(422, "invalid_proposal", "La propuesta guardada está dañada; revísala con el asistente o descártala.");
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
      await attempt("tarea", async () => { needTasks(); const task = await createTask(config, app.id, { name: proposal.name, prompt: taskContent.prompt, schedule: taskContent.schedule, model: taskContent.model ?? null }, { enabled: false }); return { id: task.id }; });
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
    if (!(await listTasks(config, app.id)).some(task => task.id === ctx.params.taskId)) throw new ApiError(404, "task_not_found", "Esa tarea ya no está.");
    // Runs that worked in an isolated copy say whether their changes still wait for review.
    const runs = await Promise.all((await listRuns(config, app.id, ctx.params.taskId)).map(async run => {
      if (!run.isolationId) return { ...run, review: null };
      const record = await readIsolation(config, app.id, run.isolationId).catch(() => null);
      return { ...run, review: record?.status === "active" ? "pending" : "reviewed" };
    }));
    return jsonResponse({ runs });
  });
  addRoute(routes, "POST", "/specialist-applications/:id/tasks", "host", async ctx => {
    requireTasks(true);
    const store = await specialistStore(config);
    const app = store.application(ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const parsed = taskInputSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(422, "invalid_task", "Revisa el nombre, el prompt y el horario de la tarea.");
    // Project, permission mode and advanced settings (projectsExperience) are owner choices.
    const settings = projectsExperienceEnabled() ? ownerTaskSettings(body, store.projectsFor(app.id).map(project => project.workspaceId)) : { owner: {}, catchUp: undefined };
    const task = await createTask(config, app.id, { ...parsed.data, ...(settings.catchUp !== undefined ? { catchUp: settings.catchUp } : {}) }, { owner: settings.owner });
    return jsonResponse({ task, tasks: await listTasks(config, app.id), budget: estimateTaskBudget(task) });
  });
  addRoute(routes, "PUT", "/specialist-applications/:id/tasks/:taskId", "host", async ctx => {
    requireTasks(true);
    const store = await specialistStore(config);
    const app = store.application(ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const parsed = taskInputSchema.partial().extend({ enabled: z.boolean().optional() }).safeParse(body);
    if (!parsed.success) throw new ApiError(422, "invalid_task", "Revisa los campos de la tarea.");
    const settings = projectsExperienceEnabled() ? ownerTaskSettings(body, store.projectsFor(app.id).map(project => project.workspaceId)) : { owner: {}, catchUp: undefined };
    const task = await updateTask(config, app.id, ctx.params.taskId, { ...parsed.data, ...(settings.catchUp !== undefined ? { catchUp: settings.catchUp } : {}) }, settings.owner);
    return jsonResponse({ task, tasks: await listTasks(config, app.id), budget: estimateTaskBudget(task) });
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
  addRoute(routes, "POST", "/specialist-applications/:id/tasks/:taskId/dry-run", "host", async ctx => {
    requireTasks(true);
    if (!taskDryRunEnabled()) throw new ApiError(404, "task_dry_run_disabled", "El ensayo de tareas está desactivado.");
    const store = await specialistStore(config);
    const app = store.application(ctx.params.id);
    const scheduler = currentSpecialistScheduler();
    if (!scheduler) throw new ApiError(503, "scheduler_unavailable", "El planificador no está corriendo en este server.");
    const result = await scheduler.dryRun(app.id, ctx.params.taskId);
    return jsonResponse({ started: result.ok, sessionId: result.sessionId ?? null, workspaceId: result.workspaceId ?? null, detail: result.detail ?? null, note: result.ok ? "Ensayo lanzado en una sesión aparte: nada se guardó ni se programó." : null });
  });

  /** Research datasets: files live per project (workspace), so the application's panels aggregate over its
   *  bound live workspaces; `?workspace=<id>` narrows a call to a single project. */
  function requireDatasets(write = false) {
    requireFeature(write);
    if (!specialistDatasetsEnabled()) throw new ApiError(404, "specialist_datasets_disabled", "Los datasets de investigación están desactivados.");
  }
  /** The person named the project when creating it; the folder is an internal id. */
  type DatasetTarget = { workspaceId: string; workspacePath: string; workspaceName: string };
  const workspaceDisplayName = (workspace: { name?: string; path: string }) => workspace.name?.trim() || workspace.path.split("/").pop() || workspace.path;
  async function datasetWorkspaces(appId: string, requested: string | null): Promise<DatasetTarget[]> {
    const store = await specialistStore(config);
    const bound = store.projectsFor(appId).map(project => project.workspaceId);
    if (requested !== null) {
      const workspace = config.workspaces.find(entry => entry.id === requested);
      if (!workspace) throw new ApiError(404, "workspace_not_found", "Ese espacio de trabajo no está disponible en el server.");
      if (!bound.includes(requested)) throw new ApiError(403, "workspace_not_bound", "Ese proyecto no pertenece a esta aplicación.");
      return [{ workspaceId: workspace.id, workspacePath: workspace.path, workspaceName: workspaceDisplayName(workspace) }];
    }
    // Same "live projects" filter the catalog applies: workspaces gone from the host are skipped.
    return config.workspaces.filter(workspace => bound.includes(workspace.id)).map(workspace => ({ workspaceId: workspace.id, workspacePath: workspace.path, workspaceName: workspaceDisplayName(workspace) }));
  }
  async function datasetTarget(appId: string, requested: string | null, datasetId: string) {
    const targets = await datasetWorkspaces(appId, requested);
    const found = await Promise.all(targets.map(async target => ({ target, meta: (await listDatasets(target.workspacePath)).find(entry => entry.id === datasetId) ?? null })));
    const hit = found.find(entry => entry.meta);
    if (hit?.meta) return { ...hit.target, meta: hit.meta };
    throw new ApiError(404, "dataset_not_found", "Ese dataset no existe.");
  }
  const workspaceName = (target: DatasetTarget) => target.workspaceName;
  addRoute(routes, "GET", "/specialist-applications/:id/datasets", "client", async ctx => {
    requireDatasets();
    const targets = await datasetWorkspaces(ctx.params.id, ctx.url.searchParams.get("workspace"));
    const listings = await Promise.all(targets.map(async target => ({ target, entries: await listDatasets(target.workspacePath) })));
    const datasets = listings
      .flatMap(({ target, entries }) => entries.map(dataset => ({ ...dataset, workspaceId: target.workspaceId, workspaceName: workspaceName(target) })))
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
      dataset: { ...found.meta, workspaceId: found.workspaceId, workspaceName: workspaceName(found) },
      snapshots,
      latest: latest !== null && size <= 200_000 ? latest : latest !== null ? { tooLarge: true } : null,
    });
  });
  addRoute(routes, "POST", "/specialist-applications/:id/datasets/:datasetId/refresh", "host", async ctx => {
    requireDatasets(true);
    const found = await datasetTarget(ctx.params.id, ctx.url.searchParams.get("workspace"), ctx.params.datasetId);
    const dataset = await refreshDatasetThroughResearch(config, found.workspacePath, ctx.params.datasetId, ctx.request.signal);
    return jsonResponse({ dataset: { ...dataset, workspaceId: found.workspaceId, workspaceName: workspaceName(found) } });
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
      .flatMap(({ target, entries }) => entries.map(source => ({ ...source, workspaceId: target.workspaceId, workspaceName: workspaceName(target) })))
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
      return jsonResponse({ ...result, workspaceId: target.workspaceId, workspaceName: workspaceName(target) });
    }
    throw new ApiError(404, "source_not_found", "Esa fuente no está registrada en los proyectos de esta aplicación.");
  });
  /** F1: a local workspace file becomes a citable source (snapshotted at registration). */
  addRoute(routes, "POST", "/specialist-applications/:id/sources/local", "host", async ctx => {
    requireSources(true);
    if (!sourcesLocalFilesEnabled()) throw new ApiError(404, "sources_local_files_disabled", "Las fuentes locales están desactivadas.");
    const targets = await datasetWorkspaces(ctx.params.id, ctx.url.searchParams.get("workspace"));
    const target = targets[0];
    if (!target) throw new ApiError(409, "no_workspace", "La aplicación no tiene ningún proyecto disponible.");
    const parsed = z.object({ path: z.string().trim().min(1).max(500), title: z.string().trim().max(200).optional() }).safeParse(await readJsonBody(ctx.request));
    if (!parsed.success) throw new ApiError(422, "invalid_source", "Revisa la ruta del archivo local.");
    const source = await registerLocalSource(target.workspacePath, parsed.data);
    return jsonResponse({ source: { ...source, workspaceId: target.workspaceId, workspaceName: workspaceName(target) } }, 201);
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
    // A saved panel is immediately launchable as an App (no chat turn needed): install the
    // project's bridge if it is missing, then project the loopback MCP connection (idempotent).
    await Promise.all(config.workspaces
      .filter(workspace => store.projectsFor(app.id).some(project => project.workspaceId === workspace.id))
      .map(async workspace => {
        await syncLibraryToolPlugin(config, workspace.id, workspace.path);
        await syncPanelAppMcpEntry(config, workspace.id, workspace.path);
      }).map(promise => promise.catch(() => undefined)));
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
      workspaceId: target.workspaceId, workspaceName: workspaceName(target),
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
      .flatMap(({ target, entries }) => entries.map(output => ({ ...output, workspaceId: target.workspaceId, workspaceName: workspaceName(target) })))
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
    if (!parsed.success) throw new ApiError(422, "invalid_output", "Revisa el tipo, el título y el contenido de la salida.");
    const result = await writeOutput(target.workspacePath, parsed.data);
    return jsonResponse({ ...result, workspaceId: target.workspaceId, workspaceName: workspaceName(target) }, 201);
  });
  addRoute(routes, "PUT", "/specialist-applications/:id/outputs/:outputId", "host", async ctx => {
    requireOutputs(true);
    const parsed = outputInputSchema.safeParse(await readJsonBody(ctx.request));
    if (!parsed.success) throw new ApiError(422, "invalid_output", "Revisa el tipo, el título y el contenido de la salida.");
    for (const target of await datasetWorkspaces(ctx.params.id, ctx.url.searchParams.get("workspace"))) {
      const meta = (await listOutputs(target.workspacePath)).find(entry => entry.id === ctx.params.outputId);
      if (!meta) continue;
      const result = await writeOutput(target.workspacePath, { ...parsed.data, id: ctx.params.outputId });
      return jsonResponse({ ...result, workspaceId: target.workspaceId, workspaceName: workspaceName(target) });
    }
    throw new ApiError(404, "output_not_found", "Esa salida no existe.");
  });
  addRoute(routes, "GET", "/specialist-applications/:id/outputs/:outputId", "client", async ctx => {
    requireOutputs();
    for (const target of await datasetWorkspaces(ctx.params.id, ctx.url.searchParams.get("workspace"))) {
      const meta = (await listOutputs(target.workspacePath)).find(entry => entry.id === ctx.params.outputId);
      if (!meta) continue;
      const { content } = await readOutput(target.workspacePath, meta.id);
      return jsonResponse({ output: { ...meta, workspaceId: target.workspaceId, workspaceName: workspaceName(target) }, content: content.slice(0, 60_000), truncated: content.length > 60_000 });
    }
    throw new ApiError(404, "output_not_found", "Esa salida no existe.");
  });
  addRoute(routes, "GET", "/specialist-applications/:id/outputs/:outputId/audit", "client", async ctx => {
    requireOutputs();
    for (const target of await datasetWorkspaces(ctx.params.id, ctx.url.searchParams.get("workspace"))) {
      const meta = (await listOutputs(target.workspacePath)).find(entry => entry.id === ctx.params.outputId);
      if (!meta) continue;
      return jsonResponse({ audit: await auditOutputCitations(target.workspacePath, meta.id), workspaceId: target.workspaceId, workspaceName: workspaceName(target) });
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

  /** Artifacts: the same output content, now addressable, versioned and openable in the panel.
   *  Double gate: the feature flag hides the UI and these routes answer 404 when it is off. */
  function requireArtifacts(write = false) {
    requireFeature(write);
    if (!comexArtifactsEnabled()) throw new ApiError(404, "artifacts_disabled", "Los artefactos están desactivados.");
  }
  addRoute(routes, "GET", "/specialist-applications/:id/artifacts", "client", async ctx => {
    requireArtifacts();
    const targets = await datasetWorkspaces(ctx.params.id, ctx.url.searchParams.get("workspace"));
    const listings = await Promise.all(targets.map(async target => ({ target, entries: await listArtifacts(target.workspacePath) })));
    const artifacts = listings
      .flatMap(({ target, entries }) => entries.map(meta => ({ ...meta, metadata: { ...meta.metadata, workspaceId: target.workspaceId, workspaceName: workspaceName(target) } })))
      .sort((left, right) => right.updatedAt - left.updatedAt);
    return jsonResponse({ artifacts });
  });
  addRoute(routes, "POST", "/specialist-applications/:id/artifacts/from-output/:outputId", "host", async ctx => {
    requireArtifacts(true);
    const targets = await datasetWorkspaces(ctx.params.id, ctx.url.searchParams.get("workspace"));
    const target = targets[0];
    if (!target) throw new ApiError(409, "no_workspace", "La aplicación no tiene ningún proyecto disponible para guardar el artefacto.");
    const meta = (await listOutputs(target.workspacePath)).find(entry => entry.id === ctx.params.outputId);
    if (!meta) throw new ApiError(404, "output_not_found", "Esa salida no existe.");
    const { content } = await readOutput(target.workspacePath, meta.id);
    const audit = await auditOutputCitations(target.workspacePath, meta.id);
    const result = await createArtifactFromOutput(target.workspacePath, ctx.params.id, target.workspaceId, meta, content, audit);
    return jsonResponse({ ...result, workspaceId: target.workspaceId, workspaceName: workspaceName(target) }, 201);
  });
  const artifactInputSchema = z.object({
    type: artifactTypeSchema,
    title: z.string().trim().min(1).max(200),
    content: z.string().min(1),
    status: z.enum(["streaming", "draft", "saved", "archived"]).optional(),
    sources: artifactMetaSchema.shape.sources.optional(),
    label: z.string().max(200).optional(),
  });
  addRoute(routes, "POST", "/specialist-applications/:id/artifacts", "host", async ctx => {
    requireArtifacts(true);
    const parsed = artifactInputSchema.safeParse(await readJsonBody(ctx.request));
    if (!parsed.success) throw new ApiError(422, "invalid_artifact", "Revisa el tipo, el título y el contenido del artefacto.");
    const targets = await datasetWorkspaces(ctx.params.id, ctx.url.searchParams.get("workspace"));
    const target = targets[0];
    if (!target) throw new ApiError(409, "no_workspace", "La aplicación no tiene ningún proyecto disponible para guardar el artefacto.");
    const result = await writeArtifact(target.workspacePath, { ...parsed.data, metadata: { workspaceId: target.workspaceId, schemaVersion: 1, workspaceName: workspaceName(target) } });
    return jsonResponse({ ...result, workspaceId: target.workspaceId, workspaceName: workspaceName(target) }, 201);
  });
  addRoute(routes, "GET", "/specialist-applications/:id/artifacts/:artifactId", "client", async ctx => {
    requireArtifacts();
    for (const target of await datasetWorkspaces(ctx.params.id, ctx.url.searchParams.get("workspace"))) {
      const found = (await listArtifacts(target.workspacePath)).find(entry => entry.id === ctx.params.artifactId);
      if (!found) continue;
      const result = await readArtifact(target.workspacePath, found.id);
      return jsonResponse({ ...result, meta: { ...result.meta, metadata: { ...result.meta.metadata, workspaceId: target.workspaceId, workspaceName: workspaceName(target) } }, workspaceId: target.workspaceId, workspaceName: workspaceName(target) });
    }
    throw new ApiError(404, "artifact_not_found", "Ese artefacto no existe.");
  });
  addRoute(routes, "GET", "/specialist-applications/:id/artifacts/:artifactId/resolve", "client", async ctx => {
    requireArtifacts();
    for (const target of await datasetWorkspaces(ctx.params.id, ctx.url.searchParams.get("workspace"))) {
      const found = (await listArtifacts(target.workspacePath)).find(entry => entry.id === ctx.params.artifactId);
      if (!found || found.type !== "data") continue;
      const { content } = await readArtifact(target.workspacePath, found.id);
      let parsed: unknown;
      try { parsed = JSON.parse(content); } catch { throw new ApiError(409, "artifact_content_missing", "El artefacto data no tiene JSON válido."); }
      const wrapped = typeof parsed === "object" && parsed !== null && "spec" in parsed
        ? Reflect.get(parsed, "spec") as unknown : parsed;
      const body = panelBodySchema.safeParse(wrapped);
      if (!body.success) throw new ApiError(422, "invalid_artifact", "El artefacto data no trae un spec de panel válido.");
      const spec = { ...body.data, panel: found.id };
      const resolution = await resolvePanelSpec(target.workspacePath, spec);
      return jsonResponse({ spec, resolution, workspaceId: target.workspaceId, workspaceName: workspaceName(target) });
    }
    throw new ApiError(404, "artifact_not_found", "Ese artefacto data no existe.");
  });
  addRoute(routes, "PUT", "/specialist-applications/:id/artifacts/:artifactId", "host", async ctx => {
    requireArtifacts(true);
    const parsed = artifactInputSchema.safeParse(await readJsonBody(ctx.request));
    if (!parsed.success) throw new ApiError(422, "invalid_artifact", "Revisa el tipo, el título y el contenido del artefacto.");
    for (const target of await datasetWorkspaces(ctx.params.id, ctx.url.searchParams.get("workspace"))) {
      const found = (await listArtifacts(target.workspacePath)).find(entry => entry.id === ctx.params.artifactId);
      if (!found) continue;
      const result = await writeArtifact(target.workspacePath, { ...parsed.data, id: found.id, metadata: found.metadata });
      return jsonResponse({ ...result, workspaceId: target.workspaceId, workspaceName: workspaceName(target) });
    }
    throw new ApiError(404, "artifact_not_found", "Ese artefacto no existe.");
  });
  addRoute(routes, "POST", "/specialist-applications/:id/artifacts/:artifactId/revert", "host", async ctx => {
    requireArtifacts(true);
    const body = await readJsonBody(ctx.request);
    const versionId = typeof body.versionId === "string" ? body.versionId : "";
    if (!versionId) throw new ApiError(422, "invalid_artifact", "Falta la versión a la que volver.");
    for (const target of await datasetWorkspaces(ctx.params.id, ctx.url.searchParams.get("workspace"))) {
      const found = (await listArtifacts(target.workspacePath)).find(entry => entry.id === ctx.params.artifactId);
      if (!found) continue;
      const meta = await revertArtifact(target.workspacePath, found.id, versionId);
      return jsonResponse({ meta, workspaceId: target.workspaceId });
    }
    throw new ApiError(404, "artifact_not_found", "Ese artefacto no existe.");
  });
}
