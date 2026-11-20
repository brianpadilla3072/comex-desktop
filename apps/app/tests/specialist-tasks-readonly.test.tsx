/** @jsxImportSource react */
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://localhost/" });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { MemoryRouter } = await import("react-router");
const { createOpenworkServerClient } = await import("../src/app/lib/openwork-server");
const { SpecialistTasksView } = await import("../src/react-app/domains/specialists/library-dialog");

// Hive QA w5-1: the web app (collaborator token) offered "Nueva tarea", "Correr ahora", "Pausar"
// and delete; every one is a host route, so the person filled a form that failed on submit.
const app = { id: "app_1", name: "Demo", specialty: "", personality: "", template: "custom" as const, agentCount: 0, skillCount: 0, createdAt: 0, workspaceIds: ["ws_1"] };
const task = { id: "task_1", name: "Precios", prompt: "Actualizar", schedule: { kind: "daily", hour: 9, minute: 0 }, enabled: true, createdAt: 0, updatedAt: 0, nextRunAt: null, lastRunAt: null, lastStatus: null, runs: 0, running: null };
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const originalFetch = globalThis.fetch;
beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  globalThis.fetch = Object.assign(async () => new Response(JSON.stringify({ tasks: [task] }), { headers: { "content-type": "application/json" } }), { preconnect: originalFetch.preconnect });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); globalThis.fetch = originalFetch; });
afterAll(async () => { await GlobalRegistrator.unregister(); });

async function render(readOnly: boolean) {
  const client = createOpenworkServerClient({ baseUrl: "http://localhost/tasks-test" });
  await act(async () => root.render(<MemoryRouter><QueryClientProvider client={new QueryClient()}><SpecialistTasksView app={app} client={client} dryRun readOnly={readOnly} onBack={() => undefined} /></QueryClientProvider></MemoryRouter>));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  return [...host.querySelectorAll("button")].map(button => (button.textContent || button.getAttribute("aria-label")) ?? "");
}

test("a read-only connection lists tasks and runs but offers no write action", async () => {
  const labels = await render(true);
  expect(host.textContent).toContain("Precios");
  expect(labels).toContain("Corridas");
  for (const hidden of ["Nueva tarea", "Correr ahora", "Ensayar", "Pausar", "Eliminar Precios"]) expect(labels).not.toContain(hidden);
  expect(host.textContent).toContain("app de escritorio");
  // The web offers pairing this browser to get full access.
  expect(host.querySelector("[data-pair-device-hint]")?.getAttribute("href")).toBe("/pair");
});

test("a writable connection keeps every action", async () => {
  const labels = await render(false);
  for (const shown of ["Nueva tarea", "Correr ahora", "Ensayar", "Pausar", "Eliminar Precios"]) expect(labels).toContain(shown);
});
