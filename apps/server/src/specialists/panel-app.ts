import { z } from "zod";
import { ApiError } from "../errors.js";
import { addRoute, type RequestContext, type Route } from "../routes/registry.js";
import { specialistApplicationsEnabled, specialistPanelAppsEnabled, specialistPanelsEnabled } from "../comex/features.js";
import { runtimeMcpMap, writeRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import { listDatasets, listSnapshotDates, readLatestSnapshot } from "./datasets.js";
import { readSpecialistToolDescriptor, specialistTokenDirectory, type SpecialistToolDescriptor } from "./library-tool-api.js";
import { listPanels, panelAggregate, panelRows, resolvePanel, type SpecialistPanelSpec } from "./panels.js";
import { specialistStore } from "./store.js";
import { workspaceIdForPath } from "../workspaces.js";
import type { ServerConfig } from "../types.js";

/** [4] MCP Apps local: a panel rendered *inline in the chat*, served by a loopback-only,
 *  project-scoped MCP server that this process owns. The AI never writes widget code: it writes a
 *  panel spec, this module compiles it deterministically into one shared HTML document and the
 *  server pre-computes every block, so the widget only paints. Read-only by construction: no tool
 *  here mutates a file, a dataset or a task (writing stays in la biblioteca/[7]/tareas). */

export const PANEL_APP_URI = "ui://openwork/panel/v1";
export const PANEL_MCP_ROUTE = "/specialist-mcp";
export const PANEL_MCP_SERVER_NAME = "openwork-panels";
/** Version of the MCP Apps protocol the widget speaks (same string as ext-apps 1.7.5). */
const APP_PROTOCOL_VERSION = "2026-01-26";
/** Version of the MCP transport protocol a JSON-RPC client negotiates (SDK 1.32 answers this). */
const MCP_PROTOCOL_VERSION = "2025-11-25";
const APP_MIME_TYPE = "text/html;profile=mcp-app";
const SNAPSHOT_PREVIEW_CHARS = 40_000;

export type PanelRenderBlock =
  | { type: "stat"; title: string; field: string; value: number | string | null; format: "number" | "percent" | "currency" | null }
  | { type: "line" | "bar"; title: string; x: string; series: Array<{ name: string; points: Array<{ x: string; y: number }> }>; skipped: number }
  | { type: "table"; columns: string[]; rows: Array<Record<string, string | number | null>>; total: number }
  | { type: "markdown"; text: string }
  | { type: "changes"; title: string; summary: string; at: number | null; added: number; removed: number; changed: number };

export type PanelRenderPayload =
  | { ok: true; panel: string; title: string; source: string; refreshedAt: number; blocks: PanelRenderBlock[] }
  | { ok: false; panel: string; title: string | null; error: string };

const scalarCell = (value: unknown): string | number | null => {
  if (typeof value === "number") return value;
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "sí" : "no";
  if (value === null || value === undefined) return null;
  try { return JSON.stringify(value).slice(0, 300); } catch { return null; }
};

/** Sort exactly like the app renderer so a table never disagrees with its card. */
function sortRows(rows: Array<Record<string, unknown>>, by: string, desc: boolean) {
  return [...rows].sort((left, right) => {
    const a = left[by];
    const b = right[by];
    const compared = typeof a === "number" && typeof b === "number" ? a - b : String(a ?? "").localeCompare(String(b ?? ""));
    return desc ? -compared : compared;
  });
}

function renderBlock(block: SpecialistPanelSpec["blocks"][number], rows: Array<Record<string, unknown>>, diff: unknown): PanelRenderBlock {
  if (block.type === "markdown") return { type: "markdown", text: block.text };
  if (block.type === "changes") {
    // Same shape the app card reads: the F2 diff envelope stored beside the snapshot.
    const envelope = diff !== null && typeof diff === "object" ? diff as { at?: unknown; diff?: { summary?: unknown; added?: unknown; removed?: unknown; changed?: unknown } } : null;
    const summary = typeof envelope?.diff?.summary === "string" ? envelope.diff.summary : "Todavía no hubo una corrida que compare.";
    return {
      type: "changes",
      title: block.title ?? "Cambios desde la última corrida",
      summary,
      at: typeof envelope?.at === "number" ? envelope.at : null,
      added: typeof envelope?.diff?.added === "number" ? envelope.diff.added : 0,
      removed: typeof envelope?.diff?.removed === "number" ? envelope.diff.removed : 0,
      changed: typeof envelope?.diff?.changed === "number" ? envelope.diff.changed : 0,
    };
  }
  if (block.type === "stat") {
    return {
      type: "stat",
      title: block.title ?? block.field,
      field: block.field,
      value: panelAggregate(rows, block.field, block.agg ?? "last"),
      format: block.format ?? null,
    };
  }
  if (block.type === "table") {
    const columns = block.columns ?? (rows[0] ? Object.keys(rows[0]).slice(0, 8) : []);
    const sorted = block.sort ? sortRows(rows, block.sort.by, block.sort.desc ?? false) : rows;
    return {
      type: "table",
      columns,
      rows: sorted.slice(0, block.limit ?? 50).map(row => Object.fromEntries(columns.map(column => [column, scalarCell(row[column])]))),
      total: sorted.length,
    };
  }
  // line / bar: numeric series only; a column with no numbers is reported, never drawn as a zero.
  let skipped = 0;
  const series = block.y.map(field => {
    const points = rows.flatMap(row => {
      const value = typeof row[field] === "number" ? row[field] : typeof row[field] === "string" && row[field].trim() !== "" && Number.isFinite(Number(row[field])) ? Number(row[field]) : null;
      if (value === null) { skipped += 1; return []; }
      return [{ x: String(row[block.x] ?? ""), y: value }];
    });
    return { name: field, points };
  });
  return { type: block.type, title: block.title ?? block.y.join(", "), x: block.x, series, skipped };
}

/** Resolve a panel and pre-compute every block. Shared by the MCP tools and the route tests, so
 *  what the widget paints is exactly what the panel means (one aggregation, no JS duplication).
 *  A huge panel is trimmed (or fails loud) to stay under the host's 1 MB result budget: the card
 *  never arrives half-serialized. */
export async function panelRenderPayload(config: Pick<ServerConfig, "configPath">, appId: string, directory: string, name: string): Promise<PanelRenderPayload> {
  const resolution = await resolvePanel(config, appId, name, directory);
  if (!resolution.ok) return { ok: false, panel: name, title: resolution.spec?.title ?? null, error: resolution.error };
  const { rows } = panelRows(resolution.data);
  const payload: PanelRenderPayload = {
    ok: true,
    panel: name,
    title: resolution.spec.title,
    source: resolution.sourceLabel,
    refreshedAt: Date.now(),
    blocks: resolution.spec.blocks.map(block => renderBlock(block, rows, resolution.diff)),
  };
  return fitWidgetPayload(payload);
}

/** 512 KB leaves room for the transport envelope under the host's 1 MB cap. */
const MAX_WIDGET_CHARS = 512 * 1024;

function fitWidgetPayload(payload: PanelRenderPayload): PanelRenderPayload {
  if (!payload.ok || JSON.stringify(payload).length <= MAX_WIDGET_CHARS) return payload;
  // First trim tables (the block itself already says "Mostrando X de Y filas"), then series.
  const withTables = { ...payload, blocks: payload.blocks.map(block => block.type === "table" ? { ...block, rows: block.rows.slice(0, 20) } : block) };
  if (JSON.stringify(withTables).length <= MAX_WIDGET_CHARS) return withTables;
  const withSeries = { ...payload, blocks: withTables.blocks.map(block => block.type === "line" || block.type === "bar"
    ? { ...block, series: block.series.map(entry => ({ ...entry, points: entry.points.slice(0, 200) })) }
    : block) };
  if (JSON.stringify(withSeries).length <= MAX_WIDGET_CHARS) return withSeries;
  return { ok: false, panel: payload.panel, title: payload.title, error: "El panel es demasiado grande para la vista interactiva: achicá la tabla o derivá el dato a un dataset." };
}

function datasetPayload(directory: string, id: string) {
  return listDatasets(directory).then(async datasets => {
    const dataset = datasets.find(entry => entry.id === id || entry.name === id);
    if (!dataset) throw new ApiError(404, "dataset_not_found", "Ese dataset no existe en este proyecto.");
    const snapshots = await listSnapshotDates(directory, dataset.id);
    if (dataset.lastSnapshotAt === null) {
      return { dataset, snapshots, latest: null, truncated: false, note: "El dataset todavía no tuvo una corrida: su consulta está guardada y es re-ejecutable, pero no hay snapshot que leer." };
    }
    const preview = JSON.stringify(await readLatestSnapshot(directory, dataset.id));
    const truncated = preview.length > SNAPSHOT_PREVIEW_CHARS;
    return {
      dataset,
      snapshots,
      truncated,
      latest: truncated ? preview.slice(0, SNAPSHOT_PREVIEW_CHARS) : JSON.parse(preview) as unknown,
      ...(truncated ? { note: "El snapshot supera 40 KB: va un recorte. El resto está en comex/datasets del proyecto." } : {}),
    };
  });
}

const TOOL_INPUT_PANEL = { type: "object", properties: { panel: { type: "string", description: "Nombre kebab-case del panel (visible en panel_list)." } }, required: ["panel"], additionalProperties: false } as const;
const TOOL_INPUT_DATASET = { type: "object", properties: { id: { type: "string", description: "id o nombre del dataset (visible en dataset_list)." } }, required: ["id"], additionalProperties: false } as const;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

function toolDefinitions() {
  return [
    {
      name: "dashboard_render",
      title: "Dibujar un panel",
      description: "Devuelve un panel declarativo ya resuelto (bloques calculados sobre el snapshot más reciente) y lo muestra como App interactiva dentro del chat. Solo lectura.",
      inputSchema: TOOL_INPUT_PANEL,
      annotations: READ_ONLY,
      _meta: { ui: { resourceUri: PANEL_APP_URI, visibility: ["model", "app"] } },
    },
    {
      name: "panel_snapshot",
      title: "Leer un panel",
      description: "El mismo contenido que dashboard_render, sin abrir la App: sirve para que el widget se refresque y para leer el panel desde el modelo.",
      inputSchema: TOOL_INPUT_PANEL,
      annotations: READ_ONLY,
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    {
      name: "panel_list",
      title: "Listar paneles",
      description: "Nombres, títulos y fuente de los paneles guardados de esta aplicación.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: READ_ONLY,
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    {
      name: "dataset_list",
      title: "Listar datasets",
      description: "Datasets re-ejecutables del proyecto, con su última corrida.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: READ_ONLY,
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    {
      name: "dataset_read",
      title: "Leer un dataset",
      description: "Snapshot más reciente de un dataset (recorte de 40 KB si es enorme).",
      inputSchema: TOOL_INPUT_DATASET,
      annotations: READ_ONLY,
      _meta: { ui: { visibility: ["model", "app"] } },
    },
  ];
}

function textResult(text: string, structuredContent?: Record<string, unknown>, isError = false, meta?: Record<string, unknown>) {
  return {
    content: [{ type: "text", text }],
    ...(structuredContent ? { structuredContent } : {}),
    ...(isError ? { isError: true } : {}),
    ...(meta ? { _meta: meta } : {}),
  };
}

async function callTool(config: Pick<ServerConfig, "configPath">, appId: string, directory: string, name: string, input: Record<string, unknown>) {
  if (name === "dashboard_render" || name === "panel_snapshot") {
    const panel = z.string().trim().min(1).max(64).safeParse(input.panel);
    if (!panel.success) return textResult("Falta el nombre del panel (campo panel).", undefined, true);
    const payload = await panelRenderPayload(config, appId, directory, panel.data);
    if (!payload.ok) return textResult(payload.error, payload as unknown as Record<string, unknown>, true);
    const summary = `Panel "${payload.title}" con ${payload.blocks.length} bloque${payload.blocks.length === 1 ? "" : "s"} (fuente ${payload.source}).`;
    if (name === "panel_snapshot") return textResult(summary, payload as unknown as Record<string, unknown>);
    // The launch reference is how a chat hosts the widget: Code Mode keeps only the structured
    // payload per inner call, so the App binding travels inside it (same shape cloud Apps use).
    const withLaunch = {
      ...payload,
      launch: { toolName: "dashboard_render", resourceUri: PANEL_APP_URI, arguments: { panel: panel.data } },
    };
    return textResult(summary, withLaunch as unknown as Record<string, unknown>, false, { ui: { resourceUri: PANEL_APP_URI } });
  }
  if (name === "panel_list") {
    const panels = await listPanels(config, appId);
    return textResult(panels.length ? `${panels.length} panel${panels.length === 1 ? "" : "es"} guardado${panels.length === 1 ? "" : "s"}.` : "Todavía no hay paneles en esta aplicación.", { panels });
  }
  if (name === "dataset_list") {
    const datasets = await listDatasets(directory);
    return textResult(datasets.length ? `${datasets.length} dataset${datasets.length === 1 ? "" : "s"}.` : "Todavía no hay datasets en este proyecto.", { datasets: datasets as unknown as Array<Record<string, unknown>> });
  }
  if (name === "dataset_read") {
    const id = z.string().trim().min(1).safeParse(input.id);
    if (!id.success) return textResult("Falta el id del dataset.", undefined, true);
    return textResult("Dataset leído.", await datasetPayload(directory, id.data) as unknown as Record<string, unknown>);
  }
  return textResult(`La herramienta "${name}" no existe en este servidor.`, undefined, true);
}

/** One MCP JSON-RPC message → one response (or null for notifications). Errors are readable and
 *  scoped: the host turns `isError` results into the card, never into a blank frame. */
export async function handlePanelMcpMessage(config: Pick<ServerConfig, "configPath">, appId: string, directory: string, message: unknown): Promise<Record<string, unknown> | null> {
  const parsed = z.object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.string(), z.number()]).optional(),
    method: z.string().min(1),
    params: z.unknown().optional(),
  }).safeParse(message);
  if (!parsed.success) {
    return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Mensaje JSON-RPC inválido." } };
  }
  const { method } = parsed.data;
  const id = parsed.data.id;
  const params = parsed.data.params !== null && typeof parsed.data.params === "object" ? parsed.data.params as Record<string, unknown> : {};
  const reply = (result: Record<string, unknown>) => id === undefined ? null : { jsonrpc: "2.0", id, result };
  if (method === "initialize") {
    return reply({
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
      serverInfo: { name: PANEL_MCP_SERVER_NAME, version: "1.0.0" },
      instructions: "Paneles declarativos del proyecto. Las herramientas son de solo lectura: para escribir un panel usá la biblioteca de la aplicación.",
    });
  }
  if (method === "ping") return reply({});
  if (method === "tools/list") return reply({ tools: toolDefinitions() });
  if (method === "tools/call") {
    const name = typeof params.name === "string" ? params.name : "";
    if (!name) return id === undefined ? null : { jsonrpc: "2.0", id, error: { code: -32602, message: "tools/call necesita el nombre de la herramienta." } };
    const input = params.arguments !== null && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? params.arguments as Record<string, unknown> : {};
    try {
      return reply(await callTool(config, appId, directory, name, input));
    } catch (error) {
      // A failed read is an answer the model can act on, not a transport failure.
      const detail = error instanceof ApiError ? error.message : "La herramienta no pudo completarse.";
      return reply(textResult(detail, undefined, true));
    }
  }
  if (method === "resources/list") {
    return reply({ resources: [{ uri: PANEL_APP_URI, name: "Panel interactivo", description: "Vista determinista de un panel declarativo (sin red, sin código de la IA).", mimeType: APP_MIME_TYPE }] });
  }
  if (method === "resources/read") {
    const uri = typeof params.uri === "string" ? params.uri : "";
    if (uri !== PANEL_APP_URI) return id === undefined ? null : { jsonrpc: "2.0", id, error: { code: -32602, message: "Ese recurso no existe en este servidor." } };
    return reply({
      contents: [{
        uri: PANEL_APP_URI,
        mimeType: APP_MIME_TYPE,
        text: panelAppHtml(),
        _meta: {
          ui: {
            prefersBorder: true,
            csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] },
          },
        },
      }],
    });
  }
  if (method.startsWith("notifications/")) return null;
  return id === undefined ? null : { jsonrpc: "2.0", id, error: { code: -32601, message: `Método no soportado: ${method}` } };
}

/** Deterministic widget: same bytes for every project and every call (the host caches by hash). */
export function panelAppHtml(): string {
  return WIDGET_HTML;
}

const WIDGET_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Panel</title><style>
:root{color-scheme:light dark}
html,body{margin:0;padding:0}
body{font:13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--color-text-primary,#1b1b1b);background:transparent}
#root{padding:6px 8px 10px;display:grid;gap:10px}
header{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
h1{font-size:14px;font-weight:600;margin:0}
.meta{font-size:11px;opacity:.72}
button{font:inherit;font-size:11px;padding:3px 9px;border-radius:6px;border:1px solid var(--color-border-primary,#d0d0d0);background:var(--color-background-secondary,#f4f4f4);color:inherit;cursor:pointer}
button[disabled]{opacity:.55;cursor:default}
.blocks{display:grid;gap:9px}
.stat{border-radius:8px;padding:7px 9px;background:var(--color-background-secondary,#f5f5f5)}
.stat-label{font-size:11px;opacity:.72}
.stat-value{font-size:19px;font-weight:600;margin-top:1px}
.chart-title,.table-title{font-size:12px;font-weight:600;margin:0 0 4px}
svg{display:block;width:100%;height:auto}
table{border-collapse:collapse;width:100%;font-size:12px;table-layout:auto}
th,td{border-bottom:1px solid var(--color-border-primary,#e4e4e4);padding:3px 6px;text-align:left;vertical-align:top}
th{font-weight:600;white-space:nowrap}
tbody tr{cursor:pointer}
tbody tr:hover{background:var(--color-background-secondary,#f7f7f7)}
.alert{border:1px solid var(--color-border-danger,#c33);color:var(--color-text-danger,#a11);border-radius:7px;padding:7px 9px;font-size:12px}
.empty{font-size:12px;opacity:.72}
.bar-row{display:grid;grid-template-columns:96px 1fr 52px;gap:6px;align-items:center;font-size:11px}
.bar-track{position:relative;height:9px;min-width:0;border-radius:3px;background:var(--color-background-tertiary,#e8e8e8)}
.bar-fill{position:absolute;inset:0 auto 0 0;height:9px;border-radius:3px;background:var(--color-text-info,#3b82f6);min-width:1px}
.bar-value{text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.muted{opacity:.72}
pre.detail{max-height:150px;overflow:auto;font-size:11px;margin:0;padding:6px;border-radius:6px;background:var(--color-background-secondary,#f5f5f5)}
</style></head><body>
<div id="root" role="region" aria-live="polite"><p class="empty">Esperando los datos del panel…</p></div>
<script>
(function(){
  "use strict";
  var state = { panel: null, payload: null };
  var seq = 0;
  var waiting = {};
  function post(message){ window.parent.postMessage(message, "*"); }
  function request(method, params){
    var id = ++seq;
    post({ jsonrpc: "2.0", id: id, method: method, params: params || {} });
    return new Promise(function(resolve, reject){ waiting[id] = { resolve: resolve, reject: reject }; });
  }
  function notify(method, params){ post({ jsonrpc: "2.0", method: method, params: params || {} }); }
  function el(tag, className, text){
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function resize(){
    var root = document.getElementById("root");
    if (!root) return;
    notify("ui/notifications/size-changed", { width: Math.ceil(window.innerWidth), height: Math.ceil(root.getBoundingClientRect().height + 16) });
  }
  function numberFormat(value, format){
    if (typeof value === "string") return value;
    if (value === null || typeof value !== "number" || !isFinite(value)) return "—";
    try {
      if (format === "percent") return (value * 100).toFixed(1).replace(".", ",") + " %";
      if (format === "currency") return new Intl.NumberFormat("es-AR", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
      return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(value);
    } catch (error) { return String(value); }
  }
  function when(at){
    if (typeof at !== "number") return "";
    try { return new Date(at).toLocaleString("es-AR"); } catch (error) { return ""; }
  }
  function renderError(message){
    var root = document.getElementById("root");
    root.textContent = "";
    root.appendChild(el("p", "alert", message || "El panel no se pudo dibujar."));
    resize();
  }
  function showNotice(message){
    var root = document.getElementById("root");
    var previous = document.getElementById("notice");
    if (previous) previous.remove();
    var notice = el("p", "alert", message || "El panel no se pudo actualizar.");
    notice.id = "notice";
    root.insertBefore(notice, root.firstChild);
    resize();
  }
  function render(payload){
    var root = document.getElementById("root");
    root.textContent = "";
    if (!payload || payload.ok !== true) {
      renderError((payload && payload.error) || "El panel no devolvió datos.");
      return;
    }
    var header = el("header");
    var titles = el("div");
    titles.appendChild(el("h1", null, payload.title));
    titles.appendChild(el("p", "meta", payload.source + (payload.refreshedAt ? " · " + when(payload.refreshedAt) : "")));
    header.appendChild(titles);
    var refresh = el("button", null, "Actualizar");
    refresh.type = "button";
    refresh.id = "refresh";
    refresh.addEventListener("click", function(){ refreshPanel(refresh); });
    header.appendChild(refresh);
    root.appendChild(header);
    var blocks = el("div", "blocks");
    (payload.blocks || []).forEach(function(block){ blocks.appendChild(renderBlock(block)); });
    root.appendChild(blocks);
    resize();
  }
  function refreshPanel(button){
    var panel = (state.payload && state.payload.panel) || state.panel;
    if (!panel) return;
    button.disabled = true;
    button.textContent = "Actualizando…";
    // A click means "ask again": the unique stamp keeps the host from answering with the result it
    // already read for this open (it keys that per-call), and the interaction flag marks the call
    // as the person's own. The tool ignores both; panel is the only input it reads.
    request("tools/call", {
      name: "dashboard_render",
      arguments: { panel: panel, refreshAt: Date.now() },
      _meta: { "openwork/userInteraction": true },
    })
      .then(function(result){
        if (result && result.isError) { showNotice(textOf(result) || "No se pudo refrescar el panel."); return; }
        applyResult(result);
      })
      .catch(function(error){ showNotice(error && error.message ? error.message : "No se pudo refrescar el panel."); })
      .finally(function(){ if (button.isConnected) { button.disabled = false; button.textContent = "Actualizar"; } });
  }
  function textOf(result){
    if (!result || !result.content) return "";
    return result.content.filter(function(part){ return part && part.type === "text"; }).map(function(part){ return part.text; }).join(" ");
  }
  function renderBlock(block){
    if (!block || typeof block !== "object") return el("p", "alert", "Bloque inválido.");
    if (block.type === "stat") {
      var stat = el("div", "stat");
      stat.appendChild(el("p", "stat-label", block.title));
      stat.appendChild(el("p", "stat-value", numberFormat(block.value, block.format)));
      return stat;
    }
    if (block.type === "markdown") {
      var text = el("p", "muted");
      text.style.whiteSpace = "pre-wrap";
      text.textContent = block.text;
      return text;
    }
    if (block.type === "changes") {
      var changes = el("div", "stat");
      changes.appendChild(el("p", "stat-label", block.title));
      changes.appendChild(el("p", null, block.summary));
      if (block.added || block.removed || block.changed) changes.appendChild(el("p", "meta", "+" + block.added + " · −" + block.removed + " · ~" + block.changed + (block.at ? " · " + when(block.at) : "")));
      return changes;
    }
    if (block.type === "table") return renderTable(block);
    if (block.type === "line" || block.type === "bar") return renderChart(block);
    return el("p", "alert", "Tipo de bloque desconocido: " + String(block.type));
  }
  function renderTable(block){
    var wrap = el("div");
    // The header row already names every column; a repeated "a · b · c" line adds nothing.
    if (!block.rows || !block.rows.length) { wrap.appendChild(el("p", "empty", "Sin filas para mostrar.")); return wrap; }
    var table = el("table");
    var head = el("thead");
    var headRow = el("tr");
    (block.columns || []).forEach(function(column){
      var th = el("th", null, column);
      th.scope = "col";
      headRow.appendChild(th);
    });
    head.appendChild(headRow);
    table.appendChild(head);
    var body = el("tbody");
    block.rows.forEach(function(row){
      var tr = el("tr");
      (block.columns || []).forEach(function(column){
        var value = row[column];
        tr.appendChild(el("td", null, value === null || value === undefined ? "" : String(value)));
      });
      tr.addEventListener("click", function(){
        var detail = wrap.querySelector("pre.detail");
        if (detail) { detail.remove(); return; }
        var pre = el("pre", "detail", JSON.stringify(row, null, 2));
        wrap.appendChild(pre);
        resize();
      });
      body.appendChild(tr);
    });
    table.appendChild(body);
    wrap.appendChild(table);
    if (block.total > block.rows.length) wrap.appendChild(el("p", "meta", "Mostrando " + block.rows.length + " de " + block.total + " filas."));
    return wrap;
  }
  function renderChart(block){
    var wrap = el("div");
    wrap.appendChild(el("p", "chart-title", block.title));
    var series = (block.series || []).filter(function(entry){ return entry.points && entry.points.length; });
    if (!series.length) {
      wrap.appendChild(el("p", "alert", "Este gráfico no tiene valores numéricos para dibujar (columna ausente o no numérica)."));
      return wrap;
    }
    var values = [];
    series.forEach(function(entry){ entry.points.forEach(function(point){ values.push(point.y); }); });
    if (block.type === "bar") {
      // Bars are magnitudes from zero: one zero baseline keeps widths comparable.
      var barSpan = (Math.max.apply(null, values.concat([0])) || 1) - Math.min.apply(null, values.concat([0])) || 1;
      series.forEach(function(entry){
        entry.points.slice(0, 20).forEach(function(point, index){
          var row = el("div", "bar-row");
          // The value column keeps the row from overflowing the card, so the bar width is a
          // percentage of its own track and every number stays readable.
          row.appendChild(el("span", "muted", (point.x || String(index + 1)) + (series.length > 1 ? " · " + entry.name : "")));
          var track = el("div", "bar-track");
          var fill = el("span", "bar-fill");
          fill.style.width = Math.max(1, Math.min(100, Math.abs(point.y) / barSpan * 100)) + "%";
          fill.title = entry.name + ": " + point.y;
          track.appendChild(fill);
          row.appendChild(track);
          row.appendChild(el("span", "bar-value meta", String(point.y)));
          wrap.appendChild(row);
        });
      });
      return wrap;
    }
    // A line shows shape, not magnitude: a zero-based scale flattens 486→491 into a straight line.
    var lineMin = Math.min.apply(null, values);
    var lineMax = Math.max.apply(null, values);
    var lineSpan = (lineMax - lineMin) || 1;
    // Draw in CSS pixels: a fixed-height chart that fills the card instead of a viewBox that
    // grows with the card width (a 670 px card used to turn 120 units into 250 px of chart).
    var width = Math.max(240, Math.round(window.innerWidth) - 24);
    var height = 150;
    var yFor = function(value){ return height - 20 - ((value - lineMin) / lineSpan) * (height - 28); };
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.style.height = height + "px";
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Gráfico de líneas: " + block.title);
    var axis = document.createElementNS(ns, "line");
    axis.setAttribute("x1", "0");
    axis.setAttribute("y1", String(height - 20));
    axis.setAttribute("x2", String(width));
    axis.setAttribute("y2", String(height - 20));
    axis.setAttribute("stroke", "currentColor");
    axis.setAttribute("stroke-opacity", "0.25");
    svg.appendChild(axis);
    if (lineMin < 0 && lineMax > 0) {
      var zero = document.createElementNS(ns, "line");
      zero.setAttribute("x1", "0");
      zero.setAttribute("x2", String(width));
      zero.setAttribute("y1", String(yFor(0)));
      zero.setAttribute("y2", String(yFor(0)));
      zero.setAttribute("stroke", "currentColor");
      zero.setAttribute("stroke-opacity", "0.35");
      zero.setAttribute("stroke-dasharray", "3 3");
      svg.appendChild(zero);
    }
    series.forEach(function(entry){
      var count = entry.points.length;
      var points = entry.points.map(function(point, index){
        var x = count === 1 ? width / 2 : index / (count - 1) * (width - 8) + 4;
        return x.toFixed(1) + "," + yFor(point.y).toFixed(1);
      }).join(" ");
      var line = document.createElementNS(ns, "polyline");
      line.setAttribute("points", points);
      line.setAttribute("fill", "none");
      line.setAttribute("stroke", "currentColor");
      line.setAttribute("stroke-width", "2");
      line.setAttribute("stroke-linejoin", "round");
      svg.appendChild(line);
      entry.points.forEach(function(point, index){
        var dot = document.createElementNS(ns, "circle");
        dot.setAttribute("cx", String(count === 1 ? width / 2 : index / (count - 1) * (width - 8) + 4));
        dot.setAttribute("cy", String(yFor(point.y)));
        dot.setAttribute("r", "2.5");
        dot.setAttribute("fill", "currentColor");
        var title = document.createElementNS(ns, "title");
        title.textContent = point.x + ": " + point.y;
        dot.appendChild(title);
        svg.appendChild(dot);
      });
    });
    wrap.appendChild(svg);
    wrap.appendChild(el("p", "meta", series.map(function(entry){ return entry.name; }).join(" · ") + (block.skipped ? " · " + block.skipped + " sin dato" : "")));
    return wrap;
  }
  function applyResult(result){
    if (!result) { renderError("El host no envió resultado."); return; }
    if (result.isError) { renderError(textOf(result) || "La herramienta devolvió un error."); return; }
    var payload = result.structuredContent;
    if (!payload || typeof payload !== "object") { renderError("El panel no recibió datos estructurados."); return; }
    state.payload = payload;
    render(payload);
  }
  window.addEventListener("message", function(event){
    var data = event.data;
    if (!data || typeof data !== "object" || data.jsonrpc !== "2.0") return;
    if (data.id !== undefined && waiting[data.id] && data.method === undefined) {
      var slot = waiting[data.id];
      delete waiting[data.id];
      if (data.error) slot.reject(new Error(data.error.message || "Error del host."));
      else slot.resolve(data.result);
      return;
    }
    if (data.id !== undefined && typeof data.method === "string") {
      if (data.method === "ui/resource-teardown") post({ jsonrpc: "2.0", id: data.id, result: {} });
      else post({ jsonrpc: "2.0", id: data.id, error: { code: -32601, message: "Método no soportado: " + data.method } });
      return;
    }
    if (data.method === "ui/notifications/tool-input") {
      var args = data.params && data.params.arguments;
      if (args && typeof args.panel === "string") state.panel = args.panel;
      return;
    }
    if (data.method === "ui/notifications/tool-result") { applyResult(data.params); return; }
  });
  function start(){
    request("ui/initialize", { protocolVersion: "${APP_PROTOCOL_VERSION}", appInfo: { name: "openwork-panels", version: "1.0.0" }, appCapabilities: {} })
      .then(function(){ notify("ui/notifications/initialized"); resize(); })
      .catch(function(error){ renderError(error && error.message ? error.message : "No se pudo inicializar la App."); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
  window.addEventListener("resize", resize);
})();
</script>
</body></html>`;

/** True when a URL points at this machine only — the panel server never rides a public interface. */
export function isLoopbackHostname(hostname: string): boolean {
  const value = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return value === "127.0.0.1" || value === "::1" || value === "localhost";
}

function routeToken(request: Request): string {
  const bearer = request.headers.get("authorization") ?? "";
  return bearer.startsWith("Bearer ") ? bearer.slice(7) : "";
}

/** Loopback MCP endpoint (Streamable HTTP, JSON responses). Same scoped token as the project's
 *  tool bridge: one credential per project, no new secret, no cloud round-trip. */
export function registerSpecialistMcpRoutes(options: {
  routes: Route[]; config: ServerConfig;
  readJsonBody: (request: Request) => Promise<Record<string, unknown>>;
  jsonResponse: (body: unknown, status?: number) => Response;
}) {
  const { routes, config, readJsonBody, jsonResponse } = options;
  addRoute(routes, "POST", PANEL_MCP_ROUTE, "none", async (ctx: RequestContext) => {
    if (!specialistApplicationsEnabled() || !specialistPanelAppsEnabled() || !specialistPanelsEnabled()) {
      throw new ApiError(404, "specialist_panel_apps_disabled", "Las Apps de paneles están desactivadas en este server.");
    }
    // Loopback only, twice: the URL host must be loopback AND the server must actually be bound
    // to a loopback interface. A server bound to 0.0.0.0 would let a remote client reach this
    // endpoint with a forged Host header, so the feature stays off there.
    const bound = config.host ?? "127.0.0.1";
    if (!isLoopbackHostname(bound)) {
      throw new ApiError(403, "specialist_panel_apps_loopback", "Este server no está atado a 127.0.0.1: las Apps de paneles quedan apagadas.");
    }
    if (!isLoopbackHostname(ctx.url.hostname)) {
      throw new ApiError(403, "specialist_panel_apps_loopback", "El servidor de paneles solo responde en 127.0.0.1.");
    }
    const token = routeToken(ctx.request);
    if (token.length < 16) throw new ApiError(401, "specialist_panel_apps_unauthorized", "Falta la credencial del proyecto.");
    const directory = await specialistTokenDirectory(config, token);
    if (!directory) throw new ApiError(401, "specialist_panel_apps_unauthorized", "La credencial no corresponde a ningún proyecto de este server.");
    const store = await specialistStore(config);
    const app = store.forWorkspace(workspaceIdForPath(directory));
    if (!app) throw new ApiError(409, "specialist_panel_apps_no_application", "Esa carpeta no pertenece a una aplicación especialista.");
    const body = await readJsonBody(ctx.request);
    const batch = Array.isArray(body) ? body as unknown[] : null;
    if (batch) {
      const answers: unknown[] = [];
      for (const message of batch) {
        const answer = await handlePanelMcpMessage(config, app.id, directory, message);
        if (answer) answers.push(answer);
      }
      return answers.length ? jsonResponse(answers) : new Response(null, { status: 202 });
    }
    const answer = await handlePanelMcpMessage(config, app.id, directory, body);
    return answer ? jsonResponse(answer) : new Response(null, { status: 202 });
  });
}

/** The descriptor token an App needs travels in the workspace's runtime MCP config, exactly like
 *  the tool bridge descriptor: same file permissions, same rotation when the folder changes. */
function entryFor(config: ServerConfig, descriptor: SpecialistToolDescriptor) {
  const url = new URL(descriptor.url);
  url.pathname = PANEL_MCP_ROUTE;
  url.search = "";
  url.hash = "";
  return {
    type: "remote",
    url: url.toString(),
    enabled: true,
    headers: { Authorization: `Bearer ${descriptor.token}` },
    oauth: false,
  };
}

function sameEntry(current: unknown, next: unknown): boolean {
  const fingerprint = (value: unknown) => {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    const record = value as Record<string, unknown>;
    const headers = record.headers !== null && typeof record.headers === "object" ? record.headers : {};
    return JSON.stringify({ type: record.type, url: record.url, enabled: record.enabled, oauth: record.oauth, headers: Object.fromEntries(Object.entries(headers as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) });
  };
  return fingerprint(current) === fingerprint(next);
}

async function writePanelAppEntry(config: ServerConfig, workspaceId: string, next: Record<string, unknown> | null) {
  const { config: written } = await writeRuntimeOpencodeConfig(config, workspaceId, (current) => {
    const mcp = { ...runtimeMcpMap(current) };
    if (next === null) delete mcp[PANEL_MCP_SERVER_NAME];
    else mcp[PANEL_MCP_SERVER_NAME] = next;
    return { ...current, mcp };
  });
  return written;
}

/** Idempotent: called next to the tool-bridge sync, so a project always advertises the same
 *  panel App (or none) that it advertises tools for. Turning the flag off removes the entry. */
export async function syncPanelAppMcpEntry(config: ServerConfig, workspaceId: string, directory: string): Promise<void> {
  if (config.readOnly || !specialistApplicationsEnabled() || !specialistPanelAppsEnabled() || !specialistPanelsEnabled()) {
    await writePanelAppEntry(config, workspaceId, null).catch(() => undefined);
    return;
  }
  const store = await specialistStore(config);
  const app = store.forWorkspace(workspaceId);
  const belongs = app !== null && store.projectsFor(app.id).some(project => project.workspaceId === workspaceId);
  const descriptor = belongs ? await readSpecialistToolDescriptor(config, directory).catch(() => null) : null;
  // A disabled descriptor (all-zero token) means the project lost its bridge: never project it.
  const usable = descriptor && descriptor.token !== "0".repeat(32) ? descriptor : null;
  if (!usable) {
    await writePanelAppEntry(config, workspaceId, null).catch(() => undefined);
    return;
  }
  const next = entryFor(config, usable);
  const written = await writePanelAppEntry(config, workspaceId, next);
  // Keeps the projection honest in diagnostics without writing twice.
  if (!sameEntry(runtimeMcpMap(written)[PANEL_MCP_SERVER_NAME], next)) throw new ApiError(500, "specialist_panel_apps_projection", "La conexión MCP del panel no quedó guardada como se esperaba.");
}

