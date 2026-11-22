/** @jsxImportSource react */
import { afterAll, afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://localhost/" });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CompanionRecentsBridge } = await import("../src/react-app/domains/desktop-companion/companion-recents-bridge");
const { buildCompanionRecents, companionMemoryKey, companionSessionKey, COMPANION_RECENT_HOUR: HOUR, useCompanionSeen } = await import("../src/react-app/domains/desktop-companion/recent-sessions");
const { useSessionActivityStore } = await import("../src/react-app/domains/session/status/session-activity-store");
import type { CompanionRecentCandidate } from "../src/react-app/domains/desktop-companion/recent-sessions";
import type { CompanionRecentSession } from "../src/app/lib/desktop-companion";
const NOW = Date.parse("2026-11-11T15:00:00Z");
let unmount: (() => Promise<void>) | undefined;
const candidate = (id: string, responseAt: number, readAt = 0, waiting = false): CompanionRecentCandidate => ({ key: companionSessionKey("ws", id), workspaceId: "ws", sessionId: id, title: id, selected: false, responseAt, readAt, waiting });
beforeEach(async () => {
  setSystemTime(NOW); Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  useCompanionSeen.setState({ entries: {} }); await useCompanionSeen.persist.clearStorage();
  await useCompanionSeen.persist.rehydrate();
  useSessionActivityStore.setState({ recordsByWorkspaceId: {}, responseTimesByWorkspaceId: {}, statusesByWorkspaceId: {}, waitingByWorkspaceId: {} });
});
afterEach(async () => { await unmount?.(); unmount = undefined; delete window.__OPENWORK_COMPANION_HOST__; setSystemTime(); });
afterAll(async () => GlobalRegistrator.unregister());

test("the hour uses assistant completion, keeps older pending requests, and gives yellow priority", () => {
  const result = buildCompanionRecents([candidate("old", NOW - HOUR), candidate("new", NOW - 1000), candidate("waiting", NOW - 3 * HOUR, 0, true), candidate("seen", NOW - 2 * HOUR, NOW - 1000)], NOW);
  expect(result.map(item => [item.sessionId, item.status])).toEqual([["waiting", "waiting"], ["new", "unread"], ["seen", "idle"]]);
  expect(buildCompanionRecents([candidate("future", NOW + HOUR)], NOW)).toEqual([]);
});
test("seen stays gray for one hour from the first read; another answer restores blue", () => {
  const key = companionMemoryKey("scope", "ws", "chat"), store = useCompanionSeen.getState();
  store.responses([{ key, at: NOW - HOUR + 1000 }]); store.read(key, NOW - HOUR + 1000);
  setSystemTime(NOW + HOUR - 1); store.read(key, NOW - HOUR + 1000);
  let entry = useCompanionSeen.getState().entries[key]; expect(entry.readAt).toBe(NOW);
  expect(buildCompanionRecents([candidate("chat", entry.responseAt, entry.readAt)], Date.now())[0]?.status).toBe("idle");
  expect(buildCompanionRecents([candidate("chat", entry.responseAt, entry.readAt)], NOW + HOUR)).toEqual([]);
  setSystemTime(NOW + HOUR + 1000); store.responses([]); store.read(key, NOW - HOUR + 1000);
  expect(useCompanionSeen.getState().entries[key].readAt).toBe(NOW);
  store.responses([{ key, at: Date.now() }]); entry = useCompanionSeen.getState().entries[key];
  expect(buildCompanionRecents([candidate("chat", entry.responseAt, entry.readAt)], Date.now())[0]?.status).toBe("unread");
});
test("an older displayed reply cannot mark a newer response as read, and scope keys stay separate", () => {
  const key = companionMemoryKey("scope-a", "ws", "chat"), store = useCompanionSeen.getState();
  store.responses([{ key, at: NOW }]); store.read(key, NOW - 1000);
  expect(useCompanionSeen.getState().entries[key].readAt).toBe(0);
  expect(companionMemoryKey("scope-b", "ws", "chat")).not.toBe(key);
});

test("a delayed newer reply is unread even when its completion precedes the previous seen time", () => {
  const key = companionMemoryKey("scope", "ws", "delayed"), store = useCompanionSeen.getState();
  store.responses([{ key, at: NOW - 2000 }]); store.read(key, NOW - 2000);
  store.responses([{ key, at: NOW - 1000 }]);
  let entry = useCompanionSeen.getState().entries[key];
  expect(entry.readAt).toBe(0);
  expect(buildCompanionRecents([candidate("delayed", entry.responseAt, entry.readAt)], NOW)[0]?.status).toBe("unread");
  store.read(key, NOW - 1000); entry = useCompanionSeen.getState().entries[key];
  expect(entry.readAt).toBe(NOW);
  const another = companionMemoryKey("scope", "ws", "read-first");
  store.responses([{ key: another, at: NOW - 2000 }]); store.read(another, NOW - 2000);
  store.read(another, NOW - 1000); store.responses([{ key: another, at: NOW - 1000 }]);
  expect(useCompanionSeen.getState().entries[another]).toEqual({ responseAt: NOW - 1000, readAt: NOW });
});
test("opening old history or receiving a user message does not invent a recent assistant response", () => {
  const store = useSessionActivityStore.getState(), completed = NOW - HOUR - 1000;
  store.observeTranscript("ws", "chat", [{ id: "answer", role: "assistant", parts: [{ type: "text", text: "Respuesta anterior" }], metadata: { opencode: { completed } } }], true);
  store.observeTranscript("ws", "chat", [{ id: "new-user", role: "user", parts: [{ type: "text", text: "Mensaje nuevo" }] }]);
  expect(useSessionActivityStore.getState().recordsByWorkspaceId.ws.chat.lastAssistantResponseAt).toBe(completed);
  const key = companionMemoryKey("scope", "ws", "chat");
  useCompanionSeen.getState().read(key, completed);
  expect(useCompanionSeen.getState().entries[key]).toBeUndefined();
});

test("tool-call preambles and compaction summaries are not new replies to read", () => {
  const store = useSessionActivityStore.getState();
  store.observeTranscript("ws", "steps", [
    { id: "tool-step", role: "assistant", parts: [{ type: "text", text: "Voy a revisar" }], metadata: { opencode: { completed: NOW, finish: "tool-calls" } } },
    { id: "summary", role: "assistant", parts: [{ type: "text", text: "Resumen interno" }], metadata: { opencode: { completed: NOW, contextCompacted: true } } },
  ], true);
  expect(useSessionActivityStore.getState().recordsByWorkspaceId.ws.steps.lastAssistantResponseAt).toBe(0);
});
test("inventory bridge publishes colors and routes only known recent conversations", async () => {
  const key = companionSessionKey("ws", "chat"), selected: string[] = [], published: CompanionRecentSession[][] = [];
  let select: ((key: string) => void) | undefined, read: ((key: string, at: number) => void) | undefined;
  let enabled = true, onEnabled: ((value: boolean) => void) | undefined;
  window.__OPENWORK_COMPANION_HOST__ = {
    state: async () => ({ enabled }), onEnabled: callback => { onEnabled = callback; return () => {}; }, publish: () => {}, clear: () => {}, reply: () => {}, onCommand: () => () => {},
    onView: () => () => {}, recentSessions: sessions => { published.push(sessions); }, onSelectSession: callback => { select = callback; return () => {}; }, onReadSession: callback => { read = callback; return () => {}; },
  };
  useSessionActivityStore.getState().recordAssistantResponse("ws", "chat", NOW - 1000);
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
  unmount = async () => { await act(async () => root.unmount()); host.remove(); };
  await act(async () => root.render(<CompanionRecentsBridge source={{ draftScope: "scope", selectedWorkspaceId: "ws", selectedSessionId: "chat", workspaceSessionGroups: [{ workspace: { id: "ws", name: "Proyecto", path: "/fixture", preset: "starter", workspaceType: "local" }, status: "ready", sessions: [{ id: "chat", title: "Conversación" }] }], onOpenSession: (workspace, session) => { selected.push(`${workspace}:${session}`); } }} />));
  expect(published.at(-1)?.[0]?.status).toBe("unread");
  await act(async () => { select?.("unknown"); select?.(key); read?.(key, NOW - 1000); });
  await act(async () => new Promise(resolve => setTimeout(resolve, 300)));
  expect(selected).toEqual(["ws:chat"]); expect(published.at(-1)?.[0]?.status).toBe("idle");
  await act(async () => useSessionActivityStore.getState().setWaitingRequest("ws", "chat", "permission", "p", true));
  await act(async () => new Promise(resolve => setTimeout(resolve, 300)));
  expect(published.at(-1)?.[0]?.status).toBe("waiting");
  await act(async () => { enabled = false; onEnabled?.(false); });
  const before = published.length;
  await act(async () => {
    useSessionActivityStore.getState().setWaitingRequest("ws", "chat", "permission", "p", false);
    useSessionActivityStore.getState().recordAssistantResponse("ws", "chat", NOW - 500);
  });
  await act(async () => new Promise(resolve => setTimeout(resolve, 300)));
  expect(published.length).toBe(before); expect(published.at(-1)).toEqual([]);
  await act(async () => { enabled = true; onEnabled?.(true); });
  expect(published.at(-1)?.[0]?.status).toBe("unread");
});

test("one expiry follows the seen deadline and never expires a pending request", async () => {
  const { nextCompanionExpiry } = await import("../src/react-app/domains/desktop-companion/recent-sessions");
  expect(nextCompanionExpiry([candidate("pending", NOW - 2 * HOUR, 0, true)], NOW)).toBeUndefined();
  expect(nextCompanionExpiry([candidate("seen", NOW - 50000, NOW - 1000), candidate("new", NOW - 10000)], NOW)).toBe(NOW - 10000 + HOUR);
});

test("transcript token progress does not invalidate recent-session selectors", () => {
  const store = useSessionActivityStore.getState();
  store.setRunStatus("ws", "tokens", "running"); store.markAssistantOutput("ws", "tokens", undefined, { allowUnknownMessageRole: true, markDeltaProgress: true });
  const before = useSessionActivityStore.getState();
  for (let i = 1; i <= 200; i++) { setSystemTime(NOW + i); store.markAssistantOutput("ws", "tokens", undefined, { allowUnknownMessageRole: true, markDeltaProgress: true }); }
  const after = useSessionActivityStore.getState();
  expect(after.recordsByWorkspaceId).not.toBe(before.recordsByWorkspaceId);
  expect(after.statusesByWorkspaceId).toBe(before.statusesByWorkspaceId);
  expect(after.waitingByWorkspaceId).toBe(before.waitingByWorkspaceId);
  expect(after.responseTimesByWorkspaceId).toBe(before.responseTimesByWorkspaceId);
});

test("large answers are projected into bounded recent messages without copying whole histories", async () => {
  const { companionMessages } = await import("../src/react-app/domains/desktop-companion/snapshot-projection");
  const messages = Array.from({ length: 2000 }, (_, i) => ({ id: String(i), role: "assistant", parts: [{ type: "text", text: "x".repeat(10000) }] } satisfies import("ai").UIMessage));
  const result = companionMessages(messages);
  expect(result.length).toBe(8); expect(result[0].id).toBe("1992"); expect(result.every(message => message.text.length === 6000)).toBe(true);
});
