#!/usr/bin/env node
/**
 * Prepara la entrega de un video por plataforma: variantes de aspecto,
 * portada y manifiesto con lo que se sube a cada lado.
 *
 *   node deliver.mjs --project video-projects/<slug>
 *   node deliver.mjs --project video-projects/<slug> --platforms reels,feed,square,wide
 *
 * Salida: renders/delivery/
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const PRESETS = {
  reels: { size: [1080, 1920], label: "Reels / Shorts / TikTok", ratio: "9:16" },
  tiktok: { size: [1080, 1920], label: "TikTok", ratio: "9:16" },
  shorts: { size: [1080, 1920], label: "YouTube Shorts", ratio: "9:16" },
  feed: { size: [1080, 1350], label: "Feed vertical (Instagram)", ratio: "4:5" },
  square: { size: [1080, 1080], label: "Cuadrado", ratio: "1:1" },
  wide: { size: [1920, 1080], label: "Horizontal", ratio: "16:9" },
};

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : def;
};

const project = resolve(arg("project", "."));
const slug = basename(project);
const video = join(project, "renders", "final.mp4");
const outDir = resolve(project, arg("out", join("renders", "delivery")));
const wanted = String(arg("platforms", "reels,feed,square,wide"))
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

if (!existsSync(video)) fail(`falta el render: ${video}`);
for (const preset of wanted) if (!PRESETS[preset]) fail(`plataforma desconocida: ${preset}`);

const source = probe(video);
const style = readJson(join(project, "style.json")) ?? {};
const qaReport = readJson(join(project, "qa", "report.json"));
const subtitles = findSubtitles(project);

mkdirSync(outDir, { recursive: true });

const files = [];
for (const preset of wanted) {
  const [width, height] = PRESETS[preset].size;
  const target = join(outDir, `${slug}-${preset}.mp4`);
  const sameShape = source.width === width && source.height === height;
  const sourceRatio = source.width / source.height;
  const targetRatio = width / height;
  // Si el destino es más ancho que el original vertical, recortar se come el
  // texto: se conserva el cuadro completo con fondo desenfocado.
  const useBlur = !sameShape && sourceRatio < 1 && targetRatio > sourceRatio * 1.05;

  if (sameShape) {
    copyFileSync(video, target);
  } else {
    const graph = useBlur
      ? `[0:v]split=2[bg][fg];` +
        `[bg]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=28:2,eq=brightness=-0.22[back];` +
        `[fg]scale=${width}:${height}:force_original_aspect_ratio=decrease[front];` +
        `[back][front]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[v]`
      : `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,` +
        `crop=${width}:${height},setsar=1,format=yuv420p[v]`;
    run([
      "-i", video,
      "-filter_complex", graph,
      "-map", "[v]", "-map", "0:a?",
      "-c:v", "libx264", "-preset", "medium", "-crf", "19",
      "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", target,
    ]);
  }

  // portada del tamaño de la variante (si es vertical se usa el still diseñado)
  const cover = join(outDir, `${slug}-${preset}-cover.jpg`);
  const still = join(project, "qa", "still.png");
  if (sameShape && existsSync(still)) {
    run(["-i", still, "-frames:v", "1", "-q:v", "2", cover]);
  } else {
    run(["-ss", "1.5", "-i", target, "-frames:v", "1", "-q:v", "2", cover]);
  }

  const info = probe(target);
  files.push({
    platform: preset,
    label: PRESETS[preset].label,
    ratio: PRESETS[preset].ratio,
    file: target,
    cover,
    size: [info.width, info.height],
    duration: info.duration,
    audio: info.hasAudio,
    bytes: statSync(target).size,
  });
}

const manifest = {
  ok: files.every((file) => file.audio && Math.abs(file.duration - source.duration) <= 0.2),
  project,
  slug,
  source: { file: video, size: [source.width, source.height], duration: source.duration },
  loudness: qaReport?.metrics?.loudness ?? null,
  style: { engine: style.meta?.engine ?? null, aspect: style.format?.aspect ?? null },
  subtitles: subtitles.map((file) => basename(file)),
  files,
};

writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
writeFileSync(join(outDir, "README.md"), readme(manifest), "utf8");

console.log(JSON.stringify(manifest, null, 2));
process.exit(manifest.ok ? 0 : 1);

function readme(data) {
  const rows = data.files
    .map(
      (file) =>
        `| ${file.label} | \`${basename(file.file)}\` | ${file.ratio} · ${file.size[0]}×${file.size[1]} | \`${basename(file.cover)}\` |`
    )
    .join("\n");
  return `# Entrega — ${data.slug}

Origen: \`${data.source.file}\` (${data.source.size[0]}×${data.source.size[1]}, ${data.source.duration.toFixed(2)} s).

| Destino | Video | Formato | Portada |
|---|---|---|---|
${rows}

${data.subtitles.length ? `Subtítulos: ${data.subtitles.map((file) => `\`${file}\``).join(", ")}` : "Sin subtítulos en el proyecto."}

- Loudness del render: ${data.loudness ?? "sin dato"} LUFS.
- El manifiesto completo está en \`manifest.json\`.
- Si una plataforma pide otro corte, se agrega un preset en \`video-entrega/scripts/deliver.mjs\`.
`;
}

function findSubtitles(root) {
  const found = [];
  for (const dir of [root, join(root, "renders"), join(root, "subtitles")]) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (name.toLowerCase().endsWith(".srt")) found.push(join(dir, name));
    }
  }
  return [...new Set(found)];
}

function probe(file) {
  const result = spawnSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height",
    "-of", "json", file,
  ], { encoding: "utf8" });
  const data = JSON.parse(result.stdout || "{}");
  const streams = data.streams ?? [];
  const videoStream = streams.find((stream) => stream.width) ?? {};
  return {
    duration: Number(data.format?.duration ?? 0),
    width: Number(videoStream.width ?? 0),
    height: Number(videoStream.height ?? 0),
    hasAudio: streams.some((stream) => stream.codec_type === "audio"),
  };
}

function readJson(file) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

function run(args) {
  const result = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], { encoding: "utf8" });
  if (result.status !== 0) fail(`ffmpeg falló: ${(result.stderr ?? "").trim().split("\n").slice(-3).join(" | ")}`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
