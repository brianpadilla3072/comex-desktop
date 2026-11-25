#!/usr/bin/env node
/**
 * Presupuesto de palabras y densidad de habla.
 *
 * El problema que resuelve: si el guion es corto para la duración pedida, el
 * video queda con silencio de relleno y se siente lento aunque los cortes
 * estén bien. A 30 s con 51 palabras sobraban 8,5 s sin voz (72 % de habla)
 * contra el 96 % de la referencia.
 *
 * Mide la velocidad real del motor (no la teórica) con las duraciones ya
 * generadas y dice cuántas palabras entran en el target.
 *
 * Usage:
 *   node word-budget.mjs <project> [--target 30] [--gap 0.4] [--preRoll 0.5]
 *                        [--endHold 1.2] [--min-ratio 0.85] [--check]
 *
 * Sale con 1 si --check y la densidad real está por debajo del mínimo.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const project = resolve(args.find((arg) => !arg.startsWith("--")) ?? ".");
const value = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const parsed = Number(args[index + 1]);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const read = (...parts) => {
  const path = join(project, ...parts);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
};

const durations = read("assets", "audio", "voice", "durations.json");
if (!durations || !Array.isArray(durations.lines) || durations.lines.length === 0) {
  console.error("Falta assets/audio/voice/durations.json. Generá la voz primero (voz-local).");
  process.exit(1);
}

const cue = read("cue-sheet.json");
const style = read("style.json");

const countWords = (text) => String(text ?? "").trim().split(/\s+/).filter(Boolean).length;

const lines = durations.lines.map((line) => ({
  id: line.id,
  words: countWords(line.text),
  seconds: Number(line.durationSeconds) || 0,
}));
const words = lines.reduce((sum, line) => sum + line.words, 0);
const speechSeconds = Math.round(lines.reduce((sum, line) => sum + line.seconds, 0) * 1000) / 1000;
const wpm = speechSeconds > 0 ? Math.round((words / speechSeconds) * 60 * 10) / 10 : 0;

const target = value("target", Number(cue?.meta?.durationSeconds ?? style?.format?.durationSeconds ?? 30));
const gap = value("gap", Number(cue?.meta?.timing?.gap ?? 0.4));
const preRoll = value("preRoll", Number(cue?.meta?.timing?.preRoll ?? 0.5));
const endHold = value("endHold", Number(cue?.meta?.timing?.endHold ?? 1.2));
const minRatio = value("min-ratio", 0.85);

const gapCount = Math.max(0, lines.length - 1);
const overhead = preRoll + endHold + gap * gapCount;
const availableSpeech = Math.max(0, target - overhead);
const budgetWords = Math.floor((availableSpeech / 60) * wpm);

const realTotal = Number(cue?.meta?.durationSeconds ?? 0);
const realRatio = realTotal > 0 ? Math.round((speechSeconds / realTotal) * 1000) / 1000 : null;

// Densidad del plan: cuánto del target ocuparía la voz actual con el overhead.
const plannedRatio = target > 0 ? Math.round((speechSeconds / target) * 1000) / 1000 : null;
const ratio = realRatio ?? plannedRatio;

const verdict =
  ratio === null ? "sin datos" : ratio >= 0.9 ? "denso" : ratio >= minRatio ? "aceptable" : "corto";
const deltaWords = budgetWords - words;

const result = {
  ok: verdict !== "corto",
  lines: lines.length,
  words,
  speechSeconds,
  wordsPerMinute: wpm,
  target,
  overheadSeconds: Math.round(overhead * 1000) / 1000,
  availableSpeechSeconds: Math.round(availableSpeech * 1000) / 1000,
  budgetWords,
  deltaWords,
  speechRatio: ratio,
  minRatio,
  verdict,
  hints: [],
};

if (verdict === "corto") {
  result.hints.push(
    `Faltan ~${Math.abs(deltaWords)} palabras para llegar a ${minRatio * 100}% de habla. Agregá frases, no silencios: el silencio se nota más que una línea de más.`,
  );
}
if (verdict === "denso") {
  result.hints.push("Más de 90 % de habla: si no hay música, dejá al menos 0.3 s entre líneas para que respire.");
}
if (wpm > 0 && (wpm < 110 || wpm > 200)) {
  result.hints.push(`La velocidad medida (${wpm} wpm) está fuera del rango humano esperable: revisá que las duraciones no incluyan silencio.`);
}

console.log(JSON.stringify(result, null, 2));
if (args.includes("--check") && !result.ok) process.exit(1);
