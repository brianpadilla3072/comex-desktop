#!/usr/bin/env node
/**
 * ¿Este equipo puede renderizar 3D con WebGL en headless?
 *
 * Monta una escena mínima con @remotion/three en <proyecto>/remotion/.webgl-check,
 * renderiza un still y mide la imagen: si sale uniforme, WebGL no está
 * funcionando y conviene el camino 2.5D (capas SVG) en vez de Three.js.
 *
 * Usage:
 *   node check-webgl.mjs <project> [--frame 10] [--clean]
 *
 * Sale con 1 si falta alguna dependencia o si el frame sale negro.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const assets = resolve(here, "..", "assets", "webgl-check");

const args = process.argv.slice(2);
const project = resolve(args.find((arg) => !arg.startsWith("--")) ?? ".");
const frameIndex = (() => {
  const index = args.indexOf("--frame");
  const parsed = index >= 0 ? Number(args[index + 1]) : 10;
  return Number.isFinite(parsed) ? parsed : 10;
})();

const remotionDir = join(project, "remotion");
const packagePath = join(remotionDir, "package.json");
if (!existsSync(packagePath)) {
  console.error(`No existe ${packagePath}. Creá el proyecto con scaffold-remotion.mjs.`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
const needed = ["@remotion/three", "three", "@react-three/fiber"];
const missing = needed.filter((name) => !deps[name]);

if (missing.length > 0) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        missing,
        fix: `cd ${remotionDir} && npm install @remotion/three three @react-three/fiber`,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

// Compara las versiones INSTALADAS, no los rangos del package.json: ^4.0.0 y
// ^4.0.545 pueden resolver a la misma versión, y Remotion exige que coincidan.
const installedVersion = (name) => {
  try {
    return JSON.parse(readFileSync(join(remotionDir, "node_modules", name, "package.json"), "utf8")).version;
  } catch {
    return null;
  }
};
const remotionInstalled = installedVersion("remotion");
const threeInstalled = installedVersion("@remotion/three");
if (remotionInstalled && threeInstalled && remotionInstalled !== threeInstalled) {
  console.warn(
    `Aviso: remotion ${remotionInstalled} y @remotion/three ${threeInstalled} no coinciden. Remotion exige la misma versión exacta.`,
  );
}

const checkDir = join(remotionDir, ".webgl-check");
if (args.includes("--clean")) {
  rmSync(checkDir, { recursive: true, force: true });
  console.log(JSON.stringify({ ok: true, cleaned: checkDir }, null, 2));
  process.exit(0);
}

mkdirSync(checkDir, { recursive: true });
cpSync(assets, checkDir, { recursive: true });

const out = join(checkDir, "frame.png");
const relativeOut = ".webgl-check/frame.png";
mkdirSync(dirname(out), { recursive: true });

try {
  execFileSync(
    "npx",
    ["remotion", "still", ".webgl-check/index.ts", "WebglCheck", relativeOut, `--frame=${frameIndex}`, "--log=error"],
    { cwd: remotionDir, stdio: "pipe", shell: true },
  );
} catch (error) {
  const detail = String(error?.stderr ?? error?.message ?? "").slice(-800);
  console.error(JSON.stringify({ ok: false, stage: "render", detail }, null, 2));
  process.exit(1);
}

// Mide la imagen: si es uniforme, el canvas salió negro o vacío.
let pixels = Buffer.alloc(0);
try {
  pixels = execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", out, "-vf", "scale=160:90", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
} catch (error) {
  console.error(JSON.stringify({ ok: false, stage: "measure", detail: String(error?.message ?? "") }, null, 2));
  process.exit(1);
}

let sum = 0;
let sumSquares = 0;
const bins = new Set();
for (const value of pixels) {
  sum += value;
  sumSquares += value * value;
  bins.add(value >> 3);
}
const mean = pixels.length ? sum / pixels.length : 0;
const variance = pixels.length ? sumSquares / pixels.length - mean * mean : 0;
const stdev = Math.sqrt(Math.max(0, variance));
const distinctBins = bins.size;
const ok = stdev >= 2 && distinctBins >= 4;

console.log(
  JSON.stringify(
    {
      ok,
      image: out,
      meanLuma: Math.round(mean * 10) / 10,
      stdev: Math.round(stdev * 100) / 100,
      distinctBins,
      verdict: ok
        ? "WebGL funciona en headless: se puede usar @remotion/three."
        : "Frame uniforme: WebGL no está renderizando. Usá 2.5D con capas SVG o probá --frame más alto.",
      ...(ok ? {} : { fix: "Probá RENDER_DEBUG=1 y revisá si el Chromium headless tiene SwiftShader (--use-gl=angle)." }),
    },
    null,
    2,
  ),
);
if (!ok) process.exit(1);
