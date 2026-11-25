#!/usr/bin/env node
/**
 * Une varios videos en uno, normalizando tamaño, fps y audio.
 *
 *   node join.mjs --out unido.mp4 --in a.mp4 --in b.mp4
 *   node join.mjs --out unido.mp4 --in a.mp4 --in b.mp4 --transition fade --duration 0.4
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const values = (name) => argv.reduce((list, item, index) => (item === `--${name}` ? [...list, argv[index + 1]] : list), []);
const arg = (name, def) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : def;
};

const inputs = values("in").map((file) => resolve(file));
const output = resolve(arg("out", ""));
const transition = arg("transition", "none");
const transitionDuration = Number(arg("duration", "0.4"));

if (inputs.length < 2) fail("necesito al menos dos --in");
for (const file of inputs) if (!existsSync(file)) fail(`no encuentro ${file}`);
if (!arg("out")) fail("falta --out");
mkdirSync(dirname(output), { recursive: true });

const first = probe(inputs[0]);
const width = even(first.width);
const height = even(first.height);
const fps = first.fps || 30;

const args = [];
for (const file of inputs) args.push("-i", file);

const norm = (index) =>
  `[${index}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
  `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${fps},setsar=1,format=yuv420p[v${index}];` +
  `[${index}:a]aresample=48000,aformat=channel_layouts=stereo[a${index}]`;

let graph;
let videoLabel = "v";
let audioLabel = "a";
if (transition === "none") {
  graph = inputs.map((_, index) => norm(index)).join(";") + ";" +
    inputs.map((_, index) => `[v${index}][a${index}]`).join("") +
    `concat=n=${inputs.length}:v=1:a=1[v][a]`;
} else {
  const durations = inputs.map((file) => probe(file).duration);
  const parts = inputs.map((_, index) => norm(index));
  let lastVideo = "v0";
  let lastAudio = "a0";
  let offset = durations[0] - transitionDuration;
  for (let index = 1; index < inputs.length; index += 1) {
    const nextVideo = `vx${index}`;
    const nextAudio = `ax${index}`;
    parts.push(
      `[${lastVideo}][v${index}]xfade=transition=${transition === "fade" ? "fade" : transition}:duration=${transitionDuration}:offset=${Math.max(0, offset)}[${nextVideo}]`
    );
    parts.push(`[${lastAudio}][a${index}]acrossfade=d=${transitionDuration}[${nextAudio}]`);
    lastVideo = nextVideo;
    lastAudio = nextAudio;
    offset += durations[index] - transitionDuration;
  }
  graph = parts.join(";");
  videoLabel = `[${lastVideo}]`;
  audioLabel = `[${lastAudio}]`;
}

args.push(
  "-filter_complex", graph,
  "-map", transition === "none" ? "[v]" : videoLabel,
  "-map", transition === "none" ? "[a]" : audioLabel,
  "-c:v", "libx264", "-preset", "medium", "-crf", "18",
  "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", output
);

if (process.env.MONTAJE_DEBUG) console.error(graph);

run(args);
const out = probe(output);
console.log(JSON.stringify({ ok: true, out: output, inputs: inputs.length, transition, duration: out.duration, size: [out.width, out.height] }, null, 2));

function probe(file) {
  const result = spawnSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration:stream=width,height,r_frame_rate",
    "-of", "json", file,
  ], { encoding: "utf8" });
  const data = JSON.parse(result.stdout || "{}");
  const stream = (data.streams ?? []).find((item) => item.width) ?? {};
  const [n, d] = String(stream.r_frame_rate ?? "30/1").split("/").map(Number);
  return {
    duration: Number(data.format?.duration ?? 0),
    width: Number(stream.width ?? 1080),
    height: Number(stream.height ?? 1920),
    fps: d ? Math.round((n / d) * 100) / 100 : 30,
  };
}

function even(value) {
  return value % 2 === 0 ? value : value - 1;
}

function run(args) {
  const result = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], { encoding: "utf8" });
  if (result.status !== 0) fail(`ffmpeg falló: ${(result.stderr ?? "").trim().split("\n").slice(-4).join(" | ")}`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
