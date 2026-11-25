#!/usr/bin/env node
/**
 * Exporta una timeline editable para terminarla en DaVinci, Premiere o similar.
 *
 *   node timeline.mjs --project video-projects/<slug> --format otio
 *   node timeline.mjs --project video-projects/<slug> --format fcpxml
 *   node timeline.mjs --project video-projects/<slug> --format edl
 *
 * Pone el render como V1 y, si existen, la voz y la música como pistas aparte
 * (A1/A2) para poder reemplazar el audio sin rehacer la composición.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : def;
};

const project = resolve(arg("project", "."));
const format = String(arg("format", "otio")).toLowerCase();
const style = readJson(join(project, "style.json")) ?? {};
const cue = readJson(join(project, "cue-sheet.json")) ?? {};
const tracks = readJson(join(project, "audio", "tracks.json")) ?? {};
const video = join(project, "renders", "final.mp4");

if (!existsSync(video)) fail(`falta el render: ${video}`);

const fps = Number(style.format?.fps ?? cue.meta?.fps ?? 30);
const width = Number(style.format?.resolution?.[0] ?? 1080);
const height = Number(style.format?.resolution?.[1] ?? 1920);
const duration = Number(cue.meta?.durationSeconds ?? 0) || probe(video).duration;
const slug = basename(project);

const beats = Array.isArray(cue.beats) ? cue.beats : [];
const voice = beats
  .filter((beat) => beat?.voice?.audio)
  .map((beat) => ({ at: Number(beat.time ?? 0), file: resolve(project, beat.voice.audio) }))
  .filter((cue) => existsSync(cue.file));
const musicFile = tracks.music?.file ? resolve(project, tracks.music.file) : null;

const outPath = resolve(arg("out", join(project, "renders", `timeline.${format}`)));
mkdirSync(dirname(outPath), { recursive: true });

if (format === "otio") writeFileSync(outPath, `${JSON.stringify(otio(), null, 2)}\n`, "utf8");
else if (format === "fcpxml") writeFileSync(outPath, fcpxml(), "utf8");
else if (format === "edl") writeFileSync(outPath, edl(), "utf8");
else fail(`formato no soportado: ${format} (otio, fcpxml, edl)`);

console.log(JSON.stringify({
  ok: true,
  out: outPath,
  format,
  duration,
  fps,
  size: [width, height],
  tracks: { V1: 1, A1: voice.length, A2: musicFile ? 1 : 0 },
}, null, 2));

function otio() {
  const rate = fps;
  const time = (value) => ({ OTIO_SCHEMA: "RationalTime.1", value: Math.round(value * rate), rate });
  const range = (start, dur) => ({ OTIO_SCHEMA: "TimeRange.1", start_time: time(start), duration: time(dur) });
  const external = (file) => ({
    OTIO_SCHEMA: "ExternalReference.1",
    target_url: pathToFileURL(file).href,
    available_range: range(0, probe(file).duration),
  });
  const clip = (name, file, start, dur) => ({
    OTIO_SCHEMA: "Clip.2",
    name,
    source_range: range(start, dur),
    media_reference: external(file),
  });
  const gap = (dur) => (dur <= 0 ? null : { OTIO_SCHEMA: "Gap.1", source_range: range(0, dur) });
  const track = (name, kind, children) => ({
    OTIO_SCHEMA: "Track.1",
    name,
    kind,
    metadata: {},
    children,
  });

  const videoTrack = track("V1", "Video", [clip(slug, video, 0, duration)]);

  const audioChildren = [];
  let cursor = 0;
  for (const cue of voice) {
    const silence = gap(cue.at - cursor);
    if (silence) audioChildren.push(silence);
    const voiceDuration = probe(cue.file).duration;
    audioChildren.push(clip(basename(cue.file), cue.file, 0, voiceDuration));
    cursor = cue.at + voiceDuration;
  }
  if (audioChildren.length === 0 && musicFile) {
    audioChildren.push(clip(basename(musicFile), musicFile, 0, duration));
  }

  return {
    OTIO_SCHEMA: "Timeline.1",
    name: slug,
    global_start_time: null,
    metadata: { fps, size: [width, height] },
    tracks: {
      OTIO_SCHEMA: "Stack.1",
      name: "stack",
      metadata: {},
      children: audioChildren.length ? [videoTrack, track("A1", "Audio", audioChildren)] : [videoTrack],
    },
  };
}

function fcpxml() {
  const frames = Math.round(duration * fps);
  const assetId = "r2";
  const assets = [
    `<asset id="${assetId}" name="${escapeXml(slug)}" src="${pathToFileURL(video).href}" start="0s" duration="${frames}/${fps}s" hasVideo="1" hasAudio="1" format="r1"/>`,
  ];
  const clips = [`<asset-clip ref="${assetId}" offset="0s" duration="${frames}/${fps}s" start="0s"/>`];

  const voiceAssets = [];
  voice.forEach((cue, index) => {
    const id = `r${index + 3}`;
    const frames = Math.round(probe(cue.file).duration * fps);
    voiceAssets.push(
      `<asset id="${id}" name="${escapeXml(basename(cue.file))}" src="${pathToFileURL(cue.file).href}" start="0s" duration="${frames}/${fps}s" hasAudio="1" format="r1"/>`
    );
    const offset = Math.round(cue.at * fps);
    clips.push(
      `<asset-clip ref="${id}" lane="-1" offset="${offset}/${fps}s" duration="${frames}/${fps}s" start="0s" audioRole="dialogue"/>`
    );
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources>
    <format id="r1" name="FFVideoFormat${width}x${height}p${Math.round(fps)}" frameDuration="1/${fps}s" width="${width}" height="${height}"/>
    ${[...assets, ...voiceAssets].join("\n    ")}
  </resources>
  <library>
    <event name="Entrega">
      <project name="${escapeXml(slug)}">
        <sequence format="r1" duration="${frames}/${fps}s" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
          <spine>
            ${clips.join("\n            ")}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
}

function edl() {
  const timecode = (seconds) => {
    const total = Math.round(seconds * fps);
    const frames = total % Math.round(fps);
    const totalSeconds = Math.floor(total / fps);
    const ss = totalSeconds % 60;
    const mm = Math.floor(totalSeconds / 60) % 60;
    const hh = Math.floor(totalSeconds / 3600);
    return [hh, mm, ss, frames].map((value) => String(value).padStart(2, "0")).join(":");
  };
  return `TITLE: ${slug}
FCM: NON-DROP FRAME

001  AX       V     C        ${timecode(0)} ${timecode(duration)} ${timecode(0)} ${timecode(duration)}
* FROM CLIP NAME: final.mp4
`;
}

function probe(file) {
  const result = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
  return { duration: Number(result.stdout.trim()) || 0 };
}

function readJson(file) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

function escapeXml(text) {
  return String(text).replace(/[<>&"']/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[char]));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
