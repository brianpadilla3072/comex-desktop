import { test } from "node:test";
import assert from "node:assert/strict";
import { registerModelGuideRoutes } from "../src/model-guide/routes.js";
import { comexModelGuideEnabled } from "../src/comex/features.js";
import { matchRoute, type Route } from "../src/routes/registry.js";
import type { ServerConfig } from "../src/types.js";

test("guide reads, discovery and refreshing the fixed public catalog require authentication", () => {
  const routes: Route[] = [];
  const config: ServerConfig = { host: "127.0.0.1", port: 0, token: "client", hostToken: "host", configPath: "/fixture/config.json", approval: { mode: "auto", timeoutMs: 30_000 }, corsOrigins: [], workspaces: [], authorizedRoots: [], readOnly: false, startedAt: 0, tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false };
  registerModelGuideRoutes({ routes, config, readJsonBody: request => request.json(), jsonResponse: body => Response.json(body), ensureWritable: () => { throw new Error("read only"); } });
  assert.equal(matchRoute(routes, "GET", "/model-guide")?.auth, "client");
  assert.equal(matchRoute(routes, "POST", "/model-guide/discover")?.auth, "client");
  assert.equal(matchRoute(routes, "POST", "/model-guide/refresh")?.auth, "client");
  assert.equal(comexModelGuideEnabled({}), false);
  assert.equal(comexModelGuideEnabled({ DEN_FEATURE_COMEX_MODEL_GUIDE: "true" }), true);
  assert.equal(comexModelGuideEnabled({ DEN_FEATURE_COMEX_MODEL_GUIDE: "false" }), false);
});
