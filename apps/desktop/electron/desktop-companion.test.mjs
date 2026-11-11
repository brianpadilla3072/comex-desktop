import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import { companionBounds, companionCommand, companionPreferences, companionSnapshot, createDesktopCompanion } from "./desktop-companion.mjs";

const snapshot = () => ({ target: "owner-a", sessionId: "session-a", title: "Investigar", project: "Proyecto", model: "Modelo",
  state: "idle", canSend: true, messages: [], activity: [], permission: null, question: null });
function fixture(enabled = true) {
  class Window extends EventEmitter {
    constructor(options = {}) { super(); this.options = options; this.visible = true; this.destroyed = false; this.sent = []; this.bounds = options;
      this.webContents = new EventEmitter(); this.webContents.mainFrame = {}; this.webContents.send = (...args) => this.sent.push(args); this.webContents.setWindowOpenHandler = callback => { this.openHandler = callback; }; }
    setBounds(bounds) { this.bounds = bounds; }
    setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {}
    showInactive() { this.visible = true; } show() { this.visible = true; } hide() { this.visible = false; }
    focus() { this.focused = true; } isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit("closed"); }
  }
  const handlers = new Map(), ipcMain = new EventEmitter(); ipcMain.handle = (name, fn) => handlers.set(name, fn);
  const main = new Window(), windows = [], shortcuts = new Set(), screen = new EventEmitter();
  const primary = { id: 1, workArea: { x: 0, y: 24, width: 1440, height: 876 } };
  screen.getAllDisplays = () => [primary]; screen.getPrimaryDisplay = () => primary;
  let quitting = false, opened = 0;
  class Tray extends EventEmitter { setToolTip() {} setContextMenu(menu) { this.menu = menu; } destroy() {} }
  const controller = createDesktopCompanion({ enabled, app: { quit() {} },
    BrowserWindow: class extends Window { constructor(options) { super(options); windows.push(this); } }, Tray, Menu: { buildFromTemplate: value => value },
    globalShortcut: { register: key => shortcuts.add(key), unregister: key => shortcuts.delete(key) }, screen, ipcMain,
    icon: {}, directory: path.join(os.tmpdir(), "openwork-companion-tests-no-config"), preload: "isolated.cjs", load: async () => {},
    getMain: () => main, quitting: () => quitting, openMain: async () => { opened++; main.show(); },
  });
  const event = window => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
  const call = (window, name, ...args) => handlers.get(`openwork:companion:${name}`)(event(window), ...args);
  const publish = value => ipcMain.emit("openwork:companion:publish", event(main), value);
  controller.attachMain(main);
  return { controller, main, windows, ipcMain, event, call, publish, shortcuts, screen, setQuitting: value => { quitting = value; }, getOpened: () => opened };
}

test("geometry stays in the selected work area across negative origins, scaling and small screens", () => {
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
test("disabled feature leaves ordinary close and startup unchanged", async () => {
  const f = fixture(false); await f.controller.start(); let prevented = false;
  f.main.emit("close", { preventDefault: () => { prevented = true; } });
  assert.equal(prevented, false); assert.equal(f.windows.length, 0); assert.equal(f.shortcuts.size, 0); f.controller.dispose();
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
  assert.equal(f.call(capsule, "state").snapshot.permission.id, "p"); f.controller.dispose();
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
