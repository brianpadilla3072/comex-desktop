#!/usr/bin/env node
/**
 * Still de portada para el panel de Video.
 *
 *   node still.mjs --project video-projects/<slug> [--at 11.5] [--video ...] [--out ...]
 *
 * El panel de la app espera `qa/still.png` para la miniatura y para el gate
 * "Stills". Sin ese archivo, el proyecto se ve pendiente aunque el video exista.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};

const projectArg = arg("project");
if (!projectArg) {
  console.error("uso: node still.mjs --project video-projects/<slug> [--at 11.5]");
  process.exit(2);
}

const project = path.resolve(projectArg);
const video = path.resolve(arg("video", path.join(project, "renders", "final.mp4")));
const out = path.resolve(arg("out", path.join(project, "qa", "still.png")));
const at = Number(arg("at", "11.5"));

if (!fs.existsSync(video)) {
  console.error(`no encuentro el video: ${video}`);
  process.exit(2);
}

fs.mkdirSync(path.dirname(out), { recursive: true });

const result = spawnSync(
  "ffmpeg",
  ["-y", "-hide_banner", "-loglevel", "error", "-ss", String(at), "-i", video, "-frames:v", "1", out],
  { encoding: "utf8" }
);

if (result.status !== 0 || !fs.existsSync(out)) {
  console.error(`ffmpeg falló: ${(result.stderr ?? "").trim().split("\n").slice(-2).join(" | ")}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    { ok: true, still: out, at, bytes: fs.statSync(out).size },
    null,
    2
  )
);
