/** @jsxImportSource react */
// Test de usuario REAL de las fuentes citables (celda B2): registro automático por research,
// lista agregada por workspace, lector de pasajes con su cita [fuente:id#n], resumen honesto y
// gating por flag (specialistSources). Contra fetch mockeado con las formas reales de routes.ts.
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

type FakeSource = { id: string; provider: string; title: string; url: string | null; evidencePath: string; datasetId: string | null; retrievedAt: number; chunks: number; workspaceId: string; workspaceName: string };
let flags: { libraryEnabled: boolean; scheduledTasksEnabled: boolean; datasetsEnabled: boolean; sourcesEnabled: boolean };
let sources: FakeSource[];
let sourceRequests: Array<{ method: string; path: string; search: string }> = [];
let listFailsWith: { status: number; code: string; message: string } | null = null;

const APP = { id: "app_test", name: "Taller", specialty: "Prueba", personality: "Clara", template: "custom" as const, agentCount: 1, skillCount: 1, createdAt: 1, workspaceIds: ["ws_test", "ws_dos"] };
const catalog = () => ({
  enabled: true,
  libraryEnabled: flags.libraryEnabled,
  scheduledTasksEnabled: flags.scheduledTasksEnabled,
  datasetsEnabled: flags.datasetsEnabled,
  sourcesEnabled: flags.sourcesEnabled,
  integrationsEnabled: false,
  user: { id: "local", displayName: "Usuario de prueba" },
  activeApplicationId: APP.id,
  applications: [APP],
});
const CHUNKS = ["La exportación de soja creció un tres por ciento en el último trimestre.", "La Bolsa de Comercio fijó el precio de referencia en 480 dólares la tonelada."];

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  if (!("ResizeObserver" in globalThis)) Reflect.set(globalThis, "ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  if (!("IntersectionObserver" in globalThis)) Reflect.set(globalThis, "IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } });
  flags = { libraryEnabled: true, scheduledTasksEnabled: false, datasetsEnabled: true, sourcesEnabled: true };
  sources = [
    { id: "src_soja_1a2b3c4d", provider: "tavily", title: "aranceles soja china", url: "https://ejemplo.cl/soja", evidencePath: "comex/fuentes/tavily/a.json", datasetId: "ds-search-aranceles-soja-1a2b3c4d", retrievedAt: 1_700_000_500_000, chunks: 2, workspaceId: "ws_test", workspaceName: "proyecto-principal" },
    { id: "src_aduana_5e6f7a8b", provider: "tavily", title: "aduana argentina", url: null, evidencePath: "comex/fuentes/tavily/b.json", datasetId: null, retrievedAt: 1_700_000_400_000, chunks: 0, workspaceId: "ws_dos", workspaceName: "proyecto-anexo" },
  ];
  sourceRequests = [];
  listFailsWith = null;
  const spy = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    if (path.includes("/sources")) sourceRequests.push({ method, path, search: url.search });
    if (path === "/specialist-applications" && method === "GET") return Response.json(catalog());
    if (path === "/specialist-applications/app_test/library" && method === "GET") {
      if (!flags.libraryEnabled) return Response.json({ code: "specialist_library_disabled", message: "desactivada" }, { status: 404 });
      return Response.json({ application: { id: APP.id, name: APP.name }, agents: [], skills: [], files: [], context: { exists: false, bytes: 0 }, counts: { agents: 0, skills: 0 } });
    }
    if (path === "/specialist-applications/app_test/library/proposals" && method === "GET") return Response.json({ proposals: [] });
    if (path === "/specialist-applications/app_test/datasets" && method === "GET") return Response.json({ datasets: [] });
    if (path === "/specialist-applications/app_test/tasks" && method === "GET") return Response.json({ tasks: [] });
    if (path === "/specialist-applications/app_test/sources" && method === "GET") {
      if (listFailsWith) return Response.json(listFailsWith, { status: listFailsWith.status });
      if (!flags.sourcesEnabled) return Response.json({ code: "specialist_sources_disabled", message: "Las fuentes citables están desactivadas." }, { status: 404 });
      return Response.json({ sources: [...sources].sort((a, b) => b.retrievedAt - a.retrievedAt) });
    }
    const byId = path.match(/^\/specialist-applications\/app_test\/sources\/([^/]+)$/);
    if (byId && method === "GET") {
      if (!flags.sourcesEnabled) return Response.json({ code: "specialist_sources_disabled", message: "Las fuentes citables están desactivadas." }, { status: 404 });
      const target = sources.find(entry => entry.id === byId[1]);
      if (!target) return Response.json({ code: "source_not_found", message: "Esa fuente no está registrada." }, { status: 404 });
      const chunkParam = url.searchParams.get("chunk");
      if (chunkParam !== null) {
        const n = Number(chunkParam);
        if (n >= CHUNKS.length) return Response.json({ ok: false, error: `La fuente ${target.id} tiene ${CHUNKS.length} pasajes; el ancla #${n} no existe.`, source: target, workspaceId: target.workspaceId, workspaceName: target.workspaceName });
        return Response.json({ ok: true, source: target, chunk: n, text: CHUNKS[n], workspaceId: target.workspaceId, workspaceName: target.workspaceName });
      }
      return Response.json({ ok: true, source: target, chunk: null, text: null, chunks: CHUNKS, totalChunks: CHUNKS.length, workspaceId: target.workspaceId, workspaceName: target.workspaceName });
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
function rowFor(title: string): HTMLElement {
  const row = [...document.querySelectorAll("div.rounded-md")].find(el => (el.textContent ?? "").includes(title));
  if (!row) throw new Error(`Missing row ${title}`);
  return row as HTMLElement;
}

test("recorrido: menú → resumen de fuentes → Gestionar → lector de pasajes con su cita", async () => {
  await renderAt();
  await openLibraryDialog();
  expect(hasText("Fuentes citables")).toBe(true);
  expect(hasText("aranceles soja china")).toBe(true);
  expect(hasText("proyecto-anexo")).toBe(true); // el resumen nombra el proyecto con más de uno

  // Gestionar de la sección "Fuentes citables" (la última): abre la vista con las filas.
  const sections = [...document.querySelectorAll("section")];
  const fuentesSection = sections.find(s => (s.textContent ?? "").startsWith("Fuentes citables"));
  if (!fuentesSection) throw new Error("Missing Fuentes section");
  await act(async () => { [...fuentesSection.querySelectorAll("button")].find(b => (b.textContent ?? "").includes("Gestionar"))!.click(); });
  await flush();
  expect(hasText("Fuentes citables de Taller")).toBe(true);
  const fila = rowFor("aranceles soja china");
  expect(fila.textContent).toContain("tavily");
  expect(fila.textContent).toContain("2 pasajes");
  expect(fila.textContent).toContain("https://ejemplo.cl/soja");
  const filaAnexo = rowFor("aduana argentina");
  expect(filaAnexo.textContent).toContain("proyecto-anexo");
  expect(filaAnexo.textContent).toContain("sin pasajes citables");

  // Ver pasajes: GET detalle con ?workspace= del proyecto de la fila; cada pasaje muestra su ancla.
  await act(async () => { [...fila.querySelectorAll("button")].find(b => (b.textContent ?? "").includes("Ver pasajes"))!.click(); });
  await flush();
  expect(hasText("[fuente:src_soja_1a2b3c4d#0]")).toBe(true);
  expect(hasText("[fuente:src_soja_1a2b3c4d#1]")).toBe(true);
  expect(hasText("480 dólares la tonelada")).toBe(true);
  const detalle = sourceRequests.find(e => e.method === "GET" && e.path.endsWith("/sources/src_soja_1a2b3c4d"));
  expect(detalle?.search).toBe("?workspace=ws_test");

  // Cerrar: no queda detalle abierto.
  await act(async () => { [...fila.querySelectorAll("button")].find(b => (b.textContent ?? "").includes("Ocultar pasajes"))!.click(); });
  await flush();
  expect(hasText("[fuente:src_soja_1a2b3c4d#0]")).toBe(false);
});

test("error de lectura en el resumen de fuentes: mensaje + reintento, nunca 'sin fuentes'", async () => {
  listFailsWith = { status: 500, code: "internal_error", message: "Unexpected server error" };
  await renderAt();
  await openLibraryDialog();
  expect(hasText("No se pudieron leer las fuentes")).toBe(true);
  expect(hasText("Volver a intentar")).toBe(true);
  expect(hasText("Sin fuentes todavía")).toBe(false);
});

test("sourcesEnabled=false: la sección no aparece y no se dispara ningún request de fuentes", async () => {
  flags = { libraryEnabled: true, scheduledTasksEnabled: false, datasetsEnabled: true, sourcesEnabled: false };
  await renderAt();
  await openLibraryDialog();
  expect(hasText("Fuentes citables")).toBe(false);
  expect(sourceRequests.length).toBe(0);
});
