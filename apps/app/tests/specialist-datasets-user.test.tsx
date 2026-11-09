/** @jsxImportSource react */
// Test de usuario REAL de la superficie "datasets" (e60a3b1b + fd3c2dbe), complemento honesto de
// specialist-datasets-ui.test.tsx: ese archivo cubre el happy path pero NO verifica (a) que el
// POST refresh lleve el query param ?workspace= (la UI manda workspaceId, openwork-server.ts:2530),
// (b) que un error lento de refresh se muestre sin tragárselo, (c) que tras un refresh exitoso el
// DETALLE abierto vuelva a pedirse (la invalicación del fix e60a3b1b, library-dialog.tsx:286), ni
// (d) que datasetsEnabled=false no dispare ningún request de datasets. Aquí se manejan los
// componentes reales contra fetch mockeado con las formas JSON reales de
// apps/server/src/specialists/routes.ts ({ datasets }, { dataset, snapshots, latest },
// { dataset }, { deleted }, 404 specialist_datasets_disabled, 422 invalid_dataset).
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
// A diferencia del test hermano, acá se registra también el search: sin "?workspace=" no se puede
// probar que la llamada llega al proyecto correcto cuando la aplicación tiene varios bindeados.
type Request = { method: string; path: string; search: string };
let datasetRequests: Request[] = [];
let refreshBehavior: { delayMs: number; failWith?: { status: number; code: string; message: string } } | null = null;
let listFailsWith: { status: number; code: string; message: string } | null = null;

const APP = { id: "app_test", name: "Taller", specialty: "Prueba", personality: "Clara", template: "custom" as const, agentCount: 1, skillCount: 1, createdAt: 1, workspaceIds: ["ws_test", "ws_dos"] };
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
  { id: "ds-search-aranceles-soja-1a2b3c4d", name: "search-aranceles-soja-1a2b3c4d", question: "aranceles soja china", provider: "tavily", operation: "search", createdAt: 1_700_000_000_000, updatedAt: 1_700_000_500_000, lastSnapshotAt: 1_700_000_500_000, snapshots: 2, derivedFrom: null, workspaceId: "ws_test", workspaceName: "proyecto-principal" },
  { id: "ds-search-informe-gigante-3c3c3c3c", name: "search-informe-gigante-3c3c3c3c", question: "informe gigante", provider: "tavily", operation: "search", createdAt: 1_700_000_400_000, updatedAt: 1_700_000_400_000, lastSnapshotAt: 1_700_000_400_000, snapshots: 1, derivedFrom: null, workspaceId: "ws_dos", workspaceName: "proyecto-anexo" },
  { id: "ds-precios-limpios-9f8e7d6c", name: "precios-limpios-9f8e7d6c", question: "Derivado de aranceles soja china", provider: "local", operation: "derived", createdAt: 1_700_000_200_000, updatedAt: 1_700_000_200_000, lastSnapshotAt: 1_700_000_200_000, snapshots: 1, derivedFrom: "ds-search-aranceles-soja-1a2b3c4d", workspaceId: "ws_test", workspaceName: "proyecto-principal" },
]);

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  if (!("ResizeObserver" in globalThis)) Reflect.set(globalThis, "ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  if (!("IntersectionObserver" in globalThis)) Reflect.set(globalThis, "IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } });
  flags = { libraryEnabled: true, scheduledTasksEnabled: false, datasetsEnabled: true };
  datasets = seedDatasets();
  datasetRequests = [];
  refreshBehavior = null;
  listFailsWith = null;
  const spy = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    if (path !== "/specialist-applications" && path.includes("/datasets")) datasetRequests.push({ method, path, search: url.search });

    if (path === "/specialist-applications" && method === "GET") return Response.json(catalog());
    if (/^\/specialist-applications\/app_test\/library$/.test(path) && method === "GET") {
      if (!flags.libraryEnabled) return Response.json({ code: "specialist_library_disabled", message: "La biblioteca de la aplicación está desactivada." }, { status: 404 });
      return Response.json(libraryPayload());
    }
    if (/^\/specialist-applications\/app_test\/library\/proposals$/.test(path) && method === "GET") {
      if (!flags.libraryEnabled) return Response.json({ code: "specialist_library_disabled", message: "La biblioteca de la aplicación está desactivada." }, { status: 404 });
      return Response.json({ proposals: [] });
    }

    const disabled = Response.json({ code: "specialist_datasets_disabled", message: "Los datasets de investigación están desactivados." }, { status: 404 });
    if (/^\/specialist-applications\/app_test\/datasets$/.test(path) && method === "GET") {
      if (listFailsWith) return Response.json(listFailsWith, { status: listFailsWith.status });
      if (!flags.datasetsEnabled) return disabled;
      return Response.json({ datasets: [...datasets].sort((left, right) => right.updatedAt - left.updatedAt) });
    }
    const refresh = path.match(/^\/specialist-applications\/app_test\/datasets\/([^/]+)\/refresh$/);
    if (refresh && method === "POST") {
      if (!flags.datasetsEnabled) return disabled;
      if (refreshBehavior) {
        await new Promise(resolve => setTimeout(resolve, refreshBehavior.delayMs));
        if (refreshBehavior.failWith) return Response.json(refreshBehavior.failWith, { status: refreshBehavior.failWith.status });
      }
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

async function flush(ms = 30) { await act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); }); }
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
function allByText(text: string, tag = "button"): HTMLElement[] {
  const selector = tag === "button" ? 'button, [role="menuitem"]' : tag;
  return [...document.querySelectorAll(selector)].filter(element => (element.textContent ?? "").includes(text)) as HTMLElement[];
}
function byText(text: string, tag = "button"): HTMLElement {
  const value = allByText(text, tag)[0];
  if (!value) throw new Error(`Missing ${selectorFor(tag)} with text "${text}". Document: ${document.body.textContent?.slice(0, 800)}`);
  return value;
}
function selectorFor(tag = "button") { return tag === "button" ? 'button/[role="menuitem"]' : tag; }
async function clickText(text: string, tag = "button") {
  await act(async () => { byText(text, tag).click(); });
  await flush();
}
function byAriaLabel(label: string): HTMLElement {
  const value = document.querySelector(`[aria-label="${label}"]`);
  if (!value) throw new Error(`Missing [aria-label="${label}"]. Document: ${document.body.textContent?.slice(0, 800)}`);
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
// La fila que contiene cierto texto de nombre (para preguntar cosas por fila, no globales).
function rowFor(name: string): HTMLElement {
  const row = [...document.querySelectorAll("div.rounded-md")].find(element => (element.textContent ?? "").includes(name));
  if (!row) throw new Error(`Missing row for "${name}"`);
  return row as HTMLElement;
}
function countRequests(method: string, matcher: RegExp): number {
  return datasetRequests.filter(entry => entry.method === method && matcher.test(entry.path)).length;
}

test("recorrido completo: menú → resumen → Gestionar → filas con workspace → expandir → Actualizar manda workspace y el detalle se vuelve a leer", async () => {
  await renderAt();
  await openLibraryDialog();

  // 1) Home con "Datos de investigación".
  expect(hasText("Datos de investigación")).toBe(true);

  // 2) Gestionar abre la vista con las filas completas.
  await clickText("Gestionar");
  expect(hasText("Datasets de investigación de Taller")).toBe(true);
  const fila = rowFor("search-aranceles-soja-1a2b3c4d");
  expect(fila.textContent).toContain("aranceles soja china"); // pregunta
  expect(fila.textContent).toContain("tavily/search"); // proveedor + operación
  expect(fila.textContent).toContain("2 snapshots"); // conteo
  expect(fila.textContent).toContain("actualizado"); // cuándo
  // Con dos workspaces la fila nombra al proyecto (no solo el resumen).
  const filaAnexo = rowFor("search-informe-gigante-3c3c3c3c");
  expect(filaAnexo.textContent).toContain("proyecto-anexo");
  // Fila derivada: sin botón "Actualizar" (no hay consulta que repetir).
  const filaDerivada = rowFor("precios-limpios-9f8e7d6c");
  expect([...filaDerivada.querySelectorAll("button")].some(element => element.textContent === "Actualizar")).toBe(false);
  expect([...filaAnexo.querySelectorAll("button")].some(element => element.textContent === "Actualizar")).toBe(true);

  // 3) Expandir: detalle con conteo de snapshots y preview <pre>; el GET detalle lleva ?workspace=.
  await clickAriaLabel("Ver snapshots de search-aranceles-soja-1a2b3c4d");
  expect(hasText("2 snapshots en el proyecto:")).toBe(true);
  expect(document.querySelector("pre")?.textContent ?? "").toContain("arancel");
  const detalle = datasetRequests.find(entry => entry.method === "GET" && /\/datasets\/ds-search-aranceles-soja-1a2b3c4d$/.test(entry.path));
  expect(detalle?.search).toBe("?workspace=ws_test");

  // 4) "Actualizar" sobre ESA fila: POST con ?workspace= del proyecto de la fila.
  const detallesAntes = countRequests("GET", /\/datasets\/ds-search-aranceles-soja-1a2b3c4d$/);
  const listasAntes = countRequests("GET", /^\/specialist-applications\/app_test\/datasets$/);
  await act(async () => { [...rowFor("search-aranceles-soja-1a2b3c4d").querySelectorAll("button")].find(element => element.textContent === "Actualizar")!.click(); });
  await flush();

  const post = datasetRequests.find(entry => entry.method === "POST");
  expect(post?.path).toBe("/specialist-applications/app_test/datasets/ds-search-aranceles-soja-1a2b3c4d/refresh");
  expect(post?.search).toBe("?workspace=ws_test");
  expect(hasText("Consulta re-ejecutada: el dataset quedó con un snapshot nuevo.")).toBe(true);
  // Refetch de la lista (snapshots 2 → 3 visible).
  expect(countRequests("GET", /^\/specialist-applications\/app_test\/datasets$/)).toBeGreaterThan(listasAntes);
  expect(rowFor("search-aranceles-soja-1a2b3c4d").textContent).toContain("3 snapshots");
  // FIX e60a3b1b: el detalle abierto se invalida y vuelve a pedir el snapshot NUEVO.
  // Si este assert falla, el usuario se queda mirando el snapshot viejo después de actualizar.
  expect(countRequests("GET", /\/datasets\/ds-search-aranceles-soja-1a2b3c4d$/)).toBeGreaterThan(detallesAntes);
});

test("refresh lento que falla (422 del provider): el botón queda bloqueado mientras corre y el error se ve, no se traga", async () => {
  await renderAt();
  await openLibraryDialog();
  await clickText("Gestionar");

  // Error verosímil sin Tavily conectado (investigación: el server burbujea el mensaje del
  // provider desde research-factory.ts:44; el estado exacto se verificó en Round 2).
  refreshBehavior = { delayMs: 80, failWith: { status: 422, code: "invalid_dataset", message: "Conectá Tavily desde Herramientas y fuentes para investigar." } };
  await clickAriaLabel("Ver snapshots de search-informe-gigante-3c3c3c3c");

  const boton = [...rowFor("search-informe-gigante-3c3c3c3c").querySelectorAll("button")].find(element => element.textContent === "Actualizar") as HTMLButtonElement;
  await act(async () => { boton.click(); });
  await flush(20); // la corrida aún está pendientando (80 ms)
  expect(boton.disabled).toBe(true); // busy: no se puede apretar dos veces

  await flush(120); // resuelve el 422
  const alertas = [...document.querySelectorAll('[role="alert"]')].map(element => element.textContent ?? "").join(" | ");
  expect(alertas).toContain("Conectá Tavily desde Herramientas y fuentes para investigar.");
  expect(hasText("Consulta re-ejecutada")).toBe(false); // no hubo notice mentiroso
  expect(boton.disabled).toBe(false); // la UI vuelve a ser usable
  expect(rowFor("search-informe-gigante-3c3c3c3c").textContent).toContain("1 snapshot"); // el conteo NO cambió
});

test("eliminar con confirmación inline: Cancelar no borra, Eliminar manda DELETE con workspace y la fila sale", async () => {
  await renderAt();
  await openLibraryDialog();
  await clickText("Gestionar");

  await clickAriaLabel("Eliminar search-informe-gigante-3c3c3c3c");
  expect(hasText('¿Eliminar "search-informe-gigante-3c3c3c3c"?')).toBe(true);
  await clickText("Cancelar");
  expect(datasetRequests.some(entry => entry.method === "DELETE")).toBe(false);
  expect(hasText("search-informe-gigante-3c3c3c3c")).toBe(true);

  await clickAriaLabel("Eliminar search-informe-gigante-3c3c3c3c");
  const confirmar = allByText("Eliminar").find(element => element.classList.contains("bg-destructive") || element.className.includes("destructive"));
  if (!confirmar) throw new Error("Missing destructive confirm button");
  await act(async () => { confirmar.click(); });
  await flush();
  const del = datasetRequests.find(entry => entry.method === "DELETE");
  expect(del?.path).toBe("/specialist-applications/app_test/datasets/ds-search-informe-gigante-3c3c3c3c");
  expect(del?.search).toBe("?workspace=ws_dos"); // el DELETE va al proyecto donde vive el dataset
  expect(hasText("Se eliminó search-informe-gigante-3c3c3c3c.")).toBe(true);
  // La fila ya no existe (ojo: el aviso de éxito menciona el nombre, hasText solo no alcanza).
  expect(document.querySelector('[aria-label="Eliminar search-informe-gigante-3c3c3c3c"]')).toBe(null);
});

test("datasetsEnabled=false: la sección no aparece y no se dispara NI UN request de datasets", async () => {
  flags = { libraryEnabled: true, scheduledTasksEnabled: false, datasetsEnabled: false };
  await renderAt();
  await openLibraryDialog();
  // Home renderiza {datasets ? <section>… : null} (library-dialog.tsx:113): la biblioteca funciona.
  expect(hasText("Datos de investigación")).toBe(false);
  expect(hasText("Contexto")).toBe(true);
  expect(datasetRequests.length).toBe(0); // ni GET de lista, aunque el server respondería 404
});

// Traba B-1 del informe, ya corregida: DatasetsSummary (library-dialog.tsx:252-256) ahora tiene una
// rama `query.isError` como DatasetsView y TasksSummary. Con la flag encendida pero el GET roto
// (500, corte de red, flags desincronizadas), el usuario lee el error y puede reintentar; nunca la
// mentira silenciosa "Sin datasets todavía…" que la celda A corrigió para tareas (HIVE-A-TEST.md traba 1).
test("traba B-1 corregida: error de lectura en el resumen de home se muestra con reintento, no como 'Sin datasets todavía'", async () => {
  // Rompo la lectura desde el principio (sin datos previos en el cache): el server real puede
  // dar 500 (ver Round 2 / HIVE-B-TEST.md).
  listFailsWith = { status: 500, code: "internal_error", message: "Unexpected server error" };
  await renderAt();
  await openLibraryDialog();
  expect(hasText("Datos de investigación")).toBe(true); // la flag está encendida, la sección existe
  expect(datasetRequests.some(entry => entry.method === "GET" && entry.path.endsWith("/datasets"))).toBe(true);
  expect(hasText("No se pudieron leer los datasets")).toBe(true);
  expect(hasText("Volver a intentar")).toBe(true);
  expect(hasText("Sin datasets todavía")).toBe(false); // la mentira ya no aparece
});
