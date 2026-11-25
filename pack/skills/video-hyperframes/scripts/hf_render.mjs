#!/usr/bin/env node
/**
 * Render de una composición HyperFrames (HTML + GSAP) cuadro por cuadro.
 *
 * No necesita `npx hyperframes` ni Puppeteer: habla CDP contra el
 * chrome-headless-shell que ya baja Remotion (o el Chrome/Edge del sistema),
 * pide `__hf.seek(t)` en cada cuadro y arma el MP4 con ffmpeg.
 *
 *   node hf_render.mjs --dir <carpeta> --out <archivo.mp4> [--fps 30]
 *                      [--scale 1] [--audio voz.wav] [--keep-frames]
 *                      [--chrome <ruta>] [--crf 18] [--json]
 *
 * Contrato: index.html con <div id="root" data-composition-id="main"
 * data-start="0" data-duration="6" data-width="1080" data-height="1920">
 * y una línea GSAP pausada registrada en window.__timelines["main"].
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------- argumentos
function parseArgs(argv) {
  const out = { fps: 30, scale: 1, crf: 18, keepFrames: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--dir") out.dir = next();
    else if (a === "--out") out.out = next();
    else if (a === "--fps") out.fps = Number(next());
    else if (a === "--scale") out.scale = Number(next());
    else if (a === "--audio") out.audio = next();
    else if (a === "--chrome") out.chrome = next();
    else if (a === "--crf") out.crf = Number(next());
    else if (a === "--frames") out.frames = next();
    else if (a === "--at") out.at = next();
    else if (a === "--format") out.format = next();
    else if (a === "--eval") out.eval = next();
    else if (a === "--resume") out.resume = true;
    else if (a === "--workers") out.workers = Number(next());
    else if (a === "--shard") out.shard = next();
    else if (a === "--keep-frames") out.keepFrames = true;
    else if (a === "--json") out.json = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.dir || !args.out) {
  console.log(
    "uso: node hf_render.mjs --dir <carpeta> --out <archivo.mp4> [--fps 30] [--scale 1] [--audio voz.wav] [--keep-frames]"
  );
  process.exit(args.help ? 0 : 2);
}

const projectDir = path.resolve(args.dir);
const outFile = path.resolve(args.out);
const indexPath = path.join(projectDir, "index.html");
if (!fs.existsSync(indexPath)) {
  console.error(`No encuentro ${indexPath}`);
  process.exit(2);
}

function framesDirFor() {
  return args.frames ? path.resolve(args.frames) : path.join(projectDir, ".hf-frames");
}

/** `i/n` → rango de cuadros [from, to) de este proceso. */
function parseShard(value, frameCount) {
  if (!value) return null;
  const m = /^(\d+)\/(\d+)$/.exec(String(value));
  if (!m) throw new Error(`--shard espera i/n, recibí ${value}`);
  const index = Number(m[1]);
  const total = Number(m[2]);
  if (!Number.isInteger(index) || !Number.isInteger(total) || total < 1 || index < 0 || index >= total) {
    throw new Error(`--shard fuera de rango: ${value}`);
  }
  const size = Math.ceil(frameCount / total);
  const from = Math.min(index * size, frameCount);
  return [from, Math.min(from + size, frameCount)];
}

/** Une los cuadros ya capturados en el MP4 final. */
async function encodeFrames() {
  const framesDir = framesDirFor();
  const ext = (args.format ?? "jpg").toLowerCase() === "png" ? "png" : "jpg";
  fs.mkdirSync(path.dirname(outFile), { recursive: true });

  const ffArgs = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-framerate",
    String(args.fps),
    "-i",
    path.join(framesDir, `frame_%05d.${ext}`),
  ];
  if (args.audio) ffArgs.push("-i", path.resolve(args.audio));
  ffArgs.push(
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    String(args.crf),
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart"
  );
  if (args.audio) ffArgs.push("-c:a", "aac", "-b:a", "192k", "-shortest");
  ffArgs.push(outFile);

  await new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", ffArgs, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let err = "";
    ff.stderr.on("data", (d) => (err += d.toString()));
    ff.on("error", reject);
    ff.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg salió ${code}\n${err.slice(-1200)}`))
    );
  });

  if (!args.keepFrames) fs.rmSync(framesDir, { recursive: true, force: true });
}

/**
 * Reparte los cuadros entre varios procesos de Chrome y codifica al final.
 * Cada proceso escribe su parte en la misma carpeta, con el índice global,
 * así la secuencia queda completa sin renumerar nada.
 */
async function runWorkers(count) {
  const framesDir = framesDirFor();
  if (!args.resume) fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });

  const base = [
    "--dir", args.dir,
    "--out", args.out,
    "--fps", String(args.fps),
    "--scale", String(args.scale),
    "--crf", String(args.crf),
  ];
  if (args.audio) base.push("--audio", args.audio);
  if (args.chrome) base.push("--chrome", args.chrome);
  if (args.frames) base.push("--frames", args.frames);
  if (args.format) base.push("--format", args.format);
  if (args.resume) base.push("--resume");

  console.error(`[hf_render] ${count} procesos en paralelo`);
  const started = Date.now();
  const running = [];
  for (let i = 0; i < count; i++) {
    const child = spawn(process.execPath, [process.argv[1], ...base, "--shard", `${i}/${count}`], {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let err = "";
    child.stderr.on("data", (d) => {
      err += d.toString();
      if (err.length > 6000) err = err.slice(-3000);
    });
    running.push(
      new Promise((resolve, reject) => {
        child.on("error", reject);
        child.on("close", (code) =>
          code === 0
            ? resolve()
            : reject(new Error(`la parte ${i + 1}/${count} salió ${code}\n${err.slice(-1500)}`))
        );
      })
    );
  }
  await Promise.all(running);
  console.error(`[hf_render] partes listas en ${((Date.now() - started) / 1000).toFixed(0)} s; codificando`);
  await encodeFrames();
}

// ------------------------------------------------------------ buscar chrome
function findChrome() {
  if (args.chrome) return args.chrome;
  if (process.env.HYPERFRAMES_CHROME) return process.env.HYPERFRAMES_CHROME;

  const local = process.env.LOCALAPPDATA || "";
  const pf = process.env.ProgramFiles || "C:\\Program Files";
  const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";

  // Primero el headless shell: no abre ninguna ventana aunque el render tarde.
  const roots = [path.join(local, "remotion"), process.cwd()];
  for (const root of roots) {
    const found = walkFor(root, "chrome-headless-shell.exe", 6);
    if (found) return found;
  }

  const fixed = [
    path.join(pf, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
  ];
  for (const p of fixed) if (fs.existsSync(p)) return p;
  return null;
}

function walkFor(root, name, depth) {
  if (depth < 0 || !fs.existsSync(root)) return null;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (e.isFile() && e.name.toLowerCase() === name.toLowerCase()) {
      return path.join(root, e.name);
    }
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name === ".git") continue;
    // node_modules no se recorre entero, salvo para llegar al browser de Remotion
    if (e.name === "node_modules") {
      const remotion = path.join(root, e.name, ".remotion");
      if (fs.existsSync(remotion)) {
        const hit = walkFor(remotion, name, depth);
        if (hit) return hit;
      }
      continue;
    }
    const hit = walkFor(path.join(root, e.name), name, depth - 1);
    if (hit) return hit;
  }
  return null;
}

const chromePath = findChrome();
if (!chromePath) {
  console.error(
    "No encontré Chrome. Pasá --chrome <ruta> o definí HYPERFRAMES_CHROME.\n" +
      "Sugerencia: usá el chrome-headless-shell de Remotion (node_modules/.remotion/...)."
  );
  process.exit(2);
}

// ------------------------------------------------------------------- CDP
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener("message", (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else resolve(msg.result);
        return;
      }
      if (msg.method) {
        const ls = this.listeners.get(msg.method) || [];
        for (const fn of ls) fn(msg.params, msg.sessionId);
      }
    });
  }

  send(method, params = {}, sessionId, timeoutMs = 30000) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`timeout CDP ${method}`));
        }
      }, timeoutMs);
    });
  }

  on(method, fn) {
    const ls = this.listeners.get(method) || [];
    ls.push(fn);
    this.listeners.set(method, ls);
  }

  waitEvent(method, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`sin evento ${method}`)), timeoutMs);
      const fn = (params) => {
        clearTimeout(t);
        const ls = this.listeners.get(method) || [];
        this.listeners.set(
          method,
          ls.filter((f) => f !== fn)
        );
        resolve(params);
      };
      this.on(method, fn);
    });
  }
}

const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevtools(port, timeoutMs = 25000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return await res.json();
    } catch {
      /* todavía no levantó */
    }
    await sleep(120);
  }
  throw new Error("chrome no abrió el puerto de depuración");
}

async function evaluate(cdp, sessionId, expression, awaitPromise = true) {
  const res = await cdp.send(
    "Runtime.evaluate",
    { expression, awaitPromise, returnByValue: true },
    sessionId
  );
  if (res.exceptionDetails) {
    throw new Error(
      res.exceptionDetails.exception?.description ||
        res.exceptionDetails.text ||
        "error al evaluar"
    );
  }
  return res.result?.value;
}

// ------------------------------------------------------------------- main
async function main() {
  // Varios procesos: cada uno hace su parte y este codifica al final.
  if (args.workers && args.workers > 1 && !args.shard) {
    await runWorkers(Math.min(Math.trunc(args.workers), 16));
    return;
  }

  const runtimeSrc = fs.readFileSync(path.resolve(import.meta.dirname, "..", "assets", "runtime.js"), "utf8");

  const readRoot = () => {
    const html = fs.readFileSync(indexPath, "utf8");
    const rootTag = /<div[^>]*data-composition-id[^>]*>/i.exec(html)?.[0] ?? "";
    const attr = (n) => {
      const m = new RegExp(`${n}="([^"]+)"`, "i").exec(rootTag);
      return m ? m[1] : null;
    };
    return {
      id: attr("data-composition-id") ?? "main",
      width: Number(attr("data-width") ?? 1920),
      height: Number(attr("data-height") ?? 1080),
      duration: Number(attr("data-duration") ?? 0),
    };
  };

  const root = readRoot();
  const width = Math.round(root.width * args.scale);
  const height = Math.round(root.height * args.scale);

  const port = await freePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hf-chrome-"));
  // Sin ventana: el headless shell ya lo es; un Chrome normal necesita el flag.
  const isHeadlessShell = /headless-shell/i.test(path.basename(chromePath));
  const chromeArgs = [
    ...(isHeadlessShell ? [] : ["--headless=new"]),
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    `--window-size=${width},${height}`,
    "--hide-scrollbars",
    "--mute-audio",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--allow-file-access-from-files",
    "--force-device-scale-factor=1",
    "--font-render-hinting=none",
    "--disable-lcd-text",
    "about:blank",
  ];

  const chrome = spawn(chromePath, chromeArgs, {
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });
  let chromeErr = "";
  chrome.stderr.on("data", (d) => {
    chromeErr += d.toString();
    if (chromeErr.length > 8000) chromeErr = chromeErr.slice(-4000);
  });

  const cleanup = () => {
    try {
      chrome.kill("SIGKILL");
    } catch {
      /* ya cerrado */
    }
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      /* bloqueado */
    }
  };

  const framesDir = args.frames
    ? path.resolve(args.frames)
    : path.join(projectDir, ".hf-frames");
  fs.mkdirSync(framesDir, { recursive: true });
  if (!args.resume) fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });
  fs.mkdirSync(path.dirname(outFile), { recursive: true });

  let cdp;
  try {
    const version = await waitForDevtools(port);
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", () => reject(new Error("no pude conectar a chrome")), {
        once: true,
      });
    });
    cdp = new CDP(ws);

    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });

    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send(
      "Page.addScriptToEvaluateOnNewDocument",
      { source: runtimeSrc },
      sessionId
    );
    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width, height, deviceScaleFactor: 1, mobile: false },
      sessionId
    );

    const loaded = cdp.waitEvent("Page.loadEventFired", 30000);
    await cdp.send("Page.navigate", { url: pathToFileURL(indexPath).href }, sessionId);
    await loaded;

    // Fuentes, imágenes y línea de tiempo listas antes del primer cuadro.
    await evaluate(
      cdp,
      sessionId,
      `(async () => {
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
        await Promise.all([...document.images].map(img => img.decode().catch(() => 0)));
        return true;
      })()`
    );

    const timelineKeys = await evaluate(
      cdp,
      sessionId,
      `Object.keys(window.__timelines || {})`
    );
    if (!timelineKeys || timelineKeys.length === 0) {
      throw new Error(
        "la composición no registró ninguna línea en window.__timelines (revisá `window.__timelines[id] = tl`)"
      );
    }

    const duration =
      Number(await evaluate(cdp, sessionId, "window.__hf && window.__hf.duration")) ||
      root.duration;
    if (!duration) throw new Error("data-duration de la raíz vacío");

    const fps = args.fps;
    const frameCount = Math.max(1, Math.round(duration * fps));
    const useJpeg = (args.format ?? "jpg").toLowerCase() !== "png";
    const ext = useJpeg ? "jpg" : "png";

    // Una captura que se cuelga no debe tirar el render entero: se reintenta.
    const capture = async (asPng) => {
      const params = {
        format: asPng || !useJpeg ? "png" : "jpeg",
        fromSurface: true,
        optimizeForSpeed: true,
      };
      if (!asPng && useJpeg) params.quality = 94;
      let lastError;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await cdp.send("Page.captureScreenshot", params, sessionId, 60000);
        } catch (err) {
          lastError = err;
          await sleep(400 + attempt * 900);
        }
      }
      throw lastError;
    };

    // Modo inspección: evalúa una expresión en la página y sale.
    if (args.eval) {
      await evaluate(cdp, sessionId, `window.__hf.seek(0)`, false);
      const value = await evaluate(cdp, sessionId, args.eval);
      console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
      fs.rmSync(framesDir, { recursive: true, force: true });
      return;
    }

    // Modo stills: solo los tiempos pedidos, sin codificar video.
    if (args.at) {
      const times = String(args.at)
        .split(",")
        .map((v) => Number(v.trim()))
        .filter((v) => Number.isFinite(v) && v >= 0 && v < duration + 0.001);
      if (!times.length) throw new Error(`--at no tiene tiempos válidos dentro de ${duration}s`);
      const stillsDir = path.join(projectDir, ".hf-stills");
      fs.mkdirSync(stillsDir, { recursive: true });
      const files = [];
      for (const t of times) {
        await evaluate(cdp, sessionId, `window.__hf.seek(${t.toFixed(6)})`, false);
        const shot = await capture(true);
        const file = path.join(stillsDir, `still-${t.toFixed(2)}.png`);
        fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
        files.push(file);
        console.error(`still ${t}s ok`);
      }
      console.log(
        JSON.stringify({ ok: true, mode: "stills", count: files.length, files }, null, 2)
      );
      fs.rmSync(framesDir, { recursive: true, force: true });
      return;
    }

    let rendered = 0;
    let skipped = 0;
    const renderRange = async (from, to) => {
      // Un Chrome recién abierto tarda unos cuadros en asentar el compositor.
      // Se piden los anteriores sin capturarlos para que el primero de la parte
      // salga igual que en el render secuencial.
      if (from > 0) {
        for (let i = Math.max(0, from - 5); i < from; i++) {
          await evaluate(cdp, sessionId, `window.__hf.seek(${(i / fps).toFixed(6)})`, false);
        }
        await evaluate(
          cdp,
          sessionId,
          "new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))"
        );
      }
      let first = true;
      for (let i = from; i < to; i++) {
        const frameFile = path.join(framesDir, `frame_${String(i).padStart(5, "0")}.${ext}`);
        if (args.resume && fs.existsSync(frameFile)) {
          skipped++;
          continue;
        }
        const t = i / fps;
        await evaluate(cdp, sessionId, `window.__hf.seek(${t.toFixed(6)})`, false);
        if (first) {
          // El primer cuadro de la parte se asienta antes de capturarlo.
          await evaluate(
            cdp,
            sessionId,
            "new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))"
          );
          await evaluate(cdp, sessionId, `window.__hf.seek(${t.toFixed(6)})`, false);
          first = false;
        }
        const shot = await capture(false);
        fs.writeFileSync(frameFile, Buffer.from(shot.data, "base64"));
        rendered++;
        if (rendered % 150 === 0) {
          console.error(`cuadros ${rendered + skipped}/${frameCount}`);
        }
      }
    };

    const shard = parseShard(args.shard, frameCount);
    if (shard) {
      await renderRange(shard[0], shard[1]);
      console.log(
        JSON.stringify(
          { ok: true, mode: "shard", from: shard[0], to: shard[1], rendered, skipped, framesDir },
          null,
          2
        )
      );
      return;
    }
    await renderRange(0, frameCount);

    // -------------------------------------------------------------- ffmpeg
    await encodeFrames();

    const sizeMb = fs.statSync(outFile).size / (1024 * 1024);
    const summary = {
      ok: true,
      engine: "hyperframes",
      chrome: chromePath,
      width,
      height,
      fps,
      duration,
      frames: frameCount,
      rendered,
      skipped,
      format: ext,
      out: outFile,
      sizeMb: Number(sizeMb.toFixed(2)),
      audio: args.audio ? path.resolve(args.audio) : null,
      framesDir: args.keepFrames ? framesDir : null,
    };
    if (!args.keepFrames) fs.rmSync(framesDir, { recursive: true, force: true });
    console.log(JSON.stringify(summary, null, 2));
  } catch (err) {
    if (chromeErr.trim()) console.error(chromeErr.slice(-1500));
    throw err;
  } finally {
    if (cdp) {
      try {
        cdp.ws.close();
      } catch {
        /* ya cerrado */
      }
    }
    cleanup();
  }
}

main().catch((err) => {
  console.error(`\n[hf_render] ${err.message}`);
  process.exit(1);
});
