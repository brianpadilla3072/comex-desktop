/** @jsxImportSource react */
import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://localhost/" });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useCompanionHost } = await import("../src/react-app/domains/desktop-companion/use-companion-host");
import type { CompanionAction, CompanionCommand, CompanionResult, CompanionSnapshot } from "../src/app/lib/desktop-companion";

let unmount: (() => Promise<void>) | null = null;
afterEach(async () => { await unmount?.(); unmount = null; delete window.__OPENWORK_COMPANION_HOST__; });
afterAll(async () => GlobalRegistrator.unregister());
const data = (): Omit<CompanionSnapshot, "target"> => ({ sessionId: "chat", title: "Chat", project: "Proyecto", model: "Modelo", state: "idle", canSend: true, messages: [], activity: [], permission: null, question: null });

test("host follows the focused owner, rejects previous-owner events and delivers duplicate commands only once", async () => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  const snapshots: CompanionSnapshot[] = [], cleared: string[] = [], sent: CompanionAction[] = [], replies: CompanionResult[] = [];
  const callbacks = new Set<(command: CompanionCommand) => void>();
  window.__OPENWORK_COMPANION_HOST__ = {
    onView: () => () => {}, recentSessions: () => {}, onSelectSession: () => () => {}, onReadSession: () => () => {},
    state: async () => ({ enabled: true }), publish: snapshot => { snapshots.push(snapshot); }, clear: target => { cleared.push(target); },
    reply: (_id, result) => { replies.push(result); }, onCommand: callback => { callbacks.add(callback); return () => { callbacks.delete(callback); }; },
  };
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  unmount = async () => { await act(async () => root.unmount()); host.remove(); };
  function Harness({ owner }: { owner: string }) { useCompanionHost({ active: true, owner, snapshot: data(), execute: async action => { sent.push(action); return { ok: true }; } }); return null; }
  await act(async () => root.render(<Harness owner="first" />));
  const first = snapshots.at(-1)!; const oldListener = [...callbacks][0];
  const command: CompanionCommand = { id: "once", target: first.target, action: { kind: "send", text: "Mensaje", files: [] } };
  await act(async () => { oldListener(command); oldListener(command); });
  expect(sent.length).toBe(1); expect(replies[0].ok).toBe(true);
  await act(async () => root.render(<Harness owner="second" />));
  expect(cleared).toContain(first.target); expect(snapshots.at(-1)!.target).not.toBe(first.target);
  await act(async () => { oldListener({ ...command, id: "late" }); for (const callback of callbacks) callback({ ...command, id: "wrong-owner" }); });
  expect(sent.length).toBe(1);
});

test("a disabled feature does not subscribe or publish", async () => {
  let published = 0, subscribed = 0;
  window.__OPENWORK_COMPANION_HOST__ = { onView: () => () => {}, recentSessions: () => {}, onSelectSession: () => () => {}, onReadSession: () => () => {}, state: async () => ({ enabled: false }), publish: () => { published++; }, clear: () => {}, reply: () => {}, onCommand: () => { subscribed++; return () => {}; } };
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
  unmount = async () => { await act(async () => root.unmount()); host.remove(); };
  function Harness() { useCompanionHost({ active: true, owner: "owner", snapshot: data(), execute: async () => ({ ok: true }) }); return null; }
  await act(async () => root.render(<Harness />));
  expect(published).toBe(0); expect(subscribed).toBe(0);
});

test("turning off stops projection and listeners; explicit reactivation publishes only current state", async () => {
  const snapshots: CompanionSnapshot[] = [];
  let enabled = true, projected = 0, commandListeners = 0;
  let onEnabled: ((value: boolean) => void) | undefined;
  window.__OPENWORK_COMPANION_HOST__ = {
    state: async () => ({ enabled, expanded: true }), onEnabled: callback => { onEnabled = callback; return () => { onEnabled = undefined; }; },
    onView: () => () => {}, recentSessions: () => {}, onSelectSession: () => () => {}, onReadSession: () => () => {},
    publish: value => { snapshots.push(value); }, clear: () => {}, reply: () => {},
    onCommand: () => { commandListeners++; return () => { commandListeners--; }; },
  };
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
  unmount = async () => { await act(async () => root.unmount()); host.remove(); };
  function Harness({ text }: { text: string }) {
    useCompanionHost({ active: true, owner: "runtime-toggle", snapshot: () => {
      projected++; return { ...data(), messages: [{ id: "reply", role: "assistant", text }] };
    }, execute: async () => ({ ok: true }) }); return null;
  }
  await act(async () => root.render(<Harness text="initial" />));
  expect(commandListeners).toBe(1);
  await act(async () => { enabled = false; onEnabled?.(false); });
  const before = projected, sent = snapshots.length;
  await act(async () => root.render(<Harness text="while disabled" />));
  await act(async () => new Promise(resolve => setTimeout(resolve, 300)));
  expect(projected).toBe(before); expect(snapshots.length).toBe(sent); expect(commandListeners).toBe(0);
  await act(async () => { enabled = true; onEnabled?.(true); });
  expect(commandListeners).toBe(1); expect(snapshots.at(-1)?.messages[0]?.text).toBe("while disabled");
});

test("a visible reply is only marked read when the main window has focus", async () => {
  const { companionMemoryKey, useCompanionSeen } = await import("../src/react-app/domains/desktop-companion/recent-sessions");
  const at = Date.now() - 1000, key = companionMemoryKey("scope-read", "workspace", "chat");
  useCompanionSeen.setState({ entries: {} });
  useCompanionSeen.getState().responses([{ key, at }]);
  let focused = false;
  Object.defineProperty(document, "hasFocus", { configurable: true, value: () => focused });
  window.__OPENWORK_COMPANION_HOST__ = { onView: () => () => {}, recentSessions: () => {}, onSelectSession: () => () => {}, onReadSession: () => () => {}, state: async () => ({ enabled: true }), publish: () => {}, clear: () => {}, reply: () => {}, onCommand: () => () => {} };
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
  unmount = async () => { await act(async () => root.unmount()); host.remove(); Reflect.deleteProperty(document, "hasFocus"); };
  function Harness({ owner }: { owner: string }) { useCompanionHost({ active: true, owner, scope: "scope-read", snapshot: { ...data(), workspaceId: "workspace", responseAt: at }, execute: async () => ({ ok: true }) }); return null; }
  await act(async () => root.render(<Harness owner="hidden" />));
  expect(useCompanionSeen.getState().entries[key].readAt).toBe(0);
  focused = true;
  await act(async () => root.render(<Harness owner="focused" />));
  expect(useCompanionSeen.getState().entries[key].readAt).toBeGreaterThanOrEqual(at);
});

test("folded hosts do not build transcript updates; expanded bursts publish the latest text once", async () => {
  const snapshots: CompanionSnapshot[] = [], projected: boolean[] = [];
  let view: ((expanded: boolean) => void) | undefined;
  window.__OPENWORK_COMPANION_HOST__ = {
    state: async () => ({ enabled: true, expanded: false }), onView: callback => { view = callback; return () => {}; },
    publish: snapshot => { snapshots.push(snapshot); }, clear: () => {}, reply: () => {}, onCommand: () => () => {},
    recentSessions: () => {}, onSelectSession: () => () => {}, onReadSession: () => () => {},
  };
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
  unmount = async () => { await act(async () => root.unmount()); host.remove(); };
  function Harness({ text, permission = false }: { text: string; permission?: boolean }) {
    useCompanionHost({ active: true, owner: "batch", urgentKey: String(permission), snapshot: detail => {
      projected.push(detail); return { ...data(), messages: detail ? [{ id: "a", role: "assistant", text }] : [], permission: permission ? { id: "p", title: "Editar", detail: "archivo", busy: false } : null };
    }, execute: async () => ({ ok: true }) }); return null;
  }
  await act(async () => root.render(<Harness text="initial" />));
  for (let i = 0; i < 20; i++) await act(async () => root.render(<Harness text={`folded-${i}`} />));
  await act(async () => new Promise(resolve => setTimeout(resolve, 300)));
  expect(projected).toEqual([false]); expect(snapshots.length).toBe(1);
  await act(async () => { view?.(true); });
  expect(snapshots.at(-1)?.messages[0]?.text).toBe("folded-19");
  const before = snapshots.length;
  for (let i = 0; i < 20; i++) await act(async () => root.render(<Harness text={`expanded-${i}`} />));
  await act(async () => new Promise(resolve => setTimeout(resolve, 300)));
  expect(snapshots.length - before).toBe(1); expect(snapshots.at(-1)?.messages[0]?.text).toBe("expanded-19");
  await act(async () => root.render(<Harness text="permission" permission />));
  expect(snapshots.at(-1)?.permission?.id).toBe("p");
});
