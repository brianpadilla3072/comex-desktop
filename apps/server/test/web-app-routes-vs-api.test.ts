import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// In the web app (openwork-server web) the pages and the API share one origin. A page path that
// is also a GET API route answers the API's JSON instead of the app when the person opens or
// reloads it (it happened with /command-center). Every app page must serve index.html.
const dir = mkdtempSync(join(tmpdir(), "web-routes-"));
const webRoot = join(dir, "web");
const overrides: Record<string, string | undefined> = {
  OPENWORK_DATA_DIR: join(dir, "openwork"), OPENWORK_RUNTIME_DB: join(dir, "runtime.sqlite"),
  OPENCODE_DB: join(dir, "v1.db"), OPENWORK_ENGINE_AUTO_UPGRADE: "0", OPENWORK_ENV_STORE: join(dir, "env.json"),
  OPENWORK_WEB_ROOT: webRoot,
};
const previous = new Map(Object.keys(overrides).map(key => [key, process.env[key]]));
let server: { port: number; stop: () => void | Promise<void> };

/** Static page paths declared in the app's router, with params filled in. */
function appPagePaths(): string[] {
  const source = readFileSync(join(import.meta.dirname, "../../app/src/react-app/shell/app-root.tsx"), "utf8");
  const paths = [...source.matchAll(/<Route\s+path="([^"]+)"/g)].map(match => match[1] ?? "");
  return [...new Set(paths.filter(path => path.startsWith("/") && path !== "/")
    .map(path => path.replace(/\/\*$/, "").replace(/:(\w+)/g, "x_$1")))];
}

before(async () => {
  for (const [key, value] of Object.entries(overrides)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  mkdirSync(join(dir, "workspace"), { recursive: true });
  mkdirSync(webRoot, { recursive: true });
  writeFileSync(join(webRoot, "index.html"), "<!doctype html><html><head></head><body>app-shell</body></html>");
  const { resolveServerConfig } = await import("../src/config.js");
  const { startServer } = await import("../src/server.js");
  const config = await resolveServerConfig({ configPath: join(dir, "server.json"), workspaces: [join(dir, "workspace")], port: 0, token: "routes-client", hostToken: "routes-host", logRequests: false });
  server = await startServer(config);
});
after(async () => {
  await server?.stop();
  for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  rmSync(dir, { recursive: true, force: true });
});

test("every app page opened in the browser serves the app, never an API answer", async () => {
  const paths = appPagePaths();
  assert.ok(paths.includes("/command-center") && paths.includes("/inbox") && paths.includes("/projects") && paths.includes("/pair"), paths.join(", "));
  const collisions: string[] = [];
  for (const path of paths) {
    const response = await fetch(`http://127.0.0.1:${server.port}${path}`, { headers: { "sec-fetch-site": "none", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", accept: "text/html" } });
    const body = await response.text();
    if (!body.includes("app-shell")) collisions.push(`${path} -> ${response.status} ${body.slice(0, 80)}`);
  }
  assert.deepEqual(collisions, []);
});
