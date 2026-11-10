/** @jsxImportSource react */
// Test de usuario REAL de la captura ampliada (celda C2): propuestas kind task/plan.
// Verifica que la UI (library-dialog.tsx ProposalsSection) muestre el badge del kind, el resumen
// en lenguaje humano ("Se crea PAUSADA"), que Aceptar muestre el resultado por pieza que devuelve
// el server ({ applied } de routes.ts) y que la sección se vea también sin biblioteca (tareas/datos).
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

type FakeProposal = { id: string; kind: string; name: string; description: string; content: string; reason: string; createdAt: number };
let flags: { libraryEnabled: boolean; scheduledTasksEnabled: boolean; datasetsEnabled: boolean };
let proposals: FakeProposal[];
let acceptResult: Record<string, unknown> | null = null;
let acceptCalls: string[] = [];

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
let tasks: Array<{ id: string; name: string; prompt: string; enabled: boolean; nextRunAt: number; runs: number; schedule: { kind: string; everyMinutes: number }; running: null }> = [];
const tasksPayload = () => ({ tasks });

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  if (!("ResizeObserver" in globalThis)) Reflect.set(globalThis, "ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  if (!("IntersectionObserver" in globalThis)) Reflect.set(globalThis, "IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } });
  flags = { libraryEnabled: true, scheduledTasksEnabled: true, datasetsEnabled: true };
  tasks = [];
  proposals = [
    { id: "prop_task", kind: "task", name: "refrescar aranceles", description: "Cada 20 minutos traer los aranceles.", content: JSON.stringify({ prompt: "Consultá.", schedule: { kind: "interval", everyMinutes: 20 } }), reason: "Se repite.", createdAt: 1_700_000_000_000 },
    { id: "prop_plan", kind: "plan", name: "programa aranceles", description: "Varias piezas juntas.", content: JSON.stringify({ skill: { name: "traer-aranceles", description: "Busca.", content: "# pasos" }, dataset: { name: "aranceles", query: { provider: "tavily", operation: "search", input: { query: "arancel soja" } } }, panel: { name: "aranceles-panel", spec: { title: "Aranceles", source: { dataset: "aranceles" }, blocks: [{ type: "table" }] } }, task: { prompt: "Refrescá.", schedule: { kind: "interval", everyMinutes: 20 } } }), reason: "Se repite.", createdAt: 1_700_000_100_000 },
    { id: "prop_skill", kind: "skill", name: "metodo-lento", description: "Un procedimiento.", content: "# pasos", reason: "", createdAt: 1_700_000_200_000 },
  ];
  acceptResult = null;
  acceptCalls = [];
  const spy = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    if (path === "/specialist-applications" && method === "GET") return Response.json(catalog());
    if (path === "/specialist-applications/app_test/library" && method === "GET") {
      if (!flags.libraryEnabled) return Response.json({ code: "specialist_library_disabled", message: "desactivada" }, { status: 404 });
      return Response.json({ application: { id: APP.id, name: APP.name }, agents: [], skills: [], files: [], context: { exists: false, bytes: 0 }, counts: { agents: 0, skills: 0 } });
    }
    if (path === "/specialist-applications/app_test/library/proposals" && method === "GET") {
      const anyFamily = flags.libraryEnabled || flags.scheduledTasksEnabled || flags.datasetsEnabled;
      if (!anyFamily) return Response.json({ code: "specialist_library_disabled", message: "desactivada" }, { status: 404 });
      return Response.json({ proposals });
    }
    const accept = path.match(/^\/specialist-applications\/app_test\/library\/proposals\/([^/]+)\/accept$/);
    if (accept && method === "POST") {
      acceptCalls.push(accept[1]!);
      proposals = proposals.filter(p => p.id !== accept[1]);
      return Response.json(acceptResult ?? { accepted: accept[1], applied: [{ piece: "tarea", ok: true }] });
    }
    const dismiss = path.match(/^\/specialist-applications\/app_test\/library\/proposals\/([^/]+)$/);
    if (dismiss && method === "DELETE") {
      proposals = proposals.filter(p => p.id !== dismiss[1]);
      return Response.json({ dismissed: dismiss[1] });
    }
    if (path === "/specialist-applications/app_test/tasks" && method === "GET") return Response.json(tasksPayload());
    if (path === "/specialist-applications/app_test/datasets" && method === "GET") return Response.json({ datasets: [] });
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
  // La etiqueta del menú es honesta según las flags: con biblioteca dice "Contexto…", sin ella "Tareas · Datos".
  const item = [...document.querySelectorAll('button, [role="menuitem"]')].find(el => {
    const text = el.textContent ?? "";
    return text.includes("Contexto, agentes y skills") || text.includes("Tareas · Datos");
  });
  if (!item) throw new Error("Missing menu item");
  await act(async () => { item.click(); });
  await flush();
}
function rowFor(name: string): HTMLElement {
  const row = [...document.querySelectorAll("div.rounded-md")].find(el => (el.textContent ?? "").includes(name));
  if (!row) throw new Error(`Missing row ${name}; doc: ${document.body.textContent?.slice(0, 800)}`);
  return row as HTMLElement;
}

test("propuestas task/plan: badge del kind, resumen humano y resultado por pieza al aceptar", async () => {
  await renderAt();
  await openLibraryDialog();
  expect(hasText("Propuestas pendientes (3)")).toBe(true);
  const filaTarea = rowFor("refrescar aranceles");
  expect(filaTarea.textContent).toContain("Tarea");
  expect(filaTarea.textContent).toContain("Se crea PAUSADA");
  expect(filaTarea.textContent).toContain("Cada 20 min");
  const filaPlan = rowFor("programa aranceles");
  expect(filaPlan.textContent).toContain("Plan");
  expect(filaPlan.textContent).toContain("skill + dataset + panel + tarea pausada");
  const filaSkill = rowFor("metodo-lento");
  expect(filaSkill.textContent).toContain("Skill");
  expect(filaSkill.textContent).not.toContain("Se crea PAUSADA");

  acceptResult = { accepted: "prop_plan", applied: [
    { piece: "skill", ok: true }, { piece: "dataset", ok: true },
    { piece: "panel", ok: false, detail: "Los paneles están desactivados." }, { piece: "tarea", ok: true },
  ] };
  await act(async () => { [...filaPlan.querySelectorAll("button")].find(b => b.textContent === "Aceptar")!.click(); });
  await flush();
  expect(acceptCalls).toEqual(["prop_plan"]);
  expect(hasText("Resultado de la propuesta aceptada")).toBe(true);
  expect(hasText("panel — Los paneles están desactivados.")).toBe(true);
  expect(hasText("✓ skill")).toBe(true);
  // La propuesta aceptada sale de la lista.
  expect(hasText("Propuestas pendientes (2)")).toBe(true);
});

test("descartar una propuesta de tarea no crea nada y la saca de la lista", async () => {
  await renderAt();
  await openLibraryDialog();
  const filaTarea = rowFor("refrescar aranceles");
  await act(async () => { [...filaTarea.querySelectorAll("button")].find(b => b.textContent === "Descartar")!.click(); });
  await flush();
  expect(acceptCalls).toEqual([]);
  expect(hasText("Propuestas pendientes (2)")).toBe(true);
  expect(hasText("refrescar aranceles")).toBe(false);
});

test("sin biblioteca pero con tareas/datos, las propuestas igual se ven", async () => {
  flags = { libraryEnabled: false, scheduledTasksEnabled: true, datasetsEnabled: true };
  await renderAt();
  await openLibraryDialog();
  expect(hasText("Propuestas pendientes (3)")).toBe(true);
  expect(hasText("Tarea")).toBe(true);
});

test("aceptar una tarea la muestra en el acto, sin esperar el sondeo de 30 s", async () => {
  await renderAt();
  await openLibraryDialog();
  expect(hasText("Sin tareas programadas.")).toBe(true);
  acceptResult = { accepted: "prop_task", applied: [{ piece: "tarea", ok: true }] };
  tasks = [{ id: "task_1", name: "refrescar aranceles", prompt: "Consultá.", enabled: false, nextRunAt: 0, runs: 0, schedule: { kind: "interval", everyMinutes: 20 }, running: null }];
  await act(async () => { [...rowFor("refrescar aranceles").querySelectorAll("button")].find(b => b.textContent === "Aceptar")!.click(); });
  await flush(80);
  expect(hasText("refrescar aranceles")).toBe(true);
  expect(hasText("Pausada")).toBe(true);
});
