import { lstat } from "node:fs/promises";
import { basename } from "node:path";
import { z } from "zod";
import {
  PROJECT_LIMITS, compareProjects, projectInstructionsInputSchema, projectMemoryDeleteQuerySchema,
  projectMemorySaveInputSchema, projectPatchInputSchema, type ProjectSummary,
} from "@openwork/types/projects";
import { comexScopedMemoryEnabled, projectsExperienceEnabled, scheduledTasksEnabled, specialistApplicationsEnabled, taskDryRunEnabled, taskIsolationReviewEnabled } from "../../comex/features.js";
import { changeScopedMemory, readScopedMemory, type MemoryContext } from "../../comex/scoped-memory.js";
import { ApiError } from "../../errors.js";
import { addRoute, type RequestContext, type Route } from "../../routes/registry.js";
import type { ServerConfig, WorkspaceInfo } from "../../types.js";
import { displayText, specialistStore } from "../store.js";
import { TASK_LIMIT, listTasks } from "../tasks.js";
import { taskProject } from "../scheduler.js";
import { createContextFolder, deleteContextEntry, listContext, contextUsage, uploadContextFile } from "./context.js";
import { readProjectInstructions, writeProjectInstructions } from "./instructions.js";
import { readRecentSessions } from "./sessions.js";
import { runsInProject, toProjectTask } from "./tasks-view.js";

/**
 * The Projects experience (feature projectsExperience): one registry over every project of every
 * specialist application, and per project its description, pin, instructions, context files,
 * memory and scheduled tasks. Reads are "client", writes are "host" (owner or paired device).
 * API table: docs/features/projects-experience/README.md.
 */

type Store = Awaited<ReturnType<typeof specialistStore>>;
type Resolved = { store: Store; workspace: WorkspaceInfo; applicationId: string; applicationName: string; rootPath: string };

const projectName = (workspace: WorkspaceInfo) => workspace.displayName?.trim() || workspace.name?.trim() || basename(workspace.path) || workspace.path;
const writableFor = (ctx: RequestContext) => ctx.actor?.type === "host" || ctx.actor?.scope === "owner";

export function registerProjectRoutes(options: {
  routes: Route[]; config: ServerConfig;
  readJsonBody: (request: Request) => Promise<Record<string, unknown>>;
  jsonResponse: (body: unknown, status?: number) => Response;
  ensureWritable: (config: ServerConfig) => void;
  /** Set a workspace's display name (as PATCH /workspaces/:id/display-name). */
  renameWorkspace?: (ctx: RequestContext, workspaceId: string, name: string) => Promise<void>;
}) {
  const { routes, config, readJsonBody, jsonResponse, ensureWritable } = options;

  function requireProjects(write = false) {
    if (!specialistApplicationsEnabled() || !projectsExperienceEnabled()) throw new ApiError(404, "projects_disabled", "La experiencia de proyectos está desactivada.");
    if (write) ensureWritable(config);
  }

  const live = (workspaceId: string) => config.workspaces.find(workspace => workspace.id === workspaceId) ?? null;

  async function resolveProject(workspaceId: string): Promise<Resolved> {
    const store = await specialistStore(config);
    const binding = store.allProjects().find(project => project.workspaceId === workspaceId);
    const workspace = live(workspaceId);
    // Workspaces removed from the host are not projects anymore (the catalog hides them too).
    if (!binding || !workspace) throw new ApiError(404, "project_not_found", "Ese proyecto no existe.");
    const app = store.application(binding.applicationId);
    return { store, workspace, applicationId: app.id, applicationName: app.name, rootPath: workspace.path };
  }

  async function createdAt(rootPath: string): Promise<number> {
    const info = await lstat(rootPath).catch(() => null);
    if (!info) return 0;
    const born = info.birthtimeMs > 0 ? info.birthtimeMs : info.ctimeMs;
    return Math.floor(born);
  }

  async function summary(project: Resolved): Promise<ProjectSummary> {
    const meta = project.store.projectMeta(project.workspace.id);
    const created = await createdAt(project.rootPath);
    return {
      workspaceId: project.workspace.id, applicationId: project.applicationId, applicationName: project.applicationName,
      name: projectName(project.workspace), description: meta.description,
      pinned: meta.pinnedAt !== null, pinnedAt: meta.pinnedAt,
      lastActivityAt: Math.max(meta.lastActivityAt ?? 0, created), createdAt: created,
    };
  }

  /** Tasks that run in this project (its own, or the application's first live project's). */
  async function projectTasks(project: Resolved) {
    if (!scheduledTasksEnabled()) return [];
    const first = taskProject(project.store, project.applicationId, { workspaceId: null }, workspaceId => live(workspaceId) !== null)?.workspaceId ?? null;
    return (await listTasks(config, project.applicationId)).filter(task => runsInProject(task, project.workspace.id, first));
  }

  const memoryContext = (ctx: RequestContext, project: Resolved): MemoryContext => ({
    // Project memory is keyed by the folder alone; the session id only has to be well formed.
    root: project.rootPath, sessionId: "project", identity: ctx.actor?.tokenHash ?? "owner",
  });

  addRoute(routes, "GET", "/specialist-projects", "client", async ctx => {
    requireProjects();
    const store = await specialistStore(config);
    const apps = new Map(store.list().applications.map(app => [app.id, app.name]));
    const projects: ProjectSummary[] = [];
    for (const binding of store.allProjects()) {
      const workspace = live(binding.workspaceId);
      const applicationName = apps.get(binding.applicationId);
      if (!workspace || applicationName === undefined) continue;
      projects.push(await summary({ store, workspace, applicationId: binding.applicationId, applicationName, rootPath: workspace.path }));
    }
    projects.sort(compareProjects);
    return jsonResponse({ projects, writable: writableFor(ctx) });
  });

  addRoute(routes, "GET", "/specialist-projects/:workspaceId", "client", async ctx => {
    requireProjects();
    const project = await resolveProject(ctx.params.workspaceId);
    const memoryEnabled = comexScopedMemoryEnabled();
    const [base, instructions, context, memory, tasks, recent] = await Promise.all([
      summary(project),
      readProjectInstructions(project.rootPath),
      contextUsage(project.rootPath),
      memoryEnabled ? readScopedMemory(config, memoryContext(ctx, project), "project").catch(() => null) : Promise.resolve(null),
      projectTasks(project).catch(() => []),
      readRecentSessions(config, project.workspace, PROJECT_LIMITS.recentSessions),
    ]);
    return jsonResponse({
      ...base,
      instructions: { set: instructions.text.trim().length > 0, updatedAt: instructions.updatedAt },
      context,
      memory: { entries: memory?.notes.length ?? 0, enabled: memoryEnabled },
      scheduled: { tasks: tasks.length },
      recentSessions: recent.sessions, recentSessionsComplete: recent.complete,
      writable: writableFor(ctx),
    });
  });

  addRoute(routes, "PATCH", "/specialist-projects/:workspaceId", "host", async ctx => {
    requireProjects(true);
    const project = await resolveProject(ctx.params.workspaceId);
    const parsed = projectPatchInputSchema.safeParse(await readJsonBody(ctx.request));
    if (!parsed.success) throw new ApiError(422, "invalid_project", "Revisa el nombre (hasta 80 caracteres) y la descripción (hasta 2.000).");
    const { name, description, pinned } = parsed.data;
    if (name !== undefined) {
      const clean = displayText(PROJECT_LIMITS.nameChars).safeParse(name);
      if (!clean.success) throw new ApiError(422, "invalid_project", "Usa un nombre de hasta 80 caracteres visibles.");
      if (!options.renameWorkspace) throw new ApiError(501, "project_rename_unavailable", "Este server no puede cambiar el nombre de los proyectos.");
      if (clean.data !== projectName(project.workspace)) await options.renameWorkspace(ctx, project.workspace.id, clean.data);
    }
    if (description !== undefined || pinned !== undefined) project.store.updateProjectMeta(project.workspace.id, { description, pinned });
    if (name !== undefined || description !== undefined) project.store.touchProject(project.workspace.id);
    // The rename replaced the workspace entry; read it again.
    return jsonResponse({ project: await summary(await resolveProject(project.workspace.id)) });
  });

  addRoute(routes, "GET", "/specialist-projects/:workspaceId/instructions", "client", async ctx => {
    requireProjects();
    const project = await resolveProject(ctx.params.workspaceId);
    return jsonResponse({ ...(await readProjectInstructions(project.rootPath)), maxChars: PROJECT_LIMITS.instructionsChars });
  });

  addRoute(routes, "PUT", "/specialist-projects/:workspaceId/instructions", "host", async ctx => {
    requireProjects(true);
    const project = await resolveProject(ctx.params.workspaceId);
    const parsed = projectInstructionsInputSchema.safeParse(await readJsonBody(ctx.request));
    if (!parsed.success) throw new ApiError(422, "instructions_too_long", `Las instrucciones pueden tener hasta ${PROJECT_LIMITS.instructionsChars.toLocaleString("es")} caracteres.`);
    const saved = await writeProjectInstructions(project.rootPath, parsed.data.text);
    project.store.touchProject(project.workspace.id);
    return jsonResponse({ ...saved, maxChars: PROJECT_LIMITS.instructionsChars });
  });

  addRoute(routes, "GET", "/specialist-projects/:workspaceId/context", "client", async ctx => {
    requireProjects();
    const project = await resolveProject(ctx.params.workspaceId);
    return jsonResponse(await listContext(project.rootPath, ctx.url.searchParams.get("path") ?? ""));
  });

  /** Raw body upload: `?path=<folder>&name=<file>[&replace=true]`, any content type. */
  addRoute(routes, "POST", "/specialist-projects/:workspaceId/context/files", "host", async ctx => {
    requireProjects(true);
    const project = await resolveProject(ctx.params.workspaceId);
    const declared = ctx.request.headers.get("content-length");
    const result = await uploadContextFile(project.rootPath, {
      folder: ctx.url.searchParams.get("path") ?? "",
      name: ctx.url.searchParams.get("name") ?? "",
      replace: ctx.url.searchParams.get("replace") === "true",
      body: ctx.request.body,
      declaredBytes: declared === null ? null : Number(declared),
      signal: ctx.request.signal,
    });
    project.store.touchProject(project.workspace.id);
    return jsonResponse(result, 201);
  });

  addRoute(routes, "POST", "/specialist-projects/:workspaceId/context/folders", "host", async ctx => {
    requireProjects(true);
    const project = await resolveProject(ctx.params.workspaceId);
    const parsed = z.object({ path: z.string().max(4_096) }).strict().safeParse(await readJsonBody(ctx.request));
    if (!parsed.success) throw new ApiError(422, "context_path_required", "Indica la ruta de la carpeta nueva.");
    const result = await createContextFolder(project.rootPath, parsed.data.path);
    project.store.touchProject(project.workspace.id);
    return jsonResponse(result, 201);
  });

  addRoute(routes, "DELETE", "/specialist-projects/:workspaceId/context", "host", async ctx => {
    requireProjects(true);
    const project = await resolveProject(ctx.params.workspaceId);
    const result = await deleteContextEntry(project.rootPath, ctx.url.searchParams.get("path") ?? "");
    project.store.touchProject(project.workspace.id);
    return jsonResponse(result);
  });

  function requireMemory() {
    if (!comexScopedMemoryEnabled()) throw new ApiError(404, "scoped_memory_disabled", "La memoria por niveles está desactivada.");
  }
  const memoryResponse = (snapshot: Awaited<ReturnType<typeof readScopedMemory>>, ctx: RequestContext) => ({
    revision: snapshot.revision, notes: snapshot.notes, writable: writableFor(ctx) && !config.readOnly, maxNotes: 24, maxChars: 800,
  });

  addRoute(routes, "GET", "/specialist-projects/:workspaceId/memory", "client", async ctx => {
    requireProjects(); requireMemory();
    const project = await resolveProject(ctx.params.workspaceId);
    return jsonResponse(memoryResponse(await readScopedMemory(config, memoryContext(ctx, project), "project"), ctx));
  });

  addRoute(routes, "POST", "/specialist-projects/:workspaceId/memory", "host", async ctx => {
    requireProjects(true); requireMemory();
    const project = await resolveProject(ctx.params.workspaceId);
    const parsed = projectMemorySaveInputSchema.safeParse(await readJsonBody(ctx.request));
    if (!parsed.success) throw new ApiError(422, "memory_invalid_note", "Escribe una nota de hasta 800 caracteres.");
    const { expectedRevision, text, id } = parsed.data;
    const snapshot = await changeScopedMemory(config, memoryContext(ctx, project), "project", { type: "save", text, ...(id ? { id } : {}) }, expectedRevision);
    project.store.touchProject(project.workspace.id);
    return jsonResponse(memoryResponse(snapshot, ctx));
  });

  addRoute(routes, "DELETE", "/specialist-projects/:workspaceId/memory/:noteId", "host", async ctx => {
    requireProjects(true); requireMemory();
    const project = await resolveProject(ctx.params.workspaceId);
    const query = projectMemoryDeleteQuerySchema.safeParse({ expectedRevision: ctx.url.searchParams.get("expectedRevision") ?? undefined });
    const noteId = z.string().uuid().safeParse(ctx.params.noteId);
    if (!query.success || !noteId.success) throw new ApiError(422, "memory_invalid_note", "Revisa la nota y la revisión guardada.");
    const snapshot = await changeScopedMemory(config, memoryContext(ctx, project), "project", { type: "delete", id: noteId.data }, query.data.expectedRevision);
    return jsonResponse(memoryResponse(snapshot, ctx));
  });

  addRoute(routes, "GET", "/specialist-projects/:workspaceId/tasks", "client", async ctx => {
    requireProjects();
    if (!scheduledTasksEnabled()) throw new ApiError(404, "scheduled_tasks_disabled", "Las tareas programadas están desactivadas.");
    const project = await resolveProject(ctx.params.workspaceId);
    const tasks = await projectTasks(project);
    return jsonResponse({
      applicationId: project.applicationId,
      tasks: tasks.map(task => toProjectTask(project.applicationId, task)),
      capabilities: { dryRun: taskDryRunEnabled(), isolation: taskIsolationReviewEnabled() },
      limit: TASK_LIMIT, writable: writableFor(ctx),
    });
  });
}
