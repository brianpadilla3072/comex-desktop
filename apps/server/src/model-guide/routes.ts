import { join } from "node:path";
import { ApiError } from "../errors.js";
import { addRoute, type Route } from "../routes/registry.js";
import { runtimeStorageDir } from "../runtime-db.js";
import type { ServerConfig } from "../types.js";
import { comexModelGuideEnabled } from "../comex/features.js";
import { guideDiscoverySchema } from "@openwork/types/model-guide";
import { openModelGuideStore } from "./store.js";

export function registerModelGuideRoutes(options: {
  routes: Route[]; config: ServerConfig; readJsonBody: (request: Request) => Promise<Record<string, unknown>>;
  jsonResponse: (body: unknown, status?: number) => Response; ensureWritable: (config: ServerConfig) => void;
}) {
  const { routes, config, jsonResponse, readJsonBody, ensureWritable } = options;
  let pending: ReturnType<typeof openModelGuideStore> | undefined;
  const store = () => {
    if (!comexModelGuideEnabled()) throw new ApiError(404, "model_guide_disabled", "El catálogo de modelos está desactivado.");
    if (!pending) pending = openModelGuideStore(join(runtimeStorageDir(config), "model-guide.sqlite"), { updateUrl: process.env.OPENWORK_MODEL_CATALOG_URL });
    return pending;
  };
  addRoute(routes, "GET", "/model-guide", "client", async ctx => {
    const scope = ctx.url.searchParams.get("scope") ?? "default";
    if (scope.length > 4096) throw new ApiError(422, "invalid_scope", "El ámbito del catálogo es inválido.");
    const db = await store();
    if (!config.readOnly) void db.refresh();
    return jsonResponse(db.snapshot(scope));
  });
  addRoute(routes, "POST", "/model-guide/discover", "client", async ctx => {
    ensureWritable(config);
    const db = await store();
    const input = guideDiscoverySchema.safeParse(await readJsonBody(ctx.request));
    if (!input.success) throw new ApiError(422, "invalid_model_catalog", "El catálogo detectado tiene datos inválidos.");
    return jsonResponse(db.discover(input.data));
  });
  addRoute(routes, "POST", "/model-guide/refresh", "client", async ctx => {
    ensureWritable(config);
    const db = await store();
    await db.refresh(true);
    return jsonResponse(db.snapshot(ctx.url.searchParams.get("scope") ?? "default"));
  });
}
