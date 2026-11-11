import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/** @type {import("@openwork/types/desktop-companion").CompanionPreferences} */
const DEFAULTS = Object.freeze({ mascot: "sprout", image: "", motion: true, openOnHover: false, autoClose: 15, alerts: true });
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value, max = 4000) => typeof value === "string" && value.length <= max;
const short = (value, max) => typeof value === "string" ? value.slice(0, max) : "";

export function companionPreferences(value) {
  if (!record(value)) return { ...DEFAULTS };
  const image = text(value.image, 700_000) && /^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/=]+$/.test(value.image) ? value.image : "";
  return { mascot: ["sprout", "ember", "image"].includes(value.mascot) ? value.mascot : "sprout", image,
    motion: value.motion !== false, openOnHover: value.openOnHover === true,
    autoClose: [5, 15, 30].includes(value.autoClose) ? value.autoClose : 15, alerts: value.alerts !== false };
}

/** Treat even our renderer's data as input. Never forward raw SDK objects or credentials. */
export function companionSnapshot(value) {
  if (!record(value) || !text(value.target, 128) || !value.target || !text(value.sessionId, 256)
    || !["idle", "working", "waiting", "offline", "error"].includes(value.state)) return null;
  const permission = record(value.permission) && text(value.permission.id, 256) ? {
    id: value.permission.id, title: short(value.permission.title, 300), detail: short(value.permission.detail, 4000), busy: value.permission.busy === true,
  } : null;
  const question = record(value.question) && text(value.question.id, 256) && Array.isArray(value.question.questions) ? {
    id: value.question.id, busy: value.question.busy === true, questions: value.question.questions.slice(0, 4).filter(record).map(q => ({
      text: short(q.text, 1000), multiple: q.multiple === true, options: Array.isArray(q.options) ? q.options.filter(x => text(x, 300)).slice(0, 12) : [],
    })),
  } : null;
  return { target: value.target, sessionId: value.sessionId, title: short(value.title, 300), project: short(value.project, 300), model: short(value.model, 200),
    state: value.state, canSend: value.canSend === true, permission, question,
    messages: Array.isArray(value.messages) ? value.messages.slice(-8).filter(record).map(m => ({ id: short(m.id, 256), role: short(m.role, 20), text: short(m.text, 6000) })) : [],
    activity: Array.isArray(value.activity) ? value.activity.filter(x => text(x, 300)).slice(-12) : [] };
}

export function companionCommand(value, snapshot) {
  if (!record(value) || !text(value.id, 128) || !value.id || !snapshot || value.target !== snapshot.target || !record(value.action)) return null;
  const action = value.action;
  if (action.kind === "send") {
    if (!snapshot.canSend || snapshot.state === "offline" || !text(action.text, 32000) || !Array.isArray(action.files) || action.files.length > 8) return null;
    let total = 0;
    for (const file of action.files) {
      if (!record(file) || !text(file.name, 255) || !file.name || /[\\/\x00-\x1f]/.test(file.name) || !text(file.type, 150)
        || !text(file.data, 11_200_000) || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data) || file.data.length % 4 !== 0) return null;
      total += file.data.length;
    }
    if (total > 11_200_000 || (!action.text.trim() && !action.files.length)) return null;
    return { id: value.id, target: value.target, action: { kind: "send", text: action.text, files: action.files.map(f => ({ name: f.name, type: f.type, data: f.data })) } };
  }
  if (action.kind === "stop") return { id: value.id, target: value.target, action: { kind: "stop" } };
  if (action.kind === "permission" && snapshot.permission?.id === action.requestId && !snapshot.permission.busy && ["once", "reject"].includes(action.reply)) {
    return { id: value.id, target: value.target, action: { kind: "permission", requestId: action.requestId, reply: action.reply } };
  }
  if (action.kind === "question" && snapshot.question?.id === action.requestId && !snapshot.question.busy) {
    if (action.answers !== null && (!Array.isArray(action.answers) || action.answers.length !== snapshot.question.questions.length
      || action.answers.some(a => !Array.isArray(a) || a.length > 12 || a.some(x => !text(x, 1000))))) return null;
    return { id: value.id, target: value.target, action: { kind: "question", requestId: action.requestId, answers: action.answers } };
  }
  return null;
}

export function companionBounds(display, expanded, height = 380) {
  const area = display.workArea;
  const width = expanded ? Math.min(560, area.width) : 84;
  return { x: Math.round(area.x + (area.width - width) / 2), y: area.y,
    width, height: expanded ? Math.min(Math.max(180, Math.round(height)), 680, area.height) : 42 };
}

/** Native window lifetime, sender validation and at-most-once command delivery. Injectable for tests. */
export function createDesktopCompanion({ enabled, app, BrowserWindow, Tray, Menu, globalShortcut, screen, ipcMain, icon, directory, preload, load, getMain, quitting, openMain }) {
  let win = null, tray = null, ready = false, active = enabled, expanded = false, height = 380, displayId = null;
  let snapshot = null, updatedAt = 0, preferences = { ...DEFAULTS }, preferencesWrite = Promise.resolve();
  const commands = new Map();
  const trustedMain = event => Boolean(getMain() && event.sender === getMain().webContents && event.senderFrame === event.sender.mainFrame);
  const trustedCapsule = event => Boolean(win && event.sender === win.webContents && event.senderFrame === event.sender.mainFrame);
  const state = () => ({ enabled: active && enabled, expanded, snapshot, updatedAt, preferences });
  const publish = () => { if (win && !win.isDestroyed()) win.webContents.send("openwork:companion:state", state()); };
  function position() {
    if (!win || win.isDestroyed()) return;
    const displays = screen.getAllDisplays();
    const display = displays.find(d => d.id === displayId) ?? screen.getPrimaryDisplay();
    displayId = display.id;
    win.setBounds(companionBounds(display, expanded, height));
  }
  function view(on, focus = false) {
    if (!ready || !active || !win || win.isDestroyed()) return;
    expanded = on === true; position(); publish();
    if (expanded && focus) { win.show(); win.focus(); } else win.showInactive();
  }
  const fail = error => ({ ok: false, error });
  ipcMain.handle("openwork:companion:host-state", event => trustedMain(event) ? { enabled } : { enabled: false });
  ipcMain.on("openwork:companion:publish", (event, value) => {
    if (!enabled || !trustedMain(event)) return;
    const next = companionSnapshot(value); if (!next) return;
    const previous = snapshot; snapshot = next; updatedAt = Date.now(); publish();
    if (preferences.alerts && (next.permission?.id && next.permission.id !== previous?.permission?.id || next.question?.id && next.question.id !== previous?.question?.id)) view(true);
  });
  ipcMain.on("openwork:companion:clear", (event, target) => {
    if (!trustedMain(event) || snapshot?.target !== target) return;
    snapshot = { ...snapshot, state: "offline", canSend: false, permission: null, question: null }; publish();
  });
  ipcMain.handle("openwork:companion:state", event => trustedCapsule(event) ? state() : null);
  ipcMain.handle("openwork:companion:view", (event, value) => { if (!trustedCapsule(event) || !record(value)) return false;
    if (Number.isFinite(value.height)) height = Math.min(680, Math.max(180, value.height));
    view(value.expanded === true, value.focus === true); return true;
  });
  ipcMain.handle("openwork:companion:open-main", async event => { if (!trustedCapsule(event)) return false; await openMain(); view(false); return true; });
  ipcMain.handle("openwork:companion:preferences", async (event, value) => {
    if (!trustedCapsule(event)) return false;
    const next = companionPreferences(value);
    preferencesWrite = preferencesWrite.catch(() => {}).then(async () => {
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, "companion.json"), JSON.stringify(next), { mode: 0o600 }); preferences = next; publish();
    });
    await preferencesWrite; return true;
  });
  ipcMain.handle("openwork:companion:command", (event, value) => {
    if (!active || !ready || !trustedCapsule(event) || !getMain() || getMain().isDestroyed()) return fail("El chat no está disponible. Abrí la app.");
    const command = companionCommand(value, snapshot);
    if (!command || Date.now() - updatedAt > 15000) return fail("El chat o la solicitud cambió. Revisá el estado antes de continuar.");
    if (commands.has(command.id)) return commands.get(command.id).promise;
    const requestKey = command.action.kind === "permission" || command.action.kind === "question" ? `${command.target}:${command.action.requestId}` : null;
    if (requestKey && [...commands.values()].some(entry => entry.requestKey === requestKey)) return fail("Esta solicitud ya fue respondida. Esperá la actualización del chat.");
    // Bound the replay cache; never evict a command that is still in flight.
    for (const [id, entry] of commands) if (entry.done && Date.now() - entry.at > 600000) commands.delete(id);
    if (commands.size >= 500) return fail("Hay demasiadas solicitudes. Abrí la app para continuar.");
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    const entry = { promise, resolve, target: command.target, requestKey, done: false, at: Date.now(), timer: null };
    commands.set(command.id, entry);
    entry.timer = setTimeout(() => { entry.done = true; resolve({ ok: false, uncertain: true, error: "No se pudo confirmar la acción. Revisá el chat antes de volver a enviarla." }); }, 45000);
    getMain().webContents.send("openwork:companion:command", command);
    return promise;
  });
  ipcMain.on("openwork:companion:reply", (event, id, result) => {
    if (!trustedMain(event)) return;
    const entry = commands.get(id); if (!entry || entry.done || !record(result)) return;
    entry.done = true; clearTimeout(entry.timer);
    entry.resolve({ ok: result.ok === true, uncertain: result.uncertain === true, ...(text(result.error, 1000) ? { error: result.error } : {}) });
  });
  function setActive(value) { active = enabled && value; if (active) view(false); else { win?.hide(); void openMain(); } }
  return {
    enabled: () => enabled,
    attachMain(main) {
      main.on("close", event => { if (ready && active && !quitting()) { event.preventDefault(); main.hide(); view(false); } });
      main.on("closed", () => { if (enabled && !active && process.platform !== "darwin" && !quitting()) app.quit(); });
      main.webContents.on("render-process-gone", () => { if (snapshot) { snapshot = { ...snapshot, state: "offline", canSend: false, permission: null, question: null }; publish(); } });
    },
    async start() {
      if (!enabled || win) return;
      try { preferences = companionPreferences(JSON.parse(await readFile(path.join(directory, "companion.json"), "utf8"))); } catch { /* fresh installation */ }
      win = new BrowserWindow({ ...companionBounds(screen.getPrimaryDisplay(), false), show: false, frame: false, transparent: true,
        resizable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false,
        webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false } });
      win.setAlwaysOnTop(true, "floating");
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      win.webContents.on("will-navigate", event => event.preventDefault());
      win.on("close", event => { if (!quitting()) { event.preventDefault(); view(false); } });
      win.on("closed", () => { win = null; ready = false; });
      try {
        tray = new Tray(icon); tray.setToolTip("Asistente de escritorio");
        tray.setContextMenu(Menu.buildFromTemplate([
          { label: "Abrir la app", click: () => void openMain() },
          { label: "Abrir el chat", click: () => view(true, true) },
          { label: "Cápsula visible", type: "checkbox", checked: true, click: item => setActive(item.checked) },
          { type: "separator" }, { label: "Salir", click: () => app.quit() },
        ]));
        tray.on("click", () => view(!expanded, true));
      } catch (error) { win.destroy(); win = null; throw error; }
      await load(win); ready = true; position(); view(false);
      // Shortcut registration failure keeps the tray as the recovery entry point.
      globalShortcut.register("CommandOrControl+Alt+Space", () => view(true, true));
      for (const name of ["display-added", "display-removed", "display-metrics-changed"]) screen.on(name, position);
    },
    dispose() {
      for (const entry of commands.values()) { clearTimeout(entry.timer); if (!entry.done) entry.resolve({ ok: false, uncertain: true, error: "La aplicación está saliendo." }); }
      commands.clear(); ready = false;
      globalShortcut.unregister("CommandOrControl+Alt+Space");
      for (const name of ["display-added", "display-removed", "display-metrics-changed"]) screen.removeListener(name, position);
      tray?.destroy(); tray = null; win?.destroy(); win = null;
    },
  };
}
