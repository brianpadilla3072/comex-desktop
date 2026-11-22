/** @jsxImportSource react */
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const ownsDom = !GlobalRegistrator.isRegistered;
if (ownsDom) GlobalRegistrator.register({ url: "http://localhost/" });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const {
  commandCenterActions, commandCenterSection, commandCenterSnapshotSchema, commandCenterStatus, formatCommandCenterDuration,
} = await import("../src/react-app/domains/command-center/command-center-model");
const { CommandCenterPanel } = await import("../src/react-app/domains/command-center/command-center-page");
type Snapshot = import("../src/react-app/domains/command-center/command-center-model").CommandCenterSnapshot;
type Item = Snapshot["items"][number];
type Client = import("../src/react-app/domains/command-center/use-command-center").CommandCenterClient;

const NOW = Date.now();

function session(overrides: Partial<Extract<Item, { kind: "session" }>> = {}): Extract<Item, { kind: "session" }> {
  return {
    kind: "session", id: "session:ws_a:ses_1", workspaceId: "ws_a", workspaceName: "Alpha", applicationId: null, applicationName: null,
    sessionId: "ses_1", title: "Draft the quote", status: "running", engine: "v2", model: { providerID: "local", modelID: "tiny" },
    startedAt: NOW - 90_000, updatedAt: NOW, waitingRequests: 0, subtasks: 0, lastError: null, ...overrides,
  };
}

function task(overrides: Partial<Extract<Item, { kind: "task" }>> = {}): Extract<Item, { kind: "task" }> {
  return {
    kind: "task", id: "task:app_1:task_1", applicationId: "app_1", applicationName: "Exports", taskId: "task_1", taskName: "Daily report",
    workspaceId: "ws_a", workspaceName: "Alpha", sessionId: "ses_task", status: "failed", mode: "scheduled", model: null,
    startedAt: NOW - 600_000, enabled: true, nextRunAt: null, lastError: "The engine answered 502.", ...overrides,
  };
}

function snapshot(items: Item[], overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    enabled: true, generatedAt: NOW, engine: "v2", complete: true, items, problems: [],
    counts: { running: items.filter(item => item.status === "running").length, waiting: 0, failed: items.filter(item => item.status === "failed").length },
    ...overrides,
  };
}

type Calls = { stop: [string, string][]; run: [string, string][]; open: [string, string][] };
let calls: Calls;
let answer: () => Promise<unknown>;
let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLDivElement;
let queryClient: InstanceType<typeof QueryClient>;

function fakeClient(): Client {
  return {
    baseUrl: "http://127.0.0.1:1",
    getCommandCenter: () => answer(),
    stopCommandCenterSession: async (workspaceId, sessionId) => { calls.stop.push([workspaceId, sessionId]); return { stopped: true }; },
    runSpecialistTaskNow: async (applicationId, taskId) => { calls.run.push([applicationId, taskId]); return { started: true, detail: null, tasks: [] }; },
  };
}

async function render() {
  await act(async () => {
    root?.render(<QueryClientProvider client={queryClient}>
      <CommandCenterPanel client={fakeClient()} active onOpenSession={(workspaceId, sessionId) => { calls.open.push([workspaceId, sessionId]); }} />
    </QueryClientProvider>);
  });
  // Let the query settle and React commit its result.
  for (let index = 0; index < 5; index += 1) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

async function click(selector: string) {
  const element = host.querySelector(selector);
  if (!(element instanceof HTMLElement)) throw new Error(`missing ${selector}`);
  await act(async () => { element.click(); });
  for (let index = 0; index < 5; index += 1) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

beforeEach(() => {
  calls = { stop: [], run: [], open: [] };
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  queryClient.clear();
  host.remove();
});

afterAll(async () => {
  if (ownsDom) await GlobalRegistrator.unregister();
});

test("status mapping: sections, tones and labels tell waiting, running and outcomes apart", () => {
  expect(commandCenterSection(session({ status: "waiting_permission" }))).toBe("waiting");
  expect(commandCenterSection(task({ status: "waiting" }))).toBe("waiting");
  expect(commandCenterSection(session({ status: "retrying" }))).toBe("running");
  expect(commandCenterSection(task({ status: "running" }))).toBe("running");
  expect(commandCenterSection(task({ status: "ok" }))).toBe("recent");
  expect(commandCenterStatus(session({ status: "running" })).tone).toBe("neutral");
  expect(commandCenterStatus(session({ status: "waiting_question" })).tone).toBe("attention");
  expect(commandCenterStatus(task({ status: "failed" })).tone).toBe("danger");
  expect(commandCenterStatus(task({ status: "blocked" })).tone).toBe("danger");
  expect(commandCenterStatus(task({ status: "ok" })).tone).toBe("muted");
  expect(commandCenterStatus(session({ status: "waiting_permission" })).label).toBe("Waiting for approval");
});

test("actions: chats open and stop; failed tasks retry; finished tasks run now; no session means no open", () => {
  expect(commandCenterActions(session())).toEqual(["open", "stop"]);
  expect(commandCenterActions(task({ status: "running" }))).toEqual(["open", "stop"]);
  expect(commandCenterActions(task({ status: "failed" }))).toEqual(["open", "retry"]);
  expect(commandCenterActions(task({ status: "blocked", sessionId: null, workspaceId: null }))).toEqual(["retry"]);
  expect(commandCenterActions(task({ status: "ok" }))).toEqual(["open", "run_now"]);
  expect(formatCommandCenterDuration(42_000)).toBe("42 s");
  expect(formatCommandCenterDuration(90 * 60_000)).toBe("1 h 30 min");
});

test("the client contract rejects a malformed answer instead of reading it as empty", () => {
  expect(commandCenterSnapshotSchema.safeParse({ items: [] }).success).toBe(false);
  expect(commandCenterSnapshotSchema.safeParse(snapshot([session(), task()])).success).toBe(true);
});

test("renders rows grouped by section with status, place, model and error", async () => {
  answer = async () => snapshot([
    session({ id: "session:ws_a:ses_wait", sessionId: "ses_wait", title: "Needs approval", status: "waiting_permission" }),
    session({ subtasks: 2, applicationName: "Exports" }),
    task(),
  ]);
  await render();
  const rows = [...host.querySelectorAll("[data-command-center-item]")];
  expect(rows.map(row => row.getAttribute("data-status"))).toEqual(["waiting_permission", "running", "failed"]);
  const text = host.textContent ?? "";
  expect(text).toContain("Needs you");
  expect(text).toContain("Draft the quote");
  expect(text).toContain("Alpha");
  expect(text).toContain("Exports");
  expect(text).toContain("local/tiny");
  expect(text).toContain("+2 sub-agents");
  expect(text).toContain("Last error: The engine answered 502.");
  expect(host.querySelector("[data-command-center-empty]")).toBeNull();
});

test("actions call the right client methods", async () => {
  answer = async () => snapshot([session(), task()]);
  await render();
  await click('[data-command-center-item="session:ws_a:ses_1"] [data-command-center-action="stop"]');
  expect(calls.stop).toEqual([["ws_a", "ses_1"]]);
  expect(host.textContent).toContain("Stopped.");
  await click('[data-command-center-item="task:app_1:task_1"] [data-command-center-action="retry"]');
  expect(calls.run).toEqual([["app_1", "task_1"]]);
  await click('[data-command-center-item="session:ws_a:ses_1"] [data-command-center-action="open"]');
  expect(calls.open).toEqual([["ws_a", "ses_1"]]);
  const stop = host.querySelector('[data-command-center-item="session:ws_a:ses_1"] [data-command-center-action="stop"]');
  expect(stop?.getAttribute("aria-label")).toBe("Stop: Draft the quote");
});

test("a failed request is an error, never 'nothing running'", async () => {
  answer = async () => { throw new Error("Server unreachable"); };
  await render();
  expect(host.querySelector("[data-command-center-error]")).not.toBeNull();
  expect(host.textContent).toContain("Server unreachable");
  expect(host.textContent).not.toContain("Nothing is running right now");
});

test("a malformed answer is an error too", async () => {
  answer = async () => ({ enabled: true, items: "nope" });
  await render();
  expect(host.querySelector("[data-command-center-error]")).not.toBeNull();
  expect(host.querySelector("[data-command-center-empty]")).toBeNull();
});

test("empty and complete says nothing is running; empty but incomplete names what could not be read", async () => {
  answer = async () => snapshot([]);
  await render();
  expect(host.querySelector("[data-command-center-empty]")?.textContent).toContain("Nothing is running right now");

  await act(async () => root?.unmount());
  root = createRoot(host);
  queryClient.clear();
  answer = async () => snapshot([], { complete: false, problems: [{ source: "workspace", id: "ws_b", label: "Beta", message: "The engine answered 503." }] });
  await render();
  expect(host.querySelector("[data-command-center-incomplete]")?.textContent).toContain("Beta: The engine answered 503.");
  expect(host.textContent).not.toContain("Nothing is running right now");
  expect(host.textContent).toContain("Nothing found in the places that answered.");
});
