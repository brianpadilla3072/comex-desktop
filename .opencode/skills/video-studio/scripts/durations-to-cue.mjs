#!/usr/bin/env node
/**
 * Ajusta cue-sheet.json a las duraciones reales de la voz.
 *
 * Usage:
 *   node .opencode/skills/video-studio/scripts/durations-to-cue.mjs video-projects/<slug> [--gap 0.4]
 *
 * Lee storyboard.json y assets/audio/voice/durations.json, y reescribe los
 * tiempos de cue-sheet.json en secuencia.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const project = resolve(args.find((arg) => !arg.startsWith("--")) ?? ".");
const gapIndex = args.indexOf("--gap");
const gap = gapIndex >= 0 ? Number(args[gapIndex + 1]) || 0.4 : 0.4;

function readJson(...parts) {
  const path = join(project, ...parts);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

const storyboard = readJson("storyboard.json");
if (!storyboard || !Array.isArray(storyboard.beats) || storyboard.beats.length === 0) {
  console.error("Falta storyboard.json con beats. Corré storyboard-to-lines.mjs primero.");
  process.exit(1);
}
const durations = readJson("assets", "audio", "voice", "durations.json");
const byId = new Map((durations?.lines ?? []).map((line) => [line.id, line]));
const existing = readJson("cue-sheet.json") ?? {};

let cursor = 0;
const warnings = [];
const beats = storyboard.beats.map((beat) => {
  const voice = byId.get(beat.id);
  const duration = voice?.durationSeconds
    ? Math.round((voice.durationSeconds + gap) * 1000) / 1000
    : Number(beat.duration ?? 2.5);
  if (beat.voiceLine && !voice) warnings.push(`${beat.id}: sin audio de voz; uso ${duration}s`);
  const result = {
    id: beat.id,
    time: Math.round(cursor * 1000) / 1000,
    duration,
    scene: beat.scene,
    sfx: (beat.sfx ?? []).map((label) => ({ label, asset: "", at: 0, gainDb: 0 })),
    motion: beat.motion,
    text: beat.text,
    transition: beat.transition,
  };
  if (voice) {
    result.voice = { line: beat.voiceLine, audio: voice.file, gainDb: 0 };
  }
  cursor = Math.round((cursor + duration) * 1000) / 1000;
  return result;
});

const cue = {
  ...existing,
  meta: {
    slug: existing.meta?.slug ?? project.split(/[\\/]/).filter(Boolean).pop() ?? "video",
    durationSeconds: cursor,
    fps: existing.meta?.fps ?? 30,
    aspect: existing.meta?.aspect ?? "16:9",
    style: existing.meta?.style ?? "style.json",
  },
  beats,
};
writeFileSync(join(project, "cue-sheet.json"), `${JSON.stringify(cue, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  ok: true,
  beats: beats.length,
  totalSeconds: cursor,
  gap,
  warnings,
  output: join(project, "cue-sheet.json"),
}, null, 2));
