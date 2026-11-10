/** @jsxImportSource react */
// Test de usuario REAL de los paneles (celda C1 + bloque "cambios" de F2): lista, apertura con
// resolve, render determinista (stat con panelAggregate compartido, tabla ordenada, línea SVG,
// bloque changes con el diff) y el fallo en voz alta cuando un proyecto no tiene el dataset.
// Fetch mockeado con las formas reales de routes.ts.
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

let flags: { libraryEnabled: boolean; scheduledTasksEnabled: boolean; datasetsEnabled: boolean; sourcesEnabled: boolean; panelsEnabled: boolean; panelAppsEnabled?: boolean };
let resolveSpec: typeof SPEC;
let panels: Array<{ name: string; title: string; source: string; updatedAt: number; bytes: number }>;
let panelRequests: Array<{ method: string; path: string }> = [];
let listFailsWith: { status: number; code: string; message: string } | null = null;
const ROWS = [
  { fecha: "2026-11-07", cierre: 480 },
  { fecha: "2026-11-08", cierre: 486 },
  { fecha: "2026-11-09", cierre: 491 },
];
const SPEC = {
  panel: "soja", title: "Soja — cierre", source: { dataset: "search-precios-soja" }, refresh: { watch: "latest" },
  blocks: [
    { type: "stat", field: "cierre", agg: "last" },
    { type: "line", x: "fecha", y: ["cierre"], title: "Precio" },
    { type: "table", limit: 20, sort: { by: "fecha", desc: true } },
    { type: "changes" },
  ],
};
const DIFF = { at: 1_700_000_000_000, diff: { kind: "rows", added: 1, removed: 0, changed: 0, sample: [], summary: "+1 nuevo" } };

const APP = { id: "app_test", name: "Taller", specialty: "Prueba", personality: "Clara", template: "custom" as const, agentCount: 1, skillCount: 1, createdAt: 1, workspaceIds: ["ws_test", "ws_dos"] };
const catalog = () => ({
  enabled: true,
  libraryEnabled: flags.libraryEnabled,
  scheduledTasksEnabled: flags.scheduledTasksEnabled,
  datasetsEnabled: flags.datasetsEnabled,
  sourcesEnabled: flags.sourcesEnabled,
  panelsEnabled: flags.panelsEnabled,
  panelAppsEnabled: flags.panelAppsEnabled === true,
  integrationsEnabled: false,
  user: { id: "local", displayName: "Usuario de prueba" },
  activeApplicationId: APP.id,
  applications: [APP],
});

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  if (!("ResizeObserver" in globalThis)) Reflect.set(globalThis, "ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  if (!("IntersectionObserver" in globalThis)) Reflect.set(globalThis, "IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } });
  flags = { libraryEnabled: true, scheduledTasksEnabled: false, datasetsEnabled: true, sourcesEnabled: true, panelsEnabled: true, panelAppsEnabled: true };
  panels = [{ name: "soja", title: "Soja — cierre", source: "dataset:search-precios-soja", updatedAt: 1_700_000_500_000, bytes: 512 }];
  resolveSpec = SPEC;
  panelRequests = [];
  listFailsWith = null;
  const spy = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    if (path.includes("/panels")) panelRequests.push({ method, path });
    if (path === "/specialist-applications" && method === "GET") return Response.json(catalog());
    if (path === "/specialist-applications/app_test/library" && method === "GET") return Response.json({ application: { id: APP.id, name: APP.name }, agents: [], skills: [], files: [], context: { exists: false, bytes: 0 }, counts: { agents: 0, skills: 0 } });
    if (path === "/specialist-applications/app_test/library/proposals" && method === "GET") return Response.json({ proposals: [] });
    if (path === "/specialist-applications/app_test/datasets" && method === "GET") return Response.json({ datasets: [] });
    if (path === "/specialist-applications/app_test/sources" && method === "GET") return Response.json({ sources: [] });
    if (path === "/specialist-applications/app_test/tasks" && method === "GET") return Response.json({ tasks: [] });
    if (path === "/specialist-applications/app_test/panels" && method === "GET") {
      if (listFailsWith) return Response.json(listFailsWith, { status: listFailsWith.status });
      if (!flags.panelsEnabled) return Response.json({ code: "specialist_panels_disabled", message: "Los paneles están desactivados." }, { status: 404 });
      return Response.json({ panels });
    }
    if (path === "/specialist-applications/app_test/panels/soja/resolve" && method === "GET") {
      if (!flags.panelsEnabled) return Response.json({ code: "specialist_panels_disabled", message: "Los paneles están desactivados." }, { status: 404 });
      return Response.json({
        spec: resolveSpec,
        resolutions: [
          { workspaceId: "ws_test", workspaceName: "proyecto-principal", ok: true, data: ROWS, sourceLabel: "dataset:ds-search-precios-soja-1a2b3c4d", diff: DIFF },
          { workspaceId: "ws_dos", workspaceName: "proyecto-anexo", ok: false, error: 'El dataset "search-precios-soja" no existe en este proyecto.' },
        ],
      });
    }
    if (path === "/specialist-applications/app_test/panels/soja" && method === "DELETE") {
      panels = panels.filter(p => p.name !== "soja");
      return Response.json({ deleted: "soja" });
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

test("recorrido: resumen → Gestionar → stat, línea, tabla ordenada, cambios y fallo local por proyecto", async () => {
  await renderAt();
  await openLibraryDialog();
  expect(hasText("Paneles")).toBe(true);
  expect(hasText("Soja — cierre")).toBe(true);

  const sections = [...document.querySelectorAll("section")];
  const panelesSection = sections.find(s => (s.textContent ?? "").startsWith("Paneles"));
  if (!panelesSection) throw new Error("Missing Paneles section");
  await act(async () => { [...panelesSection.querySelectorAll("button")].find(b => (b.textContent ?? "").includes("Gestionar"))!.click(); });
  await flush();
  expect(hasText("Paneles de Taller")).toBe(true);

  // Ver: resolve sin ?workspace= (todos los proyectos), stat=491 (último cierre), línea SVG, tabla
  // con la última fecha primero y el bloque de cambios con el diff de F2.
  await act(async () => {
    const row = [...document.querySelectorAll("div.rounded-md")].find(el => (el.textContent ?? "").includes("Soja — cierre"));
    [...(row as HTMLElement).querySelectorAll("button")].find(b => (b.textContent ?? "").trim() === "Ver")!.click();
  });
  await flush();
  expect(hasText("491")).toBe(true); // stat last(cierre)
  expect(document.querySelector("svg polyline")).not.toBeNull(); // línea
  // 480 → 486 → 491 no puede salir como una línea chata: la escala es del rango de la serie.
  const lineYs = (document.querySelector("svg polyline")?.getAttribute("points") ?? "")
    .split(" ").map(point => Number(point.split(",")[1]));
  expect(lineYs.length).toBe(3);
  expect(new Set(lineYs).size).toBeGreaterThan(1);
  expect(lineYs[2]).toBeLessThan(lineYs[0]!); // el último cierre (491) va arriba del primero (480)
  const firstRow = document.querySelector("tbody tr");
  expect(firstRow?.textContent).toContain("2026-11-09"); // sort desc por fecha
  expect(hasText("Cambios desde la última corrida")).toBe(true);
  expect(hasText("+1 nuevo")).toBe(true);
  // Segundo proyecto: la resolución fallida dice qué pasa, no pantalla blanca.
  expect(hasText('El dataset "search-precios-soja" no existe en este proyecto.')).toBe(true);
  expect(hasText("proyecto-anexo")).toBe(true);
  const resolveCall = panelRequests.find(e => e.method === "GET" && e.path.endsWith("/panels/soja/resolve"));
  expect(resolveCall).toBeTruthy();
});

test("error de lectura en el resumen de paneles: mensaje + reintento, nunca 'sin paneles'", async () => {
  listFailsWith = { status: 500, code: "internal_error", message: "Unexpected server error" };
  await renderAt();
  await openLibraryDialog();
  expect(hasText("No se pudieron leer los paneles")).toBe(true);
  expect(hasText("Volver a intentar")).toBe(true);
  expect(hasText("Sin paneles todavía")).toBe(false);
});

test("la vista de paneles anuncia la App interactiva y no recorta la tabla en silencio", async () => {
  resolveSpec = { ...SPEC, blocks: [{ type: "table", limit: 2 }, { type: "bar", x: "fecha", y: ["cierre"], title: "Barras" }] } as typeof SPEC;
  await renderAt();
  await openLibraryDialog();
  const panelesSection = [...document.querySelectorAll("section")].find(s => (s.textContent ?? "").startsWith("Paneles"));
  if (!panelesSection) throw new Error("Missing Paneles section");
  await act(async () => { [...panelesSection.querySelectorAll("button")].find(b => (b.textContent ?? "").includes("Gestionar"))!.click(); });
  await flush();
  expect(hasText("App interactiva dentro del chat")).toBe(true);
  await act(async () => {
    const row = [...document.querySelectorAll("div.rounded-md")].find(el => (el.textContent ?? "").includes("Soja — cierre"));
    [...(row as HTMLElement).querySelectorAll("button")].find(b => (b.textContent ?? "").trim() === "Ver")!.click();
  });
  await flush();
  expect(document.querySelectorAll("tbody tr").length).toBe(2);
  expect(hasText("Mostrando 2 de 3 filas")).toBe(true);
  // Barras: la etiqueta de valor tiene su propia columna (nunca se sale de la tarjeta).
  expect(document.querySelector('[aria-label^="Gráfico de barras"]')).not.toBeNull();
  expect(hasText("491")).toBe(true);
});

test("sin la App de paneles, la vista no la promete", async () => {
  flags = { ...flags, panelAppsEnabled: false };
  await renderAt();
  await openLibraryDialog();
  const panelesSection = [...document.querySelectorAll("section")].find(s => (s.textContent ?? "").startsWith("Paneles"));
  if (!panelesSection) throw new Error("Missing Paneles section");
  await act(async () => { [...panelesSection.querySelectorAll("button")].find(b => (b.textContent ?? "").includes("Gestionar"))!.click(); });
  await flush();
  expect(hasText("App interactiva dentro del chat")).toBe(false);
});

test("panelsEnabled=false: la sección no aparece y no se dispara ningún request de paneles", async () => {
  flags = { libraryEnabled: true, scheduledTasksEnabled: false, datasetsEnabled: true, sourcesEnabled: true, panelsEnabled: false };
  await renderAt();
  await openLibraryDialog();
  expect(hasText("Paneles")).toBe(false);
  expect(panelRequests.length).toBe(0);
});
