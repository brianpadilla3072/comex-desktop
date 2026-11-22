/** @jsxImportSource react */
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://localhost/" });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { RecoveryView } = await import("../src/react-app/domains/settings/pages/recovery-view");
const { APP_CONFIG_PREFERENCE_KEYS, resetAppConfigDefaults } = await import("../src/react-app/domains/settings/state/reset-app-config");
const { TooltipProvider } = await import("../src/components/ui/tooltip");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");

// Settings > Reset & recovery had three buttons hard-disabled behind a "not yet available" notice
// since the React port; their handlers were empty functions and active runs were always "none".

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  Reflect.set(window, "__OPENWORK_ELECTRON__", { invokeDesktop: async () => null });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); Reflect.deleteProperty(window, "__OPENWORK_ELECTRON__"); });
afterAll(async () => { await GlobalRegistrator.unregister(); });

function render(overrides: Partial<Parameters<typeof RecoveryView>[0]> = {}) {
  const calls: string[] = [];
  const props = {
    anyActiveRuns: false, workspaceConfigPath: "/w/.openwork/openwork.json", resetConfigBusy: false, configActionStatus: null,
    cacheRepairBusy: false, cacheRepairResult: null, dockerCleanupBusy: false, dockerCleanupResult: null,
    onResetAppConfigDefaults: () => { calls.push("reset"); }, onRepairOpencodeCache: () => { calls.push("cache"); }, onCleanupOpenworkDockerContainers: () => { calls.push("docker"); },
    ...overrides,
  };
  return { calls, mount: () => act(async () => root.render(<QueryClientProvider client={new QueryClient()}><TooltipProvider><RecoveryView {...props} /></TooltipProvider></QueryClientProvider>)) };
}
const buttons = () => [...host.querySelectorAll("button")];
const actions = () => buttons().filter(button => /^(Reset to defaults|Repair cache|Remove all)$/.test((button.textContent ?? "").trim()));

test("on the desktop with no active runs, the three recovery actions are enabled and run", async () => {
  const view = render();
  await view.mount();
  expect(host.textContent ?? "").not.toMatch(/not yet available|todavía no está disponible/i);
  const enabled = actions().filter(button => !button.disabled);
  expect(enabled.length).toBe(3);
  for (const button of enabled) await act(async () => button.click());
  expect(view.calls.sort()).toEqual(["cache", "docker", "reset"]);
});

test("active runs block every recovery action", async () => {
  const view = render({ anyActiveRuns: true });
  await view.mount();
  expect(actions().length).toBe(3);
  expect(actions().every(button => button.disabled)).toBe(true);
});

test("resetting preferences clears only the app preference keys", () => {
  const store = new Map<string, string>([["openwork.react.settings.theme-mode", "dark"], ["openwork.defaultModel", "x/y"], ["openwork.server.token", "secret"], ["openwork.language", "es"], ["openwork.sessionModels.v1", "{}"]]);
  const storage = { getItem: (key: string) => store.get(key) ?? null, removeItem: (key: string) => { store.delete(key); }, setItem: (key: string, value: string) => { store.set(key, value); } };
  expect(resetAppConfigDefaults(storage)).toBe(2);
  expect([...store.keys()].sort()).toEqual(["openwork.language", "openwork.server.token", "openwork.sessionModels.v1"]);
  expect(APP_CONFIG_PREFERENCE_KEYS.some(key => /token|server|session|language/i.test(key))).toBe(false);
});

test("w3-13: resetting preferences keeps a usage-data opt-out", () => {
  const store = new Map<string, string>([["openwork.preferences", JSON.stringify({ analyticsEnabled: false, showThinking: true, keepAwake: true })]]);
  const storage = { getItem: (key: string) => store.get(key) ?? null, removeItem: (key: string) => { store.delete(key); }, setItem: (key: string, value: string) => { store.set(key, value); } };
  expect(resetAppConfigDefaults(storage)).toBe(1);
  expect(JSON.parse(store.get("openwork.preferences") ?? "{}")).toEqual({ analyticsEnabled: false, showThinkingResetToOff: true });
  store.set("openwork.preferences", JSON.stringify({ analyticsEnabled: true }));
  resetAppConfigDefaults(storage);
  expect(store.has("openwork.preferences")).toBe(false);
});
