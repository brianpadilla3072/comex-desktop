import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiError } from "../src/errors.js";
import { registerContinuityRoutes } from "../src/comex/continuity-routes.js";
import { matchRoute, type RequestContext, type Route } from "../src/routes/registry.js";
import type { ServerConfig } from "../src/types.js";
import { readComexCheckpoint } from "../src/comex/continuity.js";
import { seedComexPack } from "../src/comex/seed.js";

const checkpoint = { objective: "Informe", decisions: [], progress: [], pending: ["Revisar"], artifacts: [] };
test("continuity routes require ownership, host write auth, read-write mode and revision checks", async t => {
  const root = await mkdtemp(join(tmpdir(), "comex-continuity-routes-"));
  const old = process.env.DEN_FEATURE_COMEX_CONTINUITY;
  t.after(async () => { await rm(root, { recursive: true, force: true }); if (old === undefined) delete process.env.DEN_FEATURE_COMEX_CONTINUITY; else process.env.DEN_FEATURE_COMEX_CONTINUITY = old; });
  process.env.DEN_FEATURE_COMEX_CONTINUITY = "true";
  const config: ServerConfig = { host: "127.0.0.1", port: 0, token: "client", hostToken: "host", approval: { mode: "auto", timeoutMs: 30_000 }, corsOrigins: [], workspaces: [], authorizedRoots: [root], readOnly: false, startedAt: 0, tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false };
  const routes: Route[] = [];
  let authorizations = 0;
  registerContinuityRoutes({ routes, config, readJsonBody: async request => request.json(), jsonResponse: body => Response.json(body), ensureWritable: value => { if (value.readOnly) throw new ApiError(403, "read_only", "Solo lectura"); }, authorizeSession: async (workspace, session) => {
    authorizations++;
    if (workspace !== "ws_a" || session !== "ses_a") throw new ApiError(404, "session_not_found", "Sesión no encontrada");
    return root;
  } });
  async function request(method: string, path = "/workspace/ws_a/continuity/ses_a", body?: unknown) {
    const route = matchRoute(routes, method, path); assert.ok(route);
    // Registry handlers only consume these fields; authentication happens in the server dispatcher.
    const ctx = { params: route.params, request: new Request(`http://localhost${path}`, { method, ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) }) } as RequestContext;
    return route.handler(ctx);
  }
  assert.equal(matchRoute(routes, "PUT", "/workspace/ws_a/continuity/ses_a")?.auth, "host");
  assert.equal(matchRoute(routes, "GET", "/workspace/ws_a/continuity/ses_a")?.auth, "client");
  assert.deepEqual(await (await request("GET")).json(), { status: "missing", revision: 0, checkpoint: null });
  await assert.rejects(request("PUT", "/workspace/ws_b/continuity/ses_a", { expectedRevision: 0, checkpoint }), error => error instanceof ApiError && error.status === 404);
  config.readOnly = true;
  await assert.rejects(request("PUT", undefined, { expectedRevision: 0, checkpoint }), error => error instanceof ApiError && error.status === 403);
  assert.equal((await readComexCheckpoint(root, "ses_a")).status, "missing");
  config.readOnly = false;
  assert.equal((await (await request("PUT", undefined, { expectedRevision: 0, checkpoint })).json()).revision, 1);
  await assert.rejects(request("PUT", undefined, { expectedRevision: 0, checkpoint }), error => error instanceof ApiError && error.code === "continuity_conflict" && error.status === 409);
  await assert.rejects(request("PUT", undefined, { expectedRevision: 1, checkpoint: { ...checkpoint, pending: Array(17).fill("exceso") } }), error => error instanceof ApiError && error.status === 422);
  process.env.DEN_FEATURE_COMEX_CONTINUITY = "false";
  const previous = authorizations;
  await assert.rejects(request("GET"), error => error instanceof ApiError && error.code === "continuity_disabled");
  assert.equal(authorizations, previous);
  assert.equal((await readComexCheckpoint(root, "ses_a")).revision, 1);
});

test("pack seed installs document launcher and updates it while preserving local customizations", async t => {
  const { mkdir, readFile } = await import("node:fs/promises");
  const root = await mkdtemp(join(tmpdir(), "comex-runtime-seed-"));
  const pack = await mkdtemp(join(tmpdir(), "comex-runtime-pack-"));
  t.after(async () => { await rm(root, { recursive: true, force: true }); await rm(pack, { recursive: true, force: true }); });
  await Promise.all([mkdir(join(pack, "skills")), mkdir(join(pack, "agents")), mkdir(join(pack, "scripts"))]);
  await writeFile(join(pack, "scripts/documents.py"), "launcher v1");
  await writeFile(join(pack, "scripts/requirements.lock.txt"), "dependencies v1");
  await writeFile(join(pack, "scripts/secret.txt"), "excluded");
  await seedComexPack(root, pack);
  assert.equal(await readFile(join(root, ".opencode/scripts/documents.py"), "utf8"), "launcher v1");
  await assert.rejects(readFile(join(root, ".opencode/scripts/secret.txt")));
  await writeFile(join(root, ".opencode/scripts/documents.py"), "local launcher");
  await writeFile(join(pack, "scripts/documents.py"), "launcher v2");
  await writeFile(join(pack, "scripts/requirements.lock.txt"), "dependencies v2");
  await seedComexPack(root, pack);
  assert.equal(await readFile(join(root, ".opencode/scripts/documents.py"), "utf8"), "local launcher");
  assert.equal(await readFile(join(root, ".opencode/scripts/documents.py.nuevo"), "utf8"), "launcher v2");
  assert.equal(await readFile(join(root, ".opencode/scripts/requirements.lock.txt"), "utf8"), "dependencies v2");
});
