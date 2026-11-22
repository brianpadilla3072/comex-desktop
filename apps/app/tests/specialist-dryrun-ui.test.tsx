/** @jsxImportSource react */
// Test de usuario REAL del ensayo de tareas (celda F3): el botón "Ensayar" aparece con la flag
// taskDryRun, lanza el dry-run y avisa que no guardó nada; sin la flag, el botón no existe.
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
let flags: { libraryEnabled: boolean; scheduledTasksEnabled: boolean; datasetsEnabled: boolean; sourcesEnabled: boolean; panelsEnabled: boolean; outputsEnabled: boolean; taskDryRunEnabled: boolean };
let dryCalls: Array<{ method: string; path: string }> = [];

const APP = { id: "app_test", name: "Taller", specialty: "Prueba", personality: "Clara", template: "custom" as const, agentCount: 1, skillCount: 1, createdAt: 1, workspaceIds: ["ws_test"] };
const catalog = () => ({
  enabled: true,
  libraryEnabled: flags.libraryEnabled,
  scheduledTasksEnabled: flags.scheduledTasksEnabled,
  datasetsEnabled: flags.datasetsEnabled,
  sourcesEnabled: flags.sourcesEnabled,
  panelsEnabled: flags.panelsEnabled,
  outputsEnabled: flags.outputsEnabled,
  taskDryRunEnabled: flags.taskDryRunEnabled,
  integrationsEnabled: false,
  user: { id: "local", displayName: "Usuario de prueba" },
  activeApplicationId: APP.id,
  applications: [APP],
});
const TASK = { id: "task_1", name: "refrescar", prompt: "Refrescar datos.", schedule: { kind: "interval", everyMinutes: 20 }, enabled: true, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000, nextRunAt: 1_700_000_500_000, lastRunAt: null, lastStatus: null, runs: 0, running: null };

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  if (!("ResizeObserver" in globalThis)) Reflect.set(globalThis, "ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  if (!("IntersectionObserver" in globalThis)) Reflect.set(globalThis, "IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } });
  flags = { libraryEnabled: true, scheduledTasksEnabled: true, datasetsEnabled: true, sourcesEnabled: true, panelsEnabled: true, outputsEnabled: true, taskDryRunEnabled: true };
  dryCalls = [];
  const spy = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    if (path.includes("/dry-run")) dryCalls.push({ method, path });
    if (path === "/specialist-applications" && method === "GET") return Response.json(catalog());
    if (path === "/specialist-applications/app_test/library" && method === "GET") return Response.json({ application: { id: APP.id, name: APP.name }, agents: [], skills: [], files: [], context: { exists: false, bytes: 0 }, counts: { agents: 0, skills: 0 } });
    if (path === "/specialist-applications/app_test/library/proposals" && method === "GET") return Response.json({ proposals: [] });
    if (path === "/specialist-applications/app_test/datasets" && method === "GET") return Response.json({ datasets: [] });
    if (path === "/specialist-applications/app_test/sources" && method === "GET") return Response.json({ sources: [] });
    if (path === "/specialist-applications/app_test/panels" && method === "GET") return Response.json({ panels: [] });
    if (path === "/specialist-applications/app_test/outputs" && method === "GET") return Response.json({ outputs: [] });
    if (path === "/specialist-applications/app_test/tasks" && method === "GET") return Response.json({ tasks: [TASK] });
    if (path === "/specialist-applications/app_test/tasks/task_1/dry-run" && method === "POST") {
      if (!flags.taskDryRunEnabled) return Response.json({ code: "task_dry_run_disabled", message: "El ensayo de tareas está desactivado." }, { status: 404 });
      return Response.json({ started: true, sessionId: "ses_dry_1", workspaceId: "ws_test", detail: null, note: "Ensayo lanzado en una sesión aparte: nada se guardó ni se programó." });
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
function hasText(text: string): boolean { return (document.body.textContent ?? "").includes(text); }
async function openTasksView() {
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
  const trigger = document.querySelector('[aria-label="Cambiar aplicación especialista"]');
  if (!trigger) throw new Error("Missing switcher");
  await act(async () => { trigger.click(); });
  await flush();
  const item = [...document.querySelectorAll('button, [role="menuitem"]')].find(el => (el.textContent ?? "").includes("Contexto, agentes y skills"));
  if (!item) throw new Error("Missing menu item");
  await act(async () => { item.click(); });
  await flush();
  const sections = [...document.querySelectorAll("section")];
  const section = sections.find(s => (s.textContent ?? "").startsWith("Tareas programadas"));
  if (!section) throw new Error("Missing Tareas section");
  await act(async () => { [...section.querySelectorAll("button")].find(b => (b.textContent ?? "").includes("Gestionar"))!.click(); });
  await flush();
}

test("ensayar: botón visible con la flag, lanza el dry-run y avisa que no guardó nada", async () => {
  await openTasksView();
  expect(hasText("Tareas programadas de Taller")).toBe(true);
  const row = [...document.querySelectorAll("div.rounded-md")].find(el => (el.textContent ?? "").includes("refrescar"));
  if (!row) throw new Error("Missing task row");
  expect((row as HTMLElement).textContent).toContain("Ensayar");
  await act(async () => { [...(row as HTMLElement).querySelectorAll("button")].find(b => (b.textContent ?? "").includes("Ensayar"))!.click(); });
  await flush(150);
  expect(dryCalls.length).toBe(1);
  expect(dryCalls[0]!.path).toBe("/specialist-applications/app_test/tasks/task_1/dry-run");
  expect(hasText("Ensayo lanzado")).toBe(true);
});

test("taskDryRunEnabled=false: el botón Ensayar no existe", async () => {
  flags = { ...flags, taskDryRunEnabled: false };
  await openTasksView();
  const row = [...document.querySelectorAll("div.rounded-md")].find(el => (el.textContent ?? "").includes("refrescar"));
  expect((row as HTMLElement).textContent).not.toContain("Ensayar");
  expect(dryCalls.length).toBe(0);
});
