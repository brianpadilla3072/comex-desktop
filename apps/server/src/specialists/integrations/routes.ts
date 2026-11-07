import { z } from "zod";
import { ApiError } from "../../errors.js";
import { specialistApplicationsEnabled, specialistIntegrationsEnabled } from "../../comex/features.js";
import { addRoute, type Route } from "../../routes/registry.js";
import { specialistStore } from "../store.js";
import { createResearchProvider, researchProviderFactories } from "./research-factory.js";
import { createPackFactory, packFactories } from "./pack-factory.js";
import { syncResearchPlugin } from "./native.js";
import { definitionFactories } from "../factories.js";
import { runtimeEngineFactories } from "../../runtime-engine-factory.js";
import type { ServerConfig } from "../../types.js";

export function registerIntegrationRoutes(options: { routes: Route[]; config: ServerConfig; readJsonBody(request: Request): Promise<Record<string, unknown>>; jsonResponse(value: unknown, status?: number): Response; ensureWritable(config: ServerConfig): void }) {
  const { routes, config, readJsonBody, jsonResponse, ensureWritable } = options;
  function guard(write = false) {
    if (!specialistApplicationsEnabled() || !specialistIntegrationsEnabled()) throw new ApiError(404, "integrations_disabled", "Las herramientas especialistas están desactivadas.");
    if (write) ensureWritable(config);
  }
  const provider = (id: string) => { if (!researchProviderFactories.some(factory => factory.id === id)) throw new ApiError(404, "provider_not_found", "Ese proveedor no tiene un adaptador instalado."); return createResearchProvider(id, config); };
  addRoute(routes, "GET", "/specialist-applications/:id/integrations", "host", async ctx => {
    guard(); const store = await specialistStore(config); store.application(ctx.params.id);
    return jsonResponse({ providers: await Promise.all(researchProviderFactories.map(async factory => ({ id: factory.id, label: factory.label, enabled: store.researchEnabled(ctx.params.id, factory.id), ...await factory.create(config).status() }))), packFactories, definitions: definitionFactories.catalog(), engines: runtimeEngineFactories.catalog() });
  });
  addRoute(routes, "POST", "/specialist-applications/:id/integrations/:provider/action", "host", async ctx => {
    guard(true); const store = await specialistStore(config); store.application(ctx.params.id);
    const adapter = provider(ctx.params.provider);
    const body = await readJsonBody(ctx.request);
    const action = z.enum(["install", "login", "disconnect", "test", "key", "enable"]).safeParse(body.action);
    if (!action.success) throw new ApiError(422, "invalid_integration_action", "Elegí una acción válida para la conexión.");
    switch (action.data) {
      case "install": return jsonResponse(await adapter.install());
      case "login": return jsonResponse(await adapter.login());
      case "disconnect": return jsonResponse(await adapter.disconnect());
      case "test": return jsonResponse(await adapter.test());
      case "key": {
        const key = z.string().min(10).max(300).safeParse(body.apiKey);
        if (!key.success) throw new ApiError(422, "invalid_tavily_key", "Revisá la clave de Tavily.");
        return jsonResponse(await adapter.saveKey(key.data));
      }
      case "enable": {
        const enabled = z.boolean().safeParse(body.enabled);
        if (!enabled.success) throw new ApiError(422, "invalid_enabled", "Elegí si querés activar la herramienta.");
        store.setResearchEnabled(ctx.params.id, enabled.data, ctx.params.provider);
        for (const workspace of config.workspaces) if (store.forWorkspace(workspace.id)?.id === ctx.params.id) await syncResearchPlugin(config, workspace.id, workspace.path);
        return jsonResponse({ enabled: enabled.data });
      }
    }
  });
  addRoute(routes, "POST", "/specialist-applications/:id/pack/preview-update", "host", async ctx => {
    guard(); const body = await readJsonBody(ctx.request);
    const path = z.string().min(1).max(4_096).safeParse(body.packPath);
    if (!path.success) throw new ApiError(422, "invalid_pack", "Elegí una carpeta de pack o perfil OCX.");
    return jsonResponse(await createPackFactory(config).preview(ctx.params.id, path.data));
  });
  addRoute(routes, "POST", "/specialist-applications/:id/pack/update", "host", async ctx => {
    guard(true);
    const body = z.object({ packPath: z.string().min(1).max(4_096), fingerprint: z.string().regex(/^[0-9a-f]{64}$/) }).safeParse(await readJsonBody(ctx.request));
    if (!body.success) throw new ApiError(422, "invalid_pack_review", "Revisá los cambios del pack antes de actualizarlo.");
    return jsonResponse(await createPackFactory(config).update(ctx.params.id, body.data.packPath, body.data.fingerprint));
  });
  addRoute(routes, "POST", "/specialist-applications/:id/pack/export-ocx", "host", async ctx => {
    guard(true);
    const body = z.object({ destination: z.string().min(1).max(4_096) }).safeParse(await readJsonBody(ctx.request));
    if (!body.success) throw new ApiError(422, "invalid_export_folder", "Elegí una carpeta para exportar el perfil.");
    return jsonResponse(await createPackFactory(config).exportOcx(ctx.params.id, body.data.destination));
  });
}
