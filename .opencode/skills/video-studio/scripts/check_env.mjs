#!/usr/bin/env node
/**
 * Verifica las herramientas del pipeline de video local.
 *
 * Usage:
 *   node .opencode/skills/video-studio/scripts/check_env.mjs
 *
 * No instala nada. `coreReady` cubre render y medición; `fullReady` agrega
 * subtítulos, assets y voz rápida.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const checks = [
  { name: "ffmpeg", command: "ffmpeg", args: ["-version"], core: true, hint: "winget install Gyan.FFmpeg" },
  { name: "ffprobe", command: "ffprobe", args: ["-version"], core: true, hint: "winget install Gyan.FFmpeg" },
  { name: "node", command: "node", args: ["--version"], core: true, hint: "winget install OpenJS.NodeJS.LTS" },
  { name: "npm", command: "npm", args: ["--version"], shell: true, core: true, hint: "winget install OpenJS.NodeJS.LTS" },
  { name: "whisper", command: "whisper-cli", args: ["--help"], alt: { command: "main", args: ["--help"] }, fallbackPath: () => join(process.env.LOCALAPPDATA ?? "", "openwork-tts", "whisper", "bin", "main.exe"), core: false, hint: "whisper-bin-x64.zip de whisper.cpp (v1.6 usa main.exe) + ggml-base.bin" },
  { name: "resvg", command: "resvg", args: ["--version"], fallbackPath: () => join(process.env.USERPROFILE ?? "", ".cargo", "bin", "resvg.exe"), core: false, hint: "cargo install resvg --locked o resvg.exe de GitHub Releases" },
  { name: "vtracer", command: "python", args: ["-c", "import vtracer"], core: false, hint: "pip install vtracer" },
  { name: "rembg", command: "rembg", args: ["--version"], fallbackPath: () => join(process.env.LOCALAPPDATA ?? "", "openwork-tts", "rembg-venv", "Scripts", "rembg.exe"), core: false, hint: 'pip install "rembg[cpu,cli]" (usar -m u2net)' },
  { name: "kokoro", command: "python", args: ["-c", "import kokoro_onnx"], core: false, hint: "pip install kokoro-onnx soundfile + modelos onnx/bin" },
  { name: "sdcpp", command: "sd", args: ["--help"], core: false, hint: "stable-diffusion.cpp (opcional, CPU lento)" },
];

function attempt(command, args, shell = false) {
  const result = spawnSync(command, args, {
    shell,
    encoding: "utf8",
    timeout: 20_000,
    windowsHide: true,
  });
  return result.status === 0;
}

function available(check) {
  if (attempt(check.command, check.args, check.shell)) return true;
  if (check.alt && attempt(check.alt.command, check.alt.args, check.alt.shell)) return true;
  if (typeof check.fallbackPath === "function") {
    const path = check.fallbackPath();
    if (path && existsSync(path)) return true;
  }
  return false;
}

const results = checks.map((check) => {
  const ok = available(check);
  return {
    name: check.name,
    ok,
    core: check.core,
    hint: ok ? undefined : check.hint,
  };
});

const coreReady = results.filter((entry) => entry.core).every((entry) => entry.ok);
const fullReady = results.every((entry) => entry.ok);

console.log(JSON.stringify({
  ok: coreReady,
  coreReady,
  fullReady,
  missing: results.filter((entry) => !entry.ok).map((entry) => entry.name),
  results,
}, null, 2));

process.exit(coreReady ? 0 : 1);
