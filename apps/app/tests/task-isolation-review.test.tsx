/** @jsxImportSource react */
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://localhost/" });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { MemoryRouter } = await import("react-router");
const { t } = await import("../src/i18n");
const { createOpenworkServerClient } = await import("../src/app/lib/openwork-server");
const { TaskIsolationReview } = await import("../src/react-app/domains/specialists/task-isolation-review");
const { ConversationIsolationPanel } = await import("../src/react-app/domains/session/comex/task-isolation-panel");
const { SpecialistTasksView } = await import("../src/react-app/domains/specialists/library-dialog");

// Isolated task copies and their review (docs/features/task-isolation-review): the person sees
// what a task changed, per file, and decides what reaches the project.
type Change = { path: string; change: "added" | "modified" | "deleted"; kind: "text" | "binary"; type: string; size: number | null; baseSize: number | null; conflict: boolean; alreadyApplied: boolean };
const summary = (status: "active" | "closed", origin: "task_run" | "session" = "task_run") => ({
  id: "iso_1", applicationId: "app_1", workspaceId: "ws_1", mode: "snapshot" as const, copyPath: "/datos/iso_1/copy",
  origin: origin === "task_run" ? { kind: "task_run" as const, taskId: "task_1", runAt: 1 } : { kind: "session" as const, sessionId: "ses_1" },
  sessionId: "ses_1", status, createdAt: 1, closedAt: null, reviewed: 0,
});
const textDiff = (path: string) => ({ path, change: "modified", kind: "text", type: "file", conflict: false, before: { size: 4, sha256: "a" }, after: { size: 4, sha256: "b" }, truncated: false,
  hunks: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [{ kind: "context", text: "uno" }, { kind: "removed", text: "dos" }, { kind: "added", text: "DOS" }] }] });
const binaryDiff = { path: "logo.png", change: "modified", kind: "binary", type: "image", conflict: false, before: { size: 2048, sha256: "a" }, after: { size: 4096, sha256: "b" }, hunks: [], truncated: false };

function fakeClient(initial: Change[], options: { busy?: boolean; origin?: "task_run" | "session"; failAccept?: string } = {}) {
  let changes = [...initial];
  let status: "active" | "closed" = "active";
  const calls: Array<{ action: string; paths: string[]; overwrite?: boolean }> = [];
  const result = () => ({ isolation: summary(status, options.origin), changes });
  const resolve = (paths: string[]) => { changes = changes.filter(change => !paths.includes(change.path)); if (!changes.length && options.origin !== "session") status = "closed"; return result(); };
  return {
    calls,
    getTaskIsolation: async () => ({ ...result(), busy: options.busy ?? false }),
    getTaskIsolationDiff: async (_app: string, _iso: string, path: string) => path === "logo.png" ? binaryDiff : textDiff(path),
    acceptTaskIsolationFiles: async (_app: string, _iso: string, paths: string[], overwrite?: boolean) => {
      calls.push({ action: "accept", paths, overwrite });
      if (options.failAccept) throw Object.assign(new Error("fail"), { code: options.failAccept });
      return resolve(paths);
    },
    discardTaskIsolationFiles: async (_app: string, _iso: string, paths: string[]) => { calls.push({ action: "discard", paths }); return resolve(paths); },
    closeTaskIsolation: async () => { calls.push({ action: "close", paths: [] }); status = "closed"; changes = []; return { isolation: summary("closed", options.origin) }; },
  };
}
const CHANGES: Change[] = [
  { path: "informe.md", change: "modified", kind: "text", type: "file", size: 4, baseSize: 4, conflict: false, alreadyApplied: false },
  { path: "logo.png", change: "modified", kind: "binary", type: "image", size: 4096, baseSize: 2048, conflict: false, alreadyApplied: false },
  { path: "datos/tabla.csv", change: "modified", kind: "text", type: "spreadsheet", size: 9, baseSize: 4, conflict: true, alreadyApplied: false },
];

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => { Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; });
afterAll(async () => { await GlobalRegistrator.unregister(); });
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
async function waitFor(check: () => boolean) {
  for (let attempt = 0; attempt < 100 && !check(); attempt += 1) await flush();
  expect(check()).toBe(true);
}
const button = (label: string, scope: ParentNode = document) => [...scope.querySelectorAll("button")].find(element => element.textContent?.trim() === label || element.getAttribute("aria-label") === label);
const row = (path: string) => document.querySelector<HTMLElement>(`[data-change-path="${path}"]`);
async function click(element: HTMLElement | undefined | null) { expect(element).toBeTruthy(); await act(async () => element?.click()); await flush(); }
const render = (node: React.ReactNode) => act(async () => root.render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>));

test("the review lists each changed file, shows a text diff, binaries by size, and marks conflicts", async () => {
  const client = fakeClient(CHANGES);
  await render(<TaskIsolationReview client={client} applicationId="app_1" isolationId="iso_1" />);
  await waitFor(() => Boolean(row("informe.md")));
  // Keys resolve in both locales (a missing key would render as itself).
  for (const lng of ["en", "es"] as const) {
    expect(t("task_isolation.summary", { count: 3, lng })).toMatch(/^3 /);
    expect(t("task_isolation.conflict_hint", { lng })).not.toBe("task_isolation.conflict_hint");
  }
  expect(host.textContent).toContain(t("task_isolation.summary", { count: 3 }));
  expect(row("datos/tabla.csv")?.textContent).toContain(t("task_isolation.conflict_badge"));
  // The first file is selected and its line diff is shown.
  await waitFor(() => host.querySelectorAll("[data-line]").length === 3);
  expect([...host.querySelectorAll("[data-line]")].map(line => `${line.getAttribute("data-line")}:${line.textContent?.slice(1).trim()}`)).toEqual(["context:uno", "removed:dos", "added:DOS"]);
  await click(row("logo.png")?.querySelector("button"));
  await waitFor(() => Boolean(host.querySelector("[data-testid=task-isolation-binary]")));
  expect(host.textContent).toContain(t("task_isolation.size_change", { before: "2.0 KB", after: "4.0 KB" }));
  // A conflicting file explains itself and offers the explicit overwrite instead of Accept.
  await click(row("datos/tabla.csv")?.querySelector("button"));
  expect(host.textContent).toContain(t("task_isolation.conflict_hint"));
  expect(button(t("task_isolation.accept"), row("datos/tabla.csv") ?? document)).toBeUndefined();
  expect(button(t("task_isolation.overwrite"), row("datos/tabla.csv") ?? document)).toBeTruthy();
});

test("accept, overwrite and discard send the right files and update the list", async () => {
  const client = fakeClient(CHANGES);
  let finished = 0;
  await render(<TaskIsolationReview client={client} applicationId="app_1" isolationId="iso_1" onFinished={() => { finished++; }} />);
  await waitFor(() => Boolean(row("informe.md")));
  // "Accept all" leaves conflicting files for an explicit decision.
  await click(button(t("task_isolation.accept_all", { count: 2 })));
  expect(client.calls[0]).toEqual({ action: "accept", paths: ["informe.md", "logo.png"], overwrite: undefined });
  await waitFor(() => !row("informe.md"));
  await click(button(t("task_isolation.overwrite"), row("datos/tabla.csv") ?? document));
  expect(client.calls[1]).toEqual({ action: "accept", paths: ["datos/tabla.csv"], overwrite: true });
  // The last file of a task run closes the review.
  await waitFor(() => host.textContent?.includes(t("task_isolation.closed")) ?? false);
  expect(finished).toBe(1);
});

test("errors are shown with direction and a busy run cannot be reviewed yet", async () => {
  const failing = fakeClient(CHANGES.slice(0, 1), { failAccept: "task_isolation_conflict" });
  await render(<TaskIsolationReview client={failing} applicationId="app_1" isolationId="iso_1" />);
  await waitFor(() => Boolean(row("informe.md")));
  await click(button(t("task_isolation.accept"), row("informe.md") ?? document));
  await waitFor(() => host.querySelector("[role=alert]")?.textContent === t("task_isolation.error_conflict"));
  await act(async () => root.unmount());
  root = createRoot(host);
  const busy = fakeClient(CHANGES.slice(0, 1), { busy: true });
  await render(<TaskIsolationReview client={busy} applicationId="app_1" isolationId="iso_1" />);
  await waitFor(() => Boolean(row("informe.md")));
  expect(host.textContent).toContain(t("task_isolation.busy"));
  expect(button(t("task_isolation.accept"), row("informe.md") ?? document)?.disabled).toBe(true);
  expect(button(t("task_isolation.discard_all"))?.disabled).toBe(true);
});

test("a conversation starts an isolated copy and finishing discards what is left", async () => {
  const review = fakeClient(CHANGES.slice(0, 1), { origin: "session" });
  let isolated = false;
  const client = {
    ...review,
    getSessionIsolation: async () => ({ applicationId: "app_1", isolation: isolated && review.calls.every(call => call.action !== "close") ? summary("active", "session") : null }),
    isolateSession: async () => { isolated = true; return { applicationId: "app_1", isolation: summary("active", "session") }; },
  };
  await render(<ConversationIsolationPanel client={client} workspaceId="ws_1" sessionId="ses_1" />);
  await click(button(t("task_isolation.session_title")));
  await waitFor(() => Boolean(button(t("task_isolation.session_start"))));
  await click(button(t("task_isolation.session_start")));
  await waitFor(() => Boolean(row("informe.md")));
  expect(host.textContent).toContain(t("task_isolation.session_active"));
  await click(button(t("task_isolation.finish_discard")));
  expect(review.calls.at(-1)?.action).toBe("close");
  await waitFor(() => Boolean(button(t("task_isolation.session_start"))));
});

test("a task run with pending changes opens its review from the run history", async () => {
  const app = { id: "app_1", name: "Demo", specialty: "", personality: "", template: "custom" as const, agentCount: 0, skillCount: 0, createdAt: 0, workspaceIds: ["ws_1"] };
  const task = { id: "task_1", name: "Precios", prompt: "Actualizar", schedule: { kind: "daily", hour: 9, minute: 0 }, enabled: true, createdAt: 0, updatedAt: 0, nextRunAt: null, lastRunAt: 1, lastStatus: "ok", runs: 2, running: null };
  const runs = [
    { at: 2, mode: "manual", missed: 0, workspaceId: "ws_1", sessionId: "ses_1", status: "ok", detail: null, isolationId: "iso_1", review: "pending" },
    { at: 1, mode: "manual", missed: 0, workspaceId: "ws_1", sessionId: "ses_0", status: "ok", detail: null, isolationId: "iso_0", review: "reviewed" },
  ];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes("/runs") ? { runs } : url.includes("/isolations/iso_1/diff") ? textDiff("informe.md") : url.includes("/isolations/iso_1") ? { isolation: summary("active"), busy: false, changes: CHANGES.slice(0, 1) } : { tasks: [task] };
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  }, { preconnect: originalFetch.preconnect });
  try {
    const client = createOpenworkServerClient({ baseUrl: "http://localhost/isolation-test" });
    await act(async () => root.render(<MemoryRouter><QueryClientProvider client={new QueryClient()}><SpecialistTasksView app={app} client={client} dryRun readOnly={false} onBack={() => undefined} /></QueryClientProvider></MemoryRouter>));
    await waitFor(() => Boolean(button("Corridas")));
    await click(button("Corridas"));
    await waitFor(() => Boolean(button(t("task_isolation.open_review"))));
    expect(host.textContent).toContain(t("task_isolation.run_reviewed"));
    await click(button(t("task_isolation.open_review")));
    await waitFor(() => Boolean(document.querySelector("[data-testid=task-isolation-review]")));
    expect(document.body.textContent).toContain(t("task_isolation.dialog_title_run", { name: "Precios" }));
    expect(row("informe.md")).toBeTruthy();
  } finally {
    globalThis.fetch = originalFetch;
  }
});
