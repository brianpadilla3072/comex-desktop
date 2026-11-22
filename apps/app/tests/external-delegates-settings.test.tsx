/** @jsxImportSource react */
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://localhost/" });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { setLocale } = await import("../src/i18n");
const feature = await import("../src/app/lib/external-delegates");
const { ExternalDelegatesSection } = await import("../src/react-app/domains/settings/permissions/external-delegates-section");
const { getSettingsSearchEntries } = await import("../src/react-app/domains/settings/settings-search-index");
const { createOpenworkServerClient } = await import("../src/app/lib/openwork-server");
// The real client against a stubbed fetch: owner and host tokens, loopback server.
const connect = async () => createOpenworkServerClient({ baseUrl: "http://127.0.0.1:8778", token: "owner", hostToken: "host" });

// Permisos › "Agentes externos": the person decides whether the agent answers external
// agents' permission requests itself. Owner access only, hidden without the flag.
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let requests: Array<{ method: string; url: string; body: string | null }> = [];
let respond: (method: string) => { status: number; body: unknown } = () => ({ status: 200, body: { decider: "person", overriddenBy: null } });
const realFetch = globalThis.fetch;

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  requests = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    requests.push({ method, url: String(input), body: typeof init?.body === "string" ? init.body : null });
    const reply = respond(method);
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  setLocale("es");
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  feature.setExternalDelegatesFeatureEnabled(false);
  globalThis.fetch = realFetch; setLocale("en");
});
afterAll(async () => { await GlobalRegistrator.unregister(); });

const settle = async () => { for (let i = 0; i < 5; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const toggle = () => host.querySelector<HTMLElement>("[role=switch]");

test("hidden without the flag, and found by search only with it", async () => {
  await act(async () => root.render(<ExternalDelegatesSection connect={connect} />));
  expect(host.textContent).toBe("");
  expect(requests).toEqual([]);
  const find = () => getSettingsSearchEntries().find((entry) => entry.anchor === "external-delegates-decider");
  expect(find()?.available?.()).toBe(false);
  await act(async () => { feature.setExternalDelegatesFeatureEnabled(true); });
  await settle();
  expect(find()?.available?.()).toBe(true);
});

test("turning it on lets the orchestrating agent decide and saves it", async () => {
  feature.setExternalDelegatesFeatureEnabled(true);
  respond = (method) => ({ status: 200, body: { decider: method === "PUT" ? "orchestrator" : "person", overriddenBy: null } });
  await act(async () => root.render(<ExternalDelegatesSection connect={connect} />));
  await settle();
  expect(host.textContent).toContain("Que el agente decida por los agentes externos");
  expect(host.textContent).toContain("te preguntan antes");
  expect(toggle()?.getAttribute("aria-checked")).toBe("false");
  await act(async () => { toggle()?.click(); });
  await settle();
  const put = requests.find((request) => request.method === "PUT");
  expect(put?.url).toContain("/delegates/settings");
  expect(put?.body).toBe(JSON.stringify({ decider: "orchestrator" }));
  expect(toggle()?.getAttribute("aria-checked")).toBe("true");
  expect(host.textContent).toContain("El agente aprueba o rechaza");
});

test("a failed save goes back and says so", async () => {
  feature.setExternalDelegatesFeatureEnabled(true);
  respond = (method) => (method === "PUT" ? { status: 500, body: { code: "boom", message: "x" } } : { status: 200, body: { decider: "person", overriddenBy: null } });
  await act(async () => root.render(<ExternalDelegatesSection connect={connect} />));
  await settle();
  await act(async () => { toggle()?.click(); });
  await settle();
  expect(toggle()?.getAttribute("aria-checked")).toBe("false");
  expect(host.textContent).toContain("No se pudo guardar el cambio");
});

test("an operator lock and missing owner access show as locked; a server without the feature hides it", async () => {
  feature.setExternalDelegatesFeatureEnabled(true);
  respond = () => ({ status: 200, body: { decider: "orchestrator", overriddenBy: "environment" } });
  await act(async () => root.render(<ExternalDelegatesSection connect={connect} />));
  await settle();
  expect(toggle()?.hasAttribute("data-disabled") || toggle()?.getAttribute("aria-disabled") === "true").toBe(true);
  expect(host.textContent).toContain("Fijado por la configuración de OpenWork");
  await act(async () => root.unmount()); root = createRoot(host);

  respond = () => ({ status: 401, body: { code: "unauthorized", message: "Invalid host token" } });
  await act(async () => root.render(<ExternalDelegatesSection connect={connect} />));
  await settle();
  expect(host.textContent).toContain("Solo quien administra esta computadora");
  await act(async () => root.unmount()); root = createRoot(host);

  respond = () => ({ status: 404, body: { code: "delegates_disabled", message: "off" } });
  await act(async () => root.render(<ExternalDelegatesSection connect={connect} />));
  await settle();
  expect(host.textContent).toBe("");
});
