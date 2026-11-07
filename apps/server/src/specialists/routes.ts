import { ensureComexWorkspace } from "../comex/seed.js";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { specialistApplicationsEnabled, specialistIntegrationsEnabled } from "../comex/features.js";
import { registerIntegrationRoutes } from "./integrations/routes.js";
import { addRoute, type RequestContext, type Route } from "../routes/registry.js";
import { applicationInput, specialistDirectory, specialistStore } from "./store.js";
import { builtInComexPack, inspectSpecialistPack, saveSpecialistPack } from "./packs.js";
import type { ServerConfig } from "../types.js";

export function registerSpecialistRoutes(options: {
  routes: Route[]; config: ServerConfig;
  readJsonBody: (request: Request) => Promise<Record<string, unknown>>;
  jsonResponse: (body: unknown, status?: number) => Response;
  ensureWritable: (config: ServerConfig) => void;
  createWorkspace: (ctx: RequestContext, payload: Record<string, unknown>) => Promise<string>;
}) {
  const { routes, config, readJsonBody, jsonResponse, ensureWritable, createWorkspace } = options;
  registerIntegrationRoutes(options);
  function requireFeature(write = false) {
    if (!specialistApplicationsEnabled()) throw new ApiError(404, "specialists_disabled", "Los perfiles especialistas están desactivados.");
    if (write) ensureWritable(config);
  }
  const catalog = async () => {
    if (!specialistApplicationsEnabled()) return { enabled: false, user: null, applications: [] };
    const store = await specialistStore(config);
    const value = store.list();
    // Workspaces removed from the host are not advertised as usable projects.
    return { enabled: true, integrationsEnabled: specialistIntegrationsEnabled(), ...value, applications: value.applications.map(app => ({ ...app, workspaceIds: app.workspaceIds.filter(id => config.workspaces.some(workspace => workspace.id === id)) })) };
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
}
