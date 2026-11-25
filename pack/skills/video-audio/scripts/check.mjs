#!/usr/bin/env node
/**
 * Mide un audio (o la mezcla de un proyecto) y lo compara con el objetivo.
 *
 *   node check.mjs --file assets/audio/mix.wav [--target -16] [--true-peak -1.5]
 *   node check.mjs --project video-projects/<slug>
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const wingetLinks = join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WinGet", "Links");
if (existsSync(wingetLinks)) process.env.PATH = `${wingetLinks};${process.env.PATH ?? ""}`;

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : def;
};

const project = resolve(arg("project", "."));
const file = resolve(arg("file", join(project, "assets", "audio", "mix.wav")));
const target = Number(arg("target", "-16"));
const truePeak = Number(arg("true-peak", "-1.5"));
const tolerance = Number(arg("tolerance", "1.5"));

if (!existsSync(file)) {
  console.error(`no encuentro ${file}`);
  process.exit(1);
}

const result = spawnSync("ffmpeg", [
  "-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-",
], { encoding: "utf8" });

const stderr = result.stderr ?? "";
const integrated = lastNumber(/I:\s*(-?\d+(?:\.\d+)?) LUFS/g, stderr);
const peak = lastNumber(/Peak:\s*(-?\d+(?:\.\d+)?) dBFS/g, stderr);

const okLoudness = integrated !== null && Math.abs(integrated - target) <= tolerance;
const okPeak = peak !== null && peak <= truePeak + 0.01;

const report = {
  ok: Boolean(okLoudness && okPeak),
  file,
  integrated,
  peak,
  target,
  truePeak,
  tolerance,
  checks: [
    { name: "loudness", ok: Boolean(okLoudness), detail: `${integrated ?? "?"} LUFS (objetivo ${target} ±${tolerance})` },
    { name: "truePeak", ok: Boolean(okPeak), detail: `${peak ?? "?"} dBFS (máx ${truePeak})` },
  ],
};

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);

function lastNumber(pattern, text) {
  let value = null;
  for (const match of text.matchAll(pattern)) value = Number(match[1]);
  return value;
}
