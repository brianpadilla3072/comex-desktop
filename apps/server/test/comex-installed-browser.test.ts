import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInstalledBrowserIntegration } from "../src/comex/installed-browser.js";
import { installedBrowserPlugin } from "../src/comex/installed-browser-plugin.js";

test("installed browser bridge stays project-local, keeps credentials outside it and closes its own endpoint", async () => {
  const root = await mkdtemp(join(tmpdir(), "comex-browser-"));
  const project = join(root, "project"); await mkdir(project);
  const integration = createInstalledBrowserIntegration({ configPath: join(root, "private/config.json"), workspaces: [{ path: project }] });
  try {
    await Promise.all([integration.install(project), integration.install(project)]);
    const file = join(project, ".opencode/plugins/comex-browser/server.js");
    const source = await readFile(file, "utf8");
    assert.ok(source.includes("installedBrowserPlugin"));
    assert.ok(!source.includes('"token"'));
    const match = source.match(/installedBrowserPlugin\(("[^\n]+")\)/);
    assert.ok(match);
    const descriptorFile = JSON.parse(match[1]);
    assert.ok(!descriptorFile.startsWith(project));
    const descriptor = JSON.parse(await readFile(descriptorFile, "utf8"));
    assert.equal((await stat(descriptorFile)).mode & 0o777, 0o600);
    assert.equal((await fetch(descriptor.url, { method: "POST", body: "{}" })).status, 401);
    await writeFile(file, source + "// Personalizado\n");
    // Existing edits are preserved by a new owner too.
    const second = createInstalledBrowserIntegration({ configPath: join(root, "other/config.json"), workspaces: [{ path: project }] });
    try { await assert.rejects(second.install(project), /No se sobrescribió/); }
    finally { await second.close(); }
    assert.equal(await readFile(file, "utf8"), source + "// Personalizado\n");
    await integration.close();
    assert.deepEqual(JSON.parse(await readFile(descriptorFile, "utf8")), {});
    await assert.rejects(fetch(descriptor.url));
  } finally { await integration.close(); await rm(root, { recursive: true, force: true }); }
});

test("browser tools use the engine's session, forward attachments and reject foreign endpoints or projects", async () => {
  const root = await mkdtemp(join(tmpdir(), "comex-browser-plugin-"));
  const descriptor = join(root, "descriptor.json");
  const calls: { sessionId?: string }[] = [];
  const server = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, "Bearer transport-fixture");
    let body = ""; for await (const chunk of request) body += chunk;
    calls.push(JSON.parse(body));
    response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ content: [{ type: "text", text: "Observed" }, { type: "file", uri: "data:image/png;base64,AA==", mime: "image/png" }] }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const value = { directory: root, url: `http://127.0.0.1:${address.port}/browser`, token: "transport-fixture" };
  await writeFile(descriptor, JSON.stringify(value), { mode: 0o600 });
  const tools: { name: string; execute(input: unknown, call: { sessionID: string; signal: AbortSignal }): Promise<unknown> }[] = [];
  try {
    const dispose = await installedBrowserPlugin(descriptor).setup({ location: { directory: root }, tool: { transform: async callback => { callback({ add: tool => tools.push(tool) }); return { dispose: async () => {} }; } } });
    const tabs = tools.find(tool => tool.name === "browser_tabs"); assert.ok(tabs);
    assert.ok(tools.some(tool => tool.name === "browser_act"));
    assert.ok(!tools.some(tool => tool.name.startsWith("computer_") || tool.name.startsWith("openwork_")));
    const result = await tabs.execute({ sessionId: "forged" }, { sessionID: "real-session", signal: new AbortController().signal });
    assert.equal(calls[0].sessionId, "real-session");
    assert.ok(JSON.stringify(result).includes("data:image/png"));
    for (const replacement of [{ ...value, url: "https://example.com/browser" }, { ...value, directory: "/another/project" }, {}]) {
      await writeFile(descriptor, JSON.stringify(replacement));
      await assert.rejects(tabs.execute({}, { sessionID: "real-session", signal: new AbortController().signal }), /no está conectado/);
    }
    assert.equal(calls.length, 1);
    await dispose?.();
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
});

test("browser installation rejects symlink folders before writing outside the workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "comex-browser-links-"));
  const project = join(root, "project"); const outside = join(root, "outside"); await mkdir(project); await mkdir(outside);
  await symlink(outside, join(project, ".opencode"));
  const integration = createInstalledBrowserIntegration({ configPath: join(root, "private/config.json"), workspaces: [{ path: project }] });
  try { await assert.rejects(integration.install(project), /enlazadas/); await assert.rejects(stat(join(outside, "plugins"))); }
  finally { await integration.close(); await rm(root, { recursive: true, force: true }); }
});
