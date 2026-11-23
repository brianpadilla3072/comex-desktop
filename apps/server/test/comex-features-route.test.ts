import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

// /comex/features was registered twice; the first answered and the second (the only one with
// taskIsolationReview) never ran, so the app never learned that flag. One route, every field.
const dir = mkdtempSync(join(tmpdir(), "comex-features-"));
const overrides: Record<string, string | undefined> = {
  OPENWORK_DATA_DIR: join(dir, "openwork"), OPENWORK_RUNTIME_DB: join(dir, "runtime.sqlite"),
  OPENCODE_DB: join(dir, "v1.db"), OPENWORK_ENGINE_AUTO_UPGRADE: "0", OPENWORK_ENV_STORE: join(dir, "env.json"),
};
const previous = new Map(Object.keys(overrides).map(key => [key, process.env[key]]));
let server: { port: number; stop: () => void | Promise<void> };
before(async () => {
  for (const [key, value] of Object.entries(overrides)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  mkdirSync(join(dir, "workspace"), { recursive: true });
  const { resolveServerConfig } = await import("../src/config.js");
  const { startServer } = await import("../src/server.js");
  const config = await resolveServerConfig({ configPath: join(dir, "server.json"), workspaces: [join(dir, "workspace")], port: 0, token: "features-client", hostToken: "features-host", logRequests: false });
  server = await startServer(config);
});
after(async () => {
  await server?.stop();
  for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  rmSync(dir, { recursive: true, force: true });
});

test("/comex/features is registered once and reports every flag the app reads", async () => {
  const source = readFileSync(join(import.meta.dirname, "../src/routes/core.ts"), "utf8");
  assert.equal(source.split('addRoute(routes, "GET", "/comex/features"').length - 1, 1);
  const response = await fetch(`http://127.0.0.1:${server.port}/comex/features`, { headers: { authorization: "Bearer features-client" } });
  const body = z.record(z.string(), z.unknown()).parse(await response.json());
  for (const key of ["taskIsolationReview", "projectsExperience", "commandCenter", "resultsInbox", "activityAnimationsToggle", "paletteSettingSearch", "artifactSpreadsheetEditor"]) {
    assert.equal(typeof body[key], "boolean", key);
  }
});
