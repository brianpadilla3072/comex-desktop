/** @jsxImportSource react */
// Test de usuario REAL del recorrido completo live-dashboards (celda C, HIVE-C-TEST).
// Un solo flujo de punta a punta abriendo el diálogo con TODAS las flags encendidas
// (biblioteca, tareas, datasets, fuentes, paneles, salidas) y verificando honestidad
// en cada paso: título y resúmenes que no mienten, propuestas con resultado por pieza,
// run-now que refresca el historial, errores legibles ante 500 (nunca el copy de
// "sin datos todavía"), lector de pasajes con anclas, bloques de panel que se
// dibujan o dicen por qué no, y auditoría de salidas con tres estados distintos.
// Fetch mockeado con las formas JSON reales de apps/server/src/specialists/routes.ts
// ({ proposals }, { accepted, applied }, { tasks }, { started, detail, tasks }, { runs },
// { datasets }, { dataset, snapshots, latest }, { sources }, { ok, source, chunks, … },
// { panels }, { spec, resolutions }, { outputs }, { output, content, truncated }, { audit }).
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

let proposals: FakeProposal[];
let tasks: FakeTask[];
let runs: FakeRun[];
let datasets: FakeDataset[];
let sources: FakeSource[];
let panels: FakePanel[];
let outputs: FakeOutput[];
// Inyección de 500 por familia, para el test de honestidad (paso 8): si está en true,
// esa lista responde 500 como el server real ante un error interno.
let failList: Record<string, boolean>;
let refreshFailsWith: { status: number; code: string; message: string } | null = null;
let allRequests: Array<{ method: string; path: string; search: string }> = [];

const APP = { id: "app_test", name: "Taller", specialty: "Prueba", personality: "Clara", template: "custom" as const, agentCount: 1, skillCount: 1, createdAt: 1, workspaceIds: ["ws_test", "ws_dos"] };
const catalog = () => ({
  enabled: true,
  libraryEnabled: true,
  scheduledTasksEnabled: true,
  datasetsEnabled: true,
  sourcesEnabled: true,
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
  proposals = [
    { id: "prop_task", kind: "task", name: "refrescar aranceles", description: "Cada 20 minutos traer los aranceles.", content: JSON.stringify({ prompt: "Consultá.", schedule: { kind: "interval", everyMinutes: 20 } }), reason: "Se repite.", createdAt: 1_700_000_000_000 },
    { id: "prop_plan", kind: "plan", name: "programa aranceles", description: "Varias piezas juntas.", content: planContent, reason: "Se repite.", createdAt: 1_700_000_100_000 },
  ];
  tasks = [
    { id: "task_1", name: "actualizar precios", prompt: "Consultá las fuentes de costo de flete.", schedule: { kind: "interval", everyMinutes: 20 }, enabled: true, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000, nextRunAt: 1_700_000_900_000, lastRunAt: null, lastStatus: null, runs: 1, running: null },
  ];
  runs = [];
  datasets = [
    { id: "ds-soja", name: "search-aranceles-soja-1a2b3c4d", question: "aranceles soja china", provider: "tavily", operation: "search", createdAt: 1_700_000_000_000, updatedAt: 1_700_000_500_000, lastSnapshotAt: 1_700_000_500_000, snapshots: 2, derivedFrom: null, workspaceId: "ws_test", workspaceName: "proyecto-principal" },
    // Query-only: registrada desde una propuesta, todavía sin ningún snapshot (lastSnapshotAt null).
    { id: "ds-nueva", name: "search-aranceles-nueva-5e6f7a8b", question: "aranceles nueva consulta", provider: "tavily", operation: "search", createdAt: 1_700_000_600_000, updatedAt: 1_700_000_600_000, lastSnapshotAt: null, snapshots: 0, derivedFrom: null, workspaceId: "ws_test", workspaceName: "proyecto-principal" },
  ];
  sources = [
    { id: "src_soja_1a2b3c4d", provider: "tavily", title: "aranceles soja china", url: "https://ejemplo.cl/soja", evidencePath: "comex/fuentes/tavily/a.json", datasetId: "ds-soja", retrievedAt: 1_700_000_500_000, chunks: 2, workspaceId: "ws_test", workspaceName: "proyecto-principal" },
    { id: "src_aduana_5e6f7a8b", provider: "tavily", title: "aduana argentina", url: null, evidencePath: "comex/fuentes/tavily/b.json", datasetId: null, retrievedAt: 1_700_000_400_000, chunks: 0, workspaceId: "ws_dos", workspaceName: "proyecto-anexo" },
  ];
  panels = [{ name: "soja", title: "Soja — cierre", source: "dataset:search-precios-soja", updatedAt: 1_700_000_500_000, bytes: 512 }];
  outputs = [
    { id: "out_good", kind: "report", title: "Informe soja", fromDatasets: [], fromSources: ["src_soja_1a2b3c4d"], focus: "", createdAt: 1_700_000_100_000, updatedAt: 1_700_000_500_000, workspaceId: "ws_test", workspaceName: "proyecto-principal" },
    { id: "out_unanchored", kind: "table", title: "Tabla de aranceles", fromDatasets: [], fromSources: [], focus: "", createdAt: 1_700_000_000_000, updatedAt: 1_700_000_400_000, workspaceId: "ws_test", workspaceName: "proyecto-principal" },
    { id: "out_rota", kind: "report", title: "Informe con cita rota", fromDatasets: [], fromSources: [], focus: "", createdAt: 1_700_000_000_000, updatedAt: 1_700_000_300_000, workspaceId: "ws_test", workspaceName: "proyecto-principal" },
  ];
  failList = { proposals: false, tasks: false, datasets: false, sources: false, panels: false, outputs: false, library: false };
  refreshFailsWith = null;
  allRequests = [];
  const fail500 = () => Response.json({ code: "internal_error", message: "Unexpected server error" }, { status: 500 });
  const spy = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    allRequests.push({ method, path, search: url.search });

    if (path === "/specialist-applications" && method === "GET") return Response.json(catalog());
    if (path === "/specialist-applications/app_test/library" && method === "GET") {
      if (failList.library) return fail500();
      return Response.json(libraryPayload());
    }
    if (path === "/specialist-applications/app_test/library/proposals" && method === "GET") {
      if (failList.proposals) return fail500();
      return Response.json({ proposals });
    }
    const accept = path.match(/^\/specialist-applications\/app_test\/library\/proposals\/([^/]+)\/accept$/);
    if (accept && method === "POST") {
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
      proposals = proposals.filter(p => p.id !== dismiss[1]);
      return Response.json({ dismissed: dismiss[1] });
    }
    if (path === "/specialist-applications/app_test/tasks" && method === "GET") {
      if (failList.tasks) return fail500();
      return Response.json({ tasks: [...tasks] });
    }
    const runNow = path.match(/^\/specialist-applications\/app_test\/tasks\/([^/]+)\/run-now$/);
    if (runNow && method === "POST") {
      runs = [{ at: 1_700_000_200_000, mode: "manual", missed: 0, workspaceId: "ws_test", sessionId: "ses_new", status: "dispatched", detail: null }, ...runs];
      tasks = tasks.map(t => t.id === runNow[1] ? { ...t, runs: t.runs + 1 } : t);
      return Response.json({ started: true, detail: null, tasks: [...tasks] });
    }
    const runsPath = path.match(/^\/specialist-applications\/app_test\/tasks\/([^/]+)\/runs$/);
    if (runsPath && method === "GET") return Response.json({ runs: [...runs] });
    if (path === "/specialist-applications/app_test/datasets" && method === "GET") {
      if (failList.datasets) return fail500();
      return Response.json({ datasets: [...datasets].sort((a, b) => b.updatedAt - a.updatedAt) });
    }
    const refresh = path.match(/^\/specialist-applications\/app_test\/datasets\/([^/]+)\/refresh$/);
    if (refresh && method === "POST") {
      if (refreshFailsWith) return Response.json(refreshFailsWith, { status: refreshFailsWith.status });
      const target = datasets.find(entry => entry.id === refresh[1]);
      if (!target) return Response.json({ code: "dataset_not_found", message: "Ese dataset no existe." }, { status: 404 });
      datasets = datasets.map(entry => entry.id === target.id ? { ...entry, snapshots: entry.snapshots + 1, updatedAt: 1_700_000_900_000, lastSnapshotAt: 1_700_000_900_000 } : entry);
      return Response.json({ dataset: datasets.find(entry => entry.id === target.id) });
    }
    const datasetById = path.match(/^\/specialist-applications\/app_test\/datasets\/([^/]+)$/);
    if (datasetById && method === "GET") {
      const target = datasets.find(entry => entry.id === datasetById[1]);
      if (!target) return Response.json({ code: "dataset_not_found", message: "Ese dataset no existe." }, { status: 404 });
      if (target.lastSnapshotAt === null) return Response.json({ dataset: target, snapshots: [], latest: null });
      return Response.json({ dataset: target, snapshots: ["2026-11-09T10-00-00-000Z.json", "2026-11-08T10-00-00-000Z.json"].slice(0, target.snapshots), latest: { results: [{ pais: "China", arancel: "23%" }] } });
    }
    if (path === "/specialist-applications/app_test/sources" && method === "GET") {
      if (failList.sources) return fail500();
      return Response.json({ sources: [...sources].sort((a, b) => b.retrievedAt - a.retrievedAt) });
    }
    const sourceById = path.match(/^\/specialist-applications\/app_test\/sources\/([^/]+)$/);
    if (sourceById && method === "GET") {
      const target = sources.find(entry => entry.id === sourceById[1]);
      if (!target) return Response.json({ code: "source_not_found", message: "Esa fuente no está registrada." }, { status: 404 });
      return Response.json({ ok: true, source: target, chunk: null, text: null, chunks: target.chunks ? CHUNKS : [], totalChunks: target.chunks, workspaceId: target.workspaceId, workspaceName: target.workspaceName });
    }
    if (path === "/specialist-applications/app_test/panels" && method === "GET") {
      if (failList.panels) return fail500();
      return Response.json({ panels });
    }
    if (path === "/specialist-applications/app_test/panels/soja/resolve" && method === "GET") {
      return Response.json({
        spec: PANEL_SPEC,
        resolutions: [
          { workspaceId: "ws_test", workspaceName: "proyecto-principal", ok: true, data: ROWS, sourceLabel: "dataset:ds-soja", diff: PANEL_DIFF },
          { workspaceId: "ws_dos", workspaceName: "proyecto-anexo", ok: false, error: 'El dataset "search-precios-soja" no existe en este proyecto.' },
        ],
      });
    }
    if (path === "/specialist-applications/app_test/outputs" && method === "GET") {
      if (failList.outputs) return fail500();
      return Response.json({ outputs: [...outputs].sort((a, b) => b.updatedAt - a.updatedAt) });
    }
    const audit = path.match(/^\/specialist-applications\/app_test\/outputs\/([^/]+)\/audit$/);
    if (audit && method === "GET") {
      if (audit[1] === "out_good") return Response.json({ audit: { total: 1, valid: 1, invalid: [] } });
      if (audit[1] === "out_unanchored") return Response.json({ audit: { total: 0, valid: 0, invalid: [], note: "sin anclas" } });
      return Response.json({ audit: { total: 1, valid: 0, invalid: [{ sourceId: "src_rota", chunk: 3, reason: "La fuente src_rota tiene 0 pasajes; el ancla #3 no existe." }] } });
    }
    const outputById = path.match(/^\/specialist-applications\/app_test\/outputs\/([^/]+)$/);
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

async function flush(ms = 30) { await act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); }); }
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
function hasText(text: string): boolean { return (document.body.textContent ?? "").includes(text); }
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
  const btn = [...section.querySelectorAll("button")].find(b => (b.textContent ?? "").includes("Gestionar"));
  if (!btn) throw new Error(`Missing Gestionar in "${start}"`);
  await act(async () => { btn.click(); });
  await flush();
}
function rowFor(name: string): HTMLElement {
  const row = [...document.querySelectorAll("div.rounded-md")].find(el => (el.textContent ?? "").includes(name));
  if (!row) throw new Error(`Missing row for "${name}"; doc: ${document.body.textContent?.slice(0, 1000)}`);
  return row as HTMLElement;
}
function countRequests(method: string, matcher: RegExp): number {
  return allRequests.filter(entry => entry.method === method && matcher.test(entry.path)).length;
}

// ── Paso 1: menú → diálogo con todas las flags → título y resúmenes honestos ──
test("paso 1 — todas las flags: el título lista las seis secciones y el home muestra los seis resúmenes con contenido real", async () => {
  await renderAt();
  const trigger = document.querySelector('[aria-label="Cambiar aplicación especialista"]');
  if (!trigger) throw new Error("Missing switcher");
  await act(async () => { trigger.click(); });
  await flush();
  const item = [...document.querySelectorAll('button, [role="menuitem"]')].find(el => (el.textContent ?? "").includes("Contexto, agentes y skills"));
  expect(item).toBeTruthy(); // con biblioteca encendida el menú se llama "Contexto, agentes y skills"
  await act(async () => { item!.click(); });
  await flush();

  // El título describe lo que hay adentro: las seis secciones, sin inventar ni ocultar ninguna.
  expect(hasText("Contexto, agentes y skills · Tareas · Datos · Fuentes · Paneles · Salidas de Taller")).toBe(true);

  // Cabeceras de sección (home) + una muestra de contenido por resumen: si una lista
  // estuviera rota, el resumen no podría mostrar su fila real.
  expect(hasText("Tareas programadas")).toBe(true);
  expect(hasText("actualizar precios")).toBe(true); // fila del resumen de tareas
  expect(hasText("Datos de investigación")).toBe(true);
  expect(hasText("search-aranceles-soja-1a2b3c4d")).toBe(true); // fila del resumen de datasets
  expect(hasText("Salidas del mini-Studio")).toBe(true);
  expect(hasText("Informe soja")).toBe(true); // fila del resumen de salidas
  expect(hasText("Paneles")).toBe(true);
  expect(hasText("Soja — cierre")).toBe(true); // fila del resumen de paneles
  expect(hasText("Fuentes citables")).toBe(true);
  expect(hasText("aranceles soja china")).toBe(true); // fila del resumen de fuentes
  expect(hasText("Contexto")).toBe(true);
  expect(hasText("Agentes (1)")).toBe(true);
  expect(hasText("Skills (1)")).toBe(true);
  expect(hasText("Propuestas pendientes (2)")).toBe(true);
});

// ── Paso 2: propuestas task/plan, resultado por pieza con una pieza fallida ──
test("paso 2 — propuesta de tarea (badge + PAUSADA) y de plan (piezas); al aceptar, el panel aplicado muestra una pieza fallida con detalle", async () => {
  await renderAt();
  await openLibraryDialog();
  expect(hasText("Propuestas pendientes (2)")).toBe(true);

  const filaTarea = rowFor("refrescar aranceles");
  expect(filaTarea.textContent).toContain("Tarea"); // badge del kind
  expect(filaTarea.textContent).toContain("Se crea PAUSADA");
  expect(filaTarea.textContent).toContain("Cada 20 min");

  const filaPlan = rowFor("programa aranceles");
  expect(filaPlan.textContent).toContain("Plan");
  expect(filaPlan.textContent).toContain("skill + dataset + panel + tarea pausada");

  await act(async () => { [...filaPlan.querySelectorAll("button")].find(b => (b.textContent ?? "") === "Aceptar")!.click(); });
  await flush(60);
  expect(hasText("Resultado de la propuesta aceptada")).toBe(true);
  expect(hasText("✓ skill")).toBe(true);
  expect(hasText("✗ panel — La spec del panel no valida: faltan bloques.")).toBe(true); // la fallida dice por qué
  expect(hasText("✓ tarea")).toBe(true);
});

// ── Paso 3: run-now invalida el historial de corridas ──
test("paso 3 — Correr ahora: tras el POST, el historial de corridas se vuelve a pedir y la fila nueva aparece", async () => {
  await renderAt();
  await openLibraryDialog();
  await openSection("Tareas programadas");
  expect(hasText("Tareas programadas de Taller")).toBe(true);

  // Abrir el historial ANTES de correr: está vacío.
  const fila = rowFor("actualizar precios");
  await act(async () => { [...fila.querySelectorAll("button")].find(b => (b.textContent ?? "").includes("Corridas"))!.click(); });
  await flush(60);
  expect(hasText("Sin corridas todavía.")).toBe(true);
  const corridasAntes = countRequests("GET", /\/tasks\/task_1\/runs$/);
  expect(corridasAntes).toBeGreaterThan(0);

  await act(async () => { [...rowFor("actualizar precios").querySelectorAll("button")].find(b => (b.textContent ?? "").includes("Correr ahora"))!.click(); });
  await flush(60);
  expect(hasText("Corrida iniciada: mirá el chat nuevo de la tarea.")).toBe(true);
  // El fix de invalidación: el GET de runs vuelve a salir y la fila manual recién creada se ve.
  expect(countRequests("GET", /\/tasks\/task_1\/runs$/)).toBeGreaterThan(corridasAntes);
  expect(hasText("a pedido")).toBe(true);
  expect(hasText("corriendo")).toBe(true); // status "dispatched" se lee como "corriendo"
});

// ── Pasos 4a/4b: datasets — error de refresh legible y consulta sin snapshot ──
test("paso 4a — refresh que falla (422 del provider): el mensaje se ve en pantalla, no se traga ni se finge éxito", async () => {
  await renderAt();
  await openLibraryDialog();
  await openSection("Datos de investigación");
  expect(hasText("Datasets de investigación de Taller")).toBe(true);

  refreshFailsWith = { status: 422, code: "invalid_dataset", message: "Conectá Tavily desde Herramientas y fuentes para investigar." };
  const fila = rowFor("search-aranceles-soja-1a2b3c4d");
  await act(async () => { [...fila.querySelectorAll("button")].find(b => (b.textContent ?? "") === "Actualizar")!.click(); });
  await flush(60);
  const alertas = [...document.querySelectorAll('[role="alert"]')].map(element => element.textContent ?? "").join(" | ");
  expect(alertas).toContain("Conectá Tavily desde Herramientas y fuentes para investigar.");
  expect(hasText("Consulta re-ejecutada")).toBe(false); // ningún notice mentiroso
  expect(rowFor("search-aranceles-soja-1a2b3c4d").textContent).toContain("2 snapshots"); // el conteo no cambió
});

test("paso 4b — dataset solo-consulta (latest null): abrirlo no rompe la vista", async () => {
  await renderAt();
  await openLibraryDialog();
  await openSection("Datos de investigación");
  const fila = rowFor("search-aranceles-nueva-5e6f7a8b");
  expect(fila.textContent).toContain("0 snapshots");
  await act(async () => { [...fila.querySelectorAll("button")].find(b => (b.getAttribute("aria-label") ?? "").includes("Ver snapshots"))!.click(); });
  await flush(60);
  // La vista sigue viva (sin pantalla blanca): título del diálogo y la fila intactos.
  expect(hasText("Datasets de investigación de Taller")).toBe(true);
  // C-1 corregida: el dataset sin correr lo dice en palabras, no con el literal "null".
  expect(hasText("El dataset todavía no tuvo una corrida: su consulta está guardada y es re-ejecutable, pero no hay snapshot que leer.")).toBe(true);
  expect(document.querySelector("pre")).toBeNull();
});

// ── Paso 5: fuentes — anclas en el lector y fuente sin pasajes ──
test("paso 5 — fuentes: el lector muestra las anclas [fuente:id#n] y la fuente sin pasajes lo dice en su fila", async () => {
  await renderAt();
  await openLibraryDialog();
  await openSection("Fuentes citables");
  expect(hasText("Fuentes citables de Taller")).toBe(true);

  const fila = rowFor("aranceles soja china");
  expect(fila.textContent).toContain("2 pasajes");
  const filaAnexo = rowFor("aduana argentina");
  expect(filaAnexo.textContent).toContain("sin pasajes indexados todavía");

  await act(async () => { [...fila.querySelectorAll("button")].find(b => (b.textContent ?? "").includes("Ver pasajes"))!.click(); });
  await flush(60);
  expect(hasText("[fuente:src_soja_1a2b3c4d#0]")).toBe(true);
  expect(hasText("[fuente:src_soja_1a2b3c4d#1]")).toBe(true);
  expect(hasText("480 dólares la tonelada")).toBe(true);
});

// ── Paso 6: paneles — stat/línea/tabla/cambios, fallo ruidoso y bloque sin números ──
test("paso 6 — panel abierto: stat, línea, tabla y cambios se dibujan; el segundo proyecto falla en voz alta y el bloque sin números lo dice", async () => {
  await renderAt();
  await openLibraryDialog();
  await openSection("Paneles");
  expect(hasText("Paneles de Taller")).toBe(true);
  const fila = rowFor("Soja — cierre");
  await act(async () => { [...fila.querySelectorAll("button")].find(b => (b.textContent ?? "").trim() === "Ver")!.click(); });
  await flush(60);
  expect(hasText("491")).toBe(true); // stat last(cierre)
  expect(document.querySelector("svg polyline")).not.toBeNull(); // línea con datos
  const firstRow = document.querySelector("tbody tr");
  expect(firstRow?.textContent).toContain("2026-11-09"); // tabla ordenada desc por fecha
  expect(hasText("Cambios desde la última corrida")).toBe(true);
  expect(hasText("+1 nuevo")).toBe(true); // el diff de F2
  // Segundo workspace: el fallo es ruidoso, no una pantalla vacía ni un blanco.
  expect(hasText("proyecto-anexo")).toBe(true);
  expect(hasText('El dataset "search-precios-soja" no existe en este proyecto.')).toBe(true);
  expect(document.querySelector('[role="alert"]')).not.toBeNull();
  // Bloque line sobre columna no numérica: se dice, no se deja un gráfico mudo en blanco.
  expect(hasText("Este gráfico no tiene valores numéricos para dibujar")).toBe(true);
});

// ── Paso 7: salidas — tres estados de auditoría bien distintos ──
test("paso 7 — salidas: auditoría válida, sin anclas y rota se distinguen en voz alta", async () => {
  await renderAt();
  await openLibraryDialog();
  await openSection("Salidas del mini-Studio");
  expect(hasText("Salidas del mini-Studio de Taller")).toBe(true);

  const ver = async (title: string) => {
    const row = rowFor(title);
    await act(async () => { [...row.querySelectorAll("button")].find(b => (b.textContent ?? "").trim() === "Ver")!.click(); });
    await flush(60);
  };
  await ver("Informe soja");
  expect(hasText("La soja creció [fuente:src_soja_1a2b3c4d#1].")).toBe(true);
  expect(hasText("✓ 1/1 citas resuelven a pasajes reales del proyecto.")).toBe(true);

  await ver("Tabla de aranceles");
  expect(hasText("Sin anclas: esta salida no está anclada a fuentes del proyecto.")).toBe(true);

  await ver("Informe con cita rota");
  expect(hasText("1 cita no resuelve")).toBe(true);
  expect(hasText("[fuente:src_rota#3]")).toBe(true);
});

// ── Paso 8: cada lista ante 500 — error honesto con reintento, jamás el copy de "vacío" ──
test("paso 8a — propuestas con 500: error + reintento, la sección no desaparece en silencio", async () => {
  failList.proposals = true;
  await renderAt();
  await openLibraryDialog();
  expect(hasText("No se pudieron leer las propuestas")).toBe(true);
  expect(hasText("Volver a intentar")).toBe(true);
});

test("paso 8b — tareas con 500: error + reintento, nunca 'Sin tareas programadas'", async () => {
  failList.tasks = true;
  await renderAt();
  await openLibraryDialog();
  expect(hasText("No se pudieron leer las tareas")).toBe(true);
  expect(hasText("Volver a intentar")).toBe(true);
  expect(hasText("Sin tareas programadas")).toBe(false);
});

test("paso 8c — datasets con 500: error + reintento, nunca 'Sin datasets todavía'", async () => {
  failList.datasets = true;
  await renderAt();
  await openLibraryDialog();
  expect(hasText("No se pudieron leer los datasets")).toBe(true);
  expect(hasText("Volver a intentar")).toBe(true);
  expect(hasText("Sin datasets todavía")).toBe(false);
});

test("paso 8d — fuentes con 500: error + reintento, nunca 'Sin fuentes todavía'", async () => {
  failList.sources = true;
  await renderAt();
  await openLibraryDialog();
  expect(hasText("No se pudieron leer las fuentes")).toBe(true);
  expect(hasText("Volver a intentar")).toBe(true);
  expect(hasText("Sin fuentes todavía")).toBe(false);
});

test("paso 8e — paneles con 500: error + reintento, nunca 'Sin paneles todavía'", async () => {
  failList.panels = true;
  await renderAt();
  await openLibraryDialog();
  expect(hasText("No se pudieron leer los paneles")).toBe(true);
  expect(hasText("Volver a intentar")).toBe(true);
  expect(hasText("Sin paneles todavía")).toBe(false);
});

test("paso 8f — salidas con 500: error + reintento, nunca 'Sin salidas todavía'", async () => {
  failList.outputs = true;
  await renderAt();
  await openLibraryDialog();
  expect(hasText("No se pudieron leer las salidas")).toBe(true);
  expect(hasText("Volver a intentar")).toBe(true);
  expect(hasText("Sin salidas todavía")).toBe(false);
});

test("paso 8g — biblioteca con 500: el banner dice el error sin secuestrar las demás secciones", async () => {
  failList.library = true;
  await renderAt();
  await openLibraryDialog();
  expect(hasText("No se pudo leer la biblioteca")).toBe(true);
  expect(hasText("Volver a intentar")).toBe(true);
  // Las secciones que sí funcionan siguen accesibles (no hay secuestro del diálogo).
  expect(hasText("Tareas programadas")).toBe(true);
  expect(hasText("Datos de investigación")).toBe(true);
  expect(hasText("actualizar precios")).toBe(true);
});
