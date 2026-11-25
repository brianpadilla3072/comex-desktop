#!/usr/bin/env node
/**
 * Reencuadra un video a otro aspecto sin deformarlo.
 *
 *   node reframe.mjs --in v.mp4 --out v-cuadrado.mp4 --aspect 1:1
 *   node reframe.mjs --in v.mp4 --out v-vertical.mp4 --aspect 9:16 --focus 0.4
 *   node reframe.mjs --in v.mp4 --out v-vertical.mp4 --aspect 9:16 --mode blur
 *
 * focus: 0 = recorta a la izquierda, 0.5 = centro, 1 = derecha.
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const PRESETS = {
  "9:16": [1080, 1920],
  "4:5": [1080, 1350],
  "1:1": [1080, 1080],
  "16:9": [1920, 1080],
};

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : def;
};

const input = resolve(arg("in", ""));
const output = resolve(arg("out", ""));
const aspect = arg("aspect", "9:16");
const mode = arg("mode", "crop");
const focus = Math.min(1, Math.max(0, Number(arg("focus", "0.5"))));

if (!arg("in") || !existsSync(input)) fail("falta --in con un archivo existente");
if (!arg("out")) fail("falta --out");
const size = PRESETS[aspect];
if (!size) fail(`aspecto no soportado: ${aspect}. Usá ${Object.keys(PRESETS).join(", ")}`);
const [width, height] = size;
mkdirSync(dirname(output), { recursive: true });

const graph = mode === "blur"
  ? `[0:v]split=2[bg][fg];` +
    `[bg]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=24:2,eq=brightness=-0.18[back];` +
    `[fg]scale=${width}:${height}:force_original_aspect_ratio=decrease[front];` +
    `[back][front]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[v]`
  : `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,` +
    `crop=${width}:${height}:(iw-${width})*${focus}:(ih-${height})/2,setsar=1,format=yuv420p[v]`;

run([
  "-i", input,
  "-filter_complex", graph,
  "-map", "[v]", "-map", "0:a?",
  "-c:v", "libx264", "-preset", "medium", "-crf", "18",
  "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", output,
]);

const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", output], { encoding: "utf8" });
console.log(JSON.stringify({ ok: true, out: output, aspect, mode, focus, size, duration: Number(probe.stdout.trim()) }, null, 2));

function run(args) {
  const result = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], { encoding: "utf8" });
  if (result.status !== 0) fail(`ffmpeg falló: ${(result.stderr ?? "").trim().split("\n").slice(-4).join(" | ")}`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
