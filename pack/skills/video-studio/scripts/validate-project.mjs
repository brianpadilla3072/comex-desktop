#!/usr/bin/env node
/**
 * Verifica los gates de un proyecto de video.
 *
 * Usage:
 *   node validate-project.mjs video-projects/<slug>
 *
 * Sale con 1 si falla un gate obligatorio. `renders/final.mp4` y
 * `qa/report.md` se informan como opcionales.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

const target = process.argv[2];
if (!target) {
  console.error("Uso: node validate-project.mjs <carpeta-del-proyecto>");
  process.exit(1);
}
const root = resolve(target);
const checks = [];

function check(name, ok, detail, required = true) {
  checks.push({ name, ok: Boolean(ok), detail, required });
}

function readJson(relative) {
  const path = join(root, relative);
  if (!existsSync(path)) return { path, exists: false, value: null };
  try {
    return { path, exists: true, value: JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")) };
  } catch (error) {
    return { path, exists: true, value: null, error: String(error) };
  }
}

function isText(relative, minLength) {
  const path = join(root, relative);
  if (!existsSync(path)) return false;
  try {
    return readFileSync(path, "utf8").trim().length >= minLength;
  } catch {
    return false;
  }
}

check("carpeta", existsSync(root), root);
check("brief.md", isText("brief.md", 80), "Brief con objetivo y audiencia");
check("storyboard.md", isText("storyboard.md", 80), "Storyboard con beats");

const style = readJson("style.json");
const styleRequired = ["meta", "palette", "typography", "motion", "audio", "attention"];
const styleOk = style.exists && style.value && styleRequired.every((key) => key in style.value);
check("style.json", styleOk, styleOk ? "style.json válido" : "Falta style.json o le faltan claves (paso video-inspiracion)");
if (styleOk) {
  const palette = style.value.palette;
  check("style.palette", Array.isArray(palette) && palette.length >= 3
    && palette.every((hex) => typeof hex === "string" && /^#[0-9a-fA-F]{6}$/.test(hex)), "3+ colores hex");
  const motion = style.value.motion;
  check("style.motion", motion && typeof motion.cutsPerMinute === "number"
    && typeof motion.patternInterruptSeconds === "number", "cutsPerMinute y patternInterruptSeconds");
  const attention = style.value.attention;
  check("style.attention", attention && typeof attention.hookSeconds === "number"
    && typeof attention.textPopMs === "number", "hookSeconds y textPopMs");
}

const cues = readJson("cue-sheet.json");
const beats = cues.value && Array.isArray(cues.value.beats) ? cues.value.beats : null;
check("cue-sheet.json", cues.exists && Array.isArray(beats), "meta + beats");
if (Array.isArray(beats)) {
  const bad = beats.filter((beat) => !beat || typeof beat.time !== "number" || !beat.scene);
  check("cue-sheet.beats", beats.length > 0 && bad.length === 0, `${beats.length} beats, ${bad.length} inválidos`);
  const missingVoice = beats.filter((beat) => {
    const audio = beat?.voice?.audio;
    if (!audio) return false;
    return !existsSync(isAbsolute(audio) ? audio : join(root, audio));
  });
  check("cue-sheet.voice", missingVoice.length === 0, `${missingVoice.length} audios de voz faltantes`);
}

const manifest = readJson("assets/manifest.json");
const assets = manifest.value && Array.isArray(manifest.value.assets) ? manifest.value.assets : null;
check("assets/manifest.json", manifest.exists && Array.isArray(assets), "assets: []");
if (Array.isArray(assets)) {
  const missing = assets.filter((asset) => {
    const path = asset?.path;
    if (!path) return false;
    return !existsSync(isAbsolute(path) ? path : join(root, path));
  });
  check("assets.paths", missing.length === 0, `${missing.length} assets faltantes`);
  const unlicensed = assets.filter((asset) => asset?.path && !asset?.license);
  check("assets.license", unlicensed.length === 0, `${unlicensed.length} sin licencia`);
}

const durations = readJson("assets/audio/voice/durations.json");
check("voz/durations.json", !durations.exists || Array.isArray(durations.value?.lines), "opcional hasta el paso de voz", false);

const renderPath = join(root, "renders", "final.mp4");
const renderOk = existsSync(renderPath) && statSync(renderPath).size > 0;
check("renders/final.mp4", renderOk, "opcional hasta el render", false);

const requiredFailures = checks.filter((entry) => entry.required && !entry.ok);
console.log(JSON.stringify({
  ok: requiredFailures.length === 0,
  root,
  failures: requiredFailures.map((entry) => entry.name),
  checks,
}, null, 2));
process.exit(requiredFailures.length === 0 ? 0 : 1);
