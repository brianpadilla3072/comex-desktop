#!/usr/bin/env node
/**
 * Corta un tramo de un video sin tocar el original.
 *
 *   node trim.mjs --in v.mp4 --out corte.mp4 --start 0:05 --end 0:12
 *   node trim.mjs --in v.mp4 --out corte.mp4 --start 5 --duration 7
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const arg = (name) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
};

const input = resolve(arg("in") ?? "");
const output = resolve(arg("out") ?? "");
const start = toSeconds(arg("start") ?? "0");
const end = arg("end") !== undefined ? toSeconds(arg("end")) : undefined;
const duration = arg("duration") !== undefined ? toSeconds(arg("duration")) : end !== undefined ? end - start : undefined;

if (!arg("in") || !existsSync(input)) fail("falta --in con un archivo existente");
if (!arg("out")) fail("falta --out");
if (!duration || duration <= 0) fail("necesito --end o --duration mayor que 0");

mkdirSync(dirname(output), { recursive: true });
run([
  "-ss", String(start), "-i", input, "-t", String(duration),
  "-c:v", "libx264", "-preset", "medium", "-crf", "18",
  "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", output,
]);

console.log(JSON.stringify({ ok: true, out: output, start, duration }, null, 2));

function toSeconds(value) {
  if (typeof value === "number") return value;
  const parts = String(value).split(":").map(Number);
  if (parts.some((part) => Number.isNaN(part))) fail(`tiempo inválido: ${value}`);
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function run(args) {
  const result = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], { encoding: "utf8" });
  if (result.status !== 0) fail(`ffmpeg falló: ${(result.stderr ?? "").trim().split("\n").slice(-3).join(" | ")}`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
