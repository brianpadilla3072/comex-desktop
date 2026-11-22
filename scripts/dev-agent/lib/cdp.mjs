import { writeFileSync } from "node:fs";

/** The main app page: never the hidden desktop companion, never DevTools. */
export function pickTarget(targets, preferred = "") {
  const pages = targets.filter(target => target.type === "page" && !target.url.includes("companion.html") && !target.url.startsWith("devtools://"));
  if (preferred) return pages.find(target => target.id === preferred || target.title === preferred || target.url.includes(preferred)) ?? null;
  return pages.find(target => target.title === "OpenWork") ?? pages[0] ?? null;
}

/**
 * Choose an element by what a person reads: exact aria-label or text first, then a
 * prefix, then a substring. `candidates` are { label, text, visible } snapshots.
 */
export function matchElement(candidates, query, nth = 0) {
  const wanted = query.trim().toLowerCase();
  const visible = candidates.filter(candidate => candidate.visible);
  const tiers = [
    candidate => candidate.label.toLowerCase() === wanted || candidate.text.toLowerCase() === wanted,
    candidate => candidate.label.toLowerCase().startsWith(wanted) || candidate.text.toLowerCase().startsWith(wanted),
    candidate => candidate.label.toLowerCase().includes(wanted) || candidate.text.toLowerCase().includes(wanted),
  ];
  const names = ["exact", "prefix", "substring"];
  for (const [index, test] of tiers.entries()) {
    const matches = visible.filter(test);
    if (matches.length) return { match: matches[nth] ?? null, count: matches.length, tier: names[index] };
  }
  return { match: null, count: 0, tier: null };
}

const KEYS = {
  Enter: { code: "Enter", keyCode: 13, text: "\r" }, Escape: { code: "Escape", keyCode: 27 }, Tab: { code: "Tab", keyCode: 9 },
  Backspace: { code: "Backspace", keyCode: 8 }, Delete: { code: "Delete", keyCode: 46 }, Space: { code: "Space", keyCode: 32, text: " " },
  ArrowUp: { code: "ArrowUp", keyCode: 38 }, ArrowDown: { code: "ArrowDown", keyCode: 40 }, ArrowLeft: { code: "ArrowLeft", keyCode: 37 }, ArrowRight: { code: "ArrowRight", keyCode: 39 },
  Home: { code: "Home", keyCode: 36 }, End: { code: "End", keyCode: 35 }, PageUp: { code: "PageUp", keyCode: 33 }, PageDown: { code: "PageDown", keyCode: 34 },
};
const MODIFIERS = { Alt: 1, Control: 2, Ctrl: 2, Meta: 4, Shift: 8 };

/** "Control+Shift+K" → CDP key event fields. */
export function keyEvent(chord) {
  const parts = chord.split("+").map(part => part.trim()).filter(Boolean);
  const key = parts.pop() ?? "";
  let modifiers = 0;
  for (const part of parts) {
    if (!(part in MODIFIERS)) throw new Error(`Unknown modifier "${part}" in "${chord}".`);
    modifiers |= MODIFIERS[part];
  }
  const named = KEYS[key];
  if (named) return { key: key === "Space" ? " " : key, code: named.code, windowsVirtualKeyCode: named.keyCode, text: modifiers ? undefined : named.text, modifiers };
  if (key.length === 1) {
    const upper = key.toUpperCase();
    return { key, code: /[A-Z]/.test(upper) ? `Key${upper}` : `Digit${key}`, windowsVirtualKeyCode: upper.charCodeAt(0), text: modifiers & ~MODIFIERS.Shift ? undefined : key, modifiers };
  }
  throw new Error(`Unknown key "${key}". Use a character or one of: ${Object.keys(KEYS).join(", ")}.`);
}

export async function connect(cdpUrl, preferred = "") {
  const base = cdpUrl.replace(/\/$/, "");
  const targets = await (await fetch(`${base}/json/list`)).json();
  const target = pickTarget(targets, preferred);
  if (!target) throw new Error(`No app page at ${base}. Pages: ${targets.map(entry => `${entry.type}:${entry.title}`).join(", ") || "none"}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  const listeners = new Set();
  let id = 0;
  socket.onmessage = event => {
    const message = JSON.parse(String(event.data));
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); return; }
    for (const listener of listeners) listener(message);
  };
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = () => reject(new Error(`Cannot attach to ${target.title}`)); });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const current = ++id;
    const timer = setTimeout(() => { pending.delete(current); reject(new Error(`${method} timed out`)); }, 30_000);
    pending.set(current, message => { clearTimeout(timer); if (message.error) reject(new Error(`${method}: ${message.error.message}`)); else resolve(message.result); });
    socket.send(JSON.stringify({ id: current, method, params }));
  });
  return { target, send, on: listener => listeners.add(listener), close: () => socket.close() };
}

export async function evaluate(session, expression) {
  const result = await session.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "Evaluation failed");
  return result.result?.value;
}

/** Visible interactive elements as a person sees them (role, label, text, box). */
export const SNAPSHOT_SCRIPT = `(() => {
  const selector = "button,a[href],input,textarea,select,[role=button],[role=menuitem],[role=option],[role=tab],[role=checkbox],[role=switch],[role=link],[contenteditable=true]";
  const label = element => (element.getAttribute("aria-label") || element.getAttribute("placeholder") || element.getAttribute("title") || (element.labels && element.labels[0] && element.labels[0].innerText) || "").trim();
  const elements = [...document.querySelectorAll(selector)].map((element, index) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const visible = box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none" && box.bottom > 0 && box.right > 0 && box.top < innerHeight && box.left < innerWidth;
    return { index, tag: element.tagName.toLowerCase(), role: element.getAttribute("role") || "", id: element.id || "", label: label(element), text: (element.innerText || element.value || "").trim().split("\\n")[0].slice(0, 120), disabled: Boolean(element.disabled || element.getAttribute("aria-disabled") === "true"), visible, x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  });
  const dialogs = [...document.querySelectorAll("[role=dialog],[role=alertdialog]")].map(dialog => (dialog.innerText || "").trim().split("\\n")[0]);
  return { title: document.title, route: location.hash || location.pathname, dialogs, elements };
})()`;

export async function snapshot(session) {
  return evaluate(session, SNAPSHOT_SCRIPT);
}

export async function mouseClick(session, x, y) {
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
    await session.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  }
}

export async function pressKey(session, chord) {
  const event = keyEvent(chord);
  await session.send("Input.dispatchKeyEvent", { type: event.text ? "keyDown" : "rawKeyDown", ...event });
  await session.send("Input.dispatchKeyEvent", { type: "keyUp", ...event, text: undefined });
}

export async function screenshot(session, path) {
  const result = await session.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(path, Buffer.from(result.data, "base64"));
  return path;
}

/** In-page buffer of errors, console errors and failed requests, reinstalled on every attach. */
export const ERROR_HOOK_SCRIPT = `(() => {
  if (window.__devAgent) return window.__devAgent.errors.length;
  const errors = [];
  const push = (kind, message) => { errors.push({ at: new Date().toISOString(), kind, message: String(message).slice(0, 2000) }); if (errors.length > 500) errors.shift(); };
  addEventListener("error", event => push("error", event.message || event.error));
  addEventListener("unhandledrejection", event => push("rejection", (event.reason && (event.reason.stack || event.reason.message)) || event.reason));
  const original = console.error;
  console.error = (...args) => { push("console.error", args.map(arg => (arg && (arg.stack || arg.message)) || String(arg)).join(" ")); original.apply(console, args); };
  const originalWarn = console.warn;
  console.warn = (...args) => { push("console.warn", args.map(String).join(" ")); originalWarn.apply(console, args); };
  const originalFetch = fetch;
  window.fetch = async (...args) => {
    try {
      const response = await originalFetch(...args);
      if (response.status >= 500) push("http", response.status + " " + (args[0] && args[0].url ? args[0].url : String(args[0])));
      return response;
    } catch (error) { push("network", (error && error.message) + " " + String(args[0] && args[0].url ? args[0].url : args[0])); throw error; }
  };
  window.__devAgent = { errors };
  return 0;
})()`;
