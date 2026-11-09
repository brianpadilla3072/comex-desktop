/** @jsxImportSource react */
// Test de usuario REAL en UNA sesión continua (HIVE-FULLUI): mismo render, mismo diálogo, en
// orden: menú → home con las seis secciones → tareas (crear/pausar/correr/ensayar/historial) →
// datasets (vista previa, Actualizar 422, eliminar) → fuentes (registro local OK + 422, abrir) →
// paneles (bloques + error por proyecto) → salidas (auditoría en 3 estados, eliminar) →
// propuestas AL FINAL (el accept las retira del inbox; F-1: el resultado por pieza sobrevive
// aunque era la última). Harness idéntico a specialist-dryrun-ui.test.tsx: mock de
// openwork-connection, SpecialistApplicationsProvider + SpecialistApplicationSwitcher vía
// MemoryRouter, diálogo abierto desde el menú. Fetch mockeado con las formas JSON reales de
// apps/server/src/specialists/routes.ts ({ tasks } / POST { task, tasks, budget } / PUT
// { task, tasks, budget } / { started, detail, tasks } / { started, sessionId, workspaceId,
// detail, note } / { runs } / { datasets } / { dataset, snapshots, latest } / { source } 201 /
// 422 { code:"invalid_source", message } / { panels } / { spec, resolutions } / { outputs } /
// { output, content, truncated } / { audit } / { proposals } / { accepted, applied }).
// El estado del server emulado es mutable entre pasos (tasks/datasets/proposals/outputs/runs).
import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://localhost/" });
mock.module("../src/react-app/shell/openwork-connection", () => ({ resolveOpenworkConnection: async () => ({ normalizedBaseUrl: "http://localhost:8787", resolvedToken: "fixture-owner", resolvedHostToken: "fixture-host" }) }));
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { MemoryRouter } = await import("react-router");
const { SpecialistApplicationsProvider, SpecialistApplicationSwitcher } = await import("../src/react-app/domains/specialists/provider");

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let cache: InstanceType<typeof QueryClient>;
let restoreFetch: () => void;

type FakeTask = {
  id: string; name: string; prompt: string; schedule: Record<string, unknown>; enabled: boolean;
  createdAt: number; updatedAt: number; nextRunAt: number | null; lastRunAt: number | null;
  lastStatus: "ok" | "failed" | "blocked" | "running" | null; runs: number; running: null;
};
type FakeRun = { at: number; mode: string; missed: number; workspaceId: string; sessionId: string | null; status: string; detail: string | null };
type FakeDataset = {
  id: string; name: string; question: string; provider: string; operation: string;
  createdAt: number; updatedAt: number; lastSnapshotAt: number | null; snapshots: number;
  derivedFrom: string | null; workspaceId: string; workspaceName: string;
};
type FakeSource = { id: string; provider: string; title: string; url: string | null; evidencePath: string; datasetId: string | null; retrievedAt: number; chunks: number; workspaceId: string; workspaceName: string };
type FakePanel = { name: string; title: string; source: string; updatedAt: number; bytes: number };
type FakeOutput = { id: string; kind: string; title: string; fromDatasets: string[]; fromSources: string[]; focus: string; createdAt: number; updatedAt: number; workspaceId: string; workspaceName: string };
type FakeProposal = { id: string; kind: string; name: string; description: string; content: string; reason: string; createdAt: number };

let tasks: FakeTask[];
let runsByTask: Record<string, FakeRun[]>;
let datasets: FakeDataset[];
let sources: FakeSource[];
let panels: FakePanel[];
let outputs: FakeOutput[];
let proposals: FakeProposal[];
let refreshFailsWith: { status: number; code: string; message: string } | null = null;
let taskCalls: Array<{ method: string; path: string; body: unknown }> = [];
let runNowCalls: Array<{ method: string; path: string }> = [];
let dryCalls: Array<{ method: string; path: string }> = [];
let refreshCalls: Array<{ method: string; path: string }> = [];
let datasetDeleteCalls: Array<{ method: string; path: string }> = [];
let localCalls: Array<{ method: string; path: string; body: unknown }> = [];
let outputDeleteCalls: Array<{ method: string; path: string }> = [];
let acceptCalls: string[] = [];
let dismissCalls: string[] = [];

const APP = { id: "app_test", name: "Taller", specialty: "Prueba", personality: "Clara", template: "custom" as const, agentCount: 1, skillCount: 1, createdAt: 1, workspaceIds: ["ws_test", "ws_dos"] };
const catalog = () => ({
  enabled: true,
  libraryEnabled: true,
  scheduledTasksEnabled: true,
  taskDryRunEnabled: true,
  datasetsEnabled: true,
  sourcesEnabled: true,
  sourcesLocalFilesEnabled: true,
  panelsEnabled: true,
  outputsEnabled: true,
  integrationsEnabled: false,
  user: { id: "local", displayName: "Usuario de prueba" },
  activeApplicationId: APP.id,
  applications: [APP],
});
const libraryPayload = () => ({
  application: { id: APP.id, name: APP.name },
  agents: [{ path: "agents/revisor.md", name: "revisor", bytes: 120, updatedAt: 1, origin: "official", description: "Revisa los textos antes de publicar." }],
  skills: [{ path: "skills/informe/SKILL.md", name: "informe", bytes: 200, updatedAt: 1, origin: "custom", description: "Arma el informe mensual.", resources: 0 }],
  files: [],
  context: { exists: false, bytes: 0 },
  counts: { agents: 1, skills: 1 },
});
const CHUNKS = ["La exportación de soja creció un tres por ciento en el último trimestre.", "La Bolsa fijó el precio de referencia en 480 dólares la tonelada."];
const LOCAL_CHUNKS = ["El informe local dice que el flete subió dos puntos.", "El segundo pasaje local confirma la suba."];
const ROWS = [
  { fecha: "2026-11-07", cierre: 480, pais: "China" },
  { fecha: "2026-11-08", cierre: 486, pais: "Brasil" },
  { fecha: "2026-11-09", cierre: 491, pais: "China" },
];
const PANEL_SPEC = {
  panel: "soja", title: "Soja — cierre", source: { dataset: "search-precios-soja" }, refresh: { watch: "latest" },
  blocks: [
    { type: "stat", field: "cierre", agg: "last", title: "Último cierre" },
    { type: "line", x: "fecha", y: ["cierre"], title: "Precio" },
    { type: "table", limit: 20, sort: { by: "fecha", desc: true } },
    { type: "changes" },
    { type: "line", x: "fecha", y: ["pais"], title: "Países" },
  ],
};
const PANEL_DIFF = { at: 1_700_000_000_000, diff: { kind: "rows", added: 1, removed: 0, changed: 0, sample: [], summary: "+1 nuevo" } };
const OUTPUT_CONTENT: Record<string, string> = {
  out_good: "# Informe soja\n\nLa soja creció [fuente:src_soja_1a2b3c4d#1].",
  out_unanchored: "sin citas acá",
  out_rota: "# T\n\nLo inventé [fuente:src_rota#3].",
  out_borrable: "salida para borrar",
};
const planContent = JSON.stringify({
  skill: { name: "traer-aranceles", description: "Busca.", content: "# pasos" },
  dataset: { name: "aranceles", query: { provider: "tavily", operation: "search", input: { query: "arancel soja" } } },
  panel: { name: "aranceles-panel", spec: { title: "Aranceles", source: { dataset: "aranceles" }, blocks: [{ type: "table" }] } },
  task: { prompt: "Refrescá.", schedule: { kind: "interval", everyMinutes: 20 } },
});

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  if (!("ResizeObserver" in globalThis)) Reflect.set(globalThis, "ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  if (!("IntersectionObserver" in globalThis)) Reflect.set(globalThis, "IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } });
  tasks = [
    { id: "task_1", name: "actualizar precios", prompt: "Consultá las fuentes de costo de flete.", schedule: { kind: "interval", everyMinutes: 20 }, enabled: true, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000, nextRunAt: 1_700_000_900_000, lastRunAt: null, lastStatus: null, runs: 1, running: null },
  ];
  runsByTask = { task_1: [] };
  datasets = [
    { id: "ds-soja", name: "search-aranceles-soja-1a2b3c4d", question: "aranceles soja china", provider: "tavily", operation: "search", createdAt: 1_700_000_000_000, updatedAt: 1_700_000_500_000, lastSnapshotAt: 1_700_000_500_000, snapshots: 2, derivedFrom: null, workspaceId: "ws_test", workspaceName: "proyecto-principal" },
    { id: "ds-borrable", name: "search-precios-borrable-1111aaaa", question: "precios a borrar", provider: "tavily", operation: "search", createdAt: 1_700_000_000_000, updatedAt: 1_700_000_400_000, lastSnapshotAt: 1_700_000_400_000, snapshots: 1, derivedFrom: null, workspaceId: "ws_test", workspaceName: "proyecto-principal" },
  ];
  sources = [
    { id: "src_soja_1a2b3c4d", provider: "tavily", title: "aranceles soja china", url: "https://ejemplo.cl/soja", evidencePath: "comex/fuentes/tavily/a.json", datasetId: "ds-soja", retrievedAt: 1_700_000_500_000, chunks: 2, workspaceId: "ws_test", workspaceName: "proyecto-principal" },
  ];
  panels = [{ name: "soja", title: "Soja — cierre", source: "dataset:search-precios-soja", updatedAt: 1_700_000_500_000, bytes: 512 }];
  outputs = [
    { id: "out_good", kind: "report", title: "Informe soja", fromDatasets: [], fromSources: ["src_soja_1a2b3c4d"], focus: "", createdAt: 1_700_000_100_000, updatedAt: 1_700_000_500_000, workspaceId: "ws_test", workspaceName: "proyecto-principal" },
    { id: "out_unanchored", kind: "table", title: "Tabla de aranceles", fromDatasets: [], fromSources: [], focus: "", createdAt: 1_700_000_000_000, updatedAt: 1_700_000_400_000, workspaceId: "ws_test", workspaceName: "proyecto-principal" },
    { id: "out_rota", kind: "report", title: "Informe con cita rota", fromDatasets: [], fromSources: [], focus: "", createdAt: 1_700_000_000_000, updatedAt: 1_700_000_300_000, workspaceId: "ws_test", workspaceName: "proyecto-principal" },
    { id: "out_borrable", kind: "table", title: "Tabla borrable", fromDatasets: [], fromSources: [], focus: "", createdAt: 1_700_000_000_000, updatedAt: 1_700_000_200_000, workspaceId: "ws_test", workspaceName: "proyecto-principal" },
  ];
  proposals = [
    { id: "prop_plan", kind: "plan", name: "programa aranceles", description: "Varias piezas juntas.", content: planContent, reason: "Se repite.", createdAt: 1_700_000_100_000 },
    { id: "prop_dismiss", kind: "skill", name: "otra-skill", description: "Un procedimiento.", content: "# pasos", reason: "", createdAt: 1_700_000_200_000 },
  ];
  refreshFailsWith = null;
  taskCalls = []; runNowCalls = []; dryCalls = []; refreshCalls = []; datasetDeleteCalls = []; localCalls = []; outputDeleteCalls = []; acceptCalls = []; dismissCalls = [];
  const spy = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const body = ["POST", "PUT", "PATCH"].includes(method) ? await request.json().catch(() => null) : null;

    if (path === "/specialist-applications" && method === "GET") return Response.json(catalog());
    if (path === "/specialist-applications/app_test/library" && method === "GET") return Response.json(libraryPayload());
    if (path === "/specialist-applications/app_test/library/proposals" && method === "GET") return Response.json({ proposals });
    const accept = path.match(/^\/specialist-applications\/app_test\/library\/proposals\/([^/]+)\/accept$/);
    if (accept && method === "POST") {
      acceptCalls.push(accept[1]!);
      proposals = proposals.filter(p => p.id !== accept[1]);
      return Response.json({
        accepted: accept[1],
        applied: [
          { piece: "skill", ok: true },
          { piece: "dataset", ok: true },
          { piece: "panel", ok: false, detail: "La spec del panel no valida: faltan bloques." },
          { piece: "tarea", ok: true },
        ],
        catalog: catalog(),
      });
    }
    const dismiss = path.match(/^\/specialist-applications\/app_test\/library\/proposals\/([^/]+)$/);
    if (dismiss && method === "DELETE") {
      dismissCalls.push(dismiss[1]!);
      proposals = proposals.filter(p => p.id !== dismiss[1]);
      return Response.json({ dismissed: dismiss[1] });
    }
    if (path === "/specialist-applications/app_test/tasks" && method === "GET") return Response.json({ tasks: [...tasks] });
    if (path === "/specialist-applications/app_test/tasks" && method === "POST") {
      taskCalls.push({ method, path, body });
      const payload = body as { name: string; prompt: string; schedule: Record<string, unknown> };
      const task: FakeTask = {
        id: `task_${tasks.length + 1}`, name: payload.name, prompt: payload.prompt, schedule: payload.schedule,
        enabled: true, createdAt: 1_700_001_000_000, updatedAt: 1_700_001_000_000, nextRunAt: 1_700_001_500_000,
        lastRunAt: null, lastStatus: null, runs: 0, running: null,
      };
      tasks = [task, ...tasks];
      runsByTask[task.id] = [];
      return Response.json({ task, tasks: [...tasks], budget: null });
    }
    const taskById = path.match(/^\/specialist-applications\/app_test\/tasks\/([^/]+)$/);
    if (taskById && method === "PUT") {
      taskCalls.push({ method, path, body });
      tasks = tasks.map(t => t.id === taskById[1] ? { ...t, enabled: (body as Record<string, unknown>).enabled as boolean } : t);
      const task = tasks.find(t => t.id === taskById[1])!;
      return Response.json({ task, tasks: [...tasks], budget: null });
    }
    if (taskById && method === "DELETE") {
      taskCalls.push({ method, path, body });
      tasks = tasks.filter(t => t.id !== taskById[1]);
      return Response.json({ deleted: taskById[1], tasks: [...tasks] });
    }
    const runNow = path.match(/^\/specialist-applications\/app_test\/tasks\/([^/]+)\/run-now$/);
    if (runNow && method === "POST") {
      runNowCalls.push({ method, path });
      runsByTask[runNow[1]!] = [{ at: 1_700_001_200_000, mode: "manual", missed: 0, workspaceId: "ws_test", sessionId: "ses_new", status: "dispatched", detail: null }, ...(runsByTask[runNow[1]!] ?? [])];
      tasks = tasks.map(t => t.id === runNow[1] ? { ...t, runs: t.runs + 1 } : t);
      return Response.json({ started: true, detail: null, tasks: [...tasks] });
    }
    const dryRun = path.match(/^\/specialist-applications\/app_test\/tasks\/([^/]+)\/dry-run$/);
    if (dryRun && method === "POST") {
      dryCalls.push({ method, path });
      return Response.json({ started: true, sessionId: "ses_dry_1", workspaceId: "ws_test", detail: null, note: "Ensayo lanzado en una sesión aparte: nada se guardó ni se programó." });
    }
    const runsPath = path.match(/^\/specialist-applications\/app_test\/tasks\/([^/]+)\/runs$/);
    if (runsPath && method === "GET") return Response.json({ runs: [...(runsByTask[runsPath[1]!] ?? [])] });
    if (path === "/specialist-applications/app_test/datasets" && method === "GET") return Response.json({ datasets: [...datasets].sort((a, b) => b.updatedAt - a.updatedAt) });
    const refresh = path.match(/^\/specialist-applications\/app_test\/datasets\/([^/]+)\/refresh$/);
    if (refresh && method === "POST") {
      refreshCalls.push({ method, path });
      if (refreshFailsWith) return Response.json(refreshFailsWith, { status: refreshFailsWith.status });
      const target = datasets.find(entry => entry.id === refresh[1]);
      if (!target) return Response.json({ code: "dataset_not_found", message: "Ese dataset no existe." }, { status: 404 });
      datasets = datasets.map(entry => entry.id === target.id ? { ...entry, snapshots: entry.snapshots + 1, updatedAt: 1_700_001_900_000, lastSnapshotAt: 1_700_001_900_000 } : entry);
      return Response.json({ dataset: datasets.find(entry => entry.id === target.id) });
    }
    const datasetById = path.match(/^\/specialist-applications\/app_test\/datasets\/([^/]+)$/);
    if (datasetById && method === "DELETE") {
      datasetDeleteCalls.push({ method, path });
      datasets = datasets.filter(entry => entry.id !== datasetById[1]);
      return Response.json({ deleted: datasetById[1] });
    }
    if (datasetById && method === "GET") {
      const target = datasets.find(entry => entry.id === datasetById[1]);
      if (!target) return Response.json({ code: "dataset_not_found", message: "Ese dataset no existe." }, { status: 404 });
      if (target.lastSnapshotAt === null) return Response.json({ dataset: target, snapshots: [], latest: null });
      return Response.json({ dataset: target, snapshots: ["2026-11-09T10-00-00-000Z.json", "2026-11-08T10-00-00-000Z.json"].slice(0, target.snapshots), latest: { results: [{ pais: "China", arancel: "23%" }] } });
    }
    if (path === "/specialist-applications/app_test/sources" && method === "GET") return Response.json({ sources: [...sources].sort((a, b) => b.retrievedAt - a.retrievedAt) });
    if (path === "/specialist-applications/app_test/sources/local" && method === "POST") {
      localCalls.push({ method, path, body });
      const rawPath = typeof (body as Record<string, unknown> | null)?.path === "string" ? ((body as Record<string, unknown>).path as string).trim() : "";
      if (!rawPath) return Response.json({ code: "invalid_source", message: "Revisá la ruta del archivo local." }, { status: 422 });
      if (/\.pdf$/i.test(rawPath)) return Response.json({ code: "invalid_source", message: "El formato .pdf todavía no se puede indexar como fuente (PDF/XLSX pendientes de extractor)." }, { status: 422 });
      if (rawPath === "noexiste.md" || rawPath.includes("..")) return Response.json({ code: "invalid_source", message: "Ese archivo no existe en este proyecto." }, { status: 422 });
      const title = rawPath.split("/").pop() ?? rawPath;
      const source: FakeSource = { id: "src_local_9f8a7b6c", provider: "file", title, url: null, evidencePath: `comex/fuentes/local/1700001000000-${title}`, datasetId: null, retrievedAt: 1_700_001_000_000, chunks: 2, workspaceId: "ws_test", workspaceName: "proyecto-principal" };
      sources = [source, ...sources];
      return Response.json({ source: { ...source, workspaceName: "proyecto-principal" } }, { status: 201 });
    }
    const sourceById = path.match(/^\/specialist-applications\/app_test\/sources\/([^/]+)$/);
    if (sourceById && method === "GET") {
      const target = sources.find(entry => entry.id === sourceById[1]);
      if (!target) return Response.json({ code: "source_not_found", message: "Esa fuente no está registrada." }, { status: 404 });
      const chunks = target.id === "src_local_9f8a7b6c" ? LOCAL_CHUNKS : target.chunks ? CHUNKS : [];
      return Response.json({ ok: true, source: target, chunk: null, text: null, chunks, totalChunks: chunks.length, workspaceId: target.workspaceId, workspaceName: target.workspaceName });
    }
    if (path === "/specialist-applications/app_test/panels" && method === "GET") return Response.json({ panels });
    if (path === "/specialist-applications/app_test/panels/soja/resolve" && method === "GET") {
      return Response.json({
        spec: PANEL_SPEC,
        resolutions: [
          { workspaceId: "ws_test", workspaceName: "proyecto-principal", ok: true, data: ROWS, sourceLabel: "dataset:ds-soja", diff: PANEL_DIFF },
          { workspaceId: "ws_dos", workspaceName: "proyecto-anexo", ok: false, error: 'El dataset "search-precios-soja" no existe en este proyecto.' },
        ],
      });
    }
    if (path === "/specialist-applications/app_test/outputs" && method === "GET") return Response.json({ outputs: [...outputs].sort((a, b) => b.updatedAt - a.updatedAt) });
    const audit = path.match(/^\/specialist-applications\/app_test\/outputs\/([^/]+)\/audit$/);
    if (audit && method === "GET") {
      if (audit[1] === "out_good") return Response.json({ audit: { total: 1, valid: 1, invalid: [] } });
      if (audit[1] === "out_unanchored") return Response.json({ audit: { total: 0, valid: 0, invalid: [], note: "sin anclas" } });
      if (audit[1] === "out_borrable") return Response.json({ audit: { total: 0, valid: 0, invalid: [], note: "sin anclas" } });
      return Response.json({ audit: { total: 1, valid: 0, invalid: [{ sourceId: "src_rota", chunk: 3, reason: "La fuente src_rota tiene 0 pasajes; el ancla #3 no existe." }] } });
    }
    const outputById = path.match(/^\/specialist-applications\/app_test\/outputs\/([^/]+)$/);
    if (outputById && method === "DELETE") {
      outputDeleteCalls.push({ method, path });
      outputs = outputs.filter(entry => entry.id !== outputById[1]);
      return Response.json({ deleted: outputById[1] });
    }
    if (outputById && method === "GET") {
      const target = outputs.find(entry => entry.id === outputById[1]);
      if (!target) return Response.json({ code: "output_not_found", message: "Esa salida no existe." }, { status: 404 });
      return Response.json({ output: target, content: OUTPUT_CONTENT[target.id] ?? "", truncated: false });
    }
    return Response.json({ code: "not_found", message: `Ruta no emulada: ${method} ${path}` }, { status: 404 });
  });
  restoreFetch = () => spy.mockRestore();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(async () => { await act(async () => root.unmount()); cache.clear(); host.remove(); restoreFetch(); });
afterAll(async () => { await GlobalRegistrator.unregister(); });

async function flush(ms = 60) { await act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); }); }
function hasText(text: string): boolean { return (document.body.textContent ?? "").includes(text); }
async function renderAt() {
  await act(async () => root.render(
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={["/workspace/ws_test/session"]}>
        <SpecialistApplicationsProvider>
          <SpecialistApplicationSwitcher fallbackName="OpenWork" />
        </SpecialistApplicationsProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  ));
  await flush();
}
async function openLibraryDialog() {
  const trigger = document.querySelector('[aria-label="Cambiar aplicación especialista"]');
  if (!trigger) throw new Error("Missing switcher");
  await act(async () => { trigger.click(); });
  await flush();
  const item = [...document.querySelectorAll('button, [role="menuitem"]')].find(el => (el.textContent ?? "").includes("Contexto, agentes y skills"));
  if (!item) throw new Error("Missing menu item");
  await act(async () => { item.click(); });
  await flush();
}
async function openSection(start: string) {
  const sections = [...document.querySelectorAll("section")];
  const section = sections.find(s => (s.textContent ?? "").startsWith(start));
  if (!section) throw new Error(`Missing section "${start}"; doc: ${document.body.textContent?.slice(0, 1200)}`);
  await act(async () => { [...section.querySelectorAll("button")].find(b => (b.textContent ?? "").includes("Gestionar"))!.click(); });
  await flush();
}
async function backHome() {
  const btn = [...document.querySelectorAll("button")].find(b => (b.textContent ?? "").trim() === "Volver");
  if (!btn) throw new Error(`Missing Volver; doc: ${document.body.textContent?.slice(0, 800)}`);
  await act(async () => { btn.click(); });
  await flush();
}
function rowFor(name: string): HTMLElement {
  const row = [...document.querySelectorAll("div.rounded-md")].find(el => (el.textContent ?? "").includes(name));
  if (!row) throw new Error(`Missing row for "${name}"; doc: ${document.body.textContent?.slice(0, 1000)}`);
  return row as HTMLElement;
}
function buttonIn(el: ParentNode, text: string): HTMLElement {
  const btn = [...el.querySelectorAll("button")].find(b => (b.textContent ?? "").includes(text));
  if (!btn) throw new Error(`Missing button "${text}" in: ${(el as HTMLElement).textContent?.slice(0, 400)}`);
  return btn as HTMLElement;
}
function rowForButton(name: string, btnText: string): HTMLElement {
  const row = [...document.querySelectorAll("div.rounded-md")].find(el => (el.textContent ?? "").includes(name) && [...el.querySelectorAll("button")].some(b => (b.textContent ?? "").includes(btnText)));
  if (!row) throw new Error(`Missing row for "${name}" with button "${btnText}"; doc: ${document.body.textContent?.slice(0, 1000)}`);
  return row as HTMLElement;
}
async function clickIn(el: ParentNode, text: string) {
  await act(async () => { buttonIn(el, text).click(); });
  await flush(80);
}
async function edit(id: string, value: string) {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) throw new Error(`Missing field ${id}; doc: ${document.body.textContent?.slice(0, 800)}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush(80);
}

// ── Sesión completa: 1 render, 7 pasos en orden ──
test("sesión completa end-to-end: home, tareas (escribir), datasets (escribir), fuentes (escribir), paneles, salidas (escribir), propuestas al final", async () => {
  await renderAt();
  await openLibraryDialog();

  // ── Paso 1: menú → título con las seis secciones + resúmenes con contenido real ──
  expect(hasText("Contexto, agentes y skills · Tareas · Datos · Fuentes · Paneles · Salidas de Taller")).toBe(true);
  expect(hasText("actualizar precios")).toBe(true); // fila tareas
  expect(hasText("search-aranceles-soja-1a2b3c4d")).toBe(true); // fila datasets
  expect(hasText("Soja — cierre")).toBe(true); // fila paneles
  expect(hasText("aranceles soja china")).toBe(true); // fila fuentes
  expect(hasText("Informe soja")).toBe(true); // fila salidas
  expect(hasText("Agentes (1)")).toBe(true);
  expect(hasText("Skills (1)")).toBe(true);
  expect(hasText("Propuestas pendientes (2)")).toBe(true);

  // ── Paso 2: TAREAS — crear (POST), presupuesto vivo, pausar, correr, ensayar, historial ──
  await openSection("Tareas programadas");
  expect(hasText("Tareas programadas de Taller")).toBe(true);
  await clickIn(document, "Nueva tarea");
  await edit("task-name", "vigilar aranceles");
  await edit("task-prompt", "Consultá las fuentes de costo de flete y actualizá la planilla del proyecto.");
  // F4: con intervalo 20 min la línea de costo aparece en vivo antes de crear.
  expect(hasText("Costo estimado:")).toBe(true);
  expect(hasText("72 corridas/día")).toBe(true);
  await clickIn(document, "Crear tarea");
  await flush(120);
  const createCall = taskCalls.find(entry => entry.method === "POST");
  expect(createCall).toBeDefined();
  expect(createCall!.body).toEqual({ name: "vigilar aranceles", prompt: "Consultá las fuentes de costo de flete y actualizá la planilla del proyecto.", schedule: { kind: "interval", everyMinutes: 20 } });
  expect(hasText("Tarea creada y activada.")).toBe(true);
  const newRow = rowFor("vigilar aranceles");
  expect(newRow.textContent).toContain("Cada 20 min");
  // Pausar: PUT { enabled:false } → badge "Pausada".
  await clickIn(newRow, "Pausar");
  await flush(120);
  const pauseCall = taskCalls.find(entry => entry.method === "PUT");
  expect(pauseCall?.body).toEqual({ enabled: false });
  expect(rowFor("vigilar aranceles").textContent).toContain("Pausada");
  expect(rowFor("vigilar aranceles").textContent).toContain("Reanudar");
  // Correr ahora sobre la pausada: el scheduler manual la dispara igual (trigger no chequea
  // enabled, solo "scheduled"), el notice lo dice.
  await clickIn(rowFor("vigilar aranceles"), "Correr ahora");
  await flush(120);
  expect(runNowCalls.length).toBe(1);
  expect(runNowCalls[0]!.path).toContain("/tasks/task_2/run-now");
  expect(hasText("Corrida iniciada: mirá el chat nuevo de la tarea.")).toBe(true);
  // Ensayar: POST dry-run + notice que no guardó nada.
  await clickIn(rowFor("vigilar aranceles"), "Ensayar");
  await flush(120);
  expect(dryCalls.length).toBe(1);
  expect(dryCalls[0]!.path).toContain("/tasks/task_2/dry-run");
  expect(hasText("Ensayo lanzado: corre en una sesión aparte y no guarda nada.")).toBe(true);
  // Historial: muestra la corrida manual recién creada con badge "corriendo" + "a pedido".
  await clickIn(rowFor("vigilar aranceles"), "Corridas");
  await flush(80);
  expect(hasText("a pedido")).toBe(true);
  expect(hasText("corriendo")).toBe(true);
  await backHome();

  // ── Paso 3: DATASETS — preview, Actualizar 422 visible, eliminar con confirm ──
  await openSection("Datos de investigación");
  expect(hasText("Datasets de investigación de Taller")).toBe(true);
  // Vista previa: expande el dataset con snapshots y ve su último snapshot.
  const dsRow = rowFor("search-aranceles-soja-1a2b3c4d");
  const expandBtn = [...dsRow.querySelectorAll("button")].find(b => (b.getAttribute("aria-label") ?? "").includes("Ver snapshots"));
  expect(expandBtn).toBeTruthy();
  await act(async () => { expandBtn!.click(); });
  await flush(80);
  expect(hasText("2 snapshots en el proyecto")).toBe(true);
  expect(hasText("China")).toBe(true); // el preview muestra el JSON del snapshot
  // Actualizar que falla con 422: mensaje accionable visible, sin notice de éxito.
  refreshFailsWith = { status: 422, code: "invalid_dataset", message: "Conectá Tavily desde Herramientas y fuentes para investigar." };
  await clickIn(rowFor("search-aranceles-soja-1a2b3c4d"), "Actualizar");
  await flush(80);
  expect(refreshCalls.length).toBe(1);
  const alertText = [...document.querySelectorAll('[role="alert"]')].map(el => el.textContent ?? "").join(" | ");
  expect(alertText).toContain("Conectá Tavily desde Herramientas y fuentes para investigar.");
  expect(hasText("Consulta re-ejecutada")).toBe(false);
  // Eliminar con confirmación: la fila desaparece y hay notice.
  const delBtn = [...rowFor("search-precios-borrable-1111aaaa").querySelectorAll("button")].find(b => (b.getAttribute("aria-label") ?? "") === "Eliminar search-precios-borrable-1111aaaa");
  expect(delBtn).toBeTruthy();
  await act(async () => { delBtn!.click(); });
  await flush(60);
  const dialog = document.querySelector('[role="alertdialog"]');
  expect(dialog).not.toBeNull();
  const confirmBtn = [...(dialog as HTMLElement).querySelectorAll("button")].find(b => (b.textContent ?? "").trim() === "Eliminar");
  expect(confirmBtn).toBeTruthy();
  await act(async () => { confirmBtn!.click(); });
  await flush(120);
  expect(datasetDeleteCalls.length).toBe(1);
  // La fila desapareció: ningún div.rounded-md la contiene (el notice "Se eliminó X." sí
  // nombra el dataset, por eso no alcanza hasText).
  expect([...document.querySelectorAll("div.rounded-md")].some(el => (el.textContent ?? "").includes("search-precios-borrable-1111aaaa"))).toBe(false);
  expect(hasText("Se eliminó search-precios-borrable-1111aaaa.")).toBe(true);
  await backHome();

  // ── Paso 4: SOURCES — registrar archivo OK con id nuevo, abrir y ver anclas; 422 visible ──
  await openSection("Fuentes citables");
  expect(hasText("Fuentes citables de Taller")).toBe(true);
  expect(hasText("Archivo local")).toBe(true);
  await clickIn(document, "Registrar archivo");
  expect(document.getElementById("source-local-path")).not.toBeNull();
  await edit("source-local-path", "datos/informe.md");
  await clickIn(document, "Registrar como fuente");
  await flush(120);
  expect(localCalls.length).toBe(1);
  expect(localCalls[0]!.path).toBe("/specialist-applications/app_test/sources/local");
  expect((localCalls[0]!.body as Record<string, unknown>).path).toBe("datos/informe.md");
  expect(hasText("Fuente registrada: informe.md")).toBe(true);
  expect(hasText("[fuente:src_local_9f8a7b6c#n]")).toBe(true);
  expect(hasText("informe.md")).toBe(true);
  // Abrir la fuente recién registrada: las anclas renderizan con el texto del pasaje.
  await clickIn(rowForButton("informe.md", "Ver pasajes"), "Ver pasajes");
  await flush(80);
  expect(hasText("[fuente:src_local_9f8a7b6c#0]")).toBe(true);
  expect(hasText("[fuente:src_local_9f8a7b6c#1]")).toBe(true);
  expect(hasText("El informe local dice que el flete subió dos puntos.")).toBe(true);
  // 422 por formato: reabre el form, el error se ve en alert y el form queda abierto.
  await clickIn(document, "Registrar archivo");
  await edit("source-local-path", "datos/roto.pdf");
  await clickIn(document, "Registrar como fuente");
  await flush(120);
  expect(localCalls.length).toBe(2);
  const sourceAlert = document.querySelector('[role="alert"]')?.textContent ?? "";
  expect(sourceAlert).toContain("El formato .pdf todavía no se puede indexar como fuente");
  expect(document.getElementById("source-local-path")).not.toBeNull();
  expect(hasText("Fuente registrada:")).toBe(false);
  await backHome();

  // ── Paso 5: PANELS — bloques stat/línea/tabla/cambios + error ruidoso del 2º proyecto ──
  await openSection("Paneles");
  expect(hasText("Paneles de Taller")).toBe(true);
  await clickIn(rowFor("Soja — cierre"), "Ver");
  await flush(80);
  expect(hasText("491")).toBe(true); // stat last(cierre)
  expect(document.querySelector("svg polyline")).not.toBeNull();
  expect(document.querySelector("tbody tr")?.textContent).toContain("2026-11-09");
  expect(hasText("Cambios desde la última corrida")).toBe(true);
  expect(hasText("+1 nuevo")).toBe(true);
  expect(hasText("proyecto-anexo")).toBe(true);
  expect(hasText('El dataset "search-precios-soja" no existe en este proyecto.')).toBe(true);
  expect(document.querySelector('[role="alert"]')).not.toBeNull();
  expect(hasText("Este gráfico no tiene valores numéricos para dibujar")).toBe(true);
  await backHome();

  // ── Paso 6: OUTPUTS — contenido + auditoría en 3 estados distintos, eliminar ──
  await openSection("Salidas del mini-Studio");
  expect(hasText("Salidas del mini-Studio de Taller")).toBe(true);
  const verOutput = async (title: string) => {
    await clickIn(rowFor(title), "Ver");
    await flush(80);
  };
  await verOutput("Informe soja");
  expect(hasText("La soja creció [fuente:src_soja_1a2b3c4d#1].")).toBe(true);
  expect(hasText("✓ 1/1 citas resuelven a pasajes reales del proyecto.")).toBe(true);
  await clickIn(rowFor("Informe soja"), "Ocultar");
  await flush(60);
  await verOutput("Tabla de aranceles");
  expect(hasText("Sin anclas: esta salida no está anclada a fuentes del proyecto.")).toBe(true);
  await clickIn(rowFor("Tabla de aranceles"), "Ocultar");
  await flush(60);
  await verOutput("Informe con cita rota");
  expect(hasText("1 cita no resuelve")).toBe(true);
  expect(hasText("[fuente:src_rota#3]")).toBe(true);
  await clickIn(rowFor("Informe con cita rota"), "Ocultar");
  await flush(60);
  // U-1 corregida: eliminar una salida pide confirmación inline antes de borrar.
  const outDel = [...rowFor("Tabla borrable").querySelectorAll("button")].find(b => (b.getAttribute("aria-label") ?? "") === "Eliminar salida Tabla borrable");
  expect(outDel).toBeTruthy();
  await act(async () => { outDel!.click(); });
  await flush(60);
  expect(hasText('¿Eliminar la salida "Tabla borrable"?')).toBe(true);
  expect(outputDeleteCalls.length).toBe(0); // Cancelar/espera no borra
  const confirmOut = [...document.querySelectorAll("button")].find(b => (b.textContent ?? "").trim() === "Eliminar");
  await act(async () => { confirmOut!.click(); });
  await flush(120);
  expect(outputDeleteCalls.length).toBe(1);
  expect(hasText("Tabla borrable")).toBe(false);
  await backHome();

  // ── Paso 7 (ÚLTIMO, el accept retira): propuestas — descartar una, aceptar el plan como última ──
  // El plan muestra badge + resumen de piezas.
  const planCard = rowFor("programa aranceles");
  expect(planCard.textContent).toContain("Plan");
  expect(planCard.textContent).toContain("skill + dataset + panel + tarea pausada");
  // Primero descarta la otra propuesta: su card desaparece (para que el accept de abajo sea el
  // de la ÚLTIMA propuesta y sirva de guarda de regresión F-1).
  await clickIn(rowFor("otra-skill"), "Descartar");
  await flush(120);
  expect(dismissCalls).toEqual(["prop_dismiss"]);
  expect(hasText("otra-skill")).toBe(false);
  // Acepta el plan siendo la última: el resultado por pieza —incluida la fallida con detalle—
  // sigue visible (F-1 corregida: library-dialog.tsx ProposalsSection).
  await clickIn(rowFor("programa aranceles"), "Aceptar");
  await flush(150);
  expect(acceptCalls).toEqual(["prop_plan"]);
  expect(hasText("Resultado de la propuesta aceptada")).toBe(true);
  expect(hasText("✓ skill")).toBe(true);
  expect(hasText("✓ dataset")).toBe(true);
  expect(hasText("✗ panel — La spec del panel no valida: faltan bloques.")).toBe(true);
  expect(hasText("✓ tarea")).toBe(true);
  // El inbox quedó vacío pero el resultado no se traga.
  expect(hasText("Propuestas pendientes")).toBe(false);
  expect(hasText("programa aranceles")).toBe(false);
}, 60000);
