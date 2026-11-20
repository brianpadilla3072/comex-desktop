import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { ApiError } from "../src/errors.js";
import { applicationInput, specialistDirectory, specialistStore } from "../src/specialists/store.js";
import { appendRun, createTask, finishRun, listRuns } from "../src/specialists/tasks.js";
import { writeOutput } from "../src/specialists/outputs.js";
import { closeIsolation, createIsolation } from "../src/specialists/isolation/service.js";
import {
  INBOX_ITEM_LIMIT, INBOX_OUTPUT_LIMIT, INBOX_RETENTION_MS, INBOX_RUN_WINDOW_MS, INBOX_SEEN_LIMIT,
  applySeen, inboxItemId, inboxStatus, linkOutputs, parseInboxItemId, pruneSeen,
} from "../src/results-inbox-core.js";
import {
  describeResultsInbox, markAllResultsSeen, markResultsSeen, registerResultsInboxRoutes, resultsInboxSnapshotSchema,
  resultsInboxSummarySchema, summarizeResultsInbox,
} from "../src/results-inbox.js";
import { matchRoute, type RequestContext, type Route } from "../src/routes/registry.js";
import type { ServerConfig, WorkspaceInfo } from "../src/types.js";

// Nothing here may reach the person's own state: every location a server could read points
// into a scratch folder for the whole file.
const ISOLATED_KEYS = ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "OPENWORK_DATA_DIR", "OPENWORK_RUNTIME_DB", "OPENCODE_DB", "OPENWORK_ENV_STORE", "DEN_FEATURE_RESULTS_INBOX"];
const savedEnv = new Map<string, string | undefined>();
let sandbox = "";
before(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "results-inbox-env-"));
  for (const key of ISOLATED_KEYS) savedEnv.set(key, process.env[key]);
  process.env.HOME = sandbox;
  process.env.XDG_CONFIG_HOME = join(sandbox, "config");
  process.env.XDG_DATA_HOME = join(sandbox, "data");
  process.env.XDG_STATE_HOME = join(sandbox, "state");
  process.env.XDG_CACHE_HOME = join(sandbox, "cache");
  process.env.OPENWORK_DATA_DIR = join(sandbox, "openwork");
  process.env.OPENWORK_RUNTIME_DB = join(sandbox, "runtime.sqlite");
  process.env.OPENCODE_DB = join(sandbox, "opencode.db");
  process.env.OPENWORK_ENV_STORE = join(sandbox, "env.json");
  delete process.env.DEN_FEATURE_RESULTS_INBOX;
});
after(async () => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(sandbox, { recursive: true, force: true });
});

// ---- Contract vectors (contracts/results-inbox/v1) ----

const candidateSchema = z.object({
  kind: z.enum(["output", "artifact"]), id: z.string(), title: z.string(), type: z.string(), workspaceId: z.string(),
  createdAt: z.number(), updatedAt: z.number(),
});
const vectors = z.object({
  constants: z.object({ retentionMs: z.number(), seenLimit: z.number(), itemLimit: z.number(), runWindowMs: z.number(), outputLimit: z.number() }),
  ids: z.array(z.object({ id: z.string(), parsed: z.object({ applicationId: z.string(), taskId: z.string(), at: z.number() }).nullable() })),
  status: z.array(z.object({ run: z.string(), inbox: z.string().nullable() })),
  prune: z.array(z.object({ name: z.string(), now: z.number(), entries: z.array(z.unknown()), expected: z.array(z.unknown()) })),
  apply: z.array(z.object({ name: z.string(), now: z.number(), entries: z.array(z.object({ id: z.string(), seenAt: z.number() })), ids: z.array(z.string()), seen: z.boolean(), expected: z.array(z.unknown()) })),
  link: z.array(z.object({
    name: z.string(),
    run: z.object({ status: z.enum(["ok", "failed", "blocked", "skipped"]), at: z.number(), finishedAt: z.number().nullable(), workspaceId: z.string().nullable() }),
    candidates: z.array(candidateSchema),
    expected: z.array(z.string()),
  })),
}).parse(JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "..", "contracts", "results-inbox", "v1", "vectors.json"), "utf8")));

test("contract: constants, ids, outcome mapping, retention and output linking", () => {
  assert.deepEqual(vectors.constants, {
    retentionMs: INBOX_RETENTION_MS, seenLimit: INBOX_SEEN_LIMIT, itemLimit: INBOX_ITEM_LIMIT, runWindowMs: INBOX_RUN_WINDOW_MS, outputLimit: INBOX_OUTPUT_LIMIT,
  });
  for (const vector of vectors.ids) assert.deepEqual(parseInboxItemId(vector.id), vector.parsed, vector.id);
  for (const vector of vectors.status) assert.equal(inboxStatus(vector.run), vector.inbox, vector.run);
  for (const vector of vectors.prune) assert.deepEqual(pruneSeen(vector.entries, vector.now), vector.expected, vector.name);
  for (const vector of vectors.apply) assert.deepEqual(applySeen(vector.entries, vector.ids, vector.seen, vector.now), vector.expected, vector.name);
  for (const vector of vectors.link) assert.deepEqual(linkOutputs(vector.run, vector.candidates).map(entry => entry.id), vector.expected, vector.name);
});

test("seen marks are capped at the limit, newest kept", () => {
  const app = "app_00000000-0000-4000-8000-000000000001";
  const task = "task_00000000-0000-4000-8000-000000000002";
  const now = 2_000_000_000_000;
  const entries = Array.from({ length: INBOX_SEEN_LIMIT + 5 }, (_, index) => ({ id: inboxItemId(app, task, now - index), seenAt: now - index }));
  const pruned = pruneSeen(entries, now);
  assert.equal(pruned.length, INBOX_SEEN_LIMIT);
  assert.equal(pruned[0]?.seenAt, now);
  assert.equal(pruned.at(-1)?.seenAt, now - INBOX_SEEN_LIMIT + 1);
});

// ---- Aggregation over real stores in a scratch folder ----

function workspace(id: string, name: string, path: string): WorkspaceInfo {
  return { id, name, path, preset: "starter", workspaceType: "local" };
}

type InboxTestConfig = Pick<ServerConfig, "configPath" | "workspaces">;
function asConfig(config: InboxTestConfig): ServerConfig {
  // The inbox reads only these fields; the rest of ServerConfig is irrelevant here.
  return Object.assign(Object.create(null), config);
}

async function fixture() {
  const root = await mkdtemp(join(sandbox, "server-"));
  const project = join(root, "project-a");
  await mkdir(project, { recursive: true });
  await writeFile(join(project, "informe.md"), "uno\n");
  const config = asConfig({ configPath: join(root, "server.json"), workspaces: [workspace("ws_a", "Alpha", project)] });
  const store = await specialistStore(config);
  const app = store.create(applicationInput.parse({ userName: "Test", name: "Exports", specialty: "Trade", personality: "Calm", template: "custom" }), { agents: 0, skills: 0 });
  store.bind("ws_a", app.id, project);
  return { root, project, config, appId: app.id };
}

test("aggregates finished runs across applications with outputs, review state and session", async () => {
  const { root, project, config, appId } = await fixture();
  try {
    const nightly = await createTask(config, appId, { name: "nightly report", prompt: "Report.", schedule: { kind: "daily", hour: 2, minute: 0 } });
    const weekly = await createTask(config, appId, { name: "weekly check", prompt: "Check.", schedule: { kind: "weekly", daysOfWeek: [1], hour: 3, minute: 0 } });
    const now = Date.now();

    // An ok run that wrote a report while in flight, with an isolated copy still waiting for review.
    const startedAt = now - 60_000;
    await appendRun(config, appId, nightly.id, { at: startedAt, mode: "scheduled", missed: 0, workspaceId: "ws_a", sessionId: "ses_ok", status: "dispatched", detail: null });
    const { output } = await writeOutput(project, { kind: "report", title: "Night summary", content: "# Summary\n" });
    const isolation = await createIsolation(config, { applicationId: appId, workspaceId: "ws_a", projectRoot: project, origin: { kind: "task_run", taskId: nightly.id, runAt: startedAt }, sessionId: "ses_ok" });
    const runs = await listRuns(config, appId, nightly.id);
    assert.equal(runs.length, 1);
    await writeFile(join(specialistDirectory(config), appId, "tasks", `${nightly.id}.json`), JSON.stringify([{ ...runs[0], isolationId: isolation.id }]));
    await finishRun(config, appId, nightly.id, startedAt, { status: "ok" });
    assert.ok((await listRuns(config, appId, nightly.id))[0]?.finishedAt, "finishing a run records when");

    // Older outcomes: a failure, a blocked run with no project, a skip, a run still in flight and one past retention.
    await appendRun(config, appId, weekly.id, { at: now - INBOX_RETENTION_MS - 60_000, mode: "scheduled", missed: 0, workspaceId: "ws_a", sessionId: null, status: "ok", detail: null });
    await appendRun(config, appId, weekly.id, { at: now - 3 * 86_400_000, mode: "scheduled", missed: 0, workspaceId: "none", sessionId: null, status: "blocked", detail: "No project." });
    await appendRun(config, appId, weekly.id, { at: now - 2 * 86_400_000, mode: "scheduled", missed: 1, workspaceId: "ws_a", sessionId: null, status: "skipped_missed", detail: "Closed." });
    await appendRun(config, appId, weekly.id, { at: now - 86_400_000, mode: "manual", missed: 0, workspaceId: "ws_a", sessionId: "ses_fail", status: "failed", detail: "The engine answered 502.", finishedAt: now - 86_000_000 });
    await appendRun(config, appId, weekly.id, { at: now - 1_000, mode: "manual", missed: 0, workspaceId: "ws_a", sessionId: "ses_live", status: "dispatched", detail: null });

    const snapshot = await describeResultsInbox(config, now + 1_000);
    assert.equal(resultsInboxSnapshotSchema.safeParse(snapshot).success, true);
    assert.equal(snapshot.complete, true);
    assert.deepEqual(snapshot.items.map(item => [item.taskName, item.status]), [
      ["nightly report", "ok"], ["weekly check", "failed"], ["weekly check", "skipped"], ["weekly check", "blocked"],
    ], "newest first; in-flight and expired runs are not results");
    const [ok, failed, skipped, blocked] = snapshot.items;
    assert.equal(ok?.id, inboxItemId(appId, nightly.id, startedAt));
    assert.equal(ok?.applicationName, "Exports");
    assert.equal(ok?.workspaceName, "Alpha");
    assert.equal(ok?.sessionId, "ses_ok");
    assert.equal(ok?.detail, null);
    assert.deepEqual(ok?.isolation, { id: isolation.id, review: "pending" });
    assert.deepEqual(ok?.outputs.map(entry => [entry.kind, entry.id, entry.title]), [["output", output.id, "Night summary"]]);
    assert.equal(failed?.detail, "The engine answered 502.");
    assert.equal(failed?.finishedAt, now - 86_000_000);
    assert.deepEqual(failed?.outputs, [], "the report was written outside this run's window");
    assert.equal(skipped?.finishedAt, null);
    assert.equal(skipped?.endedAt, now - 2 * 86_400_000);
    assert.equal(blocked?.workspaceId, null);
    assert.deepEqual(snapshot.counts, { total: 4, unseen: 4, needsReview: 1, failed: 2 });

    // Reviewing the copy closes it; the inbox follows.
    await closeIsolation(config, appId, isolation.id);
    const reviewed = await describeResultsInbox(config, now + 2_000);
    assert.deepEqual(reviewed.items[0]?.isolation, { id: isolation.id, review: "reviewed" });
    assert.equal(reviewed.counts.needsReview, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("seen marks persist on disk, can be undone, and mark-all respects the snapshot instant", async () => {
  const { root, config, appId } = await fixture();
  try {
    const task = await createTask(config, appId, { name: "refresh", prompt: "Refresh.", schedule: { kind: "interval", everyMinutes: 60 } });
    const now = Date.now();
    await appendRun(config, appId, task.id, { at: now - 7_200_000, mode: "scheduled", missed: 0, workspaceId: "ws_a", sessionId: "ses_1", status: "ok", detail: null, finishedAt: now - 7_100_000 });
    await appendRun(config, appId, task.id, { at: now - 3_600_000, mode: "scheduled", missed: 0, workspaceId: "ws_a", sessionId: "ses_2", status: "ok", detail: null, finishedAt: now - 3_500_000 });
    const first = inboxItemId(appId, task.id, now - 7_200_000);
    const second = inboxItemId(appId, task.id, now - 3_600_000);

    await markResultsSeen(config, [first], true, now);
    const file: unknown = JSON.parse(await readFile(join(specialistDirectory(config), "results-inbox.json"), "utf8"));
    assert.deepEqual(file, { version: 1, seen: [{ id: first, seenAt: now }] }, "kept server-side, versioned");
    let snapshot = await describeResultsInbox(config, now);
    assert.deepEqual(snapshot.items.map(item => [item.id, item.seen]), [[second, false], [first, true]]);
    assert.equal((await summarizeResultsInbox(config, now)).counts.unseen, 1);

    await markResultsSeen(config, [first], false, now);
    snapshot = await describeResultsInbox(config, now);
    assert.equal(snapshot.counts.unseen, 2);

    // A result that ended after the snapshot the person looked at stays unread.
    await markAllResultsSeen(config, now - 7_000_000, now);
    snapshot = await describeResultsInbox(config, now);
    assert.deepEqual(snapshot.items.map(item => [item.id, item.seen]), [[second, false], [first, true]]);
    await markAllResultsSeen(config, undefined, now);
    assert.equal((await describeResultsInbox(config, now)).counts.unseen, 0);

    // Concurrent marks from two devices are both kept.
    await markResultsSeen(config, [first, second], false, now);
    await Promise.all([markResultsSeen(config, [first], true, now), markResultsSeen(config, [second], true, now)]);
    assert.equal((await describeResultsInbox(config, now)).counts.unseen, 0);

    // A damaged seen file is reported, never read as "all read".
    await writeFile(join(specialistDirectory(config), "results-inbox.json"), "{not json");
    snapshot = await describeResultsInbox(config, now);
    assert.equal(snapshot.complete, false);
    assert.deepEqual(snapshot.problems.map(problem => problem.source), ["seen"]);
    assert.equal(snapshot.counts.unseen, 2);
    // Marking again replaces the damaged file.
    await markResultsSeen(config, [first], true, now);
    assert.equal((await describeResultsInbox(config, now)).complete, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an unreadable tasks store is a problem, not an empty inbox", async () => {
  const { root, config, appId } = await fixture();
  try {
    await mkdir(join(specialistDirectory(config), appId), { recursive: true });
    await writeFile(join(specialistDirectory(config), appId, "tasks.json"), "{broken");
    const snapshot = await describeResultsInbox(config);
    assert.equal(snapshot.complete, false);
    assert.deepEqual(snapshot.problems.map(problem => [problem.source, problem.id, problem.label]), [["tasks", appId, "Exports"]]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

function routeHarness(config: ServerConfig) {
  const routes: Route[] = [];
  registerResultsInboxRoutes({
    routes, config, ensureWritable: () => {},
    readJsonBody: async request => {
      const value: unknown = await request.json();
      return z.record(z.string(), z.unknown()).parse(value);
    },
    jsonResponse: (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  });
  return async (method: string, path: string, body?: unknown) => {
    const match = matchRoute(routes, method, path);
    assert.ok(match, `no route for ${method} ${path}`);
    const url = new URL(`http://127.0.0.1:1${path}`);
    const request = new Request(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }) });
    const context: Pick<RequestContext, "request" | "url" | "params" | "config"> = { request, url, params: match.params, config };
    try {
      const response = await match.handler(Object.assign(Object.create(null), context));
      return { status: response.status, auth: match.auth, cache: response.headers.get("cache-control"), body: await response.json() };
    } catch (error) {
      if (error instanceof ApiError) return { status: error.status, auth: match.auth, cache: null, body: { code: error.code } };
      throw error;
    }
  };
}

test("routes are owner-only, validate their input and honour the flag", async () => {
  const { root, config, appId } = await fixture();
  try {
    const task = await createTask(config, appId, { name: "refresh", prompt: "Refresh.", schedule: { kind: "interval", everyMinutes: 60 } });
    const at = Date.now() - 60_000;
    await appendRun(config, appId, task.id, { at, mode: "manual", missed: 0, workspaceId: "ws_a", sessionId: "ses_1", status: "ok", detail: null, finishedAt: at + 1_000 });
    const call = routeHarness(config);

    const listed = await call("GET", "/results-inbox");
    assert.equal(listed.auth, "host");
    assert.equal(listed.status, 200);
    assert.equal(listed.cache, "no-store");
    assert.equal(resultsInboxSnapshotSchema.safeParse(listed.body).success, true);
    const summary = await call("GET", "/results-inbox/summary");
    assert.equal(summary.auth, "host");
    assert.deepEqual(resultsInboxSummarySchema.parse(summary.body).counts, { total: 1, unseen: 1, needsReview: 0, failed: 0 });

    const id = inboxItemId(appId, task.id, at);
    const marked = await call("POST", "/results-inbox/seen", { ids: [id], seen: true });
    assert.equal(marked.auth, "host");
    assert.deepEqual(marked.body, { updated: 1 });
    assert.equal(resultsInboxSummarySchema.parse((await call("GET", "/results-inbox/summary")).body).counts.unseen, 0);

    for (const bad of [{ ids: [] }, { ids: ["../../etc/passwd"] }, { ids: [id], seen: "yes" }, { ids: [id], extra: 1 }]) {
      const rejected = await call("POST", "/results-inbox/seen", bad);
      assert.deepEqual([rejected.status, rejected.body], [400, { code: "invalid_payload" }], JSON.stringify(bad));
    }
    const all = await call("POST", "/results-inbox/seen-all", {});
    assert.equal(all.auth, "host");
    assert.equal(all.status, 200);
    assert.deepEqual((await call("POST", "/results-inbox/seen-all", { upTo: "now" })).status, 400);

    process.env.DEN_FEATURE_RESULTS_INBOX = "false";
    try {
      const offCalls: Array<[string, string, unknown]> = [["GET", "/results-inbox", undefined], ["GET", "/results-inbox/summary", undefined], ["POST", "/results-inbox/seen", { ids: [id] }], ["POST", "/results-inbox/seen-all", {}]];
      for (const [method, path, body] of offCalls) {
        const off = await call(method, path, body);
        assert.deepEqual([off.status, off.body], [404, { code: "results_inbox_disabled" }], path);
      }
    } finally { delete process.env.DEN_FEATURE_RESULTS_INBOX; }
  } finally { await rm(root, { recursive: true, force: true }); }
});
