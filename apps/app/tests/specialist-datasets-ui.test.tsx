/** @jsxImportSource react */
// Test de usuario de la sección nueva "Datos de investigación" del diálogo "Contexto, agentes y
// skills", abierto desde el menú de aplicaciones especialista. Los mocks de fetch emulan las
// respuestas reales de apps/server/src/specialists/routes.ts (formas JSON: { datasets },
// { dataset, snapshots, latest }, { dataset }, { deleted } y los 404 de flags:
// specialist_datasets_disabled).
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

type FakeDataset = {
  id: string; name: string; question: string; provider: string; operation: string;
  createdAt: number; updatedAt: number; lastSnapshotAt: number | null; snapshots: number;
  derivedFrom: string | null; workspaceId: string; workspaceName: string;
};
let flags: { libraryEnabled: boolean; scheduledTasksEnabled: boolean; datasetsEnabled: boolean };
let datasets: FakeDataset[];
let datasetRequests: Array<{ method: string; path: string }> = [];

const APP = { id: "app_test", name: "Taller", specialty: "Prueba", personality: "Clara", template: "custom" as const, agentCount: 1, skillCount: 1, createdAt: 1, workspaceIds: ["ws_test"] };
const catalog = () => ({
  enabled: true,
  libraryEnabled: flags.libraryEnabled,
  scheduledTasksEnabled: flags.scheduledTasksEnabled,
  datasetsEnabled: flags.datasetsEnabled,
  integrationsEnabled: false,
  user: { id: "local", displayName: "Usuario de prueba" },
  activeApplicationId: APP.id,
  applications: [APP],
});
const libraryPayload = () => ({
  application: { id: APP.id, name: APP.name },
  agents: [{ path: "agents/revisor.md", name: "revisor", bytes: 120, updatedAt: 1, origin: "official", description: "Revisa los textos antes de publicar." }],
  skills: [],
  files: [],
  context: { exists: false, bytes: 0 },
  counts: { agents: 1, skills: 0 },
});
const seedDatasets = (): FakeDataset[] => ([
  { id: "ds-search-informe-gigante-3c3c3c3c", name: "search-informe-gigante-3c3c3c3c", question: "informe gigante", provider: "tavily", operation: "search", createdAt: 1_700_000_400_000, updatedAt: 1_700_000_600_000, lastSnapshotAt: 1_700_000_600_000, snapshots: 1, derivedFrom: null, workspaceId: "ws_test", workspaceName: "proyecto-principal" },
  { id: "ds-search-aranceles-soja-1a2b3c4d", name: "search-aranceles-soja-1a2b3c4d", question: "aranceles soja china", provider: "tavily", operation: "search", createdAt: 1_700_000_000_000, updatedAt: 1_700_000_500_000, lastSnapshotAt: 1_700_000_500_000, snapshots: 2, derivedFrom: null, workspaceId: "ws_test", workspaceName: "proyecto-principal" },
  { id: "ds-precios-limpios-9f8e7d6c", name: "precios-limpios-9f8e7d6c", question: "Derivado de aranceles soja china", provider: "local", operation: "derived", createdAt: 1_700_000_200_000, updatedAt: 1_700_000_200_000, lastSnapshotAt: 1_700_000_200_000, snapshots: 1, derivedFrom: "ds-search-aranceles-soja-1a2b3c4d", workspaceId: "ws_dos", workspaceName: "proyecto-anexo" },
]);

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  if (!("ResizeObserver" in globalThis)) Reflect.set(globalThis, "ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  if (!("IntersectionObserver" in globalThis)) Reflect.set(globalThis, "IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } });
  flags = { libraryEnabled: true, scheduledTasksEnabled: false, datasetsEnabled: true };
  datasets = seedDatasets();
  datasetRequests = [];
  const spy = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const path = new URL(request.url).pathname;
    const method = request.method;
    if (path !== "/specialist-applications" && path.includes("/datasets")) datasetRequests.push({ method, path });

    if (path === "/specialist-applications" && method === "GET") return Response.json(catalog());
    if (/^\/specialist-applications\/app_test\/library$/.test(path) && method === "GET") {
      if (!flags.libraryEnabled) return Response.json({ code: "specialist_library_disabled", message: "La biblioteca de la aplicación está desactivada." }, { status: 404 });
      return Response.json(libraryPayload());
    }
    if (/^\/specialist-applications\/app_test\/library\/proposals$/.test(path) && method === "GET") {
      if (!flags.libraryEnabled) return Response.json({ code: "specialist_library_disabled", message: "La biblioteca de la aplicación está desactivada." }, { status: 404 });
      return Response.json({ proposals: [] });
    }

    // Datasets: 404 con la flag apagada, igual que requireDatasets() en routes.ts.
    const disabled = Response.json({ code: "specialist_datasets_disabled", message: "Los datasets de investigación están desactivados." }, { status: 404 });
    if (/^\/specialist-applications\/app_test\/datasets$/.test(path) && method === "GET") {
      if (!flags.datasetsEnabled) return disabled;
      return Response.json({ datasets: [...datasets].sort((left, right) => right.updatedAt - left.updatedAt) });
    }
    const refresh = path.match(/^\/specialist-applications\/app_test\/datasets\/([^/]+)\/refresh$/);
    if (refresh && method === "POST") {
      if (!flags.datasetsEnabled) return disabled;
      const target = datasets.find(entry => entry.id === refresh[1]);
      if (!target) return Response.json({ code: "dataset_not_found", message: "Ese dataset no existe." }, { status: 404 });
      datasets = datasets.map(entry => entry.id === target.id ? { ...entry, snapshots: entry.snapshots + 1, updatedAt: 1_700_000_900_000 } : entry);
      return Response.json({ dataset: datasets.find(entry => entry.id === target.id) });
    }
    const byId = path.match(/^\/specialist-applications\/app_test\/datasets\/([^/]+)$/);
    if (byId && method === "GET") {
      if (!flags.datasetsEnabled) return disabled;
      const target = datasets.find(entry => entry.id === byId[1]);
      if (!target) return Response.json({ code: "dataset_not_found", message: "Ese dataset no existe." }, { status: 404 });
      // El dataset "gigante" emula el recorte { tooLarge: true } del server.
      const latest = target.name.includes("gigante") ? { tooLarge: true } : { results: [{ pais: "China", arancel: "23%" }] };
      return Response.json({ dataset: target, snapshots: ["2026-11-09T10-00-00-000Z.json", "2026-11-08T10-00-00-000Z.json"].slice(0, target.snapshots), latest });
    }
    if (byId && method === "DELETE") {
      if (!flags.datasetsEnabled) return disabled;
      datasets = datasets.filter(entry => entry.id !== byId[1]);
      return Response.json({ deleted: byId[1] });
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

async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); }); }
async function renderAt(path = "/workspace/ws_test/session") {
  await act(async () => root.render(
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={[path]}>
        <SpecialistApplicationsProvider>
          <SpecialistApplicationSwitcher fallbackName="OpenWork" />
        </SpecialistApplicationsProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  ));
  await flush();
}
function byText(text: string, tag = "button"): HTMLElement {
  const selector = tag === "button" ? 'button, [role="menuitem"]' : tag;
  const value = [...document.querySelectorAll(selector)].find(element => (element.textContent ?? "").includes(text));
  if (!value) throw new Error(`Missing ${selector} with text "${text}". Document: ${document.body.textContent?.slice(0, 600)}`);
  return value as HTMLElement;
}
async function clickText(text: string, tag = "button") {
  await act(async () => { byText(text, tag).click(); });
  await flush();
}
function byAriaLabel(label: string): HTMLElement {
  const value = document.querySelector(`[aria-label="${label}"]`);
  if (!value) throw new Error(`Missing [aria-label="${label}"]. Document: ${document.body.textContent?.slice(0, 600)}`);
  return value as HTMLElement;
}
async function clickAriaLabel(label: string) {
  await act(async () => { byAriaLabel(label).click(); });
  await flush();
}
function hasText(text: string): boolean { return (document.body.textContent ?? "").includes(text); }
async function openMenu() {
  const trigger = document.querySelector('[aria-label="Cambiar aplicación especialista"]');
  if (!trigger) throw new Error("Missing application switcher trigger");
  await act(async () => { trigger.click(); });
  await flush();
}
async function openLibraryDialog() {
  await openMenu();
  await clickText("Contexto, agentes y skills");
}

test("el usuario ve sus datasets, actualiza uno con Tavily y elimina otro con confirmación", async () => {
  await renderAt();
  await openLibraryDialog();

  // --- Home: sección "Datos de investigación" con resumen y botón Gestionar.
  expect(hasText("Datos de investigación")).toBe(true);
  expect(hasText("search-aranceles-soja-1a2b3c4d")).toBe(true); // resumen usa el nombre del dataset
  expect(hasText("proyecto-anexo")).toBe(true); // con 2 workspaces, el resumen aclara de cuál es cada uno
  await clickText("Gestionar");

  // --- DatasetsView: filas con provider/operación, snapshots y fecha.
  expect(hasText("Datasets de investigación de Taller")).toBe(true);
  expect(hasText("aranceles soja china")).toBe(true);
  expect(hasText("derivado de otro dataset")).toBe(true);
  // "Actualizar" solo en los datasets re-ejecutables (los derivados no tienen consulta guardada).
  expect([...document.querySelectorAll("button")].filter(element => element.textContent === "Actualizar").length).toBe(2);

  // --- "Actualizar" → POST …/refresh y el conteo de snapshots sube tras el refetch.
  await clickText("Actualizar");
  expect(datasetRequests.some(entry => entry.method === "POST" && /\/datasets\/ds-search-informe-gigante-3c3c3c3c\/refresh$/.test(entry.path))).toBe(true);
  expect(hasText("Consulta re-ejecutada: el dataset quedó con un snapshot nuevo.")).toBe(true);
  expect(hasText("2 snapshots · actualizado")).toBe(true); // gigante: 1 → 2

  // --- Fila clickeable: muestra la cantidad de snapshots y el preview del último como <pre>.
  await clickAriaLabel("Ver snapshots de search-aranceles-soja-1a2b3c4d");
  const preview = document.querySelector("pre")?.textContent ?? "";
  expect(preview).toContain("arancel");
  expect(hasText("2 snapshots en el proyecto:")).toBe(true);

  // --- Preview recortado del server: { tooLarge: true } se explica, no se rompe.
  await clickAriaLabel("Ver snapshots de search-informe-gigante-3c3c3c3c");
  expect(hasText("El último snapshot supera los 200 KB")).toBe(true);

  // --- Eliminar el derivado: confirmación inline igual que la biblioteca.
  await clickAriaLabel("Eliminar precios-limpios-9f8e7d6c");
  expect(hasText("¿Eliminar \"precios-limpios-9f8e7d6c\"?")).toBe(true);
  await clickText("Eliminar"); // el botón de confirmación del alertdialog
  expect(datasetRequests.some(entry => entry.method === "DELETE" && /\/datasets\/ds-precios-limpios-9f8e7d6c$/.test(entry.path))).toBe(true);
  expect(hasText("Se eliminó precios-limpios-9f8e7d6c.")).toBe(true);
  expect(hasText("derivado de otro dataset")).toBe(false); // la fila del derivado ya no existe
});

test("datasets=true con biblioteca apagada: el diálogo abre igual y muestra solo los datos", async () => {
  flags = { libraryEnabled: false, scheduledTasksEnabled: false, datasetsEnabled: true };
  await renderAt();
  await openMenu();
  // Traba 4 arreglada: sin biblioteca ni tareas el ítem dice "Datos", no "Contexto, agentes y skills".
  expect(hasText("Datos")).toBe(true); // el ítem vive con cualquiera de las tres flags
  expect(hasText("Contexto, agentes y skills")).toBe(false);
  await clickText("Datos");
  expect(hasText("No se pudo leer la biblioteca")).toBe(false);
  expect(datasetRequests.filter(entry => entry.method === "GET" && /\/datasets$/.test(entry.path)).length).toBeGreaterThan(0);
  expect(hasText("Datos de investigación")).toBe(true);
  expect(hasText("search-aranceles-soja-1a2b3c4d")).toBe(true);
});

test("datasets=true y lista vacía: la sugerencia en voz baja, sin errores", async () => {
  datasets = [];
  await renderAt();
  await openLibraryDialog();
  expect(hasText("Sin datasets todavía")).toBe(true);
  await clickText("Gestionar");
  expect(hasText("Sin datasets todavía")).toBe(true);
});

test("todas las flags del diálogo apagadas: el ítem del menú desaparece", async () => {
  flags = { libraryEnabled: false, scheduledTasksEnabled: false, datasetsEnabled: false };
  await renderAt();
  await openMenu();
  expect(hasText("Contexto, agentes y skills")).toBe(false);
  expect(hasText("Personalidad y nombre")).toBe(true);
});
