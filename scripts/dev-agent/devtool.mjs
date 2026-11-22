#!/usr/bin/env node
// Dev toolkit for people and AI agents: launch an isolated OpenWork, drive it like a
// person over CDP, read its errors and call its server. See
// .opencode/skills/dev-agent-toolkit/SKILL.md. Run: pnpm dev:agent <command> [...]
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { connect, evaluate, matchElement, mouseClick, pressKey, screenshot, snapshot, ERROR_HOOK_SCRIPT } from "./lib/cdp.mjs";
import { isV2OnlyDatabase, pickOpencodeV1Bin } from "./lib/engine.mjs";
import { REPO_ROOT, electronProfileDir, electronSessionEnv, listSessions, parseCdpUrl, parseWebUrl, processAlive, readSession, removeSessionDir, sessionDir, sessionName, stopGroup, writeSession } from "./lib/session.mjs";

const HELP = `pnpm dev:agent <command> [options]          (--session <name> picks a session; default "default")

Lifecycle
  up electron [--wayland]      Isolated Electron window (own profile, mock keychain, free ports, CDP, x11 on Wayland)
  up web                       Headless web app in Chrome (picks an OpenCode v1 binary and a usable database)
  status                       Sessions, their CDP, PIDs and logs
  down [--purge]               Stop only what this session started (--purge also deletes its profile and state)

Look
  snapshot [--all]             Visible interactive elements (role, label, text) plus route and open dialogs
  text [css]                   Visible text of the page or of an element
  shot [file.png]              Screenshot of the main window
  targets                      CDP pages (the desktop companion is never driven)
  errors [--clear]             JS errors, console errors/warnings and failed requests seen in the page
  events [--tail N]            Background event log (console, exceptions, network failures) since "up"
  logs                         Paths and tail of the app logs

Act (real mouse and keyboard, like a person)
  click <text|aria-label> [--nth N]
  fill <#id|css|label> <text>  Focus, select and type (React-safe)
  press <Key|Ctrl+Key>         Enter, Escape, Tab, ArrowDown, Control+K ...
  wait-text <text> [--timeout S]
  eval <js>                    Evaluate in the page (awaits promises)
  go <route>                   Navigate inside the app, e.g. /workspace/<id>/session
  reload

Files (no native dialogs)
  upload <file>                The next file picker the app opens receives this file
  download <out-file> -- <click text>   Click and save the file the app downloads

Local fake model (never a real provider)
  fake-model on|off            Local "Fault Lab" providers for this session only (model ok = normal reply)

Server
  api <METHOD> <path> [json]   Call the local OpenWork server as the desktop host (tokens never printed)
`;

/** Sessions never reach the person's accounts: the managed engine instead of the installed
 * OpenCode service (which carries their providers and logins). */
const OFFLINE_ENV = { OPENWORK_COMEX_OPENCODE_MODE: "managed" };

function parseArgs(argv) {
  const options = { session: "default" };
  const positional = [];
  const rest = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--") { rest.push(...argv.slice(index + 1)); break; }
    if (value.startsWith("--")) {
      const key = value.slice(2);
      const next = argv[index + 1];
      if (["session", "nth", "timeout", "tail"].includes(key)) { options[key] = next; index += 1; }
      else options[key] = true;
      continue;
    }
    positional.push(value);
  }
  return { options, positional, rest };
}

function requireSession(name) {
  const session = readSession(name);
  if (!session) throw new Error(`No session "${name}". Start one with: pnpm dev:agent up electron|web`);
  return session;
}

async function withPage(name, run) {
  const session = requireSession(name);
  const page = await connect(session.cdp);
  try {
    await evaluate(page, ERROR_HOOK_SCRIPT);
    return await run(page, session);
  } finally { page.close(); }
}

async function waitFor(check, { timeoutMs, label }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await Promise.resolve().then(check).catch(error => { if (error?.fatal) throw error; return null; });
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function waitForAppReady(cdp) {
  await waitFor(async () => {
    const page = await connect(cdp);
    try {
      const text = String(await evaluate(page, "document.body ? document.body.innerText.slice(0, 200) : ''"));
      return text && !text.includes("Starting OpenWork") ? text : null;
    } finally { page.close(); }
  }, { timeoutMs: 180_000, label: "the app to finish starting" });
}

function startWatcher(name) {
  const dir = sessionDir(name);
  const log = openSync(join(dir, "watcher.log"), "a");
  const child = spawn(process.execPath, [resolve(REPO_ROOT, "scripts/dev-agent/devtool.mjs"), "watch", "--session", name], { detached: true, stdio: ["ignore", log, log] });
  child.unref();
  return child.pid;
}

async function upElectron(name, options) {
  const dir = sessionDir(name);
  mkdirSync(dir, { recursive: true });
  const profile = `agent-${name}`;
  const env = electronSessionEnv(process.env, OFFLINE_ENV, profile);
  // A Wayland session hides the dev window unless Electron runs under XWayland.
  if (process.platform === "linux" && process.env.WAYLAND_DISPLAY && process.env.DISPLAY && !options.wayland && !env.OPENWORK_ELECTRON_OZONE_PLATFORM) env.OPENWORK_ELECTRON_OZONE_PLATFORM = "x11";
  const logPath = join(dir, "electron.log");
  writeFileSync(logPath, "");
  const out = openSync(logPath, "a");
  const child = spawn("pnpm", ["--filter", "@openwork/desktop", "dev"], { cwd: REPO_ROOT, env, detached: true, stdio: ["ignore", out, out] });
  child.unref();
  writeSession(name, { name, kind: "electron", pid: child.pid, profile, profileDir: electronProfileDir(profile), log: logPath, startedAt: new Date().toISOString(), cdp: null });
  const cdp = await waitFor(() => {
    if (!processAlive(child.pid)) throw Object.assign(new Error(`Electron exited. See ${logPath}`), { fatal: true });
    return parseCdpUrl(readFileSync(logPath, "utf8"));
  }, { timeoutMs: 240_000, label: "the Electron CDP address" });
  writeSession(name, { ...readSession(name), cdp });
  await waitForAppReady(cdp);
  const watcherPid = startWatcher(name);
  writeSession(name, { ...readSession(name), watcherPid });
  return readSession(name);
}

async function upWeb(name) {
  const dir = sessionDir(name);
  mkdirSync(dir, { recursive: true });
  const env = { ...process.env, ...OFFLINE_ENV, OPENWORK_DEV_HEADLESS_WEB_DEN_PROXY: "0" };
  const notes = ["offline: managed engine (not the installed OpenCode with your accounts), no Den proxy"];
  const engine = pickOpencodeV1Bin({ env, repoRoot: REPO_ROOT });
  if (!engine) throw new Error("No OpenCode v1 binary found. Set OPENWORK_OPENCODE_BIN or run pnpm --filter @openwork/desktop prepare:sidecar.");
  env.OPENWORK_OPENCODE_BIN = engine.bin;
  notes.push(`engine ${engine.version} (${engine.source})`);
  const sharedDb = join(REPO_ROOT, "tmp", "dev-headless-opencode.db");
  if (!env.OPENCODE_DB && isV2OnlyDatabase(sharedDb)) {
    // Engine v1 never relocates an explicit database; give this session its own instead of touching the shared one.
    env.OPENCODE_DB = join(dir, "opencode.db");
    notes.push("tmp/dev-headless-opencode.db is a v2 database: using a session database");
  }
  const result = spawnSync("pnpm", ["world", "up", "dev-app-web", "--detach", "--", "--browser"], { cwd: REPO_ROOT, env, encoding: "utf8", timeout: 400_000 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  writeFileSync(join(dir, "world-up.log"), output);
  const cdp = parseCdpUrl(output);
  if (result.status !== 0 || !cdp) throw new Error(`pnpm world up failed. See ${join(dir, "world-up.log")}`);
  writeSession(name, { name, kind: "web", cdp, webUrl: parseWebUrl(output), log: join(REPO_ROOT, "tmp", "dev-headless.log"), startedAt: new Date().toISOString(), notes });
  await waitForAppReady(cdp);
  const watcherPid = startWatcher(name);
  writeSession(name, { ...readSession(name), watcherPid });
  return readSession(name);
}

async function down(name, options) {
  const session = readSession(name);
  if (!session) return `No session "${name}".`;
  const report = [];
  if (session.watcherPid) report.push(`watcher ${await stopGroup(session.watcherPid, { graceMs: 2_000 })}`);
  if (session.fakeModelPid) {
    const db = sessionRuntimeDb(session);
    if (db) { assertNotPersonalConfig(db); spawnSync("python3", [join(REPO_ROOT, ".opencode", "skills", "fake-model-faults", "scripts", "fault-providers.py"), "remove"], { env: { ...process.env, OPENWORK_RUNTIME_DB: db }, encoding: "utf8" }); }
    report.push(`fake model ${await stopGroup(session.fakeModelPid, { graceMs: 2_000 })}`);
  }
  if (session.kind === "electron") report.push(`electron ${await stopGroup(session.pid)}`);
  if (session.kind === "web") {
    const result = spawnSync("pnpm", ["world", "down", "dev-app-web"], { cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000 });
    report.push(`world ${result.status === 0 ? "down" : "down failed"}`);
  }
  const port = session.cdp ? Number(new URL(session.cdp).port) : 0;
  if (port) {
    const open = await fetch(`${session.cdp}/json/version`).then(() => true, () => false);
    report.push(open ? `CDP ${port} still open` : `CDP ${port} closed`);
  }
  if (options.purge) {
    // Only agent profiles this toolkit created.
    if (session.kind === "electron" && session.profile?.startsWith("agent-")) { rmSync(session.profileDir, { recursive: true, force: true }); report.push(`profile ${session.profileDir} deleted`); }
    removeSessionDir(name);
    report.push("session state deleted");
  } else writeSession(name, { ...session, stoppedAt: new Date().toISOString() });
  return report.join("\n");
}

/** Foreground: stream console, exceptions and network failures of the app page to events.jsonl. */
async function watch(name) {
  const file = join(sessionDir(name), "events.jsonl");
  const write = entry => appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
  for (;;) {
    const session = readSession(name);
    if (!session?.cdp || session.stoppedAt) return;
    try {
      const page = await connect(session.cdp);
      await page.send("Runtime.enable"); await page.send("Log.enable"); await page.send("Network.enable");
      write({ kind: "attached", target: page.target.title });
      await new Promise(resolveClosed => {
        page.on(message => {
          const { method, params } = message;
          if (method === "Runtime.consoleAPICalled" && ["error", "warning", "assert"].includes(params.type)) write({ kind: `console.${params.type}`, message: params.args.map(arg => arg.value ?? arg.description ?? "").join(" ").slice(0, 2000) });
          else if (method === "Runtime.exceptionThrown") write({ kind: "exception", message: (params.exceptionDetails.exception?.description ?? params.exceptionDetails.text ?? "").slice(0, 2000) });
          else if (method === "Log.entryAdded" && ["error", "warning"].includes(params.entry.level)) write({ kind: `log.${params.entry.level}`, message: params.entry.text.slice(0, 2000), url: params.entry.url });
          else if (method === "Network.loadingFailed" && !params.canceled) write({ kind: "network.failed", message: params.errorText, type: params.type });
          else if (method === "Network.responseReceived" && params.response.status >= 500) write({ kind: "http", status: params.response.status, url: params.response.url });
          else if (method === "Inspector.detached" || method === "Inspector.targetCrashed") resolveClosed();
        });
        const timer = setInterval(() => { if (!readSession(name) || readSession(name).stoppedAt) { clearInterval(timer); resolveClosed(); } }, 2_000);
      });
      page.close();
    } catch (error) { write({ kind: "watcher", message: String(error.message ?? error) }); }
    await new Promise(resolve => setTimeout(resolve, 2_000));
  }
}

/** The session's own runtime database: inside its agent profile (Electron) or the repo's tmp (web). */
function sessionRuntimeDb(session) {
  const roots = session.kind === "electron" ? [session.profileDir] : [join(REPO_ROOT, "tmp")];
  for (const root of roots) {
    const found = spawnSync("find", [root, "-maxdepth", "6", "-name", "runtime.sqlite", "-type", "f"], { encoding: "utf8" }).stdout.trim().split("\n").filter(Boolean);
    const db = found.find(path => !path.includes("/node_modules/"));
    if (db) return db;
  }
  return null;
}

function assertNotPersonalConfig(path) {
  const personal = resolve(process.env.HOME ?? "", ".config", "openwork");
  if (resolve(path).startsWith(personal + "/") || resolve(path) === personal) throw new Error(`Refusing to edit ${path}: that is the person's real OpenWork config.`);
}

async function freePort() {
  const net = await import("node:net");
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close(() => resolvePort(typeof address === "object" && address ? address.port : 0)); });
  });
}

async function fakeModel(name, action) {
  const session = requireSession(name);
  const scripts = join(REPO_ROOT, ".opencode", "skills", "fake-model-faults", "scripts");
  const db = sessionRuntimeDb(session);
  if (!db) throw new Error("No runtime database in this session yet. Wait for the app to start, then retry.");
  assertNotPersonalConfig(db);
  if (action === "off") {
    spawnSync("python3", [join(scripts, "fault-providers.py"), "remove"], { env: { ...process.env, OPENWORK_RUNTIME_DB: db }, encoding: "utf8" });
    if (session.fakeModelPid) await stopGroup(session.fakeModelPid, { graceMs: 2_000 });
    writeSession(name, { ...session, fakeModelPid: undefined, fakeModelPort: undefined });
    return "fake model off";
  }
  if (session.fakeModelPid && processAlive(session.fakeModelPid)) return `fake model already on (127.0.0.1:${session.fakeModelPort})`;
  const port = await freePort();
  const log = openSync(join(sessionDir(name), "fake-model.log"), "a");
  const server = spawn(process.execPath, [join(scripts, "fault-server.mjs")], { env: { ...process.env, PORT: String(port) }, detached: true, stdio: ["ignore", log, log] });
  server.unref();
  const added = spawnSync("python3", [join(scripts, "fault-providers.py"), "add"], { env: { ...process.env, OPENWORK_RUNTIME_DB: db, FAULT_PORT: String(port) }, encoding: "utf8" });
  if (added.status !== 0) { await stopGroup(server.pid, { graceMs: 1_000 }); throw new Error(`Could not add the fake providers: ${added.stderr || added.stdout}`); }
  writeSession(name, { ...session, fakeModelPid: server.pid, fakeModelPort: port });
  // A dummy key makes the server mirror the providers into the engine right away.
  const page = await connect(session.cdp);
  try {
    const connection = await serverConnection(page, session);
    const workspace = await evaluate(page, "((location.hash || location.pathname).match(/\\/workspace\\/([^/]+)/) || [])[1] || ''");
    if (workspace) await fetch(new URL(`/workspace/${workspace}/opencode/auth/fault-lab`, connection.baseUrl), { method: "PUT", headers: { authorization: `Bearer ${connection.token}`, "x-openwork-host-token": connection.hostToken ?? "", "content-type": "application/json" }, body: JSON.stringify({ type: "api", key: "fault" }) });
  } finally { page.close(); }
  return `fake model on: local server 127.0.0.1:${port}, providers "Fault Lab" (model ok = normal reply; reset, stall, http-429/500/503/401/402 = failures) in ${db}`;
}

async function serverConnection(page, session) {
  if (session.kind === "electron") {
    const info = await evaluate(page, "window.__OPENWORK_ELECTRON__ ? window.__OPENWORK_ELECTRON__.invokeDesktop('openworkServerInfo') : null");
    if (!info?.baseUrl) throw new Error("The desktop server is not running yet.");
    return { baseUrl: info.baseUrl, token: info.ownerToken || info.clientToken, hostToken: info.hostToken };
  }
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "tmp", "dev-headless-web.json"), "utf8"));
  return { baseUrl: manifest.openworkUrl, token: manifest.token, hostToken: manifest.hostToken };
}

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  const { options, positional, rest } = parseArgs(argv);
  const name = sessionName(options.session);
  switch (command) {
    case undefined: case "help": case "--help": return HELP;
    case "up": {
      if (readSession(name) && !readSession(name).stoppedAt) throw new Error(`Session "${name}" is already up. Use pnpm dev:agent down${name === "default" ? "" : ` --session ${name}`} first.`);
      const session = positional[0] === "electron" ? await upElectron(name, options) : positional[0] === "web" ? await upWeb(name) : null;
      if (!session) throw new Error("Use: up electron | up web");
      return JSON.stringify({ session: session.name, kind: session.kind, cdp: session.cdp, webUrl: session.webUrl, profile: session.profileDir, log: session.log, notes: session.notes }, null, 2);
    }
    case "down": return down(name, options);
    case "fake-model": return fakeModel(name, positional[0] === "off" ? "off" : "on");
    case "status": return JSON.stringify(listSessions().map(session => ({ ...session, running: session.kind === "electron" ? processAlive(session.pid) : !session.stoppedAt })), null, 2);
    case "watch": await watch(name); return "";
    case "targets": {
      const session = requireSession(name);
      const targets = await (await fetch(`${session.cdp}/json/list`)).json();
      return targets.map(target => `${target.type}\t${target.title}\t${target.url}`).join("\n");
    }
    case "snapshot": return withPage(name, async page => {
      const value = await snapshot(page);
      const elements = value.elements.filter(element => options.all || element.visible).map(element => `${String(element.index).padStart(3)} ${element.role || element.tag}${element.id ? `#${element.id}` : ""}${element.disabled ? " (disabled)" : ""}  ${element.label && element.label !== element.text ? `[${element.label}] ` : ""}${element.text}`);
      return [`title: ${value.title}`, `route: ${value.route}`, `dialogs: ${value.dialogs.join(" | ") || "none"}`, ...elements].join("\n");
    });
    case "text": return withPage(name, page => evaluate(page, `(() => { const element = ${positional[0] ? `document.querySelector(${JSON.stringify(positional[0])})` : "document.body"}; return element ? element.innerText : "(no element)"; })()`));
    case "shot": return withPage(name, page => screenshot(page, resolve(positional[0] ?? join(sessionDir(name), `shot-${Date.now()}.png`))));
    case "eval": return withPage(name, async page => { const value = await evaluate(page, positional.join(" ")); return typeof value === "string" ? value : JSON.stringify(value, null, 2); });
    case "click": return withPage(name, async page => {
      const query = positional.join(" ");
      const nth = Number(options.nth ?? 0);
      // Menus and dialogs animate in: wait briefly for an exact match before accepting a partial one,
      // so "Ajustes" never silently hits "cuenta y ajustes".
      let found = { match: null, count: 0, tier: null };
      const deadline = Date.now() + 3_000;
      do {
        found = matchElement((await snapshot(page)).elements, query, nth);
        if (found.tier === "exact" && found.match) break;
        await new Promise(resolve => setTimeout(resolve, 200));
      } while (Date.now() < deadline);
      const { match, count, tier } = found;
      if (!match) throw new Error(`No visible element matches "${query}"${count ? ` at --nth ${nth}` : ""}. Run: pnpm dev:agent snapshot`);
      await mouseClick(page, match.x, match.y);
      return `clicked ${match.role || match.tag} "${match.label || match.text}"${tier !== "exact" ? ` (${tier} match)` : ""}${count > 1 ? ` (${count} matches, used --nth ${nth})` : ""}`;
    });
    case "fill": return withPage(name, async page => {
      const [target, ...words] = positional;
      const located = await evaluate(page, `(() => {
        const target = ${JSON.stringify(target ?? "")};
        let element = null;
        try { element = document.querySelector(target); } catch {}
        if (!element) element = [...document.querySelectorAll("input,textarea,[contenteditable=true]")].find(candidate => [candidate.getAttribute("aria-label"), candidate.getAttribute("placeholder"), candidate.labels && candidate.labels[0] && candidate.labels[0].innerText].some(text => text && text.trim().toLowerCase() === target.toLowerCase()));
        if (!element) return false;
        element.focus();
        if (element.select) element.select(); else document.execCommand("selectAll");
        return true;
      })()`);
      if (!located) throw new Error(`No field matches "${target}". Use #id, a CSS selector, or its label/placeholder.`);
      await page.send("Input.insertText", { text: words.join(" ") });
      return `filled ${target}`;
    });
    case "press": return withPage(name, async page => { await pressKey(page, positional[0] ?? ""); return `pressed ${positional[0]}`; });
    case "wait-text": return withPage(name, async page => {
      const text = positional.join(" ");
      await waitFor(async () => String(await evaluate(page, "document.body.innerText")).includes(text), { timeoutMs: Number(options.timeout ?? 30) * 1000, label: `"${text}"` });
      return `found "${text}"`;
    });
    case "go": return withPage(name, async page => {
      await evaluate(page, `(() => { const route = ${JSON.stringify(positional[0] ?? "/")}; if (window.__OPENWORK_ELECTRON__) location.hash = "#" + route; else { history.pushState(history.state, "", route); dispatchEvent(new PopStateEvent("popstate", { state: history.state })); } return true; })()`);
      return `at ${positional[0]}`;
    });
    case "reload": return withPage(name, async page => { await page.send("Page.reload"); return "reloaded (errors buffer starts again)"; });
    case "errors": return withPage(name, async page => {
      const errors = await evaluate(page, `(() => { const list = window.__devAgent.errors.slice(); ${options.clear ? "window.__devAgent.errors.length = 0;" : ""} return list; })()`);
      return errors.length ? errors.map(entry => `${entry.at} ${entry.kind}: ${entry.message}`).join("\n") : "no errors captured since the page was attached";
    });
    case "events": {
      const file = join(sessionDir(name), "events.jsonl");
      if (!existsSync(file)) return "no events yet";
      return readFileSync(file, "utf8").trim().split("\n").slice(-Number(options.tail ?? 50)).join("\n");
    }
    case "logs": {
      const session = requireSession(name);
      const files = [session.log, join(sessionDir(name), "events.jsonl"), join(sessionDir(name), "watcher.log")].filter(file => file && existsSync(file));
      return files.map(file => `== ${file}\n${readFileSync(file, "utf8").trim().split("\n").slice(-Number(options.tail ?? 30)).join("\n")}`).join("\n\n");
    }
    case "upload": return withPage(name, async page => {
      const file = resolve(positional[0] ?? "");
      if (!existsSync(file)) throw new Error(`No file at ${file}`);
      const content = readFileSync(file).toString("base64");
      const fileName = file.split(/[\\/]/).pop();
      await evaluate(page, `(() => {
        const bytes = Uint8Array.from(atob(${JSON.stringify(content)}), char => char.charCodeAt(0));
        const original = HTMLInputElement.prototype.click;
        HTMLInputElement.prototype.click = function () {
          if (this.type !== "file") return original.call(this);
          HTMLInputElement.prototype.click = original;
          const transfer = new DataTransfer(); transfer.items.add(new File([bytes], ${JSON.stringify(fileName)}));
          this.files = transfer.files; this.dispatchEvent(new Event("change", { bubbles: true }));
        };
        return true;
      })()`);
      return `armed: the next file picker receives ${fileName}`;
    });
    case "download": return withPage(name, async page => {
      const out = resolve(positional[0] ?? "");
      if (!positional[0] || !rest.length) throw new Error("Use: download <out-file> -- <click text>");
      await evaluate(page, `(() => { window.__devAgentDownload = null; const original = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () { if (!this.download) return original.call(this); HTMLAnchorElement.prototype.click = original;
          const name = this.download; fetch(this.href).then(response => response.arrayBuffer()).then(buffer => { let binary = ""; const bytes = new Uint8Array(buffer); for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]); window.__devAgentDownload = { name, base64: btoa(binary) }; }); };
        return true; })()`);
      const { elements } = await snapshot(page);
      const { match } = matchElement(elements, rest.join(" "));
      if (!match) throw new Error(`No visible element matches "${rest.join(" ")}".`);
      await mouseClick(page, match.x, match.y);
      const download = await waitFor(() => evaluate(page, "window.__devAgentDownload"), { timeoutMs: 60_000, label: "the download" });
      writeFileSync(out, Buffer.from(download.base64, "base64"));
      return `saved ${download.name} → ${out}`;
    });
    case "api": return withPage(name, async (page, session) => {
      const [method = "GET", path = "/health", body] = positional;
      const server = await serverConnection(page, session);
      const response = await fetch(new URL(path, server.baseUrl.replace(/\/$/, "") + "/"), {
        method: method.toUpperCase(),
        headers: { authorization: `Bearer ${server.token}`, "x-openwork-host-token": server.hostToken ?? "", "content-type": "application/json" },
        body: body === undefined ? undefined : body,
      });
      const text = await response.text();
      return `${response.status}\n${text.length > 20_000 ? `${text.slice(0, 20_000)}\n… (${text.length} bytes)` : text}`;
    });
    default: throw new Error(`Unknown command "${command}".\n\n${HELP}`);
  }
}

main().then(output => { if (output) console.log(output); }, error => { console.error(`dev-agent: ${error.message ?? error}`); process.exit(1); });
