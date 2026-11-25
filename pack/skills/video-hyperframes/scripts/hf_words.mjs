#!/usr/bin/env node
/**
 * Tiempos por palabra: transcribe la voz con whisper.cpp y devuelve cada
 * palabra con su inicio y fin en segundos.
 *
 *   node hf_words.mjs --audio <archivo.wav> --out words.json [--lang es]
 *   node hf_words.mjs --dir <proyecto> [--cue cue-sheet.json] [--out words.json]
 *
 * En modo proyecto lee cada línea de `cue-sheet.json` (`voice.audio`) y suma el
 * tiempo del beat, así los tiempos quedan absolutos dentro del video.
 *
 * Requiere `whisper-cli` y un modelo `ggml-*.bin`. Se buscan en este orden:
 *   1. --whisper / --model
 *   2. variables WHISPER_CLI y WHISPER_MODEL
 *   3. C:\tools\whisper\Release\
 *   4. `whisper-cli` en el PATH
 *
 * Salida:
 * {
 *   "meta": { "language": "es", "model": "base", "lines": 3, "words": 42 },
 *   "words": [ { "word": "Potente", "start": 2.13, "end": 2.40, "line": "b2" } ]
 * }
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};

const readJson = (file) => JSON.parse(fs.readFileSync(path.resolve(file), "utf8").replace(/^\uFEFF/, ""));

const WHISPER_DIR = "C:\\tools\\whisper\\Release";

const findWhisper = () => {
  const explicit = arg("whisper") || process.env.WHISPER_CLI;
  if (explicit && fs.existsSync(explicit)) return explicit;
  const local = path.join(WHISPER_DIR, "whisper-cli.exe");
  if (fs.existsSync(local)) return local;
  const probe = spawnSync("whisper-cli", ["--help"], { encoding: "utf8" });
  return probe.error ? null : "whisper-cli";
};

const findModel = () => {
  const explicit = arg("model") || process.env.WHISPER_MODEL;
  if (explicit && fs.existsSync(explicit)) return explicit;
  for (const name of ["ggml-small.bin", "ggml-base.bin", "ggml-medium.bin", "ggml-tiny.bin"]) {
    const candidate = path.join(WHISPER_DIR, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
};

const whisper = findWhisper();
const model = findModel();
if (!whisper || !model) {
  console.error(
    "falta whisper.cpp o el modelo.\n" +
      `  whisper: ${whisper ?? "no encontrado"}\n  modelo: ${model ?? "no encontrado"}\n` +
      "  instalá el zip whisper-bin-x64 y bajá ggml-base.bin a C:\\tools\\whisper\\Release\\"
  );
  process.exit(2);
}

/** Une los tokens de whisper en palabras y convierte a segundos absolutos. */
const mergeTokens = (tokens, offset) => {
  const words = [];
  let current = null;
  let boundary = false; // una comilla de apertura corta la palabra

  for (const token of tokens) {
    const raw = token?.text ?? "";
    if (!raw || /^\[_.*\]$/.test(raw.trim())) continue;

    const clean = raw.trim();
    if (!clean) continue;

    const start = (token.offsets?.from ?? 0) / 1000 + offset;
    const end = (token.offsets?.to ?? token.offsets?.from ?? 0) / 1000 + offset;
    const probability = typeof token.p === "number" ? token.p : null;

    // Puntuación suelta: se pega a la palabra anterior, no cuenta como palabra.
    if (/^[.,;:!?¡¿"'“”«»…—-]+$/.test(clean)) {
      if (current) {
        current.end = Math.max(current.end, end);
        current.raw += clean;
      }
      // Comilla o paréntesis de apertura: lo que sigue es otra palabra.
      if (/^["“«'(\[]/.test(clean)) boundary = true;
      continue;
    }

    // Token que abre con comilla: la comilla sobra y arranca palabra nueva.
    const opensWithQuote = /^["“«'(\[]/.test(clean);
    const word = clean.replace(/^["“«'(\[]+/, "").replace(/["”»')\]]+$/, "");
    if (!word) continue;

    const startsWord = boundary || opensWithQuote || /^\s/.test(raw) || current === null;
    boundary = false;

    if (startsWord) {
      current = { word, raw: clean, start, end, p: probability };
      words.push(current);
    } else {
      current.word += word;
      current.raw += clean;
      current.end = Math.max(current.end, end);
      if (probability !== null && (current.p === null || probability < current.p)) {
        current.p = probability;
      }
    }
  }

  return words.map(({ word, raw, start, end, p }) => ({
    word,
    start: Number(start.toFixed(3)),
    end: Number(end.toFixed(3)),
    p: p === null ? null : Number(p.toFixed(3)),
    raw,
  }));
};

const transcribe = (audio, offset) => {
  const tmp = path.join(os.tmpdir(), `hf-words-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
  const result = spawnSync(
    whisper,
    [
      "-m", model,
      "-f", audio,
      "-l", arg("lang", "es"),
      "-ojf",
      "-of", tmp,
      "-np",
      "-sow",
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );

  const jsonFile = `${tmp}.json`;
  if (result.error || !fs.existsSync(jsonFile)) {
    const detail = (result.stderr ?? "").split("\n").filter(Boolean).slice(-3).join(" | ");
    throw new Error(`whisper falló con ${path.basename(audio)}: ${detail || result.error?.message || "sin salida"}`);
  }

  const payload = JSON.parse(fs.readFileSync(jsonFile, "utf8").replace(/^\uFEFF/, ""));
  fs.rmSync(jsonFile, { force: true });

  const tokens = (payload.transcription ?? []).flatMap((segment) => segment.tokens ?? []);
  return mergeTokens(tokens, offset);
};

// ------------------------------------------------------------------- entrada --
const audioArg = arg("audio");
const dirArg = arg("dir");

let words = [];
let lines = 0;
let total = 0;

if (audioArg) {
  const audio = path.resolve(audioArg);
  if (!fs.existsSync(audio)) {
    console.error(`no existe ${audio}`);
    process.exit(2);
  }
  words = transcribe(audio, Number(arg("offset", "0")));
  lines = 1;
  total = words.length ? words[words.length - 1].end : 0;
} else if (dirArg) {
  const project = path.resolve(dirArg);
  const cuePath = path.resolve(arg("cue", path.join(project, "cue-sheet.json")));
  if (!fs.existsSync(cuePath)) {
    console.error(`no encuentro ${cuePath} (usá --cue)`);
    process.exit(2);
  }
  const cue = readJson(cuePath);
  const beats = Array.isArray(cue.beats) ? cue.beats : [];
  const bases = [
    path.join(project, "remotion", "public"),
    path.join(project, "public"),
    path.join(project, "assets"),
    project,
  ];
  const resolveAudio = (rel) => {
    if (!rel) return null;
    const abs = path.isAbsolute(rel) ? rel : null;
    if (abs && fs.existsSync(abs)) return abs;
    for (const base of bases) {
      const candidate = path.join(base, rel);
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  };

  for (const beat of beats) {
    const audio = resolveAudio(beat.voice?.audio);
    if (!audio) continue;
    const offset = Number(beat.voice?.at ?? beat.time ?? 0);
    const found = transcribe(audio, offset).map((word) => ({ ...word, line: beat.id }));
    words.push(...found);
    lines += 1;
    total = Math.max(total, Number(beat.time ?? 0) + Number(beat.duration ?? 0));
  }
} else {
  console.log("uso: node hf_words.mjs --audio <wav> --out words.json | --dir <proyecto> [--cue cue-sheet.json]");
  process.exit(2);
}

if (!words.length) {
  console.error("whisper no devolvió palabras (¿audio vacío o silencioso?)");
  process.exit(1);
}

words.sort((a, b) => a.start - b.start);

const out = path.resolve(
  arg("out", path.join(dirArg ? path.resolve(dirArg) : process.cwd(), "words.json"))
);
const payload = {
  meta: {
    language: arg("lang", "es"),
    model: path.basename(model, ".bin").replace(/^ggml-/, ""),
    whisper: path.basename(whisper),
    lines,
    words: words.length,
    totalSeconds: Number(total.toFixed(3)),
  },
  words,
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

const slowest = words.reduce((acc, word) => Math.max(acc, word.end - word.start), 0);
console.log(
  JSON.stringify(
    {
      ok: true,
      out,
      lines,
      words: words.length,
      longestWordSeconds: Number(slowest.toFixed(2)),
      first: words.slice(0, 5).map((w) => `${w.start.toFixed(2)}s ${w.word}`),
      last: words.slice(-3).map((w) => `${w.start.toFixed(2)}s ${w.word}`),
    },
    null,
    2
  )
);
