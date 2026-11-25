#!/usr/bin/env node
/**
 * Plan de acentos de sonido: decide DÓNDE va cada SFX, no cuántos.
 *
 *   node hf_plan_sfx.mjs --beats <beats.json> [--style style.json]
 *                        [--out audio-cues.json] [--max-extra 2]
 *
 * Reglas:
 *  - Un acento en cada corte (inicio de escena, salvo la primera).
 *  - Un riser 1,2 s antes de la última escena (empuja hacia el cierre).
 *  - Un impacto en el inicio de la última escena.
 *  - Los acentos "extra" (sobre palabras clave) quedan limitados por
 *    `--max-extra`; la densidad del estilo manda sobre las ganas de poner más.
 *
 * Copia los SFX base del pack si el proyecto no los tiene, y escribe
 * `audio-cues.json`, que `hf_mix_audio.mjs` ya sabe leer.
 */
import fs from "node:fs";
import path from "node:path";
import { resolveStyle } from "./style_path.mjs";

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};

const beatsPath = arg("beats");
if (!beatsPath) {
  console.log(
    "uso: node hf_plan_sfx.mjs --beats <beats.json> [--style style.json] [--out audio-cues.json] [--max-extra 2]"
  );
  process.exit(2);
}

const beatsFile = path.resolve(beatsPath);
const beats = JSON.parse(fs.readFileSync(beatsFile, "utf8").replace(/^\uFEFF/, ""));
const scenes = Array.isArray(beats.scenes) ? beats.scenes : [];
if (!scenes.length) {
  console.error("beats.json sin scenes[]");
  process.exit(1);
}

const projectDir = path.dirname(beatsFile);
const skillDir = path.resolve(import.meta.dirname, "..");
const stylePath = resolveStyle(arg("style"), projectDir) ?? path.join(projectDir, "style.json");
const style = fs.existsSync(stylePath)
  ? JSON.parse(fs.readFileSync(stylePath, "utf8").replace(/^\uFEFF/, ""))
  : {};

const total = Number(beats.meta?.duration ?? 0) ||
  Math.max(...scenes.map((s) => Number(s.start ?? 0) + Number(s.duration ?? 0)));
const density = Number(style?.audio?.sfxDensityPerMinute ?? 0);
const maxExtra = Math.max(0, Number(arg("max-extra", "99")));

// SFX base: si el proyecto no los tiene, se copian del pack.
const sfxDir = path.join(projectDir, "assets", "audio", "sfx");
const baseDir = path.join(skillDir, "assets", "sfx");
fs.mkdirSync(sfxDir, { recursive: true });
for (const name of ["whoosh.wav", "impact.wav", "pop.wav", "riser.wav", "glitch.wav"]) {
  const target = path.join(sfxDir, name);
  if (!fs.existsSync(target) && fs.existsSync(path.join(baseDir, name))) {
    fs.copyFileSync(path.join(baseDir, name), target);
  }
}

const cues = [];
const ordered = [...scenes].sort((a, b) => Number(a.start ?? 0) - Number(b.start ?? 0));
const last = ordered[ordered.length - 1];
const lastStart = Number(last?.start ?? 0);

// Un acento por corte, alternando timbre para no repetir el mismo golpe.
// La última escena la cubre el impacto de cierre: no se duplica el golpe.
ordered.slice(1, -1).forEach((scene, i) => {
  const at = Number(scene.start ?? 0);
  cues.push({
    at: Number(at.toFixed(3)),
    asset: "audio/sfx/" + (i % 2 === 0 ? "whoosh.wav" : "impact.wav"),
    gainDb: -16,
    kind: "corte",
  });
});

// Empuje hacia el cierre.
if (lastStart > 1.4) {
  cues.push({
    at: Number((lastStart - 1.2).toFixed(3)),
    asset: "audio/sfx/riser.wav",
    gainDb: -18,
    kind: "cierre",
  });
}
cues.push({
  at: Number(lastStart.toFixed(3)),
  asset: "audio/sfx/impact.wav",
  gainDb: -15,
  kind: "cierre",
});

// Acentos sobre palabras: necesitan `words.json` (lo genera hf_words.mjs).
const defaultWords = path.join(projectDir, "words.json");
const wordsPath = arg("words", fs.existsSync(defaultWords) ? defaultWords : null);
const wordsData =
  wordsPath && fs.existsSync(wordsPath)
    ? JSON.parse(fs.readFileSync(wordsPath, "utf8").replace(/^\uFEFF/, ""))
    : null;
const words = Array.isArray(wordsData?.words) ? wordsData.words : [];

const normalize = (text) =>
  String(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ]/g, "");

const emphasize = String(arg("emphasize", ""))
  .split(",")
  .map((item) => normalize(item))
  .filter(Boolean);

const STOPWORDS = new Set(
  "de la que el y en un a con por para sin los las del al es su tu se lo como mas pero ya o u".split(" ")
);
const isNumber = (word) => /\d/.test(word);
const isCaps = (word) => /^[A-ZÁÉÍÓÚÑÜ]{4,}$/.test(word);

// Presupuesto: la densidad del estilo manda. La mitad de los SFX por minuto
// se reserva a palabras; el resto son cortes y cierre.
const accentsPerMinute = Number(
  arg("accents-per-minute", density ? Math.max(1, Math.round(density / 2)) : 3)
);
const accentBudget =
  total >= 6 ? Math.max(1, Math.floor((accentsPerMinute * total) / 60)) : 0;

const candidates = [];
for (let i = 0; i < words.length; i++) {
  const item = words[i];
  const word = String(item.word ?? "").trim();
  const key = normalize(word);
  if (!key) continue;
  if (word.length < 3 && !isCaps(word) && !isNumber(word)) continue;
  if (Number(item.end) - Number(item.start) < 0.12) continue;

  const next = words[i + 1];
  const prev = words[i - 1];
  const gapBefore = prev ? Number(item.start) - Number(prev.end) : 1;
  const gapAfter = next ? Number(next.start) - Number(item.end) : 1;
  const isList = /,$/.test(String(item.raw ?? word));
  const phraseEnd = !next || next.line !== item.line || gapAfter > 0.32;
  const capitalized = /^[A-ZÁÉÍÓÚÑÜ]/.test(word);

  let score = 0;
  let asset = "audio/sfx/pop.wav";
  let reason = null;

  if (isNumber(word)) {
    score = 4;
    asset = "audio/sfx/impact.wav";
    reason = "dato";
  } else if (emphasize.includes(key)) {
    score = 4;
    reason = "clave";
  } else if (isCaps(word)) {
    score = 3;
    reason = "mayusculas";
  } else if (isList) {
    score = 3;
    reason = "lista";
  } else if (gapBefore > 0.32 && key.length >= 5 && !STOPWORDS.has(key)) {
    score = 2;
    reason = "arranque";
  } else if (phraseEnd && key.length >= 5 && !STOPWORDS.has(key)) {
    score = 2;
    reason = "cierre-de-frase";
  }

  if (!score) continue;
  candidates.push({
    at: Number(Number(item.start).toFixed(3)),
    end: Number(Number(item.end).toFixed(3)),
    word,
    key,
    capitalized,
    score,
    reason,
    asset,
  });
}

const minGap = Number(arg("min-gap", "0.9"));
const MIN_FROM_STRUCTURE = 0.28;
const structural = cues.map((cue) => cue.at);

// Ranking dentro de cada franja: puntaje, nombre propio, largo y orden.
const rank = (a, b) =>
  b.score - a.score ||
  Number(b.capitalized) - Number(a.capitalized) ||
  b.key.length - a.key.length ||
  a.at - b.at;

// Un acento por franja: reparte el video en vez de amontonar al principio.
const buckets = Array.from({ length: Math.max(1, accentBudget) }, () => []);
for (const candidate of candidates) {
  if (!accentBudget) break;
  const index = Math.min(
    accentBudget - 1,
    Math.max(0, Math.floor((candidate.at / Math.max(0.001, total)) * accentBudget))
  );
  buckets[index].push(candidate);
}
for (const bucket of buckets) bucket.sort(rank);

if (argv.includes("--debug")) {
  console.error(
    JSON.stringify(
      {
        accentBudget,
        buckets: buckets.map((bucket, index) => ({
          index,
          candidates: bucket.slice(0, 5).map((c) => `${c.at}s ${c.word} · ${c.score}/${c.reason}`),
        })),
      },
      null,
      2
    )
  );
}

// Se evita repetir la misma palabra si en la franja hay otra opción.
const usedKeys = new Set();
const chosen = [];
for (const bucket of buckets) {
  for (const candidate of bucket) {
    if (candidate.score < 2) break;
    if (usedKeys.has(candidate.key)) continue;
    if (structural.some((at) => Math.abs(at - candidate.at) < MIN_FROM_STRUCTURE)) continue;
    if (chosen.some((other) => Math.abs(other.at - candidate.at) < minGap)) continue;
    usedKeys.add(candidate.key);
    chosen.push(candidate);
    break;
  }
}
chosen.sort((a, b) => a.at - b.at);

for (const accent of chosen) {
  cues.push({
    at: accent.at,
    asset: accent.asset,
    gainDb: accent.asset.includes("impact") ? -17 : -19,
    kind: "palabra",
    word: accent.word,
    reason: accent.reason,
  });
}

const extrasAvailable = accentBudget;

cues.sort((a, b) => a.at - b.at);

const out = path.resolve(arg("out", path.join(projectDir, "audio-cues.json")));
const payload = {
  meta: {
    totalSeconds: Number(total.toFixed(3)),
    styleDensity: density || null,
    chosen: cues.length,
    accentBudget,
    accents: chosen.length,
    words: words.length,
    wordsSource: wordsPath ? path.basename(wordsPath) : null,
    note: "Los cortes y el cierre son estructurales; los acentos caen sobre palabras (dato, clave, mayúsculas o cierre de frase).",
  },
  cues,
};
fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

console.log(
  JSON.stringify(
    {
      ok: true,
      out,
      total: payload.meta.totalSeconds,
      cues: cues.length,
      byKind: cues.reduce((acc, c) => ((acc[c.kind] = (acc[c.kind] ?? 0) + 1), acc), {}),
      densityTarget: density || null,
      accentBudget,
      accents: chosen.map((accent) => `${accent.at}s ${accent.word} (${accent.reason})`),
    },
    null,
    2
  )
);
