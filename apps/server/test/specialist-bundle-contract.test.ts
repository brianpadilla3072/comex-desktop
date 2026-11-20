import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { ApiError } from "../src/errors.js";
import { workspaceIdForPath } from "../src/workspaces.js";
import { specialistStore } from "../src/specialists/store.js";
import { prepareSpecialistWorkspace } from "../src/specialists/packs.js";
import { listTasks } from "../src/specialists/tasks.js";
import { registerSpecialistRoutes } from "../src/specialists/routes.js";
import { matchRoute, type RequestContext, type Route } from "../src/routes/registry.js";
import type { ServerConfig } from "../src/types.js";

// Runs contracts/specialist-app-bundle/v1/vectors.json (docs/rust-readiness.md, R5). The same file
// is the acceptance test for any other implementation of POST /specialist-applications/import.
const vectorSchema = z.object({
  name: z.string(),
  bundle: z.unknown(),
  expect: z.object({
    status: z.number().int(),
    code: z.string().optional(),
    projects: z.number().int().optional(),
    files: z.record(z.string(), z.string()).optional(),
    pausedTasks: z.array(z.string()).optional(),
    skippedSections: z.array(z.string()).optional(),
  }),
});
const contractSchema = z.object({ contract: z.literal("openwork.specialist-application"), version: z.literal(1), vectors: z.array(vectorSchema).min(1) });
const contractFile = new URL("../../../contracts/specialist-app-bundle/v1/vectors.json", import.meta.url);
const FLAGS = ["DEN_FEATURE_SPECIALIST_APPLICATIONS", "DEN_FEATURE_SPECIALIST_LIBRARY", "DEN_FEATURE_SCHEDULED_TASKS", "DEN_FEATURE_SPECIALIST_APP_PORTABILITY"];

test("the specialist application bundle contract v1 holds", async () => {
  const contract = contractSchema.parse(JSON.parse(await readFile(contractFile, "utf8")));
  const before = new Map(FLAGS.map(name => [name, process.env[name]]));
  for (const name of FLAGS) process.env[name] = "true";
  try {
    for (const vector of contract.vectors) {
      const root = await mkdtemp(join(tmpdir(), "specialist-contract-"));
      try {
        const config = { configPath: join(root, "server.json"), port: 4711, token: "t", workspaces: [] as Array<{ id: string; path: string; name: string; workspaceType: "local" }> };
        const routes: Route[] = [];
        registerSpecialistRoutes({
          routes, config: config as unknown as ServerConfig,
          readJsonBody: async (request: Request) => z.record(z.string(), z.unknown()).parse(await request.json()),
          jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
          ensureWritable: () => {},
          createWorkspace: async (_ctx, payload) => {
            const folderPath = String(payload.folderPath);
            const store = await specialistStore(config as unknown as ServerConfig);
            await prepareSpecialistWorkspace(config, store.application(String(payload.applicationId)), folderPath);
            const id = workspaceIdForPath(folderPath);
            store.bind(id, String(payload.applicationId), folderPath);
            config.workspaces.push({ id, path: folderPath, name: String(payload.name), workspaceType: "local" });
            return id;
          },
          removeWorkspace: async (_ctx, workspaceId) => { config.workspaces = config.workspaces.filter(workspace => workspace.id !== workspaceId); },
        });
        const url = new URL("http://127.0.0.1:1/specialist-applications/import");
        const match = matchRoute(routes, "POST", url.pathname);
        assert.ok(match);
        const request = new Request(url, { method: "POST", body: JSON.stringify({ bundle: vector.bundle, userName: "Persona" }) });
        let status: number; let body: Record<string, unknown>;
        try {
          const response = await match.handler({ request, url, params: match.params, config, actor: { type: "host", scope: "owner" } } as unknown as RequestContext);
          status = response.status; body = z.record(z.string(), z.unknown()).parse(await response.json());
        } catch (error) {
          if (!(error instanceof ApiError)) throw error;
          status = error.status; body = { code: error.code };
        }
        assert.equal(status, vector.expect.status, `${vector.name}: ${JSON.stringify(body)}`);
        if (vector.expect.code) assert.equal(body.code, vector.expect.code, vector.name);
        if (vector.expect.status >= 400) assert.equal(config.workspaces.length, 0, `${vector.name}: nothing is created on rejection`);
        if (vector.expect.projects !== undefined) assert.equal(config.workspaces.length, vector.expect.projects, vector.name);
        if (vector.expect.skippedSections) assert.deepEqual(body.skippedSections, vector.expect.skippedSections, vector.name);
        for (const [path, content] of Object.entries(vector.expect.files ?? {})) {
          assert.equal(await readFile(join(config.workspaces[0]!.path, "proyecto", path), "utf8"), content, `${vector.name}: ${path}`);
        }
        if (vector.expect.pausedTasks) {
          const application = z.object({ id: z.string() }).parse(body.application);
          const tasks = await listTasks(config, application.id);
          assert.deepEqual(tasks.filter(task => !task.enabled).map(task => task.name), vector.expect.pausedTasks, vector.name);
        }
      } finally { await rm(root, { recursive: true, force: true }); }
    }
  } finally {
    for (const [name, value] of before) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
