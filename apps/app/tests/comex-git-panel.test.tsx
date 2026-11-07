/** @jsxImportSource react */
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
const ownsDom = !GlobalRegistrator.isRegistered;
if (ownsDom) GlobalRegistrator.register({ url: "http://localhost/" });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { ComexGitPanel } = await import("../src/react-app/domains/session/comex/git-panel");
const { createOpenworkServerClient } = await import("../src/app/lib/openwork-server");
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let cache: InstanceType<typeof QueryClient>;
let reads = 0;
let creates = 0;
const head = "a".repeat(40);
const client = {
  ...createOpenworkServerClient({ baseUrl: "http://localhost/test" }),
  getComexGitReview: async () => { reads++; return { root: "/fixture", head, status: [" M report.md", "?? new.txt"], diff: "+changed", truncated: false }; },
  createComexGitWorktree: async (_id: string, expected: string) => { expect(expected).toBe(head); creates++; return { path: "/fixture-isolated", head, detached: true, includesUncommittedChanges: false }; },
};
beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  reads = 0; creates = 0;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(async () => { await act(async () => root.unmount()); cache.clear(); host.remove(); });
afterAll(async () => { if (ownsDom) await GlobalRegistrator.unregister(); });
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); }); }
async function click(label: string) { const button = Array.from(host.querySelectorAll("button")).find(item => item.textContent === label); if (!button) throw new Error(label); await act(async () => button.click()); await flush(); }
test("review is requested only on user action and isolates the reviewed commit", async () => {
  await act(async () => root.render(<QueryClientProvider client={cache}><ComexGitPanel client={client} workspaceId="fixture" /></QueryClientProvider>));
  await flush(); expect(reads).toBe(0); expect(creates).toBe(0);
  await click("Revisar cambios de código"); expect(reads).toBe(1);
  expect(host.textContent).toContain("report.md"); expect(host.textContent).toContain("+changed");
  await click("Crear trabajo aislado"); expect(creates).toBe(1);
  expect(host.textContent).toContain("/fixture-isolated");
});
test("a failed review keeps an explicit retry", async () => {
  const offline = { ...client, getComexGitReview: async () => { throw new Error("offline"); } };
  await act(async () => root.render(<QueryClientProvider client={cache}><ComexGitPanel client={offline} workspaceId="fixture" /></QueryClientProvider>));
  await click("Revisar cambios de código");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("No pude revisar");
  expect(host.textContent).toContain("Actualizar revisión"); expect(creates).toBe(0);
});
