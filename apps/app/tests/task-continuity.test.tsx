/** @jsxImportSource react */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://localhost/" });
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const React = await import("react");
Reflect.set(globalThis, "React", React);
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { TaskContinuityPanel } = await import("../src/react-app/domains/session/comex/task-panel");
const { ComexGitPanel } = await import("../src/react-app/domains/session/comex/git-panel");
const { createOpenworkServerClient } = await import("../src/app/lib/openwork-server");
import type { TaskState } from "@openwork/types/task-continuity";
after(async () => GlobalRegistrator.unregister());
const blank = (): TaskState => ({ revision: 0, workspaceId: "ws_fixture", sessionId: "ses_fixture", objective: "", criteria: "", status: "idle", phase: "work", maxTurns: 8, turns: 0, model: "opencode/big-pickle", summary: "", evidence: "", lastMessageId: null, awaiting: false, updatedAt: 0, reason: "", worktree: null, codeBaseline: null, codeTouched: false });
const flush = async () => act(async () => { await new Promise(r => setTimeout(r, 30)); });
async function click(host: HTMLElement, label: string) { const button = [...host.querySelectorAll("button")].find(x => x.textContent?.includes(label)); assert.ok(button, label); await act(async () => button.click()); await flush(); }

test("a user starts and pauses a bounded goal; errors retain the editable draft", async () => {
  let state = blank(); let calls = 0; let fail = false;
  const client = { ...createOpenworkServerClient({ baseUrl: "http://localhost/fixture" }), getTaskContinuity: async () => state,
    updateTaskGoal: async (_w: string, _s: string, body: { revision: number; action: "start" | "pause" | "resume"; goal?: { objective: string; criteria: string; maxTurns: number } }) => {
      calls++; if (body.action === "start") { assert.equal(body.goal?.objective, "Informe del proyecto"); assert.equal(body.goal?.criteria, "Archivo y fuentes verificadas"); } if (fail) throw new Error("offline"); assert.equal(body.revision, state.revision);
      state = { ...state, ...body.goal, revision: state.revision + 1, status: body.action === "pause" ? "paused" : "active" }; return state;
    } };
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  try {
    await act(async () => root.render(<QueryClientProvider client={cache}><TaskContinuityPanel client={client} workspaceId="ws_fixture" sessionId="ses_fixture" /></QueryClientProvider>)); await flush();
    assert.equal(calls, 0); await click(host, "Objetivo y continuidad"); await click(host, "Definir objetivo");
    const fields = host.querySelectorAll("textarea");
    await act(async () => {
      for (const [index, value] of ["Informe del proyecto", "Archivo y fuentes verificadas"].entries()) {
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set?.call(fields[index], value);
        fields[index]!.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    // Native React change events are exercised through the form's own controls.
    assert.equal(host.querySelectorAll("textarea").length, 2);
    assert.match(host.textContent!, /Big Pickle/);
    // Submit handler reads rendered controlled values; update through the real DOM change event.
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await flush(); assert.equal(calls, 1);
    await click(host, "Pausar objetivo"); assert.equal(state.status, "paused");
    await click(host, "Definir objetivo"); fail = true;
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await flush(); assert.ok(host.querySelector('[role="alert"]')); assert.equal(host.querySelectorAll("textarea").length, 2);
  } finally { await act(async () => root.unmount()); cache.clear(); host.remove(); }
});

test("moving a conversation keeps its worktree association and offers returning home", async () => {
  let state: TaskState = { ...blank(), status: "paused" }; let moved = 0;
  const head = "a".repeat(40);
  const client = { ...createOpenworkServerClient({ baseUrl: "http://localhost/fixture" }), getTaskContinuity: async () => state,
    getComexGitReview: async () => ({ root: "/fixture", head, status: [], diff: "", truncated: false }), listTaskWorktrees: async () => ({ items: [] }),
    changeTaskWorktree: async (_w: string, _s: string, body: { action: "isolate" | "return" | "remove"; expectedHead?: string }) => { if (body.action === "isolate") assert.equal(body.expectedHead, head); moved++; state = { ...state, worktree: body.action === "isolate" ? "/fixture-isolated" : null }; return state; } };
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  try {
    await act(async () => root.render(<QueryClientProvider client={cache}><ComexGitPanel client={client} workspaceId="ws_fixture" sessionId="ses_fixture" /></QueryClientProvider>)); await flush();
    await click(host, "Trabajo aislado y cambios"); await click(host, "Continuar este chat en trabajo aislado");
    assert.equal(moved, 1); assert.match(host.textContent!, /fixture-isolated/);
    await click(host, "Volver al proyecto con este chat"); assert.equal(moved, 2); assert.equal(state.worktree, null);
  } finally { await act(async () => root.unmount()); cache.clear(); host.remove(); }
});

test("project clients retain and rotate local host credentials without forwarding them to remote servers", async () => {
  const { createWorkspaceServerClientResolverState } = await import("../src/react-app/infra/workspace-server-client");
  const original = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = async (_input, init) => { seen.push(new Headers(init?.headers).get("x-openwork-host-token") ?? ""); return Response.json({ items: [] }); };
  try {
    const resolver = createWorkspaceServerClientResolverState({ baseUrl: "http://127.0.0.1:8787", token: "client-fixture", hostToken: "host-first" });
    const first = resolver.resolve({ id: "ws_fixture" }); assert.ok(first);
    await first.client.listTaskWorktrees("ws_fixture", "ses_fixture");
    resolver.update({ baseUrl: "http://127.0.0.1:8787", token: "client-fixture", hostToken: "host-second" });
    const second = resolver.resolve({ id: "ws_fixture" }); assert.ok(second); assert.notEqual(first.client, second.client);
    await second.client.listTaskWorktrees("ws_fixture", "ses_fixture");
    resolver.update({ baseUrl: "https://example.invalid", token: "remote-client", hostToken: "host-private" });
    await resolver.resolve({ id: "ws_fixture" })!.client.listTaskWorktrees("ws_fixture", "ses_fixture");
    assert.deepEqual(seen, ["host-first", "host-second", ""]);
  } finally { globalThis.fetch = original; }
});
