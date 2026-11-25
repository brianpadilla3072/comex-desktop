#!/usr/bin/env node
/**
 * Mezcla voz + SFX (+ música opcional) en una sola pista, para motores que
 * reciben un único audio (video-hyperframes).
 *
 *   node hf_mix_audio.mjs --dir <proyecto> [--out <wav>]
 *                         [--music <archivo>] [--musicDb -28]
 *                         [--lufs -16] [--tp -1.5]
 *
 * Lee cue-sheet.json (voz y SFX por beat) y, si existe, `audio-cues.json`
 * (acentos sueltos). La música se repite hasta cubrir el video y se atenúa
 * sola cuando habla la voz (sidechaincompress).
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const flag = (name) => argv.includes(`--${name}`);

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    ff.stderr.on("data", (d) => (err += d.toString()));
    ff.on("error", reject);
    ff.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg salió ${code}\n${err.slice(-1800)}`))
    );
  });
}

/**
 * Loudness integrado medido con ebur128. `loudnorm` de una pasada se queda
 * corto con audio disperso (SFX sueltos sobre silencio): medir y corregir.
 */
function measureLufs(file) {
  return new Promise((resolve) => {
    const ff = spawn(
      "ffmpeg",
      ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128", "-f", "null", "-"],
      { stdio: ["ignore", "ignore", "pipe"] }
    );
    let err = "";
    ff.stderr.on("data", (d) => (err += d.toString()));
    ff.on("error", () => resolve({ i: null, peak: null }));
    ff.on("close", () => {
      const lufs = [...err.matchAll(/I:\s+(-?\d+(?:\.\d+)?) LUFS/g)].pop();
      const peak = [...err.matchAll(/Peak:\s+(-?\d+(?:\.\d+)?) dBFS/g)].pop();
      resolve({ i: lufs ? Number(lufs[1]) : null, peak: peak ? Number(peak[1]) : null });
    });
  });
}

const dirArg = arg("dir");
if (!dirArg) {
  console.log(
    "uso: node hf_mix_audio.mjs --dir <proyecto> [--out <wav>] [--music <archivo>] [--musicDb -28]"
  );
  process.exit(2);
}

const project = path.resolve(dirArg);
const assets = path.resolve(arg("assets", path.join(project, "assets")));
const cuePath = path.resolve(arg("cue", path.join(project, "cue-sheet.json")));

// El cue-sheet es opcional: sin voz alcanza con `beats.json` para la duración.
const cue = fs.existsSync(cuePath)
  ? JSON.parse(fs.readFileSync(cuePath, "utf8").replace(/^\uFEFF/, ""))
  : { beats: [] };

let total = Number(cue?.meta?.durationSeconds ?? 0);
if (!total) {
  const beatsPath = path.join(project, "beats.json");
  if (fs.existsSync(beatsPath)) {
    const beats = JSON.parse(fs.readFileSync(beatsPath, "utf8").replace(/^\uFEFF/, ""));
    total = Number(beats?.meta?.duration ?? 0);
  }
}
if (!total) {
  console.error("no pude obtener la duración: falta cue-sheet.json o beats.json con meta.duration");
  process.exit(2);
}

const out = path.resolve(arg("out", path.join(assets, "audio", "mix.wav")));
const lufs = arg("lufs", "-16");
const tp = arg("tp", "-1.5");
const musicFile = arg("music", null);
// La música sin licencia declarada se mezcla igual, pero queda registrada como
// "sin-verificar": no se puede afirmar que sea usable.
const musicLicense = arg("musicLicense", null);
const musicSource = arg("musicSource", null);
// La cama va 12 dB o más abajo que la voz: no necesita ducking y el render no
// depende de sidechaincompress (que con pad se cuelga en este ffmpeg).
const musicDb = Number(arg("musicDb", "-28"));

function resolveAsset(rel) {
  const clean = String(rel).replace(/^\/+/, "");
  const candidates = [
    path.join(assets, clean),
    path.join(assets, "audio", "voice", path.basename(clean)),
    path.join(project, clean),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

const voices = [];
const sfx = [];

for (const beat of cue.beats ?? []) {
  const voice = beat?.voice?.audio;
  if (voice) {
    const file = resolveAsset(voice);
    if (file) voices.push({ file, at: Number(beat.time ?? 0), gainDb: Number(beat?.voice?.gainDb ?? 0) });
    else console.warn(`aviso: falta la voz ${voice} (beat ${beat.id})`);
  }
  for (const s of beat?.sfx ?? []) {
    const file = resolveAsset(s.asset);
    if (file) sfx.push({ file, at: Number(s.at ?? 0), gainDb: Number(s.gainDb ?? 0) });
    else console.warn(`aviso: falta el SFX ${s.asset} (beat ${beat.id})`);
  }
}

// Acentos extra: archivo propio del proyecto, no toca el cue-sheet aprobado.
const extraPath = path.join(project, "audio-cues.json");
if (fs.existsSync(extraPath)) {
  const extra = JSON.parse(fs.readFileSync(extraPath, "utf8").replace(/^\uFEFF/, ""));
  for (const s of extra.cues ?? []) {
    const file = resolveAsset(s.asset);
    if (file) sfx.push({ file, at: Number(s.at ?? 0), gainDb: Number(s.gainDb ?? 0) });
    else console.warn(`aviso: falta el acento ${s.asset}`);
  }
}

if (!voices.length && !sfx.length && !musicFile) {
  console.error("no hay pistas para mezclar");
  process.exit(1);
}

const inputs = [];
const filters = [];
let index = 0;

function addChain(track, label) {
  inputs.push("-i", track.file);
  const i = index++;
  const ms = Math.max(0, Math.round(track.at * 1000));
  filters.push(
    `[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
      `volume=${track.gainDb}dB,adelay=${ms}|${ms}[${label}]`
  );
  return `[${label}]`;
}

function mixOf(labels, outLabel) {
  if (!labels.length) return null;
  if (labels.length === 1) {
    filters.push(`${labels[0]}anull[${outLabel}]`);
    return `[${outLabel}]`;
  }
  filters.push(`${labels.join("")}amix=inputs=${labels.length}:normalize=0:dropout_transition=0[${outLabel}]`);
  return `[${outLabel}]`;
}

const voiceLabels = voices.map((t, i) => addChain(t, `v${i}`));
const sfxLabels = sfx.map((t, i) => addChain(t, `s${i}`));

const vox = mixOf(voiceLabels, "vox");
const sfxMix = mixOf(sfxLabels, "sfx");

let musicOut = null;
let bedPath = null;
if (musicFile) {
  const file = path.resolve(musicFile);
  if (!fs.existsSync(file)) {
    console.error(`No encuentro la música: ${file}`);
    process.exit(2);
  }
  if (!musicLicense) {
    console.warn(
      "aviso: música sin licencia declarada. Grabá el dato con --musicLicense \"...\" y --musicSource \"...\"."
    );
  }
  // La cama se arma aparte y con duración fija: un `-stream_loop -1` dentro del
  // grafo grande puede no terminar nunca y colgar el render.
  bedPath = path.join(path.dirname(out), ".music-bed.wav");
  await runFfmpeg([
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-stream_loop",
    "-1",
    "-i",
    file,
    "-t",
    String(total),
    "-af",
    `volume=${musicDb}dB,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo`,
    "-ar",
    "48000",
    "-c:a",
    "pcm_s16le",
    bedPath,
  ]);

  inputs.push("-i", bedPath);
  const m = index++;
  filters.push(`[${m}:a]atrim=0:${total},asetpts=N/SR/TB[musraw]`);
  musicOut = "[musraw]";
}

// Colchón de silencio con la duración exacta: `apad` dentro del grafo no
// estira la salida (ffmpeg la corta en el último SFX), así que la duración se
// garantiza con un input de silencio que entra al amix.
inputs.push("-f", "lavfi", "-t", String(total), "-i", "anullsrc=r=48000:cl=stereo");
const silence = index++;
filters.push(`[${silence}:a]aformat=sample_fmts=fltp:channel_layouts=stereo[silraw]`);

const finalLabels = ["[silraw]"];
if (vox) finalLabels.push("[vox]");
if (sfxMix) finalLabels.push("[sfx]");
if (musicOut) finalLabels.push(musicOut);

if (finalLabels.length === 1) {
  console.error("no quedó ninguna pista en la mezcla");
  process.exit(1);
}

filters.push(
  `${finalLabels.join("")}amix=inputs=${finalLabels.length}:normalize=0:dropout_transition=0[premix]`
);
filters.push(
  `[premix]loudnorm=I=${lufs}:TP=${tp}:LRA=11,atrim=0:${total},` +
    `aformat=sample_fmts=s16:channel_layouts=stereo[out]`
);

fs.mkdirSync(path.dirname(out), { recursive: true });

const args = [
  "-y",
  "-hide_banner",
  "-loglevel",
  "error",
  ...inputs,
  "-filter_complex",
  filters.join(";"),
  "-map",
  "[out]",
  "-ar",
  "48000",
  "-c:a",
  "pcm_s16le",
  // Cota dura: sin esto, un `apad` sin duración deja a ffmpeg generando
  // silencio para siempre (se vio con 60 s y 12 acentos).
  "-t",
  String(total),
  out,
];

await runFfmpeg(args);

// Corrección de loudness: si el resultado se aleja más de 0,4 dB del objetivo,
// se aplica una ganancia medida y un limitador. Sin esto, un mix con pocos SFX
// sobre silencio quedaba en −30 LUFS.
let measured = await measureLufs(out);
if (measured.i !== null) {
  const delta = Number(lufs) - measured.i;
  if (Math.abs(delta) > 0.4) {
    const normalized = `${out}.norm.wav`;
    const gain = Math.max(-24, Math.min(24, delta));
    await runFfmpeg([
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      out,
      "-af",
      `volume=${gain.toFixed(2)}dB,alimiter=limit=0.891:level=false`,
      "-ar",
      "48000",
      "-c:a",
      "pcm_s16le",
      "-t",
      String(total),
      normalized,
    ]);
    fs.renameSync(normalized, out);
    measured = await measureLufs(out);
  }
}

if (bedPath && fs.existsSync(bedPath)) {
  try {
    fs.rmSync(bedPath, { force: true });
  } catch {
    /* queda el temporal, no rompe la mezcla */
  }
}

// Ficha de la música: sin licencia no se puede afirmar que sea usable.
let musicInfo = null;
if (musicFile) {
  const license = musicLicense || null;
  musicInfo = {
    file: path.basename(path.resolve(musicFile)),
    license,
    source: musicSource || null,
    status: license ? "declarada" : "sin-verificar",
    gainDb: musicDb,
    recordedAt: new Date().toISOString().slice(0, 10),
  };
  fs.writeFileSync(
    path.join(path.dirname(out), "music.json"),
    `${JSON.stringify(musicInfo, null, 2)}\n`,
    "utf8"
  );
}

console.log(
  JSON.stringify(
    {
      ok: true,
      out,
      voices: voices.length,
      sfx: sfx.length,
      music: musicFile ? path.resolve(musicFile) : null,
      musicLicense: musicInfo?.license ?? null,
      musicStatus: musicInfo?.status ?? null,
      musicDb,
      lufsTarget: Number(lufs),
      lufsMeasured: measured?.i ?? null,
      seconds: total,
      sizeMb: Number((fs.statSync(out).size / (1024 * 1024)).toFixed(2)),
    },
    null,
    2
  )
);
