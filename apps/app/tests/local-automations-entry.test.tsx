import { afterAll, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://localhost/" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let scheduled = true;
let app: { id: string; name: string; workspaceIds: string[] } | null = { id: "app_fixture", name: "General", workspaceIds: ["ws_fixture"] };
const reads: string[] = [];
mock.module("../src/react-app/domains/specialists/provider", () => ({ useSpecialistApplications: () => ({ active: app, client: { baseUrl: "http://fixture", getSpecialistTasks: async () => { reads.push("tasks"); return { tasks: [] }; } }, catalog: { scheduledTasksEnabled: scheduled }, create: () => {}, createProject: () => {} }) }));
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { MemoryRouter } = await import("react-router");
const { LocalAutomationsPage } = await import("../src/react-app/domains/automations/local-automations-page");
afterAll(() => GlobalRegistrator.unregister());
async function render() {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { root.render(<QueryClientProvider client={cache}><MemoryRouter><LocalAutomationsPage onShowDen={() => {}} /></MemoryRouter></QueryClientProvider>); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  return { host, async stop() { await act(async () => root.unmount()); host.remove(); cache.clear(); } };
}
test("local tasks render without Den auth, account or Den network requests", async () => {
  scheduled = true; const view = await render();
  try { expect(view.host.textContent).toContain("Sin cuenta de Den"); expect(view.host.textContent).toContain("Tareas programadas de General"); expect(reads).toEqual(["tasks"]); }
  finally { await view.stop(); }
});
test("a disabled local scheduler is explicit and does not query tasks", async () => {
  scheduled = false; reads.length = 0; const view = await render();
  try { expect(view.host.textContent).toContain("desactivadas en esta instalación"); expect(reads).toHaveLength(0); }
  finally { await view.stop(); }
});
test("an installation without an application offers setup without creating one", async () => {
  scheduled = true; app = null; const view = await render();
  try { expect(view.host.textContent).toContain("Crear aplicación"); expect(reads).toHaveLength(0); }
  finally { await view.stop(); }
});
