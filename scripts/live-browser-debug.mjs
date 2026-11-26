#!/usr/bin/env node
/** Portable, bounded live diagnostics. Never restarts an app or changes its profile. */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserCandidates, parseArgs, safeUrl, summarizeStates } from './live-browser-debug-core.mjs';
import { connect, evaluate } from './dev-agent/lib/cdp.mjs';
import { addResource, releaseResource, ownersDir } from './check-resource-cleanup.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const emit = value => console.log(JSON.stringify({ version: 1, ...value }));
const pageState = '({ url: location.href, title: document.title, desktop: !!window.__OPENWORK_ELECTRON__, bootstrap: !!window.__OPENWORK_BOOTSTRAP__?.token, sessionSurface: document.querySelector("[data-session-surface-id]")?.getAttribute("data-session-surface-id") ?? null, messageCount: document.querySelectorAll("[data-message-id]").length })';
async function targets(base) {
  const response = await fetch(`${base.replace(/\/$/, '')}/json/list`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('CDP unavailable: ' + response.status);
  return response.json();
}
async function desktop(base, preferred) {
  const found = [];
  for (const target of await targets(base)) {
    if (target.type !== 'page' || (preferred && target.id !== preferred)) continue;
    const connection = await connect(base, target.id);
    try { if (await evaluate(connection, '!!window.__OPENWORK_ELECTRON__ && !location.pathname.endsWith("companion.html")')) found.push(target); }
    finally { connection.close(); }
  }
  if (found.length !== 1) throw new Error(`Expected one desktop main renderer, found ${found.length}; select --target ID.`);
  return connect(base, found[0].id);
}
async function watch(connection, seconds) {
  let events = 0;
  const requests = new Map();
  connection.on(message => {
    if (events >= 100) return;
    const data = message.params ?? {};
    if (message.method === 'Network.requestWillBeSent') {
      if (requests.size < 500) requests.set(data.requestId, safeUrl(data.request.url));
    } else if (message.method === 'Network.loadingFailed' && !data.canceled) {
      events++; emit({ event: 'network_failure', url: requests.get(data.requestId), reason: data.errorText });
    } else if (message.method === 'Network.responseReceived' && data.response.status >= 400) {
      events++; emit({ event: 'http_error', status: data.response.status, url: safeUrl(data.response.url) });
    } else if (message.method === 'Runtime.exceptionThrown') {
      events++; emit({ event: 'javascript_exception', url: safeUrl(data.exceptionDetails.url ?? ''), line: data.exceptionDetails.lineNumber });
    } else if (message.method === 'Runtime.consoleAPICalled' && data.type === 'error') {
      events++; emit({ event: 'console_error' });
    }
  });
  await connection.send('Network.enable');
  await connection.send('Runtime.enable');
  const states = [];
  for (let second = 0; second <= seconds; second++) {
    const state = await evaluate(connection, pageState);
    const item = { second, ...state, url: safeUrl(state.url) };
    states.push(item); emit({ event: 'page', ...item });
    if (second < seconds) await pause(1000);
  }
  emit({ event: 'result', ...summarizeStates(states), elapsedSeconds: seconds });
}

export async function main(argv) {
  const { command, options, seconds } = parseArgs(argv);
  if (command === 'help') {
    console.log('pnpm debug:browser doctor|watch|web|native [options]\n  --cdp URL       Electron CDP URL (or CDP_URL); required for doctor/watch/native\n  --target ID     Select one desktop window when several exist\n  --url URL       Exact link for web/native\n  --seconds N     Observe 1–60 seconds (default 8)\n  --reload        Reload after the web observation and observe again\n  --browser PATH  Chrome/Chromium/Edge executable (or CHROME_PATH)\n  --session ID   Requesting conversation for native browser tasks\nweb launches an isolated headless browser; native uses the built-in browser tools.\nAll resources created here are registered and closed automatically. No app restart.');
    return;
  }
  if (!['doctor', 'watch', 'web', 'native'].includes(command)) throw new Error('Unknown command');
  if (['web', 'native'].includes(command) && !options.url) throw new Error('--url is required');
  if (options.url && !['http:', 'https:'].includes(new URL(options.url).protocol)) throw new Error('Use an HTTP(S) URL');
  const base = options.cdp ?? process.env.CDP_URL;
  if (command !== 'web' && !base) throw new Error('--cdp or CDP_URL is required; no port is assumed');
  if (command === 'native' && !options.session) throw new Error('native requires --session');
  const owner = `live-browser-${process.pid}-${Date.now()}`;
  const registry = ownersDir();
  const record = (kind, value) => addResource(registry, owner, kind, value);
  const release = (kind, value) => releaseResource(registry, owner, kind, value);
  record('pid', process.pid);
  let connection, child, scratch;
  let interrupted = false;
  const interrupt = () => { interrupted = true; child?.kill(); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  try {
    if (command === 'web') {
      const browser = options.browser ?? browserCandidates(process.platform, process.env).find(existsSync);
      if (!browser || !existsSync(browser)) throw new Error('No Chrome/Chromium/Edge found. Set --browser or CHROME_PATH. Nothing was installed.');
      const parent = join(tmpdir(), 'opencode'); mkdirSync(parent, { recursive: true });
      scratch = mkdtempSync(join(parent, 'live-browser-')); record('path', scratch);
      child = spawn(browser, ['--headless=new', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${scratch}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore', windowsHide: true });
      let launchError;
      child.on('error', error => { launchError = error; });
      if (child.pid) record('pid', child.pid);
      const activePort = join(scratch, 'DevToolsActivePort');
      for (let i = 0; !existsSync(activePort); i++) {
        if (launchError || child.exitCode !== null || interrupted || i >= 150) throw new Error('Browser startup failed (sandbox or executable). Use a supported installed browser; sandbox protections were not disabled.');
        await pause(100);
      }
      const port = Number(readFileSync(activePort, 'utf8').split('\n')[0]);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid browser debugging port');
      record('port', port);
      try {
        const browserBase = `http://127.0.0.1:${port}`;
        const pages = (await targets(browserBase)).filter(target => target.type === 'page');
        if (pages.length !== 1) throw new Error('Isolated browser has an ambiguous page target');
        connection = await connect(browserBase, pages[0].id); record('tab', pages[0].id);
        try {
          await connection.send('Page.enable');
          const navigation = await connection.send('Page.navigate', { url: options.url });
          if (navigation.errorText) throw new Error('Navigation failed: ' + navigation.errorText);
          await watch(connection, seconds);
          if (options.reload) {
            emit({ event: 'reload' });
            await connection.send('Page.reload');
            await watch(connection, seconds);
          }
        } finally { await connection.send('Page.close'); release('tab', pages[0].id); }
      } finally {
        connection?.close(); connection = undefined;
        await stopChild(child); release('pid', child.pid); release('port', port);
      }
    } else {
      connection = await desktop(base, options.target);
      if (command === 'doctor') {
        const state = await evaluate(connection, pageState);
        emit({ event: 'desktop', ...state, url: safeUrl(state.url) });
        const runtime = await evaluate(connection, '(async () => { const info = await window.__OPENWORK_ELECTRON__.invokeDesktop("openworkServerInfo"); return { serverUrl: info.baseUrl, running: info.running }; })()');
        emit({ event: 'runtime', serverUrl: safeUrl(runtime.serverUrl), running: runtime.running });
      } else if (command === 'native') {
        // Discover from the connected desktop, never from a cached profile path.
        // Credentials stay in memory and are sent only to its loopback task host.
        const bridge = await evaluate(connection, 'window.__OPENWORK_ELECTRON__.invokeDesktop("getUiControlBridgeInfo")');
        if (!bridge?.baseUrl || !bridge.token) throw new Error('The connected desktop has no live UI bridge');
        const bridgeUrl = new URL(bridge.baseUrl);
        if (bridgeUrl.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(bridgeUrl.hostname) || bridgeUrl.username || bridgeUrl.password) throw new Error('UI bridge must be loopback HTTP');
        const call = async (name, input) => {
          const response = await fetch(new URL('/browser/task', bridgeUrl), {
            method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
            headers: { Authorization: `Bearer ${bridge.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: options.session, operation: name.replace('browser_', ''), args: input }),
          });
          if (!response.ok) throw new Error('Native task host rejected the request: ' + response.status);
          return response.json();
        };
        let ownedTab;
        try {
          const before = await call('browser_tabs', {});
          if (!before.ok) throw new Error('Native browser unavailable: ' + before.code);
          const opened = await call('browser_open', { url: options.url, provider: 'builtin' });
          if (opened.tabId && !before.tabs.some(tab => (tab.tabId ?? tab.id) === opened.tabId)) { ownedTab = opened.tabId; record('tab', ownedTab); }
          emit({ event: 'native_open', ok: opened.ok, handoff: opened.handoff, next: opened.next, code: opened.code });
          if (!opened.ok) throw new Error('Native open failed: ' + opened.code);
          const observed = await call('browser_observe', { tabId: opened.tabId });
          emit({ event: 'native_observe', ok: observed.ok, code: observed.code });
          await watch(connection, seconds);
        } finally {
          if (ownedTab) {
            await call('browser_close', { tabId: ownedTab });
            const after = await call('browser_tabs', {});
            if (!after.ok || after.tabs.some(tab => (tab.tabId ?? tab.id) === ownedTab)) throw new Error('Owned native tab could not be closed; its resource record is retained');
            release('tab', ownedTab);
          }
        }
      } else await watch(connection, seconds);
    }
  } finally {
    connection?.close();
    if (child && child.exitCode === null && child.signalCode === null) await stopChild(child);
    if (child?.pid) release('pid', child.pid);
    if (scratch) { rmSync(scratch, { recursive: true, force: true }); release('path', scratch); }
    release('pid', process.pid);
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
  }
}
async function stopChild(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise(resolve => child.once('exit', resolve));
  child.kill();
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  try { await closed; } finally { clearTimeout(timer); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(process.argv.slice(2)); } catch (error) { console.error(JSON.stringify({ version: 1, code: 'live_debug_failed', message: error.message })); process.exitCode = 1; }
}
