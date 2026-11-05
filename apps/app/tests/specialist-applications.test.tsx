/** @jsxImportSource react */
import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://localhost/" });
mock.module("../src/react-app/shell/openwork-connection", () => ({ resolveOpenworkConnection: async () => ({ normalizedBaseUrl: "http://localhost:8787", resolvedToken: "fixture-owner", resolvedHostToken: "fixture-host" }) }));
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { MemoryRouter, useLocation } = await import("react-router");
const { SpecialistApplicationsProvider, useSpecialistApplications } = await import("../src/react-app/domains/specialists/provider");
import type { SpecialistCatalog } from "../src/app/lib/openwork-server";
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let cache: InstanceType<typeof QueryClient>;
let server: SpecialistCatalog;
let posted: Record<string, unknown> | null;
let invalidPack: boolean;
let restoreFetch: () => void;
function Probe() {
  const specialist = useSpecialistApplications(); const location = useLocation();
  return <output>{`${specialist?.catalog?.user?.displayName ?? ""}|${specialist?.active?.name ?? ""}|${location.pathname}`}</output>;
}
beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear(); posted = null; invalidPack = false;
  server = { enabled: true, user: null, applications: [] };
  const spy = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const path = new URL(request.url).pathname;
    if (path === "/specialist-applications" && request.method === "POST") {
      const body = await request.json(); posted = body;
      server = { enabled: true, user: { id: "local", displayName: body.userName }, activeApplicationId: "app_fixture",
        applications: [{ id: "app_fixture", name: body.name, specialty: body.specialty, personality: body.personality, template: body.template, agentCount: 0, skillCount: 0, createdAt: 1, workspaceIds: ["ws_custom"] }] };
      return Response.json({ workspaceId: "ws_custom", catalog: server }, { status: 201 });
    }
    if (path.endsWith("preview-pack")) return invalidPack ? Response.json({ code: "invalid_pack", message: "Pack inválido de prueba" }, { status: 422 }) : Response.json({ agents: ["revisor"], skills: ["tono"], fileCount: 2, bytes: 100 });
    if (path.includes("engine-v2-preview")) return Response.json({ enabled: true, running: true, chatRouting: true, connectionSource: "installed", mirroredProviderIds: [], skippedProviderIds: [], catalogModelIds: [] });
    return Response.json(server);
  });
  restoreFetch = () => spy.mockRestore();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(async () => { await act(async () => root.unmount()); cache.clear(); host.remove(); restoreFetch(); });
afterAll(async () => { await GlobalRegistrator.unregister(); });
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); }); }
async function render() { await act(async () => root.render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={["/workspace/ws_legacy/session"]}><SpecialistApplicationsProvider><Probe /></SpecialistApplicationsProvider></MemoryRouter></QueryClientProvider>)); await flush(); }
function button(label: string) { const value = [...document.querySelectorAll("button")].find(element => element.textContent === label); if (!value) throw new Error(`Missing ${label}`); return value; }
async function click(label: string) { await act(async () => button(label).click()); await flush(); }
async function edit(id: string, value: string) {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) throw new Error("Missing field");
  await act(async () => { Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")?.set?.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); });
}

test("first local setup submits the chosen identity and personality and opens that application's project", async () => {
  await render(); await edit("specialist-user", "Usuario de prueba"); await click("Otra especialidad");
  await edit("specialist-name", "Taller"); await edit("specialist-specialty", "Diseño"); await edit("specialist-personality", "Clara y creativa");
  await click("Crear aplicación"); await flush();
  expect(posted).toMatchObject({ userName: "Usuario de prueba", name: "Taller", specialty: "Diseño", personality: "Clara y creativa", template: "custom" });
  expect(host.querySelector("output")?.textContent).toBe("Usuario de prueba|Taller|/workspace/ws_custom/session");
});
test("a rejected pack keeps the local user's draft and exposes the validation error", async () => {
  await render(); await edit("specialist-user", "Usuario de prueba"); await edit("specialist-pack", "/fixture/invalid-pack");
  invalidPack = true; await click("Revisar pack");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Pack inválido");
  expect(document.querySelector<HTMLInputElement>("#specialist-user")?.value).toBe("Usuario de prueba");
  expect(button("Crear aplicación").disabled).toBe(false);
  expect(posted).toBe(null);
});
