/** @jsxImportSource react */
// Test de usuario REAL de las celdas F (F1 fuentes locales, F3 dry-run, F4 presupuesto vivo,
// F5 plan OpenAPI): el recorrido completo de cada celda con la app diciendo la verdad en cada
// paso. Harness idéntico a specialist-dryrun-ui.test.tsx: mock de openwork-connection, render
// de SpecialistApplicationsProvider + SpecialistApplicationSwitcher vía MemoryRouter, y el
// diálogo se abre desde el menú ("Contexto, agentes y skills"). Fetch mockeado con las formas
// JSON reales de apps/server/src/specialists/routes.ts y
// apps/server/src/specialists/library-tool-api.ts:
//  - catálogo con { enabled, libraryEnabled, scheduledTasksEnabled, taskDryRunEnabled,
//    datasetsEnabled, panelsEnabled, sourcesEnabled, sourcesLocalFilesEnabled, outputsEnabled,
//    user, activeApplicationId, applications }
//  - { sources } / POST { source } (201) / 422 { code:"invalid_source", message }
//  - { tasks } / POST dry-run { started, sessionId, workspaceId, detail, note }
//  - { proposals } / POST accept { accepted, applied: [{ piece, ok, id?, detail? }] }
//  - plan OpenAPI tal como lo arma specialist_openapi_propose: skill + dataset (provider
//    "openapi", re-ejecutable) + panel de tabla, sin credenciales embebidas.
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

type Flags = {
  libraryEnabled: boolean; scheduledTasksEnabled: boolean; datasetsEnabled: boolean;
  sourcesEnabled: boolean; sourcesLocalFilesEnabled: boolean;
  panelsEnabled: boolean; outputsEnabled: boolean; taskDryRunEnabled: boolean;
};
type FakeSource = { id: string; provider: string; title: string; url: string | null; evidencePath: string; datasetId: string | null; retrievedAt: number; chunks: number; workspaceId: string; workspaceName: string };
type FakeProposal = { id: string; kind: string; name: string; description: string; content: string; reason: string; createdAt: number };
type FakeTask = { id: string; name: string; prompt: string; schedule: Record<string, unknown>; enabled: boolean; createdAt: number; updatedAt: number; nextRunAt: number | null; lastRunAt: number | null; lastStatus: string | null; runs: number; running: null };

let flags: Flags;
let sources: FakeSource[];
let proposals: FakeProposal[];
let tasks: FakeTask[];
let localCalls: Array<{ method: string; path: string; body: unknown }> = [];
let dryCalls: Array<{ method: string; path: string }> = [];
let acceptCalls: string[] = [];
let acceptApplied: Array<{ piece: string; ok: boolean; id?: string; detail?: string }> | null = null;

const APP = { id: "app_test", name: "Taller", specialty: "Prueba", personality: "Clara", template: "custom" as const, agentCount: 1, skillCount: 1, createdAt: 1, workspaceIds: ["ws_test"] };
const catalog = () => ({
  enabled: true,
  libraryEnabled: flags.libraryEnabled,
  scheduledTasksEnabled: flags.scheduledTasksEnabled,
  taskDryRunEnabled: flags.taskDryRunEnabled,
  datasetsEnabled: flags.datasetsEnabled,
  panelsEnabled: flags.panelsEnabled,
  sourcesEnabled: flags.sourcesEnabled,
  sourcesLocalFilesEnabled: flags.sourcesLocalFilesEnabled,
  outputsEnabled: flags.outputsEnabled,
  integrationsEnabled: false,
  user: { id: "local", displayName: "Usuario de prueba" },
  activeApplicationId: APP.id,
  applications: [APP],
});
const TASK: FakeTask = { id: "task_1", name: "refrescar", prompt: "Refrescar datos.", schedule: { kind: "interval", everyMinutes: 20 }, enabled: true, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000, nextRunAt: 1_700_000_500_000, lastRunAt: null, lastStatus: null, runs: 0, running: null };

// F5: plan tal como lo fabrica specialist_openapi_propose en library-tool-api.ts — skill +
// dataset re-ejecutable sobre el endpoint + panel de tabla, sin credenciales.
const openapiPlanContent = JSON.stringify({
  skill: { name: "consultar-api-soja", description: "Consulta la API de api-soja y deja sus datos como dataset re-ejecutable.", content: "# Consultar api-soja\n\nUsa el endpoint `/precios` de la API para responder consultas. Los datos quedan como dataset re-ejecutable `api-soja`.\n\n## Pasos\n1. Llamá al endpoint con los parámetros que pida la persona (autenticación: las credenciales viven en la integración del usuario, NUNCA embebidas en este skill ni en el dataset).\n2. Guardá la respuesta como snapshot del dataset y citá [fuente:<id>#<n>] tras leer cada pasaje con specialist_source_read.\n3. Si la API falla, decilo en voz alta: nunca inventes cifras." },
  dataset: { name: "api-soja", query: { provider: "openapi", operation: "fetch", input: { url: "https://api.ejemplo.test/precios", method: "GET", operationId: "listPrecios", specNote: "Consulta re-ejecutable sobre la API; autenticación vía integración del usuario, nunca embebida." } } },
  panel: { name: "api-soja-panel", spec: { title: "api-soja", source: { dataset: "api-soja" }, refresh: { watch: "latest" }, blocks: [{ type: "table", limit: 50 }] } },
});

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  if (!("ResizeObserver" in globalThis)) Reflect.set(globalThis, "ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  if (!("IntersectionObserver" in globalThis)) Reflect.set(globalThis, "IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } });
  flags = { libraryEnabled: true, scheduledTasksEnabled: true, datasetsEnabled: true, sourcesEnabled: true, sourcesLocalFilesEnabled: true, panelsEnabled: true, outputsEnabled: true, taskDryRunEnabled: true };
  sources = [];
  // Dos propuestas (F-1): con una sola, el accept hace que la sección devuelva null y el
  // resultado por pieza desaparece — ver HIVE-F-TEST.md. La segunda garantiza que la sección
  // siga visible para asertar el resultado honesto sin endosar el bug.
  proposals = [
    { id: "prop_openapi", kind: "plan", name: "api-api-soja", description: "Pack de consulta para la API de api-soja (2 GET).", content: openapiPlanContent, reason: "Propuesto desde el spec OpenAPI.", createdAt: 1_700_000_000_000 },
    { id: "prop_skill_retry", kind: "skill", name: "otra-skill", description: "Un procedimiento.", content: "# pasos", reason: "", createdAt: 1_700_000_100_000 },
  ];
  tasks = [TASK];
  localCalls = [];
  dryCalls = [];
  acceptCalls = [];
  acceptApplied = null;
  const spy = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const body = ["POST", "PUT", "PATCH"].includes(method) ? await request.json().catch(() => null) : null;
    if (path.includes("/sources/local")) localCalls.push({ method, path, body });
    if (path.includes("/dry-run")) dryCalls.push({ method, path });

    if (path === "/specialist-applications" && method === "GET") return Response.json(catalog());
    if (path === "/specialist-applications/app_test/library" && method === "GET") return Response.json({ application: { id: APP.id, name: APP.name }, agents: [], skills: [], files: [], context: { exists: false, bytes: 0 }, counts: { agents: 0, skills: 0 } });
    if (path === "/specialist-applications/app_test/library/proposals" && method === "GET") return Response.json({ proposals });
    const accept = path.match(/^\/specialist-applications\/app_test\/library\/proposals\/([^/]+)\/accept$/);
    if (accept && method === "POST") {
      acceptCalls.push(accept[1]!);
      proposals = proposals.filter(p => p.id !== accept[1]);
      return Response.json({ accepted: accept[1], applied: acceptApplied ?? [{ piece: "skill", ok: true }, { piece: "dataset", ok: true }, { piece: "panel", ok: true }], catalog: catalog() });
    }
    const dismiss = path.match(/^\/specialist-applications\/app_test\/library\/proposals\/([^/]+)$/);
    if (dismiss && method === "DELETE") {
      proposals = proposals.filter(p => p.id !== dismiss[1]);
      return Response.json({ dismissed: dismiss[1] });
    }
    if (path === "/specialist-applications/app_test/tasks" && method === "GET") return Response.json({ tasks });
    if (path === "/specialist-applications/app_test/tasks/task_1/dry-run" && method === "POST") {
      if (!flags.taskDryRunEnabled) return Response.json({ code: "task_dry_run_disabled", message: "El ensayo de tareas está desactivado." }, { status: 404 });
      return Response.json({ started: true, sessionId: "ses_dry_1", workspaceId: "ws_test", detail: null, note: "Ensayo lanzado en una sesión aparte: nada se guardó ni se programó." });
    }
    if (path === "/specialist-applications/app_test/datasets" && method === "GET") return Response.json({ datasets: [] });
    if (path === "/specialist-applications/app_test/sources" && method === "GET") {
      if (!flags.sourcesEnabled) return Response.json({ code: "specialist_sources_disabled", message: "Las fuentes citables están desactivadas." }, { status: 404 });
      return Response.json({ sources: [...sources].sort((a, b) => b.retrievedAt - a.retrievedAt) });
    }
    if (path === "/specialist-applications/app_test/sources/local" && method === "POST") {
      if (!flags.sourcesEnabled) return Response.json({ code: "specialist_sources_disabled", message: "Las fuentes citables están desactivadas." }, { status: 404 });
      if (!flags.sourcesLocalFilesEnabled) return Response.json({ code: "sources_local_files_disabled", message: "Las fuentes locales están desactivadas." }, { status: 404 });
      // routes.ts: zod valida { path: trim 1..500 } → 422; sources.ts registerLocalSource:
      // formato no indexable (PDF/XLSX) → 422, archivo inexistente → 422.
      const rawPath = typeof (body as Record<string, unknown> | null)?.path === "string" ? ((body as Record<string, unknown>).path as string).trim() : "";
      if (!rawPath) return Response.json({ code: "invalid_source", message: "Revisá la ruta del archivo local." }, { status: 422 });
      if (/\.pdf$/i.test(rawPath)) return Response.json({ code: "invalid_source", message: "El formato .pdf todavía no se puede indexar como fuente (PDF/XLSX pendientes de extractor)." }, { status: 422 });
      if (rawPath === "noexiste.md" || rawPath.includes("..")) return Response.json({ code: "invalid_source", message: "Ese archivo no existe en este proyecto." }, { status: 422 });
      const title = rawPath.split("/").pop() ?? rawPath;
      const source: FakeSource = { id: "src_local_9f8a7b6c", provider: "file", title, url: null, evidencePath: `comex/fuentes/local/1700000000000-9f8a7b6c-${title}`, datasetId: null, retrievedAt: 1_700_001_000_000, chunks: 0, workspaceId: "ws_test", workspaceName: "proyecto-principal" };
      sources = [source, ...sources];
      return Response.json({ source: { ...source, workspaceName: "proyecto-principal" } }, { status: 201 });
    }
    if (path === "/specialist-applications/app_test/panels" && method === "GET") return Response.json({ panels: [] });
    if (path === "/specialist-applications/app_test/outputs" && method === "GET") return Response.json({ outputs: [] });
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
  if (!section) throw new Error(`Missing section "${start}"`);
  await act(async () => { [...section.querySelectorAll("button")].find(b => (b.textContent ?? "").includes("Gestionar"))!.click(); });
  await flush();
}
async function edit(id: string, value: string) {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) throw new Error(`Missing field ${id}; doc: ${document.body.textContent?.slice(0, 800)}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
}
function rowFor(name: string): HTMLElement {
  const row = [...document.querySelectorAll("div.rounded-md")].find(el => (el.textContent ?? "").includes(name));
  if (!row) throw new Error(`Missing row ${name}; doc: ${document.body.textContent?.slice(0, 1000)}`);
  return row as HTMLElement;
}
async function clickText(text: string, rootEl: ParentNode = document) {
  const btn = [...rootEl.querySelectorAll("button")].find(b => (b.textContent ?? "").includes(text));
  if (!btn) throw new Error(`Missing button "${text}"`);
  await act(async () => { btn.click(); });
  await flush();
}

// ── F1: fuentes locales ──
test("F1: con sourcesLocalFilesEnabled, Fuentes muestra el formulario Archivo local y registrar POSTea /sources/local con el path tipeado y avisa con el nuevo id", async () => {
  await renderAt();
  await openLibraryDialog();
  await openSection("Fuentes citables");
  expect(hasText("Fuentes citables de Taller")).toBe(true);
  expect(hasText("Archivo local")).toBe(true);
  expect(hasText("Registrar archivo")).toBe(true);

  await clickText("Registrar archivo");
  expect(document.getElementById("source-local-path")).not.toBeNull();
  expect(hasText("Ruta en el proyecto (texto, CSV, Markdown o HTML)")).toBe(true);

  await edit("source-local-path", "datos/informe.md");
  await clickText("Registrar como fuente");
  await flush(120);

  // El POST lleva el path tal como se tipeó (routes.ts: { path }).
  expect(localCalls.length).toBe(1);
  expect(localCalls[0]!.path).toBe("/specialist-applications/app_test/sources/local");
  expect((localCalls[0]!.body as Record<string, unknown>).path).toBe("datos/informe.md");

  // Éxito honesto: el aviso nombra la fuente y su id citable, y la fila nueva aparece en la lista.
  expect(hasText("Fuente registrada: informe.md")).toBe(true);
  expect(hasText("[fuente:src_local_9f8a7b6c#n]")).toBe(true);
  expect(hasText("informe.md")).toBe(true);
  expect(hasText("file")).toBe(true);
});

test("F1: un 422 del server (formato no indexable) se muestra como error del formulario, no cierra en silencio", async () => {
  await renderAt();
  await openLibraryDialog();
  await openSection("Fuentes citables");
  await clickText("Registrar archivo");
  await edit("source-local-path", "datos/roto.pdf");
  await clickText("Registrar como fuente");
  await flush(120);

  expect(localCalls.length).toBe(1);
  expect(hasText("El formato .pdf todavía no se puede indexar como fuente")).toBe(true);
  const alert = document.querySelector('[role="alert"]')?.textContent ?? "";
  expect(alert).toContain("PDF/XLSX pendientes de extractor");
  // El formulario sigue abierto: no hubo cierre silencioso ni aviso de éxito.
  expect(document.getElementById("source-local-path")).not.toBeNull();
  expect(hasText("Registrar como fuente")).toBe(true);
  expect(hasText("Fuente registrada:")).toBe(false);
});

test("F1 gating: con sourcesLocalFilesEnabled=false el formulario Archivo local no aparece", async () => {
  flags = { ...flags, sourcesLocalFilesEnabled: false };
  await renderAt();
  await openLibraryDialog();
  await openSection("Fuentes citables");
  expect(hasText("Archivo local")).toBe(false);
  expect(hasText("Registrar archivo")).toBe(false);
  expect(document.getElementById("source-local-path")).toBeNull();
  expect(localCalls.length).toBe(0);
});

// ── F3: dry-run ──
test("F3: con taskDryRunEnabled, el botón Ensayar existe por tarea y al clic muestra el aviso de que no guardó nada", async () => {
  await renderAt();
  await openLibraryDialog();
  await openSection("Tareas programadas");
  expect(hasText("Tareas programadas de Taller")).toBe(true);
  const row = rowFor("refrescar");
  expect(row.textContent).toContain("Ensayar");
  await act(async () => { [...row.querySelectorAll("button")].find(b => (b.textContent ?? "").includes("Ensayar"))!.click(); });
  await flush(150);
  expect(dryCalls.length).toBe(1);
  expect(dryCalls[0]!.path).toBe("/specialist-applications/app_test/tasks/task_1/dry-run");
  expect(hasText("Ensayo lanzado")).toBe(true);
  expect(hasText("no guarda nada")).toBe(true);
});

test("F3 gating: con taskDryRunEnabled=false el botón Ensayar no existe", async () => {
  flags = { ...flags, taskDryRunEnabled: false };
  await renderAt();
  await openLibraryDialog();
  await openSection("Tareas programadas");
  const row = rowFor("refrescar");
  expect(row.textContent).not.toContain("Ensayar");
  expect(dryCalls.length).toBe(0);
});

// ── F4: presupuesto vivo ──
test("F4: Nueva tarea con prompt muestra la línea viva Costo estimado con corridas/día", async () => {
  await renderAt();
  await openLibraryDialog();
  await openSection("Tareas programadas");
  await clickText("Nueva tarea");
  await edit("task-name", "actualizar precios");
  await edit("task-prompt", "Consultá las fuentes de costo de flete y actualizá la planilla del proyecto.");
  // Intervalo por defecto 20 min → 72 corridas/día según estimateTaskBudget de tasks.ts.
  expect(hasText("Costo estimado:")).toBe(true);
  expect(hasText("corridas/día")).toBe(true);
  expect(hasText("72 corridas/día")).toBe(true);
  // No hay problema de horario con el valor por defecto.
  expect(hasText("Indicá cada cuántos minutos")).toBe(false);
});

test("F4: intervalo inválido (0) oculta el presupuesto y muestra el problema de horario en su lugar", async () => {
  await renderAt();
  await openLibraryDialog();
  await openSection("Tareas programadas");
  await clickText("Nueva tarea");
  await edit("task-name", "actualizar precios");
  await edit("task-prompt", "Consultá las fuentes de costo de flete y actualizá la planilla del proyecto.");
  expect(hasText("Costo estimado:")).toBe(true);

  await edit("task-every", "0");
  await flush(60);
  // Sin línea de presupuesto mientras el horario no valida (scheduleProblem): no se miente un costo.
  expect(hasText("Costo estimado:")).toBe(false);
  expect(hasText("Indicá cada cuántos minutos: un entero entre 1 y 43200.")).toBe(true);
  const alert = document.querySelector('[role="alert"]')?.textContent ?? "";
  expect(alert).toContain("Indicá cada cuántos minutos");

  // Volver a un valor válido recupera la estimación en vivo.
  await edit("task-every", "60");
  expect(hasText("Costo estimado:")).toBe(true);
  expect(hasText("24 corridas/día")).toBe(true);
});

test("F4: kind once muestra Una sola corrida en vez de corridas/día", async () => {
  await renderAt();
  await openLibraryDialog();
  await openSection("Tareas programadas");
  await clickText("Nueva tarea");
  await edit("task-name", "aviso único");
  await edit("task-prompt", "Mandá el resumen mensual por correo.");
  await clickText("Una vez");
  expect(hasText("Costo estimado:")).toBe(true);
  expect(hasText("Una sola corrida: sin costo recurrente.")).toBe(true);
  expect(hasText("corridas/día")).toBe(false);
  // La fecha es obligatoria para crear, pero el presupuesto ya dice la verdad sin ella.
  expect(document.getElementById("task-once")).not.toBeNull();
});

// ── F5: plan OpenAPI ──
test("F5: el plan OpenAPI (skill+dataset+panel) muestra badge Plan, resumen de piezas y al aceptar el resultado por pieza", async () => {
  await renderAt();
  await openLibraryDialog();
  expect(hasText("Propuestas pendientes (2)")).toBe(true);
  const card = rowFor("api-api-soja");
  expect(card.textContent).toContain("Plan");
  expect(card.textContent).toContain("skill + dataset + panel");
  expect(card.textContent).not.toContain("tarea pausada");
  expect(card.textContent).toContain("Pack de consulta para la API de api-soja");

  acceptApplied = [{ piece: "skill", ok: true }, { piece: "dataset", ok: true }, { piece: "panel", ok: true }];
  await act(async () => { [...card.querySelectorAll("button")].find(b => (b.textContent ?? "") === "Aceptar")!.click(); });
  await flush(120);
  expect(acceptCalls).toEqual(["prop_openapi"]);
  expect(hasText("Resultado de la propuesta aceptada")).toBe(true);
  expect(hasText("✓ skill")).toBe(true);
  expect(hasText("✓ dataset")).toBe(true);
  expect(hasText("✓ panel")).toBe(true);
  // La propuesta aceptada sale del inbox; queda la otra (F-1).
  expect(hasText("Propuestas pendientes (1)")).toBe(true);
  expect(hasText("otra-skill")).toBe(true);
});
