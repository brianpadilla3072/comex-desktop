import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildPdfWrapper, createDesignRenderer, DESIGN_RENDER_PARTITION, designRenderUrlAllowed } from "./design-render.mjs";

function fakeElectron(options = {}) {
  const windows = [];
  const sessions = [];
  class FakeWebContents {
    constructor(owner) { this.owner = owner; this.listeners = new Map(); this.windowOpenHandler = null; }
    setWindowOpenHandler(handler) { this.windowOpenHandler = handler; }
    on(name, listener) { this.listeners.set(name, listener); }
    once(name, listener) { this.listeners.set(name, listener); }
    invalidate() { this.listeners.get("paint")?.({}, {}, { toPNG: () => Buffer.from(`painted-${this.owner.loaded.length}`) }); }
    async capturePage(rect) {
      this.owner.captures.push(rect);
      const empty = options.emptyCapture === true;
      return { isEmpty: () => empty, toPNG: () => Buffer.from(`png-${this.owner.loaded.length}`) };
    }
    async printToPDF(printOptions) { this.owner.printOptions = printOptions; return Buffer.from("%PDF-1.7 fake"); }
    stop() { this.owner.stopped = true; }
  }
  class FakeBrowserWindow {
    constructor(windowOptions) {
      this.options = windowOptions; this.loaded = []; this.captures = []; this.destroyed = false; this.sizes = [];
      this.webContents = new FakeWebContents(this);
      windows.push(this);
    }
    async loadFile(file) {
      const { readFile } = await import("node:fs/promises");
      this.loaded.push({ file, html: await readFile(file, "utf8") });
      if (options.hangLoad) await new Promise(() => {});
    }
    setContentSize(width, height) { this.sizes.push([width, height]); }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
  }
  const session = {
    fromPartition(partition, partitionOptions) {
      const ses = {
        partition, partitionOptions, filter: null, permissionRequest: null, permissionCheck: null,
        webRequest: { onBeforeRequest(listener) { ses.filter = listener; } },
        setPermissionRequestHandler(handler) { ses.permissionRequest = handler; },
        setPermissionCheckHandler(handler) { ses.permissionCheck = handler; },
      };
      sessions.push(ses);
      return ses;
    },
  };
  return { BrowserWindow: FakeBrowserWindow, session, windows, sessions };
}

async function scratch(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "design-render-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

const page = (label) => ({ html: `<!doctype html><html><body><h1>${label}</h1></body></html>`, width: 1920, height: 1080 });

test("PNG export captures each page at its size in a locked-down hidden window and cleans up", async (t) => {
  const tempRoot = await scratch(t);
  const electron = fakeElectron();
  const renderer = createDesignRenderer({ ...electron, tempRoot, settleMs: 0, delay: async () => {} });
  const result = await renderer.render({ format: "png", pages: [page("Uno"), page("Dos")] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.files.map((file) => Buffer.from(file).toString()), ["png-1", "png-2"]);
  assert.ok(result.files[0] instanceof Uint8Array);
  assert.equal(electron.windows.length, 1);
  const [win] = electron.windows;
  assert.equal(win.options.show, false);
  assert.deepEqual(
    { offscreen: win.options.webPreferences.offscreen, sandbox: win.options.webPreferences.sandbox, nodeIntegration: win.options.webPreferences.nodeIntegration, contextIsolation: win.options.webPreferences.contextIsolation, partition: win.options.webPreferences.partition, devTools: win.options.webPreferences.devTools },
    { offscreen: true, sandbox: true, nodeIntegration: false, contextIsolation: true, partition: DESIGN_RENDER_PARTITION, devTools: false },
  );
  assert.equal(win.options.webPreferences.preload, undefined);
  assert.deepEqual(win.webContents.windowOpenHandler(), { action: "deny" });
  let prevented = false;
  win.webContents.listeners.get("will-navigate")({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(win.captures[0], { x: 0, y: 0, width: 1920, height: 1080 });
  assert.match(win.loaded[1].html, /Dos/);
  assert.equal(win.destroyed, true);
  assert.deepEqual(await readdir(tempRoot), []);
  // Session: in-memory, every permission denied, network cancelled.
  const [ses] = electron.sessions;
  assert.equal(ses.partition.startsWith("persist:"), false);
  let granted = null;
  ses.permissionRequest(null, "media", (value) => { granted = value; });
  assert.equal(granted, false);
  assert.equal(ses.permissionCheck(), false);
  let decision = null;
  ses.filter({ url: "https://example.com/tracker.png" }, (value) => { decision = value; });
  assert.deepEqual(decision, { cancel: true });
  ses.filter({ url: "data:image/png;base64,AAAA" }, (value) => { decision = value; });
  assert.deepEqual(decision, { cancel: false });
});

test("PNG export falls back to the paint event when capture is empty", async (t) => {
  const tempRoot = await scratch(t);
  const electron = fakeElectron({ emptyCapture: true });
  const renderer = createDesignRenderer({ ...electron, tempRoot, settleMs: 0, delay: async () => {} });
  const result = await renderer.render({ format: "png", pages: [page("Uno")] });
  assert.equal(result.ok, true);
  assert.equal(Buffer.from(result.files[0]).toString(), "painted-1");
});

test("PDF export prints one wrapper with a sandboxed iframe per page at the exact size", async (t) => {
  const tempRoot = await scratch(t);
  const electron = fakeElectron();
  const renderer = createDesignRenderer({ ...electron, tempRoot, settleMs: 0, delay: async () => {} });
  const result = await renderer.render({ format: "pdf", pages: [page("Uno"), page("Dos & \"tres\"")] });
  assert.equal(result.ok, true);
  assert.equal(result.files.length, 1);
  assert.match(Buffer.from(result.files[0]).toString(), /^%PDF/);
  const [win] = electron.windows;
  assert.deepEqual(win.printOptions.pageSize, { width: 20, height: 11.25 });
  assert.deepEqual(win.printOptions.margins, { top: 0, bottom: 0, left: 0, right: 0 });
  assert.equal(win.printOptions.printBackground, true);
  const html = win.loaded[0].html;
  assert.equal(html.match(/<iframe sandbox="allow-scripts"/g).length, 2);
  assert.match(html, /@page\{size:1920px 1080px;margin:0\}/);
  assert.match(html, /Dos &amp; &quot;tres&quot;/);
  assert.deepEqual(await readdir(tempRoot), []);
});

test("invalid requests are refused before any window opens", async (t) => {
  const tempRoot = await scratch(t);
  const electron = fakeElectron();
  const renderer = createDesignRenderer({ ...electron, tempRoot, settleMs: 0, delay: async () => {} });
  for (const request of [null, { format: "svg", pages: [page("x")] }, { format: "png", pages: [] }, { format: "png", pages: [{ html: "x", width: 0, height: 10 }] }, { format: "png", pages: [page("x")], extra: true }]) {
    const result = await renderer.render(request);
    assert.equal(result.ok, false);
    assert.equal(result.code, "invalid_request");
  }
  assert.equal(electron.windows.length, 0);
});

test("a page that never loads times out, and the window and folder are removed", async (t) => {
  const tempRoot = await scratch(t);
  const electron = fakeElectron({ hangLoad: true });
  const renderer = createDesignRenderer({ ...electron, tempRoot, settleMs: 0, timeoutMs: 20, delay: async () => {} });
  const result = await renderer.render({ format: "png", pages: [page("Uno")] });
  assert.deepEqual({ ok: result.ok, code: result.code }, { ok: false, code: "render_timeout" });
  assert.equal(electron.windows[0].destroyed, true);
  assert.equal(electron.windows[0].stopped, true);
  assert.deepEqual(await readdir(tempRoot), []);
  // The queue keeps working after a failure.
  const next = createDesignRenderer({ ...fakeElectron(), tempRoot, settleMs: 0, delay: async () => {} });
  assert.equal((await next.render({ format: "png", pages: [page("Dos")] })).ok, true);
});

test("URL policy and wrapper helpers", () => {
  assert.equal(designRenderUrlAllowed("file:///tmp/x/page.html", "file:///tmp/x/page.html"), true);
  assert.equal(designRenderUrlAllowed("file:///etc/passwd", "file:///tmp/x/page.html"), false);
  assert.equal(designRenderUrlAllowed("about:srcdoc", null), true);
  assert.equal(designRenderUrlAllowed("blob:null/123", null), true);
  assert.equal(designRenderUrlAllowed("http://127.0.0.1:8778/x", null), false);
  assert.match(buildPdfWrapper([{ html: "<p>a</p>", width: 100, height: 50 }]), /srcdoc="&lt;p&gt;a&lt;\/p&gt;"/);
});

test("a window clamped to a smaller screen still yields a full page at its exact size", async (t) => {
  // Linux clamps the hidden window to the display; the page must be zoomed to fit and the
  // capture scaled back, never cropped (seen live: 1680×967 instead of 1920×1080).
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "design-render-clamp-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const zooms = [];
  const resized = [];
  class ClampedContents {
    constructor() { this.listeners = new Map(); }
    setWindowOpenHandler() {}
    on(name, listener) { this.listeners.set(name, listener); }
    once(name, listener) { this.listeners.set(name, listener); }
    setZoomFactor(factor) { zooms.push(factor); }
    async capturePage(rect) {
      return {
        isEmpty: () => false,
        getSize: () => ({ width: rect.width, height: rect.height }),
        resize: (size) => { resized.push(size); return { toPNG: () => Buffer.from("scaled") }; },
        toPNG: () => Buffer.from("raw"),
      };
    }
  }
  class ClampedWindow {
    constructor() { this.webContents = new ClampedContents(); this.destroyedFlag = false; }
    getContentSize() { return [1680, 967]; }
    setContentSize() {}
    async loadFile() {}
    isDestroyed() { return this.destroyedFlag; }
    destroy() { this.destroyedFlag = true; }
  }
  const base = fakeElectron();
  const renderer = createDesignRenderer({ ...base, BrowserWindow: ClampedWindow, tempRoot, settleMs: 0, delay: async () => {} });
  const result = await renderer.render({ format: "png", pages: [{ html: "<p>x</p>", width: 1920, height: 1080 }] });
  assert.equal(result.ok, true);
  assert.equal(zooms.length, 1);
  assert.ok(Math.abs(zooms[0] - 1680 / 1920) < 1e-9);
  assert.deepEqual(resized, [{ width: 1920, height: 1080, quality: "best" }]);
  assert.equal(Buffer.from(result.files[0]).toString(), "scaled");
});
