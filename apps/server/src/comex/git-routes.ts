import { dirname } from "node:path";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { addRoute, type Route } from "../routes/registry.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { comexGitWorkspaceEnabled } from "./features.js";
import { createGitWorktree, reviewGitWorkspace } from "./git.js";

export function registerComexGitRoutes(options: {
  routes: Route[]; config: ServerConfig;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
  readJsonBody: (request: Request) => Promise<Record<string, unknown>>;
  jsonResponse: (body: unknown, status?: number) => Response;
  ensureWritable: (config: ServerConfig) => void;
  resolveSessionDirectory?: (workspace: WorkspaceInfo, sessionId: string) => Promise<string | null>;
}) {
  const { routes, config, resolveWorkspace, readJsonBody, jsonResponse, ensureWritable } = options;
  const workspace = async (id: string) => {
    if (!comexGitWorkspaceEnabled()) throw new ApiError(404, "git_disabled", "La revisión Git está desactivada por el operador.");
    const value = await resolveWorkspace(config, id);
    if (value.workspaceType !== "local") throw new ApiError(422, "git_local_required", "La revisión Git requiere un proyecto local.");
    return value;
  };
  addRoute(routes, "GET", "/workspace/:id/git/review", "host", async ctx => {
    const value = await workspace(ctx.params.id);
    const sessionId = ctx.url.searchParams.get("session");
    let directory = value.path;
    if (sessionId) {
      const resolved = await options.resolveSessionDirectory?.(value, sessionId);
      if (!resolved) throw new ApiError(404, "session_not_found", "La conversación no pertenece al proyecto.");
      directory = resolved;
    }
    return jsonResponse(await reviewGitWorkspace(directory, { codeOnly: ctx.url.searchParams.get("codeOnly") === "true" }));
  });
  addRoute(routes, "POST", "/workspace/:id/git/worktrees", "host", async ctx => {
    const value = await workspace(ctx.params.id);
    ensureWritable(config);
    if (!config.configPath) throw new ApiError(503, "git_runtime_unavailable", "No hay una carpeta de configuración disponible para crear el trabajo aislado.");
    const parsed = z.object({ expectedHead: z.string().regex(/^[a-f0-9]{40,64}$/) }).strict().safeParse(await readJsonBody(ctx.request));
    if (!parsed.success) throw new ApiError(422, "git_invalid_head", "Revisá el commit de origen antes de crear un trabajo aislado.");
    return jsonResponse(await createGitWorktree(value.path, dirname(config.configPath), parsed.data.expectedHead), 201);
  });
}
