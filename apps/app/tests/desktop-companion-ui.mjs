// Real Chromium + production React UI, with an isolated IPC fixture. No model calls.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const build = process.env.COMPANION_UI_BUILD;
if (!build) throw Error("Set COMPANION_UI_BUILD to the isolated companion build.");
const server = createServer(async (req, res) => {
  try {
    const name = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const file = path.resolve(build, `.${name}`);
    if (!file.startsWith(path.resolve(build) + path.sep)) { res.writeHead(403).end(); return; }
    res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css" })[path.extname(file)] ?? "application/octet-stream");
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
const checks = [], errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 560, height: 680 }, colorScheme: "dark" });
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    let snapshot = { target: "owner-a", sessionId: "a", workspaceId: "ws", scope: "account-a", title: "Chat A", project: "Fixture", model: "Fixture", state: "idle", canSend: true, messages: [], activity: [], permission: null, question: null };
    let state = { enabled: true, connected: true, expanded: true, snapshot, recentSessions: [], recentsUpdatedAt: Date.now(), updatedAt: Date.now(), preferences: { mascot: "sprout", image: "", motion: false, openOnHover: false, autoClose: 15, alerts: true } };
    const listeners = new Set(), commands = [];
    let reply = { ok: true };
    const emit = patch => { state = { ...state, ...patch }; listeners.forEach(fn => fn(patch)); };
    window.__fixture = {
      commands, snapshot: patch => { snapshot = { ...snapshot, ...patch }; emit({ snapshot }); },
      patch: emit, reply: value => { reply = value; },
    };
    window.__OPENWORK_COMPANION__ = {
      state: async () => state, onState: fn => { listeners.add(fn); return () => listeners.delete(fn); },
      view: async value => { if (typeof value.expanded === "boolean") emit({ expanded: value.expanded }); return true; },
      command: async command => { commands.push(command); return reply; },
      preferences: async preferences => { emit({ preferences }); return true; },
      openMain: async () => true, readSession: async () => true, selectSession: async () => true,
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/companion.html`);
  const editor = page.getByRole("textbox", { name: "Mensaje al asistente" });
  await editor.fill("Borrador A");
  await page.getByLabel("Adjuntar archivos").locator("..").locator('input[type=file]').setInputFiles({ name: "nota.txt", mimeType: "text/plain", buffer: Buffer.from("fixture") });
  await page.evaluate(() => window.__fixture.snapshot({ target: "owner-b", sessionId: "b" }));
  await page.waitForFunction(() => document.querySelector('textarea')?.value === "");
  await page.evaluate(() => window.__fixture.snapshot({ target: "owner-a-remounted", sessionId: "a" }));
  await page.waitForFunction(() => document.querySelector('textarea')?.value === "Borrador A", null, { timeout: 1500 });
  assert.equal(await page.getByLabel("Quitar nota.txt").count(), 1);
  checks.push("draft and files survive returning to a remounted conversation");
  await page.evaluate(() => window.__fixture.snapshot({ scope: "account-b", target: "another-account" }));
  await page.waitForFunction(() => document.querySelector('textarea')?.value === "");
  await page.evaluate(() => window.__fixture.snapshot({ scope: "account-a", target: "owner-a-again" }));
  await page.waitForFunction(() => document.querySelector('textarea')?.value === "Borrador A");
  checks.push("drafts stay separate across account scopes");
  await page.evaluate(() => window.__fixture.snapshot({ permission: { id: "p", title: "Modificar archivo", detail: "fixture.txt", busy: false }, state: "waiting", canSend: false }));
  await page.getByRole("button", { name: "Permitir una vez" }).waitFor();
  assert.equal(await editor.count(), 0);
  await page.getByRole("button", { name: "Plegar", exact: true }).click();
  await page.getByRole("button", { name: "Abrir asistente", exact: true }).click();
  await page.getByRole("button", { name: "Permitir una vez" }).click();
  assert.equal(await page.getByRole("button", { name: "Permitir una vez" }).isDisabled(), true);
  checks.push("permission replaces input, survives folding and cannot be answered twice");
  await page.evaluate(() => window.__fixture.snapshot({ permission: null, question: { id: "q", busy: false, questions: [{ text: "Elegí una opción", multiple: true, custom: true, options: ["Primera", "Segunda"] }] } }));
  await page.getByText("Elegí una opción", { exact: true }).waitFor();
  assert.equal(await editor.count(), 0, "question should replace the composer");
  await page.getByLabel("Primera", { exact: true }).check();
  await page.getByLabel("Otra respuesta: Elegí una opción", { exact: true }).fill("Mi opción personalizada");
  await page.getByRole("button", { name: "Plegar", exact: true }).click();
  await page.getByRole("button", { name: "Abrir asistente", exact: true }).click();
  assert.equal(await page.getByLabel("Primera", { exact: true }).isChecked(), true);
  assert.equal(await page.getByLabel("Otra respuesta: Elegí una opción", { exact: true }).inputValue(), "Mi opción personalizada");
  checks.push("multiple choices and custom answer survive folding together");
  await page.getByRole("button", { name: "Responder", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.__fixture.commands.at(-1).action.answers), [["Primera", "Mi opción personalizada"]]);
  assert.equal(await page.getByRole("button", { name: "Responder", exact: true }).isDisabled(), true);
  assert.equal(await page.getByLabel("Primera", { exact: true }).isDisabled(), true);
  checks.push("question replaces input and sends one answer");
  await page.evaluate(() => window.__fixture.snapshot({ question: null, state: "idle", canSend: true }));
  assert.equal(await editor.inputValue(), "Borrador A");
  await page.evaluate(() => window.__fixture.reply({ ok: false, error: "Rechazo de prueba" }));
  await page.getByRole("button", { name: "Enviar mensaje", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await editor.inputValue(), "Borrador A");
  checks.push("failed send preserves draft and attachment");
  await page.evaluate(() => window.__fixture.reply({ ok: false, uncertain: true, error: "No confirmado" }));
  await page.getByRole("button", { name: "Enviar mensaje", exact: true }).click();
  await page.getByText("No confirmado", { exact: false }).waitFor();
  await page.evaluate(() => window.__fixture.snapshot({ target: "b-again", sessionId: "b" }));
  await editor.fill("Borrador B");
  await page.evaluate(() => window.__fixture.snapshot({ target: "a-again", sessionId: "a" }));
  assert.equal(await page.getByRole("button", { name: "Enviar mensaje", exact: true }).isDisabled(), true);
  checks.push("unconfirmed sends stay blocked after switching away and back");
  await page.evaluate(() => {
    window.__fixture.reply({ ok: true });
    window.__fixture.snapshot({ target: "b-send", sessionId: "b" });
  });
  await page.waitForFunction(() => document.querySelector('textarea')?.value === "Borrador B");
  const before = await page.evaluate(() => window.__fixture.commands.length);
  await editor.press("Enter");
  await editor.press("Enter");
  await page.waitForFunction(() => document.querySelector('textarea')?.value === "");
  assert.equal(await page.evaluate(() => window.__fixture.commands.length), before + 1);
  checks.push("rapid Enter sends once and clears only the successful draft");
  await page.evaluate(() => window.__fixture.snapshot({ state: "working", canSend: false }));
  await page.getByRole("button", { name: "Detener trabajo", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__fixture.commands.at(-1).action.kind), "stop");
  checks.push("working state exposes Stop and routes it to the existing host");
  await page.evaluate(() => window.__fixture.patch({ connected: false }));
  assert.equal(await editor.isDisabled(), true);
  checks.push("lost connection disables sending");
  for (const width of [320, 560]) {
    await page.setViewportSize({ width, height: 680 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  }
  checks.push("no horizontal overflow on small screens");
  await page.evaluate(() => window.__fixture.patch({ visible: false, expanded: false }));
  await page.waitForFunction(() => document.querySelector('canvas') === null);
  assert.equal(await page.getByRole("textbox", { name: "Mensaje al asistente" }).count(), 0);
  await page.evaluate(() => window.__fixture.patch({ visible: true, expanded: true, connected: true }));
  await editor.waitFor();
  checks.push("main-window visibility hides the capsule without disabling its session");
  await page.evaluate(() => window.__fixture.patch({ enabled: false, expanded: false }));
  await page.waitForFunction(() => document.querySelector('canvas') === null);
  assert.equal(await page.getByRole("button", { name: "Abrir asistente", exact: true }).count(), 0);
  checks.push("runtime off unmounts the mascot and its animation timers");
  const racing = await browser.newPage({ viewport: { width: 560, height: 680 } });
  racing.on("pageerror", error => errors.push(error.message));
  await racing.addInitScript(() => {
    let update;
    const initial = { enabled: true, connected: true, expanded: true, recentSessions: [], recentsUpdatedAt: 0, updatedAt: 0,
      preferences: { mascot: "sprout", image: "", motion: false, openOnHover: false, autoClose: 15, alerts: true },
      snapshot: { target: "race", sessionId: "race", title: "Fixture", project: "Fixture", model: "Fixture", state: "idle", canSend: true, messages: [], activity: [], permission: null, question: null } };
    window.__OPENWORK_COMPANION__ = {
      onState: callback => { update = callback; return () => {}; },
      state: async () => { update({ snapshot: { ...initial.snapshot, permission: { id: "new-permission", title: "Permiso más reciente", detail: "Fixture", busy: false } } }); return initial; },
      view: async () => true,
    };
  });
  await racing.goto(`http://127.0.0.1:${server.address().port}/companion.html`);
  await racing.getByText("Permiso más reciente", { exact: true }).waitFor({ timeout: 1500 });
  assert.equal(await racing.getByRole("textbox", { name: "Mensaje al asistente" }).count(), 0);
  checks.push("initial state cannot overwrite a newer incoming permission");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, errors }));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
