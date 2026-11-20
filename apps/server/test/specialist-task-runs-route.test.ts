import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApiError } from "../src/errors.js";
import { specialistDirectory, specialistStore, applicationInput } from "../src/specialists/store.js";
import { createTask, listRuns } from "../src/specialists/tasks.js";
import { registerSpecialistRoutes } from "../src/specialists/routes.js";
import { matchRoute, type RequestContext, type Route } from "../src/routes/registry.js";
import type { ServerConfig } from "../src/types.js";

const FLAGS = ["DEN_FEATURE_SPECIALIST_APPLICATIONS", "DEN_FEATURE_SCHEDULED_TASKS"];
const run = { at: 1, status: "ok", sessionId: null, error: null };

// The runs route used to answer 200 [] for a task that does not exist, and it
// built the run-log path from the raw (URL-decoded) task id, so a client token
// could read run-shaped JSON from outside the application's tasks folder.
test("task runs answer 404 for unknown or path-like task ids and never read outside the tasks folder", async () => {
  const before = new Map(FLAGS.map(name => [name, process.env[name]]));
  for (const name of FLAGS) process.env[name] = "true";
  const root = await mkdtemp(join(tmpdir(), "specialist-task-runs-"));
  try {
    const config = { configPath: join(root, "server.json"), port: 4711, token: "test-token", workspaces: [] };
    const store = await specialistStore(config as unknown as ServerConfig);
    const app = store.create(applicationInput.parse({ userName: "Persona", name: "Alpha", specialty: "Pruebas", template: "custom" }), { agents: 0, skills: 0 });
    const task = await createTask(config, app.id, { name: "diaria", prompt: "Revisá.", schedule: { kind: "interval", everyMinutes: 30 } });
    // A run-shaped file outside the tasks folder that a traversal would reach.
    await mkdir(specialistDirectory(config), { recursive: true });
    await writeFile(join(specialistDirectory(config), "secret.json"), JSON.stringify([run]));
    const routes: Route[] = [];
    registerSpecialistRoutes({
      routes, config: config as unknown as ServerConfig,
      readJsonBody: async (request: Request) => await request.json() as Record<string, unknown>,
      jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
      ensureWritable: () => {}, createWorkspace: async () => "ws_new",
    });
    const get = async (taskSegment: string) => {
      const url = new URL(`http://127.0.0.1:1/specialist-applications/${app.id}/tasks/${taskSegment}/runs`);
      const match = matchRoute(routes, "GET", url.pathname);
      assert.ok(match);
      try {
        const response = await match.handler({ request: new Request(url), url, params: match.params, config } as unknown as RequestContext);
        return { status: response.status, body: await response.json() as { runs?: unknown[] } };
      } catch (error) {
        if (error instanceof ApiError) return { status: error.status, body: { code: error.code } };
        throw error;
      }
    };
    assert.deepEqual(await get(task.id), { status: 200, body: { runs: [] } });
    assert.equal((await get("task_00000000-0000-0000-0000-000000000000")).status, 404);
    for (const segment of ["..%2F..%2Fsecret", "..%2F..%2F..%2Fsecret", "%2E%2E%2F%2E%2E%2Fsecret"]) {
      const response = await get(segment);
      assert.equal(response.status, 404, segment);
    }
    // The store refuses a traversal id even when called directly.
    assert.deepEqual(await listRuns(config, app.id, "../../secret"), []);
  } finally {
    for (const [name, value] of before) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    await rm(root, { recursive: true, force: true });
  }
});
