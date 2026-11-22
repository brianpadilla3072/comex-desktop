import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import { companionBounds, companionCommand, companionPreferences, companionRecentSessions, companionSnapshot, createDesktopCompanion } from "./desktop-companion.mjs";

const snapshot = () => ({ target: "owner-a", sessionId: "session-a", title: "Investigar", project: "Proyecto", model: "Modelo",
  state: "idle", canSend: true, messages: [], activity: [], permission: null, question: null });
function fixture(enabled = true) {
  class Window extends EventEmitter {
    constructor(options = {}) { super(); this.options = options; this.visible = true; this.destroyed = false; this.sent = []; this.bounds = options;
      this.webContents = new EventEmitter(); this.webContents.mainFrame = {}; this.webContents.send = (...args) => this.sent.push(args); this.webContents.setWindowOpenHandler = callback => { this.openHandler = callback; }; }
    setBounds(bounds) { this.bounds = bounds; }
    setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {}
    showInactive() { this.visible = true; } show() { this.visible = true; this.minimized = false; this.emit("show"); } hide() { this.visible = false; this.emit("hide"); }
    isVisible() { return this.visible; } isMinimized() { return this.minimized === true; }
    minimize() { this.minimized = true; this.emit("minimize"); } restore() { this.minimized = false; this.visible = true; this.emit("restore"); }
    focus() { this.focused = true; } isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit("closed"); }
  }
  const handlers = new Map(), ipcMain = new EventEmitter(); ipcMain.handle = (name, fn) => handlers.set(name, fn);
  const main = new Window(), windows = [], trays = [], shortcuts = new Set(), screen = new EventEmitter();
  main.visible = false;
  const primary = { id: 1, workArea: { x: 0, y: 24, width: 1440, height: 876 } };
  screen.getAllDisplays = () => [primary]; screen.getPrimaryDisplay = () => primary;
  let quitting = false, opened = 0;
  class Tray extends EventEmitter { constructor() { super(); trays.push(this); } setToolTip() {} setContextMenu(menu) { this.menu = menu; } destroy() {} }
  const controller = createDesktopCompanion({ enabled, app: { quit() {} },
    BrowserWindow: class extends Window { constructor(options) { super(options); windows.push(this); } }, Tray, Menu: { buildFromTemplate: value => value },
    globalShortcut: { register: key => { shortcuts.add(key); return true; }, unregister: key => shortcuts.delete(key) }, screen, ipcMain,
    icon: {}, directory: path.join(os.tmpdir(), "openwork-companion-tests-no-config"), preload: "isolated.cjs", load: async () => {},
    getMain: () => main, quitting: () => quitting, openMain: async () => { opened++; main.show(); },
  });
  const event = window => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
  const call = (window, name, ...args) => handlers.get(`openwork:companion:${name}`)(event(window), ...args);
  const publish = value => ipcMain.emit("openwork:companion:publish", event(main), value);
  controller.attachMain(main);
  return { controller, main, windows, trays, ipcMain, event, call, publish, shortcuts, screen, setQuitting: value => { quitting = value; }, getOpened: () => opened };
}

test("runtime off disables the host, releases its shortcut and rejects background updates", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
  const f = fixture(); await f.controller.start(); const capsule = f.windows[0], tray = f.trays[0];
  f.publish(snapshot());
  tray.menu.find(item => item.type === "checkbox").click({ checked: false });
  assert.equal(capsule.visible, false); assert.equal(f.call(f.main, "host-state").enabled, false);
  assert.equal(f.shortcuts.size, 0); assert.equal(tray.menu.find(item => item.type === "checkbox").checked, false);
  const before = capsule.sent.length, sentByHost = f.main.sent.length;
  f.publish({ ...snapshot(), title: "ignored", messages: [{ id: "late", role: "assistant", text: "ignored" }] });
  f.ipcMain.emit("openwork:companion:recents", f.event(f.main), []);
  t.mock.timers.tick(60000);
  assert.equal(capsule.sent.length, before); assert.equal(f.main.sent.length, sentByHost);
  assert.equal(f.call(capsule, "state").snapshot.messages.length, 0);
  assert.equal(f.call(capsule, "state").snapshot.title, "Investigar");
  tray.menu.find(item => item.type === "checkbox").click({ checked: true });
  assert.equal(f.call(f.main, "host-state").enabled, true); assert.equal(f.shortcuts.size, 1);
  assert.equal(capsule.visible, false); assert.equal(tray.menu.find(item => item.type === "checkbox").checked, true);
  f.main.hide(); assert.equal(capsule.visible, true);
  f.controller.dispose();
});

test("only the main window or capsule is visible; close and minimize keep the same host alive", async () => {
  const f = fixture(); f.main.show(); await f.controller.start(); const capsule = f.windows[0];
  f.publish(snapshot());
  assert.equal(capsule.visible, false); assert.equal(f.call(capsule, "state").visible, false);
  f.call(capsule, "view", { expanded: true, focus: true });
  assert.equal(capsule.visible, false); assert.equal(f.call(capsule, "state").expanded, false);
  f.main.minimize(); assert.equal(capsule.visible, true); assert.equal(f.call(capsule, "state").visible, true);
  f.call(capsule, "view", { expanded: true }); assert.equal(f.call(capsule, "state").expanded, true);
  f.main.restore(); assert.equal(capsule.visible, false); assert.equal(f.call(capsule, "state").expanded, false);
  f.publish({ ...snapshot(), permission: { id: "pending", title: "Editar", detail: "fixture", busy: false } });
  assert.equal(capsule.visible, false);
  let prevented = false; f.main.emit("close", { preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(f.main.isDestroyed(), false); assert.equal(capsule.visible, true);
  assert.equal(f.call(f.main, "host-state").enabled, true);
  f.call(capsule, "open-main"); assert.equal(f.main.visible, true); assert.equal(capsule.visible, false);
  f.controller.dispose();
  assert.equal(f.main.listenerCount("minimize"), 0); assert.equal(f.main.listenerCount("restore"), 0);
});

test("geometry centers on the screen while staying below reserved desktop panels", () => {
  const panelDisplay = { bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 80, y: 32, width: 1360, height: 868 } };
  assert.deepEqual(companionBounds(panelDisplay, false), { x: 678, y: 32, width: 84, height: 42 });
  assert.deepEqual(companionBounds(panelDisplay, true), { x: 440, y: 32, width: 560, height: 380 });
  const display = { workArea: { x: -1920, y: 30, width: 1920, height: 1050 } };
  assert.deepEqual(companionBounds(display, false), { x: -1002, y: 30, width: 84, height: 42 });
  const small = companionBounds({ workArea: { x: 0, y: 0, width: 320, height: 240 } }, true, 900);
  assert.equal(small.width, 320); assert.equal(small.height, 240);
});
test("snapshot is bounded and strips credentials, arbitrary SDK payloads and unexpected properties", () => {
  const normalized = companionSnapshot({ ...snapshot(), token: "secret", messages: Array.from({ length: 50 }, (_, i) => ({ id: `${i}`, role: "assistant", text: "x".repeat(10000), token: "secret" })) });
  assert.equal(normalized.messages.length, 8); assert.equal(normalized.messages[0].text.length, 6000); assert.equal(JSON.stringify(normalized).includes("secret"), false);
});
test("stale owners, answered requests, unsafe filenames and oversized attachments are rejected", () => {
  const make = action => ({ id: "command", target: "owner-a", action });
  assert.equal(companionCommand({ ...make({ kind: "stop" }), target: "other" }, snapshot()), null);
  assert.equal(companionCommand(make({ kind: "permission", requestId: "expired", reply: "once" }), snapshot()), null);
  assert.equal(companionCommand(make({ kind: "send", text: "x", files: [{ name: "../secret", type: "text/plain", data: "dGVzdA==" }] }), snapshot()), null);
  assert.equal(companionCommand(make({ kind: "send", text: "x", files: Array(8).fill({ name: "file", type: "", data: "AAAA".repeat(400000) }) }), snapshot()), null);
  assert.equal(companionCommand(make({ kind: "permission", requestId: "p1", reply: "always" }), { ...snapshot(), permission: { id: "p1" } }), null);
});
test("custom mascot preferences reject active content and preserve safe image data", () => {
  assert.equal(companionPreferences({ image: "data:image/svg+xml,<svg/onload=alert(1)>" }).image, "");
  assert.equal(companionPreferences({ image: "data:image/png;base64,dGVzdA==", mascot: "image" }).mascot, "image");
  assert.equal(companionPreferences({ autoClose: -1 }).autoClose, 15);
});
test("recents are bounded, deduplicated and cannot spoof another workspace key", () => {
  const item = { key: JSON.stringify(["ws", "chat"]), workspaceId: "ws", sessionId: "chat", title: "Chat", status: "unread", selected: false, responseAt: 100, readAt: 0, token: "secret" };
  assert.equal(companionRecentSessions([item, item, { ...item, key: "forged" }]).length, 1);
  assert.equal(JSON.stringify(companionRecentSessions([item])).includes("secret"), false);
  assert.equal(companionBounds({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }, false, 380, 3).width, 156);
});
test("only the inventory host publishes recents; read requires the expanded, current response", async () => {
  const f = fixture(); await f.controller.start(); const capsule = f.windows[0];
  const item = { key: JSON.stringify(["ws", "session-a"]), workspaceId: "ws", sessionId: "session-a", title: "Chat", status: "unread", responseAt: 200, readAt: 0 };
  f.ipcMain.emit("openwork:companion:recents", f.event(capsule), [item]);
  assert.equal(f.call(capsule, "state").recentSessions.length, 0);
  f.ipcMain.emit("openwork:companion:recents", f.event(f.main), [item]);
  f.publish({ ...snapshot(), workspaceId: "ws", responseAt: 100 });
  assert.equal(f.call(capsule, "read-session", item.key), false);
  assert.equal(f.call(capsule, "select-session", "unknown"), false);
  assert.equal(f.call(capsule, "select-session", item.key), true);
  assert.equal(f.call(capsule, "read-session", item.key), false);
  f.publish({ ...snapshot(), workspaceId: "ws", responseAt: 200 });
  assert.equal(f.call(capsule, "read-session", item.key), true);
  assert.deepEqual(f.main.sent.at(-1), ["openwork:companion:read-session", item.key, 200]);
  f.call(capsule, "view", { expanded: false }); assert.equal(f.call(capsule, "read-session", item.key), false);
  f.controller.dispose();
});
test("disabled feature leaves ordinary close and startup unchanged", async () => {
  const f = fixture(false); await f.controller.start(); let prevented = false;
  f.main.emit("close", { preventDefault: () => { prevented = true; } });
  assert.equal(prevented, false); assert.equal(f.windows.length, 0); assert.equal(f.shortcuts.size, 0); f.controller.dispose();
});
test("closing before capsule readiness preserves the host; failed or disposed startup restores ordinary close", async () => {
  const f = fixture(); f.main.show(); let prevented = false;
  f.main.emit("close", { preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(f.main.visible, false);
  await f.controller.start(); assert.equal(f.windows[0].visible, true);
  f.controller.dispose(); prevented = false;
  f.main.emit("close", { preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
});
test("close hides the main window, but explicit quit remains a real close", async () => {
  const f = fixture(); await f.controller.start(); let prevented = false;
  f.main.emit("close", { preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true); assert.equal(f.main.visible, false); assert.equal(f.main.destroyed, false);
  f.setQuitting(true); prevented = false; f.main.emit("close", { preventDefault: () => { prevented = true; } });
  assert.equal(prevented, false); f.controller.dispose(); assert.equal(f.shortcuts.size, 0);
});
test("only the host main frame publishes; alerts expand without keyboard focus and survive folding", async () => {
  const f = fixture(); await f.controller.start(); const capsule = f.windows[0];
  f.ipcMain.emit("openwork:companion:publish", f.event(capsule), snapshot());
  assert.equal(f.call(capsule, "state").snapshot, null);
  f.ipcMain.emit("openwork:companion:publish", { ...f.event(f.main), senderFrame: {} }, snapshot());
  assert.equal(f.call(capsule, "state").snapshot, null);
  f.publish({ ...snapshot(), state: "waiting", permission: { id: "p", title: "Editar", detail: "archivo", busy: false } });
  assert.equal(f.call(capsule, "state").expanded, true); assert.equal(capsule.focused, undefined);
  f.call(capsule, "view", { expanded: false });
  f.call(capsule, "view", { height: 420 });
  assert.equal(f.call(capsule, "state").expanded, false);
  assert.equal(f.call(capsule, "state").snapshot.permission.id, "p"); f.controller.dispose();
});
test("a permission cannot be answered again with a different command id", async () => {
  const f = fixture(); await f.controller.start(); const capsule = f.windows[0];
  f.publish({ ...snapshot(), permission: { id: "p", title: "Editar", detail: "archivo", busy: false } });
  const command = { id: "first", target: "owner-a", action: { kind: "permission", requestId: "p", reply: "once" } };
  const first = f.call(capsule, "command", command);
  f.ipcMain.emit("openwork:companion:reply", f.event(f.main), command.id, { ok: true });
  assert.equal((await first).ok, true);
  assert.equal((await f.call(capsule, "command", { ...command, id: "second" })).ok, false);
  assert.equal(f.main.sent.filter(([name]) => name === "openwork:companion:command").length, 1);
  f.controller.dispose();
});
test("commands are delivered once, require the active owner and accept replies only from the host", async () => {
  const f = fixture(); await f.controller.start(); const capsule = f.windows[0]; f.publish(snapshot());
  const command = { id: "same-command", target: "owner-a", action: { kind: "send", text: "hola", files: [] } };
  const first = f.call(capsule, "command", command), repeated = f.call(capsule, "command", command);
  assert.equal(first, repeated); assert.equal(f.main.sent.filter(([name]) => name === "openwork:companion:command").length, 1);
  f.ipcMain.emit("openwork:companion:reply", f.event(capsule), command.id, { ok: true });
  f.ipcMain.emit("openwork:companion:reply", f.event(f.main), command.id, { ok: true });
  assert.deepEqual(await first, { ok: true, uncertain: false });
  f.publish({ ...snapshot(), target: "owner-b" });
  assert.equal((await f.call(capsule, "command", { ...command, id: "new" })).ok, false);
  f.controller.dispose();
});
test("host disposal marks state unverified; shutdown resolves pending actions as uncertain", async () => {
  const f = fixture(); await f.controller.start(); const capsule = f.windows[0]; f.publish(snapshot());
  const pending = f.call(capsule, "command", { id: "inflight", target: "owner-a", action: { kind: "send", text: "hola", files: [] } });
  f.ipcMain.emit("openwork:companion:clear", f.event(f.main), "owner-a");
  assert.equal(f.call(capsule, "state").snapshot.state, "offline");
  assert.equal((await f.call(capsule, "command", { id: "other", target: "owner-a", action: { kind: "send", text: "hola", files: [] } })).ok, false);
  f.controller.dispose(); assert.equal((await pending).uncertain, true);
});
test("a definitively rejected request can be retried, but an uncertain reply keeps its lease", async () => {
  const f = fixture(); await f.controller.start(); const capsule = f.windows[0];
  f.publish({ ...snapshot(), permission: { id: "permission-retry", title: "Editar", detail: "fixture", busy: false } });
  const command = { id: "first-attempt", target: "owner-a", action: { kind: "permission", requestId: "permission-retry", reply: "once" } };
  const first = f.call(capsule, "command", command);
  f.ipcMain.emit("openwork:companion:reply", f.event(f.main), command.id, { ok: false, error: "No se envió" });
  assert.equal((await first).ok, false);
  const retry = f.call(capsule, "command", { ...command, id: "retry" });
  assert.equal(f.main.sent.filter(([name]) => name === "openwork:companion:command").length, 2);
  f.ipcMain.emit("openwork:companion:reply", f.event(f.main), "retry", { ok: false, uncertain: true });
  assert.equal((await retry).uncertain, true);
  assert.equal((await f.call(capsule, "command", { ...command, id: "unsafe-retry" })).ok, false);
  f.controller.dispose();
});

test("idle state stays valid without payload heartbeats; only a missing authenticated health reply disconnects", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
  const f = fixture(); await f.controller.start(); const capsule = f.windows[0]; f.publish(snapshot());
  const before = capsule.sent.length;
  t.mock.timers.tick(20000);
  assert.equal(f.call(capsule, "state").connected, true); assert.equal(capsule.sent.length, before);
  const command = { id: "idle-send", target: "owner-a", action: { kind: "send", text: "hola", files: [] } };
  const sent = f.call(capsule, "command", command); f.ipcMain.emit("openwork:companion:reply", f.event(f.main), command.id, { ok: true });
  assert.equal((await sent).ok, true);
  t.mock.timers.tick(10000);
  const ping = f.main.sent.findLast(([name]) => name === "openwork:companion:ping"); assert.ok(ping);
  f.ipcMain.emit("openwork:companion:pong", f.event(capsule), ping[1]);
  t.mock.timers.tick(10000); assert.equal(f.call(capsule, "state").connected, false);
  assert.equal((await f.call(capsule, "command", { ...command, id: "offline" })).ok, false);
  t.mock.timers.tick(30000);
  const retry = f.main.sent.findLast(([name]) => name === "openwork:companion:ping");
  f.ipcMain.emit("openwork:companion:pong", f.event(f.main), retry[1]);
  assert.equal(f.call(capsule, "state").connected, true); f.controller.dispose();
});
test("folded state omits transcripts, suppresses duplicates and avoids repeating image preferences", async () => {
  const f = fixture(); await f.controller.start(); const capsule = f.windows[0];
  f.publish({ ...snapshot(), messages: [{ id: "a", role: "assistant", text: "first" }] });
  const before = capsule.sent.filter(([name]) => name === "openwork:companion:state").length;
  for (let i = 0; i < 30; i++) f.publish({ ...snapshot(), messages: [{ id: "a", role: "assistant", text: `token-${i}` }] });
  assert.equal(capsule.sent.filter(([name]) => name === "openwork:companion:state").length, before);
  assert.equal(f.call(capsule, "state").snapshot.messages.length, 0);
  f.call(capsule, "view", { expanded: true });
  assert.equal(f.call(capsule, "state").snapshot.messages[0].text, "token-29");
  const lastPatch = capsule.sent.findLast(([name]) => name === "openwork:companion:state")[1];
  assert.equal("preferences" in lastPatch, false);
  f.controller.dispose();
});
