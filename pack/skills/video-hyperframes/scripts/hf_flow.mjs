#!/usr/bin/env node
/**
 * Orquestador: de `beats.json` a video con QA, en un comando.
 *
 *   node hf_flow.mjs --dir <proyecto> [--style style.json]
 *                    [--audio] [--music <archivo>] [--fps 30]
 *                    [--plan-sfx] [--words words.json] [--emphasize "a,b"]
 *                    [--musicLicense "texto"] [--musicSource "url"]
 *                    [--no-render] [--skip-mix]
 *
 * Pasos: genera la composición → valida el contrato → mezcla audio (opcional)
 * → renderiza → corre el QA del pack. Se detiene en el primer paso que falla.
 *
 * Requiere en el proyecto: `beats.json`. Para audio: `cue-sheet.json` y los
 * assets (o `--assets`/`--cue`).
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { resolveStyle } from "./style_path.mjs";

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const flag = (name) => argv.includes(`--${name}`);

const dirArg = arg("dir");
if (!dirArg) {
  console.log(
    "uso: node hf_flow.mjs --dir <proyecto> [--style style.json] [--audio] [--music <archivo>] [--fps 30] [--workers 4] [--plan-sfx] [--words words.json] [--emphasize a,b] [--no-render] [--skip-mix]"
  );
  process.exit(2);
}

const skillDir = path.resolve(import.meta.dirname, "..");
const project = path.resolve(dirArg);
const beats = path.join(project, "beats.json");
if (!fs.existsSync(beats)) {
  console.error(`No encuentro ${beats}`);
  process.exit(2);
}

const steps = [];
const run = (label, cmd, args) =>
  new Promise((resolve, reject) => {
    process.stderr.write(`\n▶ ${label}\n`);
    const child = spawn(cmd, args, { stdio: ["ignore", "inherit", "inherit"], cwd: process.cwd() });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        steps.push({ step: label, ok: true });
        resolve();
      } else {
        steps.push({ step: label, ok: false, code });
        reject(new Error(`${label} falló con código ${code}`));
      }
    });
  });

const node = process.execPath;
const script = (name) => path.join(skillDir, "scripts", name);

const fps = arg("fps", "30");
// --style acepta ruta o nombre de la biblioteca.
const style = resolveStyle(arg("style"), project) ?? path.join(project, "style.json");

try {
  // 1 · composición
  const genArgs = [script("hf_generate.mjs"), "--beats", beats, "--dir", project, "--force"];
  if (fs.existsSync(style)) genArgs.push("--style", style);
  await run("generar composición", node, genArgs);

  // 2 · contrato
  await run("validar contrato", node, [script("hf_check.mjs"), "--dir", project]);

  // 3 · tiempos por palabra (opcional: solo si hay voz)
  const cuePath = path.join(project, "cue-sheet.json");
  const wordsFile = path.resolve(arg("words", path.join(project, "words.json")));
  const wantsWords = flag("words") || flag("plan-sfx") || flag("transcribe");
  const hasCueSheet = fs.existsSync(cuePath);
  if (wantsWords && hasCueSheet && !fs.existsSync(wordsFile)) {
    const wordArgs = [script("hf_words.mjs"), "--dir", project, "--out", wordsFile];
    wordArgs.push("--cue", cuePath);
    if (arg("lang")) wordArgs.push("--lang", arg("lang"));
    await run("tiempos por palabra", node, wordArgs);
  }

  // 4 · plan de acentos (cortes + palabras)
  if (flag("plan-sfx")) {
    const planArgs = [script("hf_plan_sfx.mjs"), "--beats", beats];
    if (fs.existsSync(style)) planArgs.push("--style", style);
    if (fs.existsSync(wordsFile)) planArgs.push("--words", wordsFile);
    if (arg("emphasize")) planArgs.push("--emphasize", arg("emphasize"));
    await run("plan de acentos", node, planArgs);
  }

  // 5 · audio
  const wantsAudio =
    flag("audio") || Boolean(arg("music")) || flag("mix") || flag("plan-sfx");
  if (wantsAudio && !flag("skip-mix")) {
    const mixArgs = [script("hf_mix_audio.mjs"), "--dir", project];
    if (fs.existsSync(cuePath)) mixArgs.push("--cue", cuePath);
    if (arg("assets")) mixArgs.push("--assets", path.resolve(arg("assets")));
    if (arg("music")) {
      mixArgs.push("--music", path.resolve(arg("music")), "--musicDb", arg("musicDb", "-25"));
      if (arg("musicLicense")) mixArgs.push("--musicLicense", arg("musicLicense"));
      if (arg("musicSource")) mixArgs.push("--musicSource", arg("musicSource"));
    }
    await run("mezclar audio", node, mixArgs);
  }

  // 6 · render
  const audioFile = path.join(project, "assets", "audio", "mix.wav");
  const hasAudio = fs.existsSync(audioFile);
  const renderOut = path.join(project, "renders", "final.mp4");
  if (!flag("no-render")) {
    const startedAt = Date.now();
    const renderArgs = [
      script("hf_render.mjs"),
      "--dir", project,
      "--out", renderOut,
      "--fps", fps,
      "--format", "jpg",
      "--resume",
    ];
    if (hasAudio) renderArgs.push("--audio", audioFile);
    // Varios procesos de Chrome: la opción viene del flag o de HF_WORKERS.
    const workers = Number(arg("workers", process.env.HF_WORKERS ?? ""));
    if (Number.isFinite(workers) && workers > 1) renderArgs.push("--workers", String(workers));
    await run("renderizar", node, renderArgs);

    // Un render "exitoso" sin archivo nuevo no es un render.
    const stat = fs.existsSync(renderOut) ? fs.statSync(renderOut) : null;
    if (!stat || stat.size < 1024 || stat.mtimeMs < startedAt - 5000) {
      throw new Error(`el render no dejó un archivo nuevo en ${renderOut}`);
    }

    // 7 · QA del pack
    const qa = path.resolve(skillDir, "..", "video-studio", "scripts", "render_qa.mjs");
    if (fs.existsSync(qa)) {
      await run("QA", node, [qa, project]);
    } else {
      process.stderr.write("aviso: no encontré render_qa.mjs, salteo QA\n");
    }

    // 8 · still de portada para el panel de Video (miniatura + gate "Stills")
    const still = path.resolve(skillDir, "..", "video-studio", "scripts", "still.mjs");
    if (fs.existsSync(still)) {
      await run("still de portada", node, [still, "--project", project]);
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        project,
        audio: hasAudio,
        render: flag("no-render") ? null : path.join(project, "renders", "final.mp4"),
        steps,
      },
      null,
      2
    )
  );
} catch (err) {
  console.error(`\n[hf_flow] ${err.message}`);
  console.log(JSON.stringify({ ok: false, project, steps }, null, 2));
  process.exit(1);
}
