import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { workspaceIdForPath } from "../src/workspaces.js";
import { specialistStore } from "../src/specialists/store.js";
import { registerSpecialistRoutes } from "../src/specialists/routes.js";
import { matchRoute, type RequestContext, type Route } from "../src/routes/registry.js";
import type { ServerConfig } from "../src/types.js";

const FLAGS = ["DEN_FEATURE_SPECIALIST_APPLICATIONS", "DEN_FEATURE_COMEX_WORKSPACE"];

// Creating the first Comercio Exterior application adopts the workspaces that
// already ran the legacy Comex pack. It must never install the pack, append
// Comex instructions to AGENTS.md, or bind ordinary projects that only happen
// to be open in OpenWork.
test("the first Comex application adopts legacy Comex workspaces only and leaves ordinary projects untouched", async () => {
  const before = new Map(FLAGS.map(name => [name, process.env[name]]));
  for (const name of FLAGS) process.env[name] = "true";
  const root = await mkdtemp(join(tmpdir(), "specialist-first-comex-"));
  try {
    const legacy = join(root, "legacy-comex");
    await mkdir(join(legacy, ".opencode"), { recursive: true });
    await writeFile(join(legacy, ".opencode", ".comex-pack-hashes.json"), "{}");
    const ordinary = join(root, "ordinary-project");
    await mkdir(ordinary, { recursive: true });
    const ordinaryGuidance = "# Proyecto ajeno\n\nSus propias reglas.\n";
    await writeFile(join(ordinary, "AGENTS.md"), ordinaryGuidance);
    const legacyId = workspaceIdForPath(legacy);
    const ordinaryId = workspaceIdForPath(ordinary);
    const config = {
      configPath: join(root, "server.json"), port: 4711, token: "test-token",
      workspaces: [
        { id: ordinaryId, path: ordinary, workspaceType: "local" },
        { id: legacyId, path: legacy, workspaceType: "local" },
      ],
    };
    const created: string[] = [];
    const routes: Route[] = [];
    registerSpecialistRoutes({
      routes, config: config as unknown as ServerConfig,
      readJsonBody: async (request: Request) => await request.json() as Record<string, unknown>,
      jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
      ensureWritable: () => {},
      createWorkspace: async (_ctx, input) => { created.push(input.folderPath); return "ws_principal"; },
    });
    const url = new URL("http://127.0.0.1:1/specialist-applications");
    const match = matchRoute(routes, "POST", url.pathname);
    assert.ok(match);
    // The person is looking at the ordinary project when they create the app.
    const request = new Request(url, { method: "POST", body: JSON.stringify({ userName: "Persona", name: "Comex", specialty: "Comercio Exterior", template: "comex", preferredWorkspaceId: ordinaryId }) });
    const response = await match.handler({ request, url, params: match.params, config } as unknown as RequestContext);
    assert.equal(response.status, 201);
    const body = await response.json() as { workspaceId: string; application: { id: string } };

    // The ordinary project keeps exactly what it had.
    assert.equal(await readFile(join(ordinary, "AGENTS.md"), "utf8"), ordinaryGuidance);
    await assert.rejects(stat(join(ordinary, ".opencode")));
    await assert.rejects(stat(join(ordinary, "comex")));
    const store = await specialistStore(config as unknown as ServerConfig);
    assert.notEqual(store.forWorkspace(ordinaryId)?.id, body.application.id);

    // The legacy Comex workspace is adopted and becomes the app's project.
    assert.equal(store.forWorkspace(legacyId)?.id, body.application.id);
    assert.equal(body.workspaceId, legacyId);
    assert.deepEqual(created, []);
  } finally {
    for (const [name, value] of before) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    await rm(root, { recursive: true, force: true });
  }
});

test("the first Comex application without legacy workspaces starts its own project", async () => {
  const before = new Map(FLAGS.map(name => [name, process.env[name]]));
  for (const name of FLAGS) process.env[name] = "true";
  const root = await mkdtemp(join(tmpdir(), "specialist-first-comex-fresh-"));
  try {
    const ordinary = join(root, "ordinary-project");
    await mkdir(ordinary, { recursive: true });
    const ordinaryId = workspaceIdForPath(ordinary);
    const config = { configPath: join(root, "server.json"), port: 4711, token: "test-token", workspaces: [{ id: ordinaryId, path: ordinary, workspaceType: "local" }] };
    const created: string[] = [];
    const routes: Route[] = [];
    registerSpecialistRoutes({
      routes, config: config as unknown as ServerConfig,
      readJsonBody: async (request: Request) => await request.json() as Record<string, unknown>,
      jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
      ensureWritable: () => {},
      createWorkspace: async (_ctx, input) => { created.push(input.folderPath); await mkdir(input.folderPath, { recursive: true }); return "ws_principal"; },
    });
    const url = new URL("http://127.0.0.1:1/specialist-applications");
    const match = matchRoute(routes, "POST", url.pathname);
    assert.ok(match);
    const request = new Request(url, { method: "POST", body: JSON.stringify({ userName: "Persona", name: "Comex", specialty: "Comercio Exterior", template: "comex", preferredWorkspaceId: ordinaryId }) });
    const response = await match.handler({ request, url, params: match.params, config } as unknown as RequestContext);
    assert.equal(response.status, 201);
    const body = await response.json() as { workspaceId: string };
    assert.equal(body.workspaceId, "ws_principal");
    assert.equal(created.length, 1);
    await assert.rejects(stat(join(ordinary, ".opencode")));
    await assert.rejects(stat(join(ordinary, "AGENTS.md")));
  } finally {
    for (const [name, value] of before) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    await rm(root, { recursive: true, force: true });
  }
});
