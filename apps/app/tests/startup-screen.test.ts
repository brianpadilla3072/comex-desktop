import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// The startup screen in index.html runs before React mounts. These tests run
// the real inline script from index.html against its real markup, so the file
// that ships is the file under test (feature startupScreenPolish).

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const markupMatch = html.match(/<div id="root">([\s\S]*?)<\/div>\s*<script id="startup-screen-script">/);
const scriptMatch = html.match(/<script id="startup-screen-script">([\s\S]*?)<\/script>/);
if (!markupMatch || !scriptMatch) throw new Error("index.html no longer has the startup screen markup and script");
const markup = markupMatch[1];
const script = scriptMatch[1];

type Listener = [string, EventListenerOrEventListenerObject, boolean | AddEventListenerOptions | undefined];
let listeners: Listener[] = [];
let timers: ReturnType<typeof setTimeout>[] = [];

beforeAll(() => {
  GlobalRegistrator.register({ url: "http://localhost/" });
});

afterEach(() => {
  for (const [type, listener, options] of listeners) window.removeEventListener(type, listener, options);
  for (const timer of timers) clearTimeout(timer);
  listeners = [];
  timers = [];
  localStorage.clear();
  document.body.innerHTML = "";
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

function boot(options: { language?: string; revealAfterMs?: number } = {}) {
  document.body.innerHTML = `<div id="root">${markup}</div>`;
  if (options.revealAfterMs !== undefined) {
    document.getElementById("startup-screen")?.setAttribute("data-reveal-after-ms", String(options.revealAfterMs));
  }
  const scopedWindow = {
    addEventListener(type: string, listener: EventListenerOrEventListenerObject, capture?: boolean | AddEventListenerOptions) {
      listeners.push([type, listener, capture]);
      window.addEventListener(type, listener, capture);
    },
  };
  const scopedSetTimeout = (callback: () => void, ms: number) => {
    const timer = setTimeout(callback, ms);
    timers.push(timer);
    return timer;
  };
  const language = options.language ?? "en-US";
  const run = new Function("window", "document", "localStorage", "navigator", "setTimeout", script);
  run(scopedWindow, document, localStorage, { language, languages: [language] }, scopedSetTimeout);
}

const text = (id: string) => document.getElementById(id)?.textContent ?? "";
const recoveryVisible = () => document.getElementById("startup-recovery")?.hidden === false;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("the saved language wins over the Comex hint and the browser", () => {
  localStorage.setItem("openwork.language", "es");
  localStorage.setItem("openwork.language.default", "en");
  boot({ language: "en-US" });
  expect(text("startup-status")).toBe("Iniciando OpenWork");
  expect(text("startup-reload")).toBe("Recargar");
});

test("an explicit English choice stays English on a Spanish browser with the Comex hint", () => {
  localStorage.setItem("openwork.language", "en");
  localStorage.setItem("openwork.language.default", "es");
  boot({ language: "es-AR" });
  expect(text("startup-status")).toBe("Starting OpenWork");
});

test("the Comex default hint applies when nothing was chosen", () => {
  localStorage.setItem("openwork.language.default", "es");
  boot({ language: "en-US" });
  expect(text("startup-status")).toBe("Iniciando OpenWork");
  expect(text("startup-recovery-message")).toBe("OpenWork está tardando más de lo normal en iniciar.");
});

test("the browser language applies last, and unknown languages fall back to English", () => {
  boot({ language: "es-MX" });
  expect(text("startup-status")).toBe("Iniciando OpenWork");
  document.body.innerHTML = "";
  boot({ language: "de-DE" });
  expect(text("startup-status")).toBe("Starting OpenWork");
});

test("the reload hint appears after the short delay, not before", async () => {
  boot({ revealAfterMs: 30 });
  expect(recoveryVisible()).toBe(false);
  await wait(60);
  expect(recoveryVisible()).toBe(true);
  expect(text("startup-recovery-message")).toBe("OpenWork is taking longer than usual to start.");
});

test("the shipped delay is 12 seconds", () => {
  boot();
  expect(document.getElementById("startup-screen")?.getAttribute("data-reveal-after-ms")).toBe("12000");
});

test("a main bundle that fails to load reveals Reload at once with a clear message", () => {
  localStorage.setItem("openwork.language", "es");
  boot();
  expect(recoveryVisible()).toBe(false);
  const entry = document.createElement("script");
  entry.setAttribute("type", "module");
  document.body.append(entry);
  entry.dispatchEvent(new Event("error"));
  expect(recoveryVisible()).toBe(true);
  expect(text("startup-recovery-message")).toBe("OpenWork no pudo cargar. Recarga para intentarlo de nuevo.");
});

test("an uncaught error before mount reveals Reload at once", () => {
  boot();
  window.dispatchEvent(new ErrorEvent("error", { message: "boom" }));
  expect(recoveryVisible()).toBe(true);
  expect(text("startup-recovery-message")).toBe("OpenWork could not load. Reload to try again.");
});

test("a failing image or stylesheet does not count as a bundle failure", () => {
  boot();
  const image = document.createElement("img");
  document.body.append(image);
  image.dispatchEvent(new Event("error"));
  expect(recoveryVisible()).toBe(false);
});

test("after React mounts, later errors do nothing", () => {
  boot();
  document.getElementById("root")?.replaceChildren();
  window.dispatchEvent(new ErrorEvent("error", { message: "boom" }));
  expect(document.getElementById("startup-recovery")).toBeNull();
});

test("the app stores only the off value under the key index.html reads", async () => {
  const { STARTUP_SCREEN_POLISH_KEY, rememberStartupScreenPolish } = await import("../src/app/lib/startup-screen-flag");
  expect(script).toContain(`"${STARTUP_SCREEN_POLISH_KEY}"`);
  rememberStartupScreenPolish(false);
  expect(localStorage.getItem(STARTUP_SCREEN_POLISH_KEY)).toBe("off");
  rememberStartupScreenPolish(true);
  expect(localStorage.getItem(STARTUP_SCREEN_POLISH_KEY)).toBeNull();
});

test("with the flag off the screen keeps the previous English text and no early reveal", async () => {
  localStorage.setItem("openwork.startupScreenPolish", "off");
  localStorage.setItem("openwork.language", "es");
  boot({ revealAfterMs: 10 });
  expect(text("startup-status")).toBe("Starting OpenWork");
  await wait(40);
  window.dispatchEvent(new ErrorEvent("error", { message: "boom" }));
  expect(recoveryVisible()).toBe(false);
});
