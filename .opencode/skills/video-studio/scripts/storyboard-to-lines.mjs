#!/usr/bin/env node
/**
 * Convierte storyboard.md (tabla) en storyboard.json + lines.json.
 *
 * Usage:
 *   node .opencode/skills/video-studio/scripts/storyboard-to-lines.mjs video-projects/<slug>
 *
 * Columnas esperadas: # | Tiempo | Escena | Voz (línea) | SFX | Movimiento | Texto | Transición
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const project = resolve(process.argv[2] ?? ".");
const storyboardPath = join(project, "storyboard.md");
if (!existsSync(storyboardPath)) {
  console.error(`Falta ${storyboardPath}`);
  process.exit(1);
}

function parseTime(value) {
  const text = String(value ?? "").trim();
  const mmss = /^(\d+):(\d+(?:\.\d+)?)$/.exec(text);
  if (mmss) return Math.round((Number(mmss[1]) * 60 + Number(mmss[2])) * 1000) / 1000;
  const seconds = Number(text.replace(",", "."));
  return Number.isFinite(seconds) ? seconds : 0;
}

const rows = [];
for (const line of readFileSync(storyboardPath, "utf8").split(/\r?\n/)) {
  if (!line.trim().startsWith("|")) continue;
  const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
  if (cells.length < 8 || !/^\d+$/.test(cells[0])) continue;
  const [number, time, scene, voice, sfx, motion, text, transition] = cells;
  rows.push({
    id: `b${number}`,
    time: parseTime(time),
    scene,
    voiceLine: voice,
    sfx: sfx ? sfx.split(",").map((item) => item.trim()).filter(Boolean) : [],
    motion,
    text,
    transition,
  });
}

if (rows.length === 0) {
  console.error("No encontré filas en storyboard.md (tabla con # | Tiempo | Escena | ...).");
  process.exit(1);
}

const lines = rows
  .filter((row) => row.voiceLine)
  .map((row) => ({ id: row.id, text: row.voiceLine }));

writeFileSync(join(project, "storyboard.json"), `${JSON.stringify({ beats: rows }, null, 2)}\n`, "utf8");
mkdirSync(join(project, "assets", "audio"), { recursive: true });
writeFileSync(join(project, "assets", "audio", "lines.json"), `${JSON.stringify(lines, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  ok: true,
  beats: rows.length,
  lines: lines.length,
  storyboard: join(project, "storyboard.json"),
  linesFile: join(project, "assets", "audio", "lines.json"),
  next: "python .opencode/skills/voz-local/scripts/tts.py --profile voices/<nombre>/perfil.json --lines assets/audio/lines.json --outdir assets/audio/voice",
}, null, 2));
