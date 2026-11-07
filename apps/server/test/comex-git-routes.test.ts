import { test } from "node:test";
import assert from "node:assert/strict";
import { registerComexGitRoutes } from "../src/comex/git-routes.js";
import { ApiError } from "../src/errors.js";
import { matchRoute, type Route, type RequestContext } from "../src/routes/registry.js";
import type { ServerConfig } from "../src/types.js";

test("Git routes require host authorization and reject writes before executing Git", async t => {
  const before = process.env.DEN_FEATURE_COMEX_GIT_WORKSPACE;
  t.after(() => { if (before === undefined) delete process.env.DEN_FEATURE_COMEX_GIT_WORKSPACE; else process.env.DEN_FEATURE_COMEX_GIT_WORKSPACE = before; });
  const config: ServerConfig = { host: "127.0.0.1", port: 0, token: "client", hostToken: "host", configPath: "/fixture/config.json", approval: { mode: "auto", timeoutMs: 30_000 }, corsOrigins: [], workspaces: [], authorizedRoots: [], readOnly: false, startedAt: 0, tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false };
  const routes: Route[] = [];
  let resolutions = 0;
  registerComexGitRoutes({ routes, config, resolveWorkspace: async (_config, id) => { resolutions++; if (id !== "fixture") throw new ApiError(404, "missing", "Proyecto inexistente"); return { id, name: "Fixture", path: "/fixture", workspaceType: "local" }; }, readJsonBody: request => request.json(), jsonResponse: body => Response.json(body), ensureWritable: value => { if (value.readOnly) throw new ApiError(403, "read_only", "Solo lectura"); } });
  const get = matchRoute(routes, "GET", "/workspace/fixture/git/review");
  const post = matchRoute(routes, "POST", "/workspace/fixture/git/worktrees");
  assert.ok(get); assert.ok(post); assert.equal(get.auth, "host"); assert.equal(post.auth, "host");
  // Dispatcher authorization is tested by the application; this fixture invokes handler guards only.
  const context = { params: post.params, request: new Request("http://localhost/workspace/fixture/git/worktrees", { method: "POST", body: JSON.stringify({ expectedHead: "--help" }) }) } as RequestContext;
  process.env.DEN_FEATURE_COMEX_GIT_WORKSPACE = "false";
  await assert.rejects(post.handler(context), error => error instanceof ApiError && error.code === "git_disabled");
  assert.equal(resolutions, 0);
  process.env.DEN_FEATURE_COMEX_GIT_WORKSPACE = "true";
  config.readOnly = true;
  await assert.rejects(post.handler(context), error => error instanceof ApiError && error.code === "read_only");
  config.readOnly = false;
  config.configPath = undefined;
  await assert.rejects(post.handler(context), error => error instanceof ApiError && error.code === "git_runtime_unavailable");
  config.configPath = "/fixture/config.json";
  await assert.rejects(post.handler(context), error => error instanceof ApiError && error.code === "git_invalid_head");
});
