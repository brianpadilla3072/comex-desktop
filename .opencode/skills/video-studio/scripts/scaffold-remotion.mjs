#!/usr/bin/env node
/**
 * Copia el starter de Remotion dentro de un proyecto de video.
 *
 * Usage:
 *   node scaffold-remotion.mjs video-projects/<slug> [--force]
 *
 * No instala dependencias: imprime el comando siguiente.
 */
import { cpSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const starter = resolve(scriptDir, "..", "templates", "remotion-starter");
const args = process.argv.slice(2);
const project = args.find((arg) => !arg.startsWith("--"));
const force = args.includes("--force");

if (!project) {
  console.error("Uso: node scaffold-remotion.mjs <carpeta-proyecto> [--force]");
  process.exit(1);
}

const root = resolve(project);
for (const required of ["style.json", "cue-sheet.json"]) {
  if (!existsSync(join(root, required))) {
    console.error(`Falta ${required} en ${root}. Corré init-project.mjs y video-inspiracion primero.`);
    process.exit(1);
  }
}

const target = join(root, "remotion");
cpSync(starter, target, { recursive: true, force, errorOnExist: false });
console.log(JSON.stringify({
  ok: true,
  target,
  next: [
    `cd "${target}"`,
    "npm install",
    "npm run still",
    "npm run render",
  ],
}, null, 2));
