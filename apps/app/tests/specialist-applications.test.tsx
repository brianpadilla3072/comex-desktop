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
const { setRemotePairingSetupPending } = await import("../src/react-app/shell/remote-pairing-setup-state");
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
  setRemotePairingSetupPending(false);
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
afterEach(async () => { await act(async () => root.unmount()); cache.clear(); host.remove(); restoreFetch(); setRemotePairingSetupPending(false); });
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

test("remote pairing setup defers the first-application dialog and then opens it", async () => {
  setRemotePairingSetupPending(true);
  await render();
  expect(document.querySelector("#specialist-name")).toBe(null);
  await act(async () => setRemotePairingSetupPending(false));
  await flush();
  expect(document.querySelector("#specialist-name")).toBeTruthy();
});

test("remote pairing setup closes an auto-opened application dialog instead of stacking", async () => {
  await render();
  expect(document.querySelector("#specialist-name")).toBeTruthy();
  await act(async () => setRemotePairingSetupPending(true));
  await flush();
  expect(document.querySelector("#specialist-name")).toBe(null);
  await act(async () => setRemotePairingSetupPending(false));
  await flush();
  expect(document.querySelector("#specialist-name")).toBeTruthy();
});

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

// Portability (feature: specialistAppPortability). Comercio Exterior used to be preselected for the
// first application, so people chose it without meaning to.
test("with portability on, the first application starts with nothing preselected and offers an import", async () => {
  server = { enabled: true, portabilityEnabled: true, user: null, applications: [] };
  await render();
  expect(document.querySelector<HTMLInputElement>("#specialist-name")?.value).toBe("");
  expect(document.querySelector<HTMLInputElement>("#specialist-specialty")?.value).toBe("");
  expect(button("Otra especialidad").getAttribute("aria-pressed")).toBe("true");
  expect(button("Comercio Exterior").getAttribute("aria-pressed")).toBe("false");
  expect([...document.querySelectorAll("button")].some(element => element.textContent?.includes("Importar aplicación"))).toBe(true);
});
test("with portability off, the first application keeps its previous Comercio Exterior defaults", async () => {
  await render();
  expect(document.querySelector<HTMLInputElement>("#specialist-name")?.value).toBe("Comex");
  expect(button("Comercio Exterior").getAttribute("aria-pressed")).toBe("true");
  expect([...document.querySelectorAll("button")].some(element => element.textContent?.includes("Importar aplicación"))).toBe(false);
});
test("deleting asks first and only calls the server after confirming", async () => {
  const { DeleteApplicationDialog } = await import("../src/react-app/domains/specialists/portability");
  const { createOpenworkServerClient } = await import("../src/app/lib/openwork-server");
  const deletes: string[] = [];
  restoreFetch();
  const spy = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (request.method === "DELETE") { deletes.push(new URL(request.url).pathname); return Response.json({ removedWorkspaceIds: [], keptWorkspaceIds: [], catalog: { enabled: true, applications: [] } }); }
    return Response.json({});
  });
  restoreFetch = () => spy.mockRestore();
  const app = { id: "app_fixture", name: "Comex", specialty: "Comercio", personality: "", template: "comex" as const, agentCount: 0, skillCount: 0, createdAt: 1, workspaceIds: [] };
  let closed = 0; let deleted = 0;
  const client = createOpenworkServerClient({ baseUrl: "http://localhost:8787", token: "fixture-owner", hostToken: "fixture-host" });
  await act(async () => root.render(<DeleteApplicationDialog app={app} client={client} onClose={() => { closed += 1; }} onDeleted={async () => { deleted += 1; }} />));
  expect(document.body.textContent).toContain("Eliminar Comex");
  await click("Cancelar");
  expect([closed, deletes.length]).toEqual([1, 0]);
  await click("Eliminar aplicación");
  expect(deletes).toEqual(["/specialist-applications/app_fixture"]);
  expect(deleted).toBe(1);
});
test("exported files get a safe, recognizable name and imports report what was skipped", async () => {
  const { bundleFileName, importNotice } = await import("../src/react-app/domains/specialists/portability");
  expect(bundleFileName("Comercio Exterior: Ñandú / Prueba", new Date("2026-11-19T10:00:00Z"))).toBe("comercio-exterior-nandu-prueba-2026-11-19.openwork-app.json");
  expect(bundleFileName("???", new Date("2026-11-19T10:00:00Z"))).toBe("aplicacion-2026-11-19.openwork-app.json");
  expect(importNotice({ skippedSections: [], warnings: [] })).toBe("");
  expect(importNotice({ skippedSections: ["future"], warnings: ["No se importó la tarea \"x\"."] })).toBe("No se importó la tarea \"x\". Se omitieron partes que esta versión no reconoce: future.");
});
// A browser session only holds a collaborator token: the server rejects every write, so the
// first-application form must not open by itself.
test("a read-only connection never opens the first-application form by itself", async () => {
  server = { enabled: true, writable: false, portabilityEnabled: true, user: null, applications: [] };
  await render();
  expect(document.querySelector("#specialist-name")).toBe(null);
  expect(document.body.textContent).not.toContain("Crea tu primera aplicación");
});
// The catalog refetches every 15 s. An unchanged answer must keep the same client and context,
// or everything under the provider re-renders while chats only wait (renderer CPU).
test("an unchanged catalog refetch keeps the client and does not re-render consumers", async () => {
  server = { enabled: true, user: { id: "local", displayName: "Usuario de prueba" }, activeApplicationId: "app_fixture",
    applications: [{ id: "app_fixture", name: "Taller", specialty: "Diseño", personality: "Clara", template: "custom", agentCount: 0, skillCount: 0, createdAt: 1, workspaceIds: ["ws_legacy"] }] };
  let renders = 0;
  const clients = new Set<unknown>();
  function CountingProbe() {
    const specialist = useSpecialistApplications();
    renders += 1;
    if (specialist?.client) clients.add(specialist.client);
    return <output>{specialist?.active?.name ?? ""}</output>;
  }
  await act(async () => root.render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={["/workspace/ws_legacy/session"]}><SpecialistApplicationsProvider><CountingProbe /></SpecialistApplicationsProvider></MemoryRouter></QueryClientProvider>));
  await flush();
  expect(host.querySelector("output")?.textContent).toBe("Taller");
  const before = renders;
  for (let index = 0; index < 3; index += 1) {
    await act(async () => { await cache.refetchQueries({ queryKey: ["specialist-applications"] }); });
    await flush();
  }
  expect(clients.size).toBe(1);
  expect(renders).toBe(before);
});
