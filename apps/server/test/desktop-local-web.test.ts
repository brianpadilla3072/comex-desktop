import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { desktopWebAllowed, prepareDesktopWebRoot, desktopWebReceiptSchema } from "../src/desktop-local-web.js";
import { serveStaticUi, addWebBase } from "../src/static-ui.js";

test("desktop web is explicit, instance-owned and restricted to loopback", async () => {
  const previous = process.env.DEN_FEATURE_DESKTOP_LOCAL_WEB;
  const root = await mkdtemp(join(tmpdir(), "desktop-web-"));
  try {
    await writeFile(join(root, "index.html"), '<html><head><script src="./assets/app.js"></script></head><body></body></html>');
    const request = new Request("http://127.0.0.1:12345/workspace/ws_example/session/ses_example");
    const config = { token: "synthetic-client-token", host: "127.0.0.1", desktopWebRoot: root };
    process.env.DEN_FEATURE_DESKTOP_LOCAL_WEB = "false";
    await assert.rejects(prepareDesktopWebRoot({ root }, config.host), error => error instanceof Error && "code" in error && error.code === "desktop_web_disabled");
    assert.equal(await serveStaticUi(request, config), null);
    process.env.DEN_FEATURE_DESKTOP_LOCAL_WEB = "true";
    assert.equal(await prepareDesktopWebRoot({ root }, config.host), root);
    await assert.rejects(prepareDesktopWebRoot({ root }, "0.0.0.0"), error => error instanceof Error && "code" in error && error.code === "desktop_web_disabled");
    await assert.rejects(prepareDesktopWebRoot({ root: "relative" }, config.host), error => error instanceof Error && "code" in error && error.code === "desktop_web_invalid_root");
    assert.deepEqual(desktopWebReceiptSchema.parse({ version: 1, ready: true }), { version: 1, ready: true });
    const response = await serveStaticUi(request, config);
    assert.equal(response?.status, 200);
    assert.ok(response);
    const html = await response.text();
    assert.ok(html.includes('<base href="/">'));
    assert.ok(html.includes('"desktopWeb":{"version":1}'));
    assert.ok(html.includes('"token":"synthetic-client-token"'));
    const crossSite = await serveStaticUi(new Request(request.url, { headers: { "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" } }), config);
    assert.ok(crossSite);
    assert.ok(!(await crossSite.text()).includes("synthetic-client-token"));
    assert.equal(await serveStaticUi(request, { ...config, host: "0.0.0.0" }), null);
    process.env.DEN_FEATURE_DESKTOP_LOCAL_WEB = "false";
    assert.equal(await serveStaticUi(request, config), null, "kill switch removes the surface without restarting");
  } finally {
    if (previous === undefined) delete process.env.DEN_FEATURE_DESKTOP_LOCAL_WEB;
    else process.env.DEN_FEATURE_DESKTOP_LOCAL_WEB = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop web policy and relative asset base are portable", async () => {
  const { readFile } = await import("node:fs/promises");
  const { z } = await import("zod");
  const schema = z.object({ version: z.literal(1), vectors: z.array(z.object({ host: z.string(), enabled: z.boolean(), allowed: z.boolean() })) });
  const contract = schema.parse(JSON.parse(await readFile(new URL("../../../contracts/desktop-local-web/v1/policy.json", import.meta.url), "utf8")));
  for (const vector of contract.vectors) assert.equal(desktopWebAllowed(vector.host, vector.enabled), vector.allowed);
  assert.equal(addWebBase('<html><head></head></html>'), '<html><head><base href="/"></head></html>');
  assert.equal(addWebBase('<head><base href="/"></head>'), '<head><base href="/"></head>');
});

test("the embedded desktop enables the existing listener without starting another engine", async () => {
  const previous = process.env.DEN_FEATURE_DESKTOP_LOCAL_WEB;
  const root = await mkdtemp(join(tmpdir(), "desktop-web-embedded-"));
  const { startEmbeddedServer } = await import("../src/embedded.js");
  let handle: Awaited<ReturnType<typeof startEmbeddedServer>> | undefined;
  try {
    await writeFile(join(root, "index.html"), '<html><head></head><body>Local web fixture</body></html>');
    process.env.DEN_FEATURE_DESKTOP_LOCAL_WEB = "true";
    handle = await startEmbeddedServer({ host: "127.0.0.1", port: 0, configPath: join(root, "server.json"), workspaces: [], manageOpencode: false, opencodeBaseUrl: "http://127.0.0.1:1", token: "fixture-client", hostToken: "fixture-host", logRequests: false });
    const port = handle.port;
    assert.equal(handle.managedOpencode, null);
    assert.equal((await fetch(`${handle.url}/workspace/ws_example/session/ses_example`)).status, 404);
    assert.deepEqual(await handle.enableDesktopWeb({ root }), { version: 1, ready: true });
    const response = await fetch(`${handle.url}/workspace/ws_example/session/ses_example`);
    assert.equal(response.status, 200);
    assert.ok((await response.text()).includes('"desktopWeb":{"version":1}'));
    assert.equal(handle.port, port);
    assert.equal(handle.managedOpencode, null);
    process.env.DEN_FEATURE_DESKTOP_LOCAL_WEB = "false";
    assert.equal((await fetch(`${handle.url}/workspace/ws_example/session/ses_example`)).status, 404);
  } finally {
    await handle?.stop();
    if (previous === undefined) delete process.env.DEN_FEATURE_DESKTOP_LOCAL_WEB;
    else process.env.DEN_FEATURE_DESKTOP_LOCAL_WEB = previous;
    await rm(root, { recursive: true, force: true });
  }
});
