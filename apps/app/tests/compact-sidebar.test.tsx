/** @jsxImportSource react */
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://localhost/" });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { SidebarProvider, useSidebar } = await import("../src/components/ui/sidebar");
const { CompactSidebarNav } = await import("../src/react-app/domains/session/sidebar/compact-sidebar-nav");
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
function Probe() { return <output>{String(useSidebar().open)}</output>; }
beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
afterAll(async () => { await GlobalRegistrator.unregister(); });
test("collapsed navigation keeps real actions, labels, active states and a way back to projects", async () => {
  const calls: string[] = [];
  await act(async () => root.render(<SidebarProvider defaultOpen={false}><Probe /><CompactSidebarNav
    onNewTask={() => calls.push("new")} onSearch={() => calls.push("search")} onDashboard={() => calls.push("dashboard")}
    dashboardLabel="Resultados" onAutomations={() => calls.push("automations")} automationsActive automationsNeedAttention
    onExtensions={() => calls.push("library")} /></SidebarProvider>));
  expect(host.querySelector("output")!.textContent).toBe("false");
  for (const label of ["Nueva tarea", "Buscar conversaciones", "Resultados", "Automatizaciones", "Biblioteca"]) {
    await act(async () => host.querySelector<HTMLElement>(`button[aria-label="${label}"]`)!.click());
  }
  expect(calls).toEqual(["new", "search", "dashboard", "automations", "library"]);
  expect(host.querySelector('[aria-label="Automatizaciones"]')?.getAttribute("data-active")).not.toBeNull();
  expect(host.querySelector('[aria-label="Necesita atención"]')).not.toBeNull();
  await act(async () => host.querySelector<HTMLElement>('[aria-label="Proyectos y conversaciones"]')!.click());
  expect(host.querySelector("output")!.textContent).toBe("true");
});
test("unavailable destinations are omitted and a disabled new task cannot run", async () => {
  let calls = 0;
  await act(async () => root.render(<SidebarProvider defaultOpen={false}><CompactSidebarNav newTaskDisabled onNewTask={() => calls++} onExtensions={() => {}} /></SidebarProvider>));
  expect(host.querySelector('[aria-label="Buscar conversaciones"]')).toBeNull();
  expect(host.querySelector('[aria-label="Automatizaciones"]')).toBeNull();
  await act(async () => host.querySelector<HTMLElement>('[aria-label="Nueva tarea"]')!.click());
  expect(calls).toBe(0);
});
