import { after, test } from "node:test";
import assert from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { panelAppHtml } from "../src/specialists/panel-app.js";

/** The widget is the only part of [4] that a person actually sees, so it is driven here the way
 *  the chat host drives it: real DOM, real postMessage handshake, real tool-result notifications.
 *  A blank card is a bug, and this harness fails when the card goes blank. */

const ownedDom = !GlobalRegistrator.isRegistered && typeof document === "undefined";
if (ownedDom) GlobalRegistrator.register({ url: "http://localhost/" });
after(async () => { if (ownedDom) await GlobalRegistrator.unregister(); });

type HostMessage = Record<string, unknown>;

const html = panelAppHtml();
const body = /<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? "";
const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1] ?? "";

const payload = {
  ok: true,
  panel: "cierres",
  title: "Cierres",
  source: "file:datos.json",
  refreshedAt: 1_700_000_000_000,
  blocks: [
    { type: "stat", title: "Cierre", field: "cierre", value: 489, format: "number" },
    { type: "line", title: "Precio", x: "fecha", series: [{ name: "cierre", points: [{ x: "2026-11-08", y: 486 }, { x: "2026-11-09", y: 491 }] }], skipped: 0 },
    { type: "table", columns: ["fecha", "cierre"], rows: [{ fecha: "2026-11-08", cierre: 486 }, { fecha: "2026-11-09", cierre: 491 }], total: 2 },
    { type: "markdown", text: "Datos del último cierre." },
    { type: "changes", title: "Cambios", summary: "+1 nuevo, 1 modificado", at: 1_700_000_000_000, added: 1, removed: 0, changed: 1 },
  ],
};

async function until(check: () => boolean, label: string) {
  for (let turn = 0; turn < 200 && !check(); turn += 1) await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(check(), label);
}

/** Boots the real widget document and answers as the host would. Returns the messages the widget
 *  sent and a way to deliver a tool result. */
function mountWidget(options: { toolResult?: () => HostMessage } = {}) {
  document.body.innerHTML = body;
  const sent: HostMessage[] = [];
  const reply = (message: HostMessage) => {
    sent.push(message);
    if (message["method"] === "ui/initialize") {
      window.postMessage({ jsonrpc: "2.0", id: message["id"], result: { protocolVersion: "2026-01-26", hostInfo: { name: "test-host", version: "1" }, hostCapabilities: {}, hostContext: { theme: "light" } } }, "*");
    }
    if (message["method"] === "tools/call") {
      const result = options.toolResult?.() ?? { content: [{ type: "text", text: "ok" }], structuredContent: payload };
      window.postMessage({ jsonrpc: "2.0", id: message["id"], result }, "*");
    }
  };
  // A parent window distinct from the page: the real host lives outside the sandbox, so messages
  // travel one way (worker → host) and answers come back through window.postMessage.
  const fakeParent = { postMessage: (message: HostMessage) => reply(message) };
  Object.defineProperty(window, "parent", { configurable: true, value: fakeParent });
  // Runs the widget's own script in the page scope, exactly as the sandbox would.
  new Function(script)();
  return {
    sent,
    dispose: () => undefined,
    deliver: (result: HostMessage) => window.postMessage({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: result }, "*"),
  };
}

test("the widget completes the MCP Apps handshake and reports its size", async () => {
  const host = mountWidget();
  try {
    await until(() => host.sent.some(message => message["method"] === "ui/initialize"), "the widget never sent ui/initialize");
    await until(() => host.sent.some(message => message["method"] === "ui/notifications/initialized"), "the widget never confirmed initialization");
    await until(() => host.sent.some(message => message["method"] === "ui/notifications/size-changed"), "the widget never reported its size");
    const version = (host.sent.find(message => message["method"] === "ui/initialize")?.["params"] as { protocolVersion: string }).protocolVersion;
    assert.equal(version, "2026-01-26");
  } finally { host.dispose(); }
});

test("the widget paints every block the server computes", async () => {
  const host = mountWidget();
  try {
    await until(() => host.sent.some(message => message["method"] === "ui/notifications/initialized"), "handshake incomplete");
    host.deliver({ content: [{ type: "text", text: "ok" }], structuredContent: payload });
    await until(() => document.querySelector("h1")?.textContent === "Cierres", "the title never painted");
    assert.match(document.querySelector("header p")?.textContent ?? "", /file:datos\.json/);
    assert.equal(document.querySelector(".stat-value")?.textContent, "489");
    assert.equal(document.querySelectorAll("table tbody tr").length, 2);
    assert.equal(document.querySelector("svg polyline")?.getAttribute("points")?.split(" ").length, 2);
    assert.match(document.querySelector("header .meta")?.textContent ?? "", /· \d{2}\/\d{2}\/\d{4}/);
    // The changes block keeps its summary, never a bare count.
    assert.match(document.body.textContent ?? "", /\+1 nuevo, 1 modificado/);
  } finally { host.dispose(); }
});

test("a failed result or a broken panel says why instead of rendering a blank card", async () => {
  const host = mountWidget();
  try {
    await until(() => host.sent.some(message => message["method"] === "ui/notifications/initialized"), "handshake incomplete");
    host.deliver({ content: [{ type: "text", text: "El archivo datos.json no existe en este proyecto." }], isError: true });
    await until(() => (document.querySelector(".alert")?.textContent ?? "").includes("no existe"), "an error result painted nothing");
    host.deliver({ content: [], structuredContent: { ok: false, panel: "roto", title: null, error: "El dataset nunca tuvo una corrida." } });
    await until(() => (document.querySelector(".alert")?.textContent ?? "").includes("nunca tuvo"), "a failed payload painted nothing");
  } finally { host.dispose(); }
});

test("a chart without numbers fails loud and the refresh button re-runs the tool", async () => {
  const state = { title: "Primero", value: 1 };
  const host = mountWidget({
    toolResult: () => ({
      content: [{ type: "text", text: "ok" }],
      structuredContent: {
        ok: true, panel: "cierres", title: state.title, source: "file:datos.json", refreshedAt: 1,
        blocks: [
          { type: "stat", title: "Cierre", field: "cierre", value: state.value, format: "number" },
          { type: "bar", title: "Sin números", x: "fecha", series: [{ name: "cierre", points: [] }], skipped: 3 },
        ],
      },
    }),
  });
  try {
    await until(() => host.sent.some(message => message["method"] === "ui/notifications/initialized"), "handshake incomplete");
    host.deliver({ content: [], structuredContent: { ok: true, panel: "cierres", title: state.title, source: "file:datos.json", refreshedAt: 1, blocks: [{ type: "stat", title: "Cierre", field: "cierre", value: state.value, format: "number" }, { type: "bar", title: "Sin números", x: "fecha", series: [{ name: "cierre", points: [] }], skipped: 3 }] } });
    await until(() => document.querySelector("h1")?.textContent === "Primero", "first paint missing");
    assert.match(document.body.textContent ?? "", /no tiene valores numéricos/);
    state.title = "Segundo";
    state.value = 42;
    const button = document.querySelector<HTMLButtonElement>("#refresh");
    assert.ok(button, "the refresh button is missing");
    button.click();
    await until(() => document.querySelector("h1")?.textContent === "Segundo", "refresh did not repaint the card");
    assert.equal(document.querySelector(".stat-value")?.textContent, "42");
    const call = host.sent.find(message => message["method"] === "tools/call");
    assert.deepEqual((call?.["params"] as { name: string; arguments: { panel: string } }), { name: "dashboard_render", arguments: { panel: "cierres" } });
  } finally { host.dispose(); }
});
