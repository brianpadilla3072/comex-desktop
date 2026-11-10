import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ApiError } from "../src/errors.js";
import { workspaceIdForPath } from "../src/workspaces.js";
import { applicationInput, specialistStore } from "../src/specialists/store.js";
import { syncLibraryToolPlugin } from "../src/specialists/library-tool-api.js";
import { handlePanelMcpMessage, panelAppHtml, PANEL_APP_URI, PANEL_MCP_SERVER_NAME, syncPanelAppMcpEntry } from "../src/specialists/panel-app.js";
import { writePanel } from "../src/specialists/panels.js";
import { registerSpecialistRoutes } from "../src/specialists/routes.js";
import { matchRoute, type RequestContext, type Route } from "../src/routes/registry.js";
import { runtimeMcpMap, readRuntimeOpencodeConfig, writeRuntimeOpencodeConfig } from "../src/runtime-opencode-config-store.js";
import type { ServerConfig } from "../src/types.js";

const input = (name: string) => applicationInput.parse({ userName: "Usuario de prueba", name, specialty: `Especialidad ${name}`, personality: `PERSONA_${name}`, template: "custom" });

const ALL = {
  DEN_FEATURE_SPECIALIST_APPLICATIONS: "true",
  DEN_FEATURE_SPECIALIST_LIBRARY: "true",
  DEN_FEATURE_SPECIALIST_PANELS: "true",
  DEN_FEATURE_SPECIALIST_PANEL_APPS: "true",
};

function withEnv(values: Record<string, string>, run: () => Promise<void>) {
  const before = new Map(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
  return run().finally(() => {
    for (const [key, value] of before) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "specialists-panel-app-"));
  const config = {
    configPath: join(root, "server.json"), port: 4711, token: "test-token", readOnly: false,
    workspaces: [] as Array<{ id: string; path: string }>,
  };
  const store = await specialistStore(config as unknown as ServerConfig);
  const app = store.create(input("Alpha"), { agents: 0, skills: 0 });
  const project = join(root, "proyecto");
  await mkdir(join(project, "datos"), { recursive: true });
  await writeFile(join(project, "datos", "precios.json"), JSON.stringify([
    { fecha: "2026-11-08", cierre: 486, volumen: "1200" },
    { fecha: "2026-11-09", cierre: 491, volumen: "980" },
    { fecha: "2026-11-10", cierre: 489, volumen: null },
  ]));
  const workspaceId = workspaceIdForPath(project);
  config.workspaces.push({ id: workspaceId, path: project });
  store.bind(workspaceId, app.id, project);
  return { root, config, app, project, workspaceId };
}

const spec = {
  title: "Soja — cierre",
  source: { file: "datos/precios.json" },
  refresh: { watch: "latest" },
  blocks: [
    { type: "stat", field: "cierre", agg: "last", format: "currency" },
    { type: "line", x: "fecha", y: ["cierre", "volumen"], title: "Precio" },
    { type: "table", limit: 2, sort: { by: "cierre", desc: true }, columns: ["fecha", "cierre"] },
    { type: "markdown", text: "Datos del último cierre." },
    { type: "changes" },
  ],
};

function apiHarness(config: Record<string, unknown>) {
  const routes: Route[] = [];
  registerSpecialistRoutes({
    routes, config: config as unknown as ServerConfig,
    readJsonBody: async (request: Request) => await request.json() as Record<string, unknown>,
    jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
    ensureWritable: () => {}, createWorkspace: async () => "ws_new",
  });
  return async (method: string, fullPath: string, body?: unknown, headers?: Record<string, string>, origin = "http://127.0.0.1:1") => {
    const url = new URL(`${origin}${fullPath}`);
    const match = matchRoute(routes, method, url.pathname);
    assert.ok(match, `no route for ${method} ${fullPath}`);
    const request = new Request(url, { method, body: body === undefined ? undefined : JSON.stringify(body), headers });
    try {
      const response = await match.handler({ request, url, params: match.params, config } as unknown as RequestContext);
      const text = await response.text();
      return { status: response.status, json: text ? JSON.parse(text) as Record<string, unknown> : null };
    } catch (error) {
      if (error instanceof ApiError) return { status: error.status, json: { error: error.code } };
      throw error;
    }
  };
}

async function tokenOf(root: string): Promise<string> {
  const { readdir } = await import("node:fs/promises");
  const files = await readdir(join(root, "specialists", "tool"));
  const descriptor = JSON.parse(await readFile(join(root, "specialists", "tool", files[0]!), "utf8")) as { token: string };
  return descriptor.token;
}

test("the panel widget is deterministic and cannot reach the network or eval", async () => {
  const html = panelAppHtml();
  assert.equal(panelAppHtml(), html);
  assert.match(html, /^<!doctype html><html><head>/);
  assert.match(html, /ui\/initialize/);
  assert.match(html, /ui\/notifications\/initialized/);
  assert.match(html, /ui\/notifications\/size-changed/);
  assert.match(html, /ui\/notifications\/tool-result/);
  // The only URL-shaped string allowed is the SVG namespace: it is an identifier, not a request.
  const withoutNamespaces = html.split("http://www.w3.org/2000/svg").join("");
  for (const forbidden of ["http://", "https://", "fetch(", "XMLHttpRequest", "eval(", "new Function", "import(", "src=", "href="]) {
    assert.equal(withoutNamespaces.includes(forbidden), false, `the widget must not contain ${forbidden}`);
  }
  assert.equal(html.includes("<script src"), false);
});

test("panel payload computes every block with the shared aggregation semantics", async () => {
  const { root, config, app, project, workspaceId } = await fixture();
  try {
    await withEnv(ALL, async () => {
      await writePanel(config as unknown as ServerConfig, app.id, "soja-cierre", spec);
      const answer = await handlePanelMcpMessage(config as unknown as ServerConfig, app.id, project, {
        jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "dashboard_render", arguments: { panel: "soja-cierre" } },
      });
      assert.ok(answer);
      const result = answer["result"] as { structuredContent: Record<string, unknown>; content: Array<{ text: string }>; isError?: boolean; _meta?: { ui: { resourceUri: string } } };
      assert.equal(result.isError, undefined);
      // The UI binding rides the result too, so the engine can preserve the card (see the v2
      // results plugin); the tool definition stays the source of truth for discovery.
      assert.deepEqual(result._meta?.ui.resourceUri, PANEL_APP_URI);
      assert.match(result.content[0]!.text, /Soja — cierre/);
      const payload = result.structuredContent;
      assert.equal(payload["ok"], true);
      assert.equal(payload["panel"], "soja-cierre");
      assert.equal(payload["source"], "file:datos/precios.json");
      const blocks = payload["blocks"] as Array<Record<string, unknown>>;
      const stat = blocks[0]!;
      assert.equal(stat["type"], "stat");
      assert.equal(stat["value"], 489);
      assert.equal(stat["format"], "currency");
      const chart = blocks[1]!;
      assert.equal(chart["type"], "line");
      const series = chart["series"] as Array<{ name: string; points: Array<{ x: string; y: number }> }>;
      assert.deepEqual(series.map(entry => entry.name), ["cierre", "volumen"]);
      assert.equal(series[0]!.points.length, 3);
      // The null volume is skipped, never plotted as zero.
      assert.deepEqual(series[1]!.points.map(point => point.y), [1200, 980]);
      const table = blocks[2]!;
      assert.deepEqual(table["columns"], ["fecha", "cierre"]);
      assert.deepEqual((table["rows"] as Array<Record<string, unknown>>).map(row => row["fecha"]), ["2026-11-09", "2026-11-10"]);
      assert.equal(table["total"], 3);
      assert.deepEqual(blocks[3], { type: "markdown", text: "Datos del último cierre." });
      const changes = blocks[4]!;
      assert.equal(changes["type"], "changes");
      assert.match(String(changes["summary"]), /corrida/);
      void workspaceId;
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a panel that cannot be drawn answers with the reason, never a blank frame", async () => {
  const { root, config, app, project } = await fixture();
  try {
    await withEnv(ALL, async () => {
      await writePanel(config as unknown as ServerConfig, app.id, "roto", { ...spec, source: { file: "datos/falta.json" } });
      const answer = await handlePanelMcpMessage(config as unknown as ServerConfig, app.id, project, {
        jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "dashboard_render", arguments: { panel: "roto" } },
      });
      const result = answer?.["result"] as { isError: boolean; content: Array<{ text: string }>; structuredContent: Record<string, unknown> };
      assert.equal(result.isError, true);
      assert.match(result.content[0]!.text, /no existe/);
      assert.equal(result.structuredContent["ok"], false);
      // An unknown tool is an answer the model can correct, not a transport error.
      const unknown = await handlePanelMcpMessage(config as unknown as ServerConfig, app.id, project, {
        jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "no_existe", arguments: {} },
      });
      assert.equal((unknown?.["result"] as { isError: boolean }).isError, true);
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("MCP handshake, tools, resources and notifications follow the protocol", async () => {
  const { root, config, app, project } = await fixture();
  try {
    await withEnv(ALL, async () => {
      const initialize = await handlePanelMcpMessage(config as unknown as ServerConfig, app.id, project, {
        jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2026-01-26", appInfo: { name: "test", version: "1" }, appCapabilities: {} },
      });
      const result = initialize?.["result"] as { protocolVersion: string; serverInfo: { name: string }; capabilities: { tools: unknown; resources: unknown } };
      assert.equal(result.protocolVersion, "2025-11-25");
      assert.equal(result.serverInfo.name, PANEL_MCP_SERVER_NAME);
      assert.ok(result.capabilities.tools && result.capabilities.resources);

      const listed = await handlePanelMcpMessage(config as unknown as ServerConfig, app.id, project, { jsonrpc: "2.0", id: 2, method: "tools/list" });
      const tools = (listed?.["result"] as { tools: Array<Record<string, unknown>> }).tools;
      const render = tools.find(tool => tool["name"] === "dashboard_render");
      assert.ok(render);
      assert.deepEqual((render["_meta"] as { ui: { resourceUri: string } }).ui.resourceUri, PANEL_APP_URI);
      // Every tool this server advertises is read-only: the widget cannot mutate anything.
      for (const tool of tools) assert.equal((tool["annotations"] as { readOnlyHint: boolean }).readOnlyHint, true, String(tool["name"]));
      assert.equal(tools.some(tool => /refresh|write|delete|create/.test(String(tool["name"]))), false);

      const resources = await handlePanelMcpMessage(config as unknown as ServerConfig, app.id, project, { jsonrpc: "2.0", id: 3, method: "resources/list" });
      const list = (resources?.["result"] as { resources: Array<{ uri: string; mimeType: string }> }).resources;
      assert.deepEqual(list.map(entry => entry.uri), [PANEL_APP_URI]);
      assert.equal(list[0]!.mimeType, "text/html;profile=mcp-app");

      const read = await handlePanelMcpMessage(config as unknown as ServerConfig, app.id, project, { jsonrpc: "2.0", id: 4, method: "resources/read", params: { uri: PANEL_APP_URI } });
      const contents = (read?.["result"] as { contents: Array<{ uri: string; mimeType: string; text: string; _meta: { ui: { csp: { connectDomains: string[] } } } }> }).contents;
      assert.equal(contents[0]!.uri, PANEL_APP_URI);
      assert.equal(contents[0]!.text, panelAppHtml());
      assert.deepEqual(contents[0]!._meta.ui.csp.connectDomains, []);

      assert.equal(await handlePanelMcpMessage(config as unknown as ServerConfig, app.id, project, { jsonrpc: "2.0", method: "notifications/initialized" }), null);
      const unknown = await handlePanelMcpMessage(config as unknown as ServerConfig, app.id, project, { jsonrpc: "2.0", id: 5, method: "sampling/createMessage" });
      assert.equal((unknown?.["error"] as { code: number }).code, -32601);
      const garbage = await handlePanelMcpMessage(config as unknown as ServerConfig, app.id, project, { nope: true });
      assert.equal((garbage?.["error"] as { code: number }).code, -32600);
      assert.equal(await handlePanelMcpMessage(config as unknown as ServerConfig, app.id, project, { jsonrpc: "2.0", method: "tools/list" }), null);
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the loopback route authenticates with the project token and honours flags and host", async () => {
  const { root, config, app, project, workspaceId } = await fixture();
  const call = apiHarness(config);
  try {
    await withEnv(ALL, async () => {
      await syncLibraryToolPlugin(config as unknown as ServerConfig, workspaceId, project);
      const token = await tokenOf(root);
      const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
      const ok = await call("POST", "/specialist-mcp", { jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, headers);
      assert.equal(ok.status, 200);
      assert.equal(((ok.json?.["result"] as { serverInfo: { name: string } }).serverInfo.name), PANEL_MCP_SERVER_NAME);
      const noToken = await call("POST", "/specialist-mcp", { jsonrpc: "2.0", id: 1, method: "initialize" }, { "content-type": "application/json" });
      assert.equal(noToken.status, 401);
      const wrongToken = await call("POST", "/specialist-mcp", { jsonrpc: "2.0", id: 1, method: "initialize" }, { authorization: "Bearer 00000000000000000000000000000000", "content-type": "application/json" });
      assert.equal(wrongToken.status, 401);

      const notification = await call("POST", "/specialist-mcp", { jsonrpc: "2.0", method: "notifications/initialized" }, headers);
      assert.equal(notification.status, 202);
      assert.equal(notification.json, null);

      const batch = await call("POST", "/specialist-mcp", [
        { jsonrpc: "2.0", id: 10, method: "ping" },
        { jsonrpc: "2.0", id: 11, method: "tools/list" },
      ], headers);
      assert.equal(batch.status, 200);
      assert.ok(Array.isArray(batch.json));
      assert.equal((batch.json as unknown as Array<Record<string, unknown>>).length, 2);

      const offHost = await call("POST", "/specialist-mcp", { jsonrpc: "2.0", id: 1, method: "initialize" }, headers, "http://192.168.1.20:4711");
      assert.equal(offHost.status, 403);
      // A server bound to a public interface turns the feature off entirely: a forged Host header
      // must not be enough to reach the panel endpoint from the network.
      (config as { host?: string }).host = "0.0.0.0";
      const boundPublic = await call("POST", "/specialist-mcp", { jsonrpc: "2.0", id: 1, method: "initialize" }, headers);
      assert.equal(boundPublic.status, 403);
      assert.equal(boundPublic.json?.["error"], "specialist_panel_apps_loopback");
      delete (config as { host?: string }).host;
      void app;
    });
    await withEnv({ ...ALL, DEN_FEATURE_SPECIALIST_PANEL_APPS: "false" }, async () => {
      const token = await tokenOf(root);
      const disabled = await call("POST", "/specialist-mcp", { jsonrpc: "2.0", id: 1, method: "initialize" }, { authorization: `Bearer ${token}`, "content-type": "application/json" });
      assert.equal(disabled.status, 404);
      assert.equal(disabled.json?.["error"], "specialist_panel_apps_disabled");
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the real MCP client the App host uses can drive the loopback endpoint", async () => {
  const { root, config, app, project, workspaceId } = await fixture();
  try {
    await withEnv(ALL, async () => {
      await writePanel(config as unknown as ServerConfig, app.id, "soja-cierre", spec);
      await syncLibraryToolPlugin(config as unknown as ServerConfig, workspaceId, project);
      const token = await tokenOf(root);
      const routes: Route[] = [];
      registerSpecialistRoutes({
        routes, config: config as unknown as ServerConfig,
        readJsonBody: async (request: Request) => await request.json() as Record<string, unknown>,
        jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
        ensureWritable: () => {}, createWorkspace: async () => "ws_new",
      });
      const match = matchRoute(routes, "POST", "/specialist-mcp");
      assert.ok(match);
      const server = Bun.serve({
        port: 0,
        fetch: async (request) => {
          // Streamable HTTP: the standalone SSE stream (GET) is optional; answering 405 is the
          // documented way to say this server only replies inline.
          if (request.method !== "POST") return new Response(null, { status: 405 });
          return await match.handler({ request, url: new URL(request.url), params: match.params, config } as unknown as RequestContext);
        },
      });
      const client = new Client({ name: "app-host-test", version: "1.0.0" }, { capabilities: {} });
      try {
        const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/specialist-mcp`), {
          requestInit: { headers: { authorization: `Bearer ${token}` } },
        });
        await client.connect(transport);
        const tools = await client.listTools();
        assert.ok(tools.tools.some(tool => tool.name === "dashboard_render"));
        const called = await client.callTool({ name: "dashboard_render", arguments: { panel: "soja-cierre" } });
        const content = called.structuredContent as Record<string, unknown> | undefined;
        assert.equal(content?.["ok"], true);
        assert.equal((content?.["blocks"] as unknown[]).length, 5);
        const resource = await client.readResource({ uri: PANEL_APP_URI });
        assert.equal(resource.contents[0]?.mimeType, "text/html;profile=mcp-app");
        assert.equal(resource.contents[0]?.text, panelAppHtml());
      } finally {
        await client.close().catch(() => undefined);
        server.stop(true);
      }
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the projection keeps one panel connection per project and removes it when the flag goes off", async () => {
  const { root, config, app, project, workspaceId } = await fixture();
  const serverConfig = config as unknown as ServerConfig;
  try {
    await withEnv(ALL, async () => {
      await syncLibraryToolPlugin(serverConfig, workspaceId, project);
      await syncPanelAppMcpEntry(serverConfig, workspaceId, project);
      const first = runtimeMcpMap(await readRuntimeOpencodeConfig(serverConfig, workspaceId))[PANEL_MCP_SERVER_NAME] as Record<string, unknown>;
      assert.equal(first["type"], "remote");
      assert.equal(first["enabled"], true);
      assert.equal(first["oauth"], false);
      assert.match(String(first["url"]), /^http:\/\/127\.0\.0\.1:4711\/specialist-mcp$/);
      const token = await tokenOf(root);
      assert.deepEqual(first["headers"], { Authorization: `Bearer ${token}` });
      // Second sync is a no-op the store reports as unchanged.
      const before = await readRuntimeOpencodeConfig(serverConfig, workspaceId);
      const again = await writeRuntimeOpencodeConfig(serverConfig, workspaceId, current => current);
      assert.equal(again.changed, false);
      await syncPanelAppMcpEntry(serverConfig, workspaceId, project);
      const after = await readRuntimeOpencodeConfig(serverConfig, workspaceId);
      assert.deepEqual(runtimeMcpMap(after)[PANEL_MCP_SERVER_NAME], runtimeMcpMap(before)[PANEL_MCP_SERVER_NAME]);
      void app;
    });
    await withEnv({ ...ALL, DEN_FEATURE_SPECIALIST_PANEL_APPS: "false" }, async () => {
      await syncPanelAppMcpEntry(serverConfig, workspaceId, project);
      assert.equal(runtimeMcpMap(await readRuntimeOpencodeConfig(serverConfig, workspaceId))[PANEL_MCP_SERVER_NAME], undefined);
    });
    await withEnv({ ...ALL, DEN_FEATURE_SPECIALIST_PANELS: "false" }, async () => {
      await syncPanelAppMcpEntry(serverConfig, workspaceId, project);
      assert.equal(runtimeMcpMap(await readRuntimeOpencodeConfig(serverConfig, workspaceId))[PANEL_MCP_SERVER_NAME], undefined);
    });
    // A folder that belongs to no specialist application never gets the connection.
    await withEnv(ALL, async () => {
      const outsider = join(root, "ajeno");
      await mkdir(outsider, { recursive: true });
      const outsiderId = workspaceIdForPath(outsider);
      config.workspaces.push({ id: outsiderId, path: outsider });
      await syncPanelAppMcpEntry(serverConfig, outsiderId, outsider);
      assert.equal(runtimeMcpMap(await readRuntimeOpencodeConfig(serverConfig, outsiderId))[PANEL_MCP_SERVER_NAME], undefined);
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a panel too large for the host budget is trimmed, or fails loud instead of truncating silently", async () => {
  const { root, config, app, project } = await fixture();
  try {
    await withEnv(ALL, async () => {
      const wide = Array.from({ length: 300 }, (_, row) => Object.fromEntries(
        Array.from({ length: 40 }, (_, column) => [`c${column}`, `${row}-${column}-${"x".repeat(80)}`]),
      ));
      await writeFile(join(project, "datos", "grande.json"), JSON.stringify(wide));
      // One table with every column: trimming rows keeps it under the 512 KB widget budget.
      await writePanel(config as unknown as ServerConfig, app.id, "grande", {
        title: "Grande", source: { file: "datos/grande.json" }, blocks: [{ type: "table", limit: 500, columns: Array.from({ length: 40 }, (_, column) => `c${column}`) }],
      });
      const one = await handlePanelMcpMessage(config as unknown as ServerConfig, app.id, project, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "dashboard_render", arguments: { panel: "grande" } } });
      const payload = (one?.["result"] as { structuredContent: PanelPayload }).structuredContent;
      assert.equal(payload.ok, true);
      const table = payload.blocks[0] as { rows: unknown[]; total: number };
      assert.equal(table.total, 300);
      assert.equal(table.rows.length, 20);
      assert.ok(JSON.stringify(payload).length <= 512 * 1024);

      // Twelve wide tables cannot fit even trimmed: the tool says why, it never sends a partial card.
      await writePanel(config as unknown as ServerConfig, app.id, "enorme", {
        title: "Enorme", source: { file: "datos/grande.json" },
        blocks: Array.from({ length: 12 }, () => ({ type: "table" as const, limit: 500, columns: Array.from({ length: 40 }, (_, column) => `c${column}`) })),
      });
      const many = await handlePanelMcpMessage(config as unknown as ServerConfig, app.id, project, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "dashboard_render", arguments: { panel: "enorme" } } });
      const rejected = (many?.["result"] as { structuredContent: PanelPayload; isError: boolean }).structuredContent;
      assert.equal(rejected.ok, false);
      assert.match(rejected.ok === false ? rejected.error : "", /demasiado grande/);
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

type PanelPayload = { ok: true; blocks: unknown[] } | { ok: false; error: string };

test("the catalog says whether panel Apps are available, so the UI never promises a missing feature", async () => {
  const { root, config } = await fixture();
  const call = apiHarness(config);
  try {
    await withEnv(ALL, async () => {
      const on = await call("GET", "/specialist-applications");
      assert.equal(on.status, 200);
      assert.equal(on.json?.["panelAppsEnabled"], true);
    });
    await withEnv({ ...ALL, DEN_FEATURE_SPECIALIST_PANEL_APPS: "false" }, async () => {
      const off = await call("GET", "/specialist-applications");
      assert.equal(off.json?.["panelAppsEnabled"], false);
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});
