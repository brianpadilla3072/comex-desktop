#!/usr/bin/env node
/**
 * Reemplaza o suma audio a un video ya renderizado.
 *
 *   node audio.mjs --in v.mp4 --out v2.mp4 --replace nueva.wav
 *   node audio.mjs --in v.mp4 --out v2.mp4 --mix musica.mp3 --gain -12
 *   node audio.mjs --in v.mp4 --out v2.mp4 --replace voz.wav --normalize -16
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : def;
};

const input = resolve(arg("in", ""));
const output = resolve(arg("out", ""));
const replace = arg("replace");
const mix = arg("mix");
const gain = Number(arg("gain", "0"));
const normalize = arg("normalize");

if (!arg("in") || !existsSync(input)) fail("falta --in con un archivo existente");
if (!arg("out")) fail("falta --out");
if (!replace && !mix) fail("necesito --replace <audio> o --mix <audio>");
if (replace && !existsSync(resolve(replace))) fail(`no encuentro ${replace}`);
if (mix && !existsSync(resolve(mix))) fail(`no encuentro ${mix}`);
mkdirSync(dirname(output), { recursive: true });

const args = ["-i", input];
const filters = [];
let map = [];

if (replace) {
  args.push("-i", resolve(replace));
  const tail = normalize ? `,loudnorm=I=${Number(normalize)}:TP=-1.5:LRA=11` : "";
  filters.push(`[1:a]aresample=48000,aformat=channel_layouts=stereo,volume=${gain}dB${tail}[a]`);
  map = ["-map", "0:v", "-map", "[a]"];
} else {
  args.push("-i", resolve(mix));
  const tail = normalize ? `,loudnorm=I=${Number(normalize)}:TP=-1.5:LRA=11` : "";
  filters.push(`[0:a]aresample=48000,aformat=channel_layouts=stereo[orig]`);
  filters.push(`[1:a]aresample=48000,aformat=channel_layouts=stereo,volume=${gain}dB${tail}[extra]`);
  filters.push(`[orig][extra]amix=inputs=2:normalize=0:dropout_transition=0[a]`);
  map = ["-map", "0:v", "-map", "[a]"];
}

run([
  ...args,
  "-filter_complex", filters.join(";"),
  ...map,
  "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", output,
]);

console.log(JSON.stringify({ ok: true, out: output, mode: replace ? "replace" : "mix", normalize: normalize ?? null }, null, 2));

function run(args) {
  const result = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], { encoding: "utf8" });
  if (result.status !== 0) fail(`ffmpeg falló: ${(result.stderr ?? "").trim().split("\n").slice(-4).join(" | ")}`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
