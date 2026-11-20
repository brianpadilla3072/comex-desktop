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
  filterResultsInbox, groupResultsInboxByDay, primaryResultsInboxAction, resultsInboxActions, resultsInboxBadge,
  resultsInboxSnapshotSchema, resultsInboxStatus,
} = await import("../src/react-app/domains/results-inbox/results-inbox-model");
const { ResultsInboxPanel } = await import("../src/react-app/domains/results-inbox/results-inbox-page");
const { ResultsInboxBadge, resultsInboxNavLabel } = await import("../src/react-app/domains/results-inbox/results-inbox-badge");
const { resultsInboxSummaryQueryKey } = await import("../src/react-app/domains/results-inbox/use-results-inbox");
type Snapshot = import("../src/react-app/domains/results-inbox/results-inbox-model").ResultsInboxSnapshot;
type Item = Snapshot["items"][number];
type Client = import("../src/react-app/domains/results-inbox/results-inbox-page").ResultsInboxPageClient;

const NOW = Date.now();
const DAY = 86_400_000;

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: "run:app_1:task_1:1", applicationId: "app_1", applicationName: "Exports", taskId: "task_1", taskName: "Nightly report",
    status: "ok", mode: "scheduled", detail: null, startedAt: NOW - 120_000, finishedAt: NOW - 60_000, endedAt: NOW - 60_000,
    workspaceId: "ws_a", workspaceName: "Alpha", sessionId: "ses_1", isolation: null, outputs: [], seen: false, seenAt: null,
    ...overrides,
  };
}

function snapshot(items: Item[], overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    enabled: true, generatedAt: NOW, complete: true, items, problems: [],
    counts: {
      total: items.length,
      unseen: items.filter(entry => !entry.seen).length,
      needsReview: items.filter(entry => entry.isolation?.review === "pending").length,
      failed: items.filter(entry => entry.status === "failed" || entry.status === "blocked").length,
    },
    ...overrides,
  };
}

type Calls = { seen: [string[], boolean][]; all: (number | undefined)[]; open: [string, string][]; isolation: [string, string][]; output: [string, string, string | undefined][] };
let calls: Calls;
let answer: () => Promise<unknown>;
let seenAnswer: () => Promise<unknown>;
let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLDivElement;
let queryClient: InstanceType<typeof QueryClient>;

function fakeClient(): Client {
  return {
    baseUrl: "http://127.0.0.1:1",
    getResultsInbox: () => answer(),
    markResultsInboxSeen: async (ids, seen) => { calls.seen.push([ids, seen]); return seenAnswer(); },
    markAllResultsInboxSeen: async (upTo) => { calls.all.push(upTo); return { updated: 1 }; },
    getTaskIsolation: async (applicationId, isolationId) => { calls.isolation.push([applicationId, isolationId]); return new Promise(() => undefined); },
    getTaskIsolationDiff: async () => ({}),
    acceptTaskIsolationFiles: async () => ({}),
    discardTaskIsolationFiles: async () => ({}),
    closeTaskIsolation: async () => ({}),
    getSpecialistOutput: async (applicationId, outputId, workspaceId) => {
      calls.output.push([applicationId, outputId, workspaceId]);
      return { output: { id: outputId, kind: "report", title: "Night summary", fromDatasets: [], fromSources: [], focus: "", createdAt: NOW, updatedAt: NOW, workspaceId: workspaceId ?? "", workspaceName: "Alpha" }, content: "# Summary", truncated: false };
    },
    getArtifact: async () => { throw new Error("not used"); },
  };
}

async function settle() {
  for (let index = 0; index < 6; index += 1) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

async function render() {
  await act(async () => {
    root?.render(<QueryClientProvider client={queryClient}>
      <ResultsInboxPanel client={fakeClient()} active onOpenSession={(workspaceId, sessionId) => { calls.open.push([workspaceId, sessionId]); }} />
    </QueryClientProvider>);
  });
  await settle();
}

async function click(selector: string, scope: ParentNode = host) {
  const element = scope.querySelector(selector);
  if (!(element instanceof HTMLElement)) throw new Error(`missing ${selector}`);
  await act(async () => { element.click(); });
  await settle();
}

const rows = () => [...host.querySelectorAll("[data-results-inbox-item]")].map(row => row.getAttribute("data-results-inbox-item"));

beforeEach(() => {
  calls = { seen: [], all: [], open: [], isolation: [], output: [] };
  seenAnswer = async () => ({ updated: 1 });
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

const reviewItem = item({ id: "run:app_1:task_2:2", taskId: "task_2", taskName: "Price refresh", isolation: { id: "iso_1", review: "pending" }, endedAt: NOW - 30_000 });
const failedItem = item({ id: "run:app_1:task_3:3", taskId: "task_3", taskName: "Weekly check", status: "failed", detail: "The engine answered 502.", endedAt: NOW - DAY, sessionId: "ses_3" });
const blockedItem = item({ id: "run:app_1:task_4:4", taskId: "task_4", taskName: "Orphan task", status: "blocked", detail: "No project.", workspaceId: null, workspaceName: null, sessionId: null, endedAt: NOW - 3 * DAY, finishedAt: null, seen: true, seenAt: NOW });
const outputItem = item({ outputs: [{ kind: "output", id: "out-report-1", title: "Night summary", type: "report", workspaceId: "ws_a", updatedAt: NOW - 70_000 }] });

test("model: filters, status, actions and badge", () => {
  const items = [outputItem, reviewItem, failedItem, blockedItem];
  expect(filterResultsInbox(items, "all").map(entry => entry.id)).toEqual(items.map(entry => entry.id));
  expect(filterResultsInbox(items, "review").map(entry => entry.taskName)).toEqual(["Price refresh"]);
  expect(filterResultsInbox(items, "failed").map(entry => entry.taskName)).toEqual(["Weekly check", "Orphan task"]);
  expect(resultsInboxStatus(failedItem).tone).toBe("danger");
  expect(resultsInboxStatus(item({ status: "skipped" })).tone).toBe("muted");
  expect(primaryResultsInboxAction(reviewItem)).toBe("review");
  expect(primaryResultsInboxAction(outputItem)).toBe("open");
  expect(primaryResultsInboxAction(item({ sessionId: null, outputs: outputItem.outputs }))).toBe("output");
  expect(primaryResultsInboxAction(blockedItem)).toBe(null);
  expect(resultsInboxActions(reviewItem)).toEqual(["review", "open"]);
  expect(resultsInboxActions(blockedItem)).toEqual([]);
  expect(resultsInboxBadge(0)).toBe(null);
  expect(resultsInboxBadge(7)).toBe("7");
  expect(resultsInboxBadge(250)).toBe("99+");
});

test("model: groups by the local day each result ended, newest first", () => {
  const days = groupResultsInboxByDay([blockedItem, failedItem, outputItem, reviewItem], NOW);
  expect(days.map(day => day.items.map(entry => entry.taskName))).toEqual([["Price refresh", "Nightly report"], ["Weekly check"], ["Orphan task"]]);
  expect(days[0]?.label).toBe("Today");
  expect(days[1]?.label).toBe("Yesterday");
});

test("the client contract rejects a malformed answer instead of reading it as empty", () => {
  expect(resultsInboxSnapshotSchema.safeParse({ enabled: true, items: [] }).success).toBe(false);
  expect(resultsInboxSnapshotSchema.safeParse(snapshot([outputItem])).success).toBe(true);
});

test("renders results grouped by day with status, place, unread state and outputs", async () => {
  answer = async () => snapshot([outputItem, reviewItem, failedItem, blockedItem]);
  await render();
  expect(rows()).toEqual([reviewItem.id, outputItem.id, failedItem.id, blockedItem.id]);
  const headings = [...host.querySelectorAll("section h2")].map(node => node.textContent);
  expect(headings.slice(0, 2)).toEqual(["Today", "Yesterday"]);
  const failed = host.querySelector(`[data-results-inbox-item="${failedItem.id}"]`);
  expect(failed?.getAttribute("data-seen")).toBe("false");
  expect(failed?.textContent).toContain("The engine answered 502.");
  expect(failed?.textContent).toContain("Exports");
  expect(failed?.textContent).toContain("Alpha");
  expect(host.querySelector(`[data-results-inbox-item="${blockedItem.id}"]`)?.getAttribute("data-seen")).toBe("true");
  expect(host.querySelector(`[data-results-inbox-item="${reviewItem.id}"] [data-results-inbox-review]`)).not.toBeNull();
  expect(host.querySelector(`[data-results-inbox-output="out-report-1"]`)?.textContent).toContain("Night summary");
  expect(host.textContent).toContain("Unread: 3 · Needs review: 1 · Failed: 2");
});

test("filters narrow the list and an empty filter says so, not 'no results'", async () => {
  answer = async () => snapshot([outputItem, failedItem]);
  await render();
  await click('[data-results-inbox-filter="failed"]');
  expect(rows()).toEqual([failedItem.id]);
  expect(host.querySelector('[data-results-inbox-filter="failed"]')?.getAttribute("aria-pressed")).toBe("true");
  await click('[data-results-inbox-filter="review"]');
  expect(rows()).toEqual([]);
  expect(host.querySelector("[data-results-inbox-empty]")?.textContent).toContain("No results match this filter.");
});

test("opening a conversation navigates and marks the result seen", async () => {
  // The fake server keeps the mark, as the real one does.
  answer = async () => snapshot([{ ...failedItem, seen: calls.seen.some(([ids, seen]) => seen && ids.includes(failedItem.id)) }]);
  await render();
  await click(`[data-results-inbox-item="${failedItem.id}"] [data-results-inbox-action="open"]`);
  expect(calls.open).toEqual([["ws_a", "ses_3"]]);
  expect(calls.seen).toEqual([[[failedItem.id], true]]);
  expect(host.querySelector(`[data-results-inbox-item="${failedItem.id}"]`)?.getAttribute("data-seen")).toBe("true");
});

test("a pending review opens the review panel first; outputs open in place; both mark seen", async () => {
  answer = async () => snapshot([reviewItem, outputItem]);
  await render();
  await click(`[data-results-inbox-item="${reviewItem.id}"] [data-results-inbox-open]`);
  expect(calls.isolation).toEqual([["app_1", "iso_1"]]);
  expect(calls.open).toEqual([]);
  expect(calls.seen).toEqual([[[reviewItem.id], true]]);
  await click(`[data-results-inbox-output="out-report-1"]`);
  expect(calls.output).toEqual([["app_1", "out-report-1", "ws_a"]]);
  expect(calls.seen.at(-1)).toEqual([[outputItem.id], true]);
});

test("a seen result can be marked unread again; mark all uses the snapshot instant", async () => {
  answer = async () => snapshot([blockedItem, outputItem]);
  await render();
  await click(`[data-results-inbox-item="${blockedItem.id}"] [data-results-inbox-toggle-seen]`);
  expect(calls.seen).toEqual([[[blockedItem.id], false]]);
  await click("[data-results-inbox-mark-all]");
  expect(calls.all).toEqual([NOW]);
});

test("a failed seen change is reported and rolled back", async () => {
  answer = async () => snapshot([outputItem]);
  seenAnswer = async () => { throw new Error("Server unreachable"); };
  await render();
  await click(`[data-results-inbox-item="${outputItem.id}"] [data-results-inbox-toggle-seen]`);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Server unreachable");
  expect(host.querySelector(`[data-results-inbox-item="${outputItem.id}"]`)?.getAttribute("data-seen")).toBe("false");
});

test("a failed request is an error, never an empty inbox", async () => {
  answer = async () => { throw new Error("Server unreachable"); };
  await render();
  expect(host.querySelector("[data-results-inbox-error]")?.textContent).toContain("Server unreachable");
  expect(host.querySelector("[data-results-inbox-empty]")).toBeNull();
});

test("a malformed answer is an error too", async () => {
  answer = async () => ({ enabled: true, items: "nope" });
  await render();
  expect(host.querySelector("[data-results-inbox-error]")).not.toBeNull();
});

test("empty and complete says no results yet; incomplete names what could not be read", async () => {
  answer = async () => snapshot([]);
  await render();
  expect(host.querySelector("[data-results-inbox-empty]")?.textContent).toContain("No results yet");
  await act(async () => root?.unmount());
  root = createRoot(host);
  queryClient.clear();
  answer = async () => snapshot([], { complete: false, problems: [{ source: "tasks", id: "app_1", label: "Exports", message: "unreadable" }] });
  await render();
  expect(host.querySelector("[data-results-inbox-incomplete]")?.textContent).toContain("Scheduled tasks of Exports");
  expect(host.querySelector("[data-results-inbox-empty]")?.textContent).toContain("No results in the places that answered.");
});

test("badge shows the unread count and the nav label says it", async () => {
  expect(resultsInboxNavLabel(3)).toBe("Inbox, 3 unread");
  expect(resultsInboxNavLabel(null)).toBe("Inbox");
  await act(async () => { root?.render(<ResultsInboxBadge count={120} />); });
  expect(host.querySelector("[data-results-inbox-badge]")?.textContent).toBe("99+");
  await act(async () => { root?.render(<ResultsInboxBadge count={0} />); });
  expect(host.querySelector("[data-results-inbox-badge]")).toBeNull();
  expect(resultsInboxSummaryQueryKey("http://x")[0]).toBe("results-inbox");
});

test("the compact rail offers the inbox with its unread badge, only when available", async () => {
  const { SidebarProvider } = await import("../src/components/ui/sidebar");
  const { CompactSidebarNav } = await import("../src/react-app/domains/session/sidebar/compact-sidebar-nav");
  let opened = 0;
  await act(async () => root?.render(<SidebarProvider defaultOpen={false}><CompactSidebarNav onNewTask={() => {}} onExtensions={() => {}}
    onResultsInbox={() => { opened += 1; }} resultsInboxActive resultsInboxUnread={4} /></SidebarProvider>));
  const entry = host.querySelector<HTMLElement>('button[aria-label="Inbox, 4 unread"]');
  expect(entry).not.toBeNull();
  expect(entry?.getAttribute("data-active")).not.toBeNull();
  expect(entry?.querySelector("[data-results-inbox-badge]")?.textContent).toBe("4");
  await act(async () => { entry?.click(); });
  expect(opened).toBe(1);
  await act(async () => root?.render(<SidebarProvider defaultOpen={false}><CompactSidebarNav onNewTask={() => {}} onExtensions={() => {}} /></SidebarProvider>));
  expect(host.querySelector('button[aria-label^="Inbox"]')).toBeNull();
});
