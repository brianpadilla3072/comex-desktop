/** @jsxImportSource react */
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({ url: "http://localhost/session" });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { createOpenworkServerClient } = await import("../src/app/lib/openwork-server");
const { LocalProvider } = await import("../src/react-app/kernel/local-provider");
const { RemotePairingSetup } = await import("../src/react-app/shell/remote-pairing-setup");
const { setLocale } = await import("../src/i18n");

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  Reflect.set(window, "__OPENWORK_ELECTRON__", {});
  window.localStorage.clear();
  setLocale("en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  Reflect.deleteProperty(window, "__OPENWORK_ELECTRON__");
  window.localStorage.clear();
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

async function flush() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
}

async function waitForText(text: string) {
  for (let attempt = 0; attempt < 100 && !(document.body.textContent ?? "").includes(text); attempt += 1) await flush();
}

function fixture(status: { enabled: boolean; remoteCodeEnabled: boolean; remoteCodeConfigured: boolean; remoteCodeSource: "stored" | "development" | "none" }, onCode?: (code?: string) => void) {
  let current = status;
  const client = {
    ...createOpenworkServerClient({ baseUrl: "http://localhost:8787", token: "owner", hostToken: "host" }),
    getPairingStatus: async () => current,
    createRemotePairingCode: async (code?: string) => {
      onCode?.(code);
      current = { ...current, remoteCodeConfigured: true, remoteCodeSource: "stored" };
      return { code: code?.toUpperCase().replace(/[^A-Z0-9]/g, "") ?? "ABCDEFGHJKLMNPQR", createdAt: 1 };
    },
  };
  return client;
}

async function render(client: ReturnType<typeof fixture>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => root.render(
    <QueryClientProvider client={queryClient}>
      <LocalProvider>
        <RemotePairingSetup client={client} />
      </LocalProvider>
    </QueryClientProvider>,
  ));
  await flush();
}

test("first run asks for a remote code, shows it once, and remembers completion", async () => {
  await render(fixture({ enabled: true, remoteCodeEnabled: true, remoteCodeConfigured: false, remoteCodeSource: "none" }));
  await waitForText("Set up remote access");
  expect(document.body.textContent).toContain("Set up remote access");
  const create = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.includes("Save code"));
  expect(create).toBeTruthy();
  await act(async () => create?.click());
  for (let attempt = 0; attempt < 100 && !document.querySelector<HTMLInputElement>("[data-remote-pairing-code]"); attempt += 1) await flush();
  expect(document.querySelector<HTMLInputElement>("[data-remote-pairing-code]")?.value).toBe("ABCDEFGHJKLMNPQR");
  const done = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Done");
  await act(async () => done?.click());
  for (let attempt = 0; attempt < 100 && (document.body.textContent ?? "").includes("Save this code"); attempt += 1) await flush();
  expect(document.body.textContent).not.toContain("Save this code");
  const prefs = JSON.parse(window.localStorage.getItem("openwork.preferences") ?? "{}") as { hasCompletedRemotePairingSetup?: boolean };
  expect(prefs.hasCompletedRemotePairingSetup).toBe(true);
});

test("the owner can choose the remote code instead of generating one", async () => {
  let requested: string | undefined;
  await render(fixture({ enabled: true, remoteCodeEnabled: true, remoteCodeConfigured: false, remoteCodeSource: "none" }, code => { requested = code; }));
  await waitForText("Set up remote access");
  const input = document.querySelector<HTMLInputElement>("#remote-pairing-code");
  expect(input).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "MY-LONG-REMOTE-CODE");
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const save = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Save code");
  await act(async () => save?.click());
  for (let attempt = 0; attempt < 100 && !document.querySelector<HTMLInputElement>("[data-remote-pairing-code]"); attempt += 1) await flush();
  expect(requested).toBe("MY-LONG-REMOTE-CODE");
  expect(document.querySelector<HTMLInputElement>("[data-remote-pairing-code]")?.value).toBe("MYLONGREMOTECODE");
});

test("a configured development code does not interrupt first run", async () => {
  await render(fixture({ enabled: true, remoteCodeEnabled: true, remoteCodeConfigured: false, remoteCodeSource: "development" }));
  for (let attempt = 0; attempt < 10; attempt += 1) await flush();
  expect(document.body.textContent).not.toContain("Set up remote access");
});
