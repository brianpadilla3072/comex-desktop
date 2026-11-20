import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

/**
 * Renders design pages (self-contained HTML documents built by the app) to PDF or PNG with
 * Electron's own Chromium. Used by the design studio exports (docs/features/design-studio).
 *
 * Isolation: every page loads in a hidden offscreen BrowserWindow with sandbox, context
 * isolation, no Node integration, no preload, no devtools, in an in-memory session partition
 * whose request filter cancels every request except the one temporary page file and
 * `data:`/`blob:`/`about:` URLs. Permissions are denied, popups and navigation are refused.
 * The temporary folder lives under the OS temp dir and is removed after each render.
 *
 *   PDF: one wrapper document with one sandboxed `srcdoc` iframe per page, `printToPDF` with
 *        the exact page size (1920x1080 px = 20 x 11.25 in) and no margins: one PDF page per
 *        design page.
 *   PNG: each page alone at its size, `capturePage` (the paint event as fallback).
 *
 * Renders run one at a time so a large deck never holds two hidden renderers.
 */

export const DESIGN_RENDER_PARTITION = "openwork-design-render";
export const DESIGN_RENDER_LIMITS = Object.freeze({
  pages: 200,
  pageHtmlBytes: 48 * 1024 * 1024,
  totalHtmlBytes: 256 * 1024 * 1024,
  dimension: 20_000,
});
const CSS_PX_PER_INCH = 96;

const pageSchema = z.strictObject({
  html: z.string().min(1).max(DESIGN_RENDER_LIMITS.pageHtmlBytes),
  width: z.number().int().positive().max(DESIGN_RENDER_LIMITS.dimension),
  height: z.number().int().positive().max(DESIGN_RENDER_LIMITS.dimension),
});
export const designRenderRequestSchema = z.strictObject({
  format: z.enum(["pdf", "png"]),
  pages: z.array(pageSchema).min(1).max(DESIGN_RENDER_LIMITS.pages),
});

/** URLs the render session may load: the page file itself and inline data. */
export function designRenderUrlAllowed(url, pageUrl) {
  if (typeof url !== "string") return false;
  if (pageUrl && url === pageUrl) return true;
  return /^(data|blob):/i.test(url) || /^about:(blank|srcdoc)$/i.test(url);
}

function escapeAttribute(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** One printable document: a sandboxed iframe per page, one PDF page each. */
export function buildPdfWrapper(pages) {
  const first = pages[0];
  const frames = pages.map((page) => `<iframe sandbox="allow-scripts" width="${page.width}" height="${page.height}" style="width:${page.width}px;height:${page.height}px" srcdoc="${escapeAttribute(page.html)}"></iframe>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:${first.width}px ${first.height}px;margin:0}html,body{margin:0;padding:0;background:transparent}iframe{display:block;border:0;break-after:page;page-break-after:always}iframe:last-child{break-after:auto;page-break-after:auto}</style></head><body>${frames}</body></html>`;
}

function toBytes(buffer) {
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength).slice();
}

function withTimeout(promise, timeoutMs, onTimeout) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { onTimeout?.(); reject(Object.assign(new Error("render timed out"), { code: "render_timeout" })); }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * @param {{
 *   BrowserWindow: typeof import("electron").BrowserWindow,
 *   session: Pick<typeof import("electron").session, "fromPartition">,
 *   tempRoot?: string,
 *   settleMs?: number,
 *   timeoutMs?: number,
 *   fs?: { mkdtemp: typeof mkdtemp, writeFile: typeof writeFile, rm: typeof rm },
 *   delay?: (ms: number) => Promise<void>,
 * }} deps
 */
export function createDesignRenderer(deps) {
  const fs = deps.fs ?? { mkdtemp, writeFile, rm };
  const tempRoot = deps.tempRoot ?? os.tmpdir();
  const settleMs = deps.settleMs ?? 300;
  const timeoutMs = deps.timeoutMs ?? 30_000;
  const delay = deps.delay ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let renderSession = null;
  let currentPageUrl = null;
  let queue = Promise.resolve();

  function sessionForRender() {
    if (renderSession) return renderSession;
    const ses = deps.session.fromPartition(DESIGN_RENDER_PARTITION, { cache: false });
    ses.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: !designRenderUrlAllowed(details.url, currentPageUrl) });
    });
    ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    renderSession = ses;
    return ses;
  }

  function createWindow(width, height) {
    sessionForRender();
    const win = new deps.BrowserWindow({
      show: false,
      width,
      height,
      useContentSize: true,
      frame: false,
      paintWhenInitiallyHidden: true,
      webPreferences: {
        offscreen: true,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        webviewTag: false,
        javascript: true,
        webSecurity: true,
        spellcheck: false,
        devTools: false,
        backgroundThrottling: false,
        partition: DESIGN_RENDER_PARTITION,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event) => event.preventDefault());
    win.webContents.on("will-attach-webview", (event) => event.preventDefault());
    return win;
  }

  async function load(win, directory, html) {
    const file = path.join(directory, "page.html");
    await fs.writeFile(file, html, "utf8");
    currentPageUrl = pathToFileURL(file).href;
    try {
      await withTimeout(win.loadFile(file), timeoutMs, () => win.webContents.stop?.());
    } finally {
      currentPageUrl = null;
    }
    await delay(settleMs);
  }

  async function capture(win, width, height) {
    const image = await win.webContents.capturePage({ x: 0, y: 0, width, height });
    if (!image.isEmpty()) return image.toPNG();
    // Offscreen windows paint on demand: ask for a frame and take it from the paint event.
    const painted = new Promise((resolve) => win.webContents.once("paint", (_event, _dirty, frame) => resolve(frame)));
    win.webContents.invalidate();
    const frame = await withTimeout(painted, timeoutMs);
    return frame.toPNG();
  }

  /** @returns {Promise<{ ok: true, files: Uint8Array[] }>} */
  async function renderNow(request) {
    const directory = await fs.mkdtemp(path.join(tempRoot, "openwork-design-render-"));
    let win = null;
    try {
      if (request.format === "pdf") {
        const first = request.pages[0];
        win = createWindow(first.width, first.height);
        await load(win, directory, buildPdfWrapper(request.pages));
        const pdf = await win.webContents.printToPDF({
          printBackground: true,
          preferCSSPageSize: true,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
          pageSize: { width: first.width / CSS_PX_PER_INCH, height: first.height / CSS_PX_PER_INCH },
        });
        return { ok: true, files: [toBytes(pdf)] };
      }
      const files = [];
      for (const page of request.pages) {
        if (!win) win = createWindow(page.width, page.height);
        else win.setContentSize(page.width, page.height);
        await load(win, directory, page.html);
        files.push(toBytes(await capture(win, page.width, page.height)));
      }
      return { ok: true, files };
    } finally {
      if (win && !win.isDestroyed()) win.destroy();
      await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** @returns {Promise<import("@openwork/types/desktop-ipc").DesignRenderResult>} */
  async function render(input) {
    const parsed = designRenderRequestSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: "invalid_request", message: "The design pages to render are not valid." };
    const total = parsed.data.pages.reduce((sum, page) => sum + page.html.length, 0);
    if (total > DESIGN_RENDER_LIMITS.totalHtmlBytes) return { ok: false, code: "invalid_request", message: "The design is too large to render at once." };
    const run = queue.then(() => renderNow(parsed.data));
    queue = run.then(() => undefined, () => undefined);
    try {
      return await run;
    } catch (error) {
      const code = error && typeof error === "object" && error.code === "render_timeout" ? "render_timeout" : "render_failed";
      return { ok: false, code, message: error instanceof Error ? error.message : String(error) };
    }
  }

  return { render };
}
