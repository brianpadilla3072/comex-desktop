#!/usr/bin/env node
/**
 * QA de un render: duración, formato, loudness, cortes/min y SFX/min.
 *
 * Usage:
 *   node .opencode/skills/video-studio/scripts/render_qa.mjs video-projects/<slug>
 *
 * Escribe qa/report.json y qa/report.md. Sale con 1 si hay bloqueantes.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const wingetLinks = join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WinGet", "Links");
if (existsSync(wingetLinks)) process.env.PATH = `${wingetLinks};${process.env.PATH ?? ""}`;

const project = resolve(process.argv[2] ?? ".");
const render = join(project, "renders", "final.mp4");
const checks = [];

function check(name, ok, detail, blocker = false) {
  checks.push({ name, ok: Boolean(ok), detail, blocker });
}

function readJson(relative) {
  const path = join(project, relative);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

function lastNumber(pattern, text) {
  let value = null;
  for (const match of text.matchAll(pattern)) value = Number(match[1]);
  return value;
}

if (!existsSync(render) || statSync(render).size === 0) {
  check("render", false, "Falta renders/final.mp4", true);
  finish();
}

const probe = spawnSync("ffprobe", [
  "-v", "error", "-show_entries",
  "format=duration,size:stream=width,height,r_frame_rate,codec_name",
  "-of", "json", render,
], { encoding: "utf8" });
if (probe.status !== 0) {
  check("ffprobe", false, probe.stderr.trim().split("\n").pop() ?? "ffprobe falló", true);
  finish();
}
const info = JSON.parse(probe.stdout || "{}");
const format = info.format ?? {};
const stream = (info.streams ?? [])[0] ?? {};
const actualDuration = Number(format.duration ?? 0);
const fps = (() => {
  const raw = String(stream.r_frame_rate ?? "");
  if (!raw.includes("/")) return Number(raw) || null;
  const [n, d] = raw.split("/").map(Number);
  return d ? Math.round((n / d) * 100) / 100 : null;
})();
check("render", true, `${actualDuration.toFixed(3)} s, ${stream.width}x${stream.height}, ${stream.codec_name}`);
check("formato", stream.codec_name === "h264", `codec ${stream.codec_name ?? "?"}`, false);

const ebu = spawnSync("ffmpeg", [
  "-hide_banner", "-nostats", "-i", render, "-af", "ebur128=peak=true", "-f", "null", "-",
], { encoding: "utf8" });
const loudness = lastNumber(/I:\s*(-?\d+(?:\.\d+)?) LUFS/g, ebu.stderr ?? "");
const peak = lastNumber(/Peak:\s*(-?\d+(?:\.\d+)?) dBFS/g, ebu.stderr ?? "");
check("loudness", loudness !== null && loudness >= -24 && loudness <= -10, `${loudness ?? "?"} LUFS (objetivo voz -16)`, false);
check("truePeak", peak !== null && peak <= -1, `${peak ?? "?"} dBFS (máx -1)`, false);

const style = readJson("style.json");
const cue = readJson("cue-sheet.json");
const planned = Number(cue?.meta?.durationSeconds ?? 0);
check("duración", !planned || Math.abs(actualDuration - planned) <= 1, `plan ${planned.toFixed(2)} s, real ${actualDuration.toFixed(2)} s`, !planned ? false : Math.abs(actualDuration - planned) > 1);

const beats = Array.isArray(cue?.beats) ? cue.beats : [];
const cuts = Math.max(0, beats.length - 1);
const cutsPerMinute = actualDuration ? Math.round((cuts / actualDuration) * 60 * 10) / 10 : 0;
const targetCuts = Number(style?.motion?.cutsPerMinute ?? 0);
const cutsOk = !targetCuts || Math.abs(cutsPerMinute - targetCuts) <= Math.max(2, targetCuts * 0.2);
check("cortes/min", cutsOk, `${cutsPerMinute} real vs ${targetCuts} objetivo`, false);

const sfxCount = beats.reduce((total, beat) => total + (Array.isArray(beat?.sfx) ? beat.sfx.length : 0), 0);
const sfxPerMinute = actualDuration ? Math.round((sfxCount / actualDuration) * 60 * 10) / 10 : 0;
const targetSfx = Number(style?.audio?.sfxDensityPerMinute ?? 0);
const sfxOk = !targetSfx || Math.abs(sfxPerMinute - targetSfx) <= Math.max(2, targetSfx * 0.25);
check("SFX/min", sfxOk, `${sfxPerMinute} real vs ${targetSfx} objetivo`, false);

const hookSeconds = Number(style?.attention?.hookSeconds ?? 0);
const firstText = beats.find((beat) => beat?.text);
check("hook", !hookSeconds || (firstText && Number(firstText.time) <= hookSeconds), firstText ? `primer texto en ${firstText.time}s (hook ${hookSeconds}s)` : "sin texto en el hook", false);

finish();

function finish() {
  const blockers = checks.filter((entry) => entry.blocker && !entry.ok);
  const report = {
    ok: blockers.length === 0,
    project,
    render: existsSync(render) ? render : null,
    metrics: { actualDuration, fps, loudness, peak, cutsPerMinute, sfxPerMinute },
    blockers: blockers.map((entry) => entry.name),
    checks,
  };
  const qaDir = join(project, "qa");
  mkdirSync(qaDir, { recursive: true });
  writeFileSync(join(qaDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const rows = checks.map((entry) => `| ${entry.name} | ${entry.ok ? "OK" : entry.blocker ? "BLOQUEANTE" : "aviso"} | ${entry.detail} |`).join("\n");
  const md = [
    "# QA del render",
    "",
    `- Proyecto: \`${project}\``,
    `- Render: \`${render}\``,
    `- Duración real: ${actualDuration.toFixed(3)} s`,
    `- fps: ${fps ?? "?"}`,
    `- Loudness: ${loudness ?? "?"} LUFS; true peak: ${peak ?? "?"} dBFS`,
    `- Cortes/min: ${cutsPerMinute}; SFX/min: ${sfxPerMinute}`,
    "",
    "| Check | Estado | Detalle |",
    "|---|---|---|",
    rows,
    "",
  ].join("\n");
  writeFileSync(join(qaDir, "report.md"), md, "utf8");
  console.log(JSON.stringify(report, null, 2));
  process.exit(blockers.length === 0 ? 0 : 1);
}
