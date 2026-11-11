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

test("a disabled feature does not subscribe or publish, including an asynchronous mount being replaced", async () => {
  let published = 0, subscribed = 0;
  window.__OPENWORK_COMPANION_HOST__ = { state: async () => ({ enabled: false }), publish: () => { published++; }, clear: () => {}, reply: () => {}, onCommand: () => { subscribed++; return () => {}; } };
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
  unmount = async () => { await act(async () => root.unmount()); host.remove(); };
  function Harness() { useCompanionHost({ active: true, owner: "owner", snapshot: data(), execute: async () => ({ ok: true }) }); return null; }
  await act(async () => root.render(<Harness />));
  expect(published).toBe(0); expect(subscribed).toBe(0);
});
