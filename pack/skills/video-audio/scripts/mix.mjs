#!/usr/bin/env node
/**
 * Mezcla de audio independiente del motor de video.
 *
 *   node mix.mjs --project video-projects/<slug> [--tracks audio/tracks.json]
 *                [--out assets/audio/mix.wav] [--keep-stems]
 *
 * Lee un contrato (`audio/tracks.json`) con líneas de voz, música y SFX y
 * escribe una mezcla normalizada. No depende de HyperFrames ni de Remotion:
 * cualquier motor consume el mismo `mix.wav`.
 *
 * Pasos (cada uno es un ffmpeg aparte, para poder diagnosticar):
 *   1. voz   → líneas con retardo, sin silencio de cola
 *   2. música → loop hasta la duración, con ducking por sidechain de la voz
 *   3. SFX   → eventos puntuales
 *   4. mezcla → amix + loudnorm (I=-16, TP=-1.5)
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : def;
};
const flag = (name) => argv.includes(`--${name}`);

const projectArg = arg("project", ".");
const project = resolve(projectArg);
const tracksPath = resolve(project, arg("tracks", "audio/tracks.json"));
const outPath = resolve(project, arg("out", "assets/audio/mix.wav"));
const tmpDir = join(project, "assets", "audio", ".mix-tmp");

if (!existsSync(tracksPath)) {
  fail(`no encuentro ${tracksPath}. Copiá la plantilla de video-audio/templates/tracks.json.`);
}

const tracks = readJson(tracksPath);
const duration = Number(tracks.duration ?? 0);
if (!duration) fail("tracks.json necesita duration (segundos)");

const target = Number(tracks.loudness?.target ?? -16);
const truePeak = Number(tracks.loudness?.truePeak ?? -1.5);

const lines = (tracks.lines ?? []).map((line, index) => ({
  ...line,
  index,
  file: resolve(project, line.file),
  at: Number(line.at ?? 0),
  gainDb: Number(line.gainDb ?? tracks.voice?.gainDb ?? 0),
}));
for (const line of lines) {
  if (!existsSync(line.file)) fail(`falta la voz ${line.file}`);
}

const music = tracks.music?.file ? { ...tracks.music, file: resolve(project, tracks.music.file) } : null;
if (music && !existsSync(music.file)) fail(`falta la música ${music.file}`);

const sfx = (tracks.sfx ?? []).map((cue) => ({
  ...cue,
  file: resolve(project, cue.file),
  at: Number(cue.at ?? 0),
  gainDb: Number(cue.gainDb ?? 0),
}));
for (const cue of sfx) {
  if (!existsSync(cue.file)) fail(`falta el SFX ${cue.file}`);
}

mkdirSync(tmpDir, { recursive: true });
mkdirSync(dirname(outPath), { recursive: true });

const voiceWav = join(tmpDir, "voice.wav");
const musicWav = join(tmpDir, "music.wav");
const sfxWav = join(tmpDir, "sfx.wav");

// 1 · voz
if (lines.length === 0) {
  runFfmpeg(["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", String(duration), "-c:a", "pcm_s16le", voiceWav]);
} else {
  const args = [];
  for (const line of lines) args.push("-i", line.file);
  const trim = tracks.voice?.trimSilence === false
    ? ""
    : "silenceremove=start_periods=1:start_duration=0.02:start_threshold=-45dB," +
      "areverse,silenceremove=start_periods=1:start_duration=0.02:start_threshold=-45dB,areverse,";
  const filters = lines.map((line) => {
    const delay = Math.round(line.at * 1000);
    return `[${line.index}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,${trim}volume=${line.gainDb}dB,adelay=${delay}|${delay}[v${line.index}]`;
  });
  const mixIn = lines.map((line) => `[v${line.index}]`).join("");
  const graph = `${filters.join(";")};${mixIn}amix=inputs=${lines.length}:normalize=0:dropout_transition=0[voice]`;
  args.push("-filter_complex", graph, "-map", "[voice]", "-c:a", "pcm_s16le", voiceWav);
  runFfmpeg(args);
}

// 2 · música (+ ducking contra la voz)
if (!music) {
  runFfmpeg(["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", String(duration), "-c:a", "pcm_s16le", musicWav]);
} else {
  const gain = Number(music.gainDb ?? -18);
  const duck = music.duck?.enabled !== false;
  const base = `aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:${duration},asetpts=N/SR/TB,volume=${gain}dB,apad=whole_dur=${duration}`;
  if (duck) {
    const threshold = Number(music.duck?.threshold ?? 0.05);
    const ratio = Number(music.duck?.ratio ?? 8);
    const attack = Number(music.duck?.attack ?? 15);
    const release = Number(music.duck?.release ?? 400);
    runFfmpeg([
      "-stream_loop", "-1", "-i", music.file,
      "-i", voiceWav,
      "-filter_complex",
      `[0:a]${base}[mus];[1:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad=whole_dur=${duration}[sc];` +
        `[mus][sc]sidechaincompress=threshold=${threshold}:ratio=${ratio}:attack=${attack}:release=${release}[ducked]`,
      "-map", "[ducked]", "-c:a", "pcm_s16le", musicWav,
    ]);
  } else {
    runFfmpeg(["-stream_loop", "-1", "-i", music.file, "-filter_complex", `[0:a]${base}[mus]`, "-map", "[mus]", "-c:a", "pcm_s16le", musicWav]);
  }
}

// 3 · SFX
if (sfx.length === 0) {
  runFfmpeg(["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", String(duration), "-c:a", "pcm_s16le", sfxWav]);
} else {
  const args = [];
  for (const cue of sfx) args.push("-i", cue.file);
  const filters = sfx.map((cue) => {
    const delay = Math.round(cue.at * 1000);
    return `[${cue.index ?? sfx.indexOf(cue)}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${cue.gainDb}dB,adelay=${delay}|${delay}[s${sfx.indexOf(cue)}]`;
  });
  const mixIn = sfx.map((_, index) => `[s${index}]`).join("");
  const graph = `${filters.join(";")};${mixIn}amix=inputs=${sfx.length}:normalize=0:dropout_transition=0[sfx]`;
  args.push("-filter_complex", graph, "-map", "[sfx]", "-c:a", "pcm_s16le", sfxWav);
  runFfmpeg(args);
}

// 4 · mezcla final
runFfmpeg([
  "-i", voiceWav,
  "-i", musicWav,
  "-i", sfxWav,
  "-filter_complex",
  `[0:a]volume=1[vo];[1:a]volume=1[mu];[2:a]volume=1[fx];` +
    `[vo][mu][fx]amix=inputs=3:normalize=0:dropout_transition=0,` +
    `apad=whole_dur=${duration},atrim=0:${duration},` +
    `loudnorm=I=${target}:TP=${truePeak}:LRA=11[out]`,
  "-map", "[out]", "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", outPath,
]);

const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "json", outPath], { encoding: "utf8" });
const outDuration = Number(JSON.parse(probe.stdout || "{}").format?.duration ?? 0);
const report = {
  ok: true,
  out: outPath,
  duration: Number(outDuration.toFixed(3)),
  plan: duration,
  bytes: statSync(outPath).size,
  loudnessTarget: { integrated: target, truePeak },
  stems: { voice: lines.length, music: music ? music.file : null, sfx: sfx.length },
};

if (flag("keep-stems")) {
  mkdirSync(join(project, "assets", "audio", "stems"), { recursive: true });
  for (const [name, file] of [["voice", voiceWav], ["music", musicWav], ["sfx", sfxWav]]) {
    runFfmpeg(["-y", "-i", file, "-c:a", "pcm_s16le", join(project, "assets", "audio", "stems", `${name}.wav`)]);
  }
  report.stemsDir = join(project, "assets", "audio", "stems");
}

mkdirSync(join(project, "qa"), { recursive: true });
writeFileSync(join(project, "qa", "audio-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (!flag("keep-stems")) rmSync(tmpDir, { recursive: true, force: true });

console.log(JSON.stringify(report, null, 2));

function runFfmpeg(args) {
  const result = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], { encoding: "utf8" });
  if (result.status !== 0) {
    const tail = (result.stderr ?? "").trim().split("\n").slice(-4).join(" | ");
    fail(`ffmpeg falló: ${tail}`);
  }
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function fail(message) {
  console.error(message);
  rmSync(tmpDir, { recursive: true, force: true });
  process.exit(1);
}
