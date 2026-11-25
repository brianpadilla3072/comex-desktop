#!/usr/bin/env node
/**
 * Crea el esqueleto de un proyecto de video.
 *
 * Usage:
 *   node init-project.mjs <slug> [--dir <carpeta>] [--force]
 *
 * Por defecto crea video-projects/<slug> desde el cwd.
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const templates = resolve(scriptDir, "..", "templates");
const args = process.argv.slice(2);
const slug = args.find((arg) => !arg.startsWith("--"));
const dirFlag = args.indexOf("--dir");
const force = args.includes("--force");

if (!slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
  console.error("Uso: node init-project.mjs <slug-en-kebab> [--dir <carpeta>] [--force]");
  process.exit(1);
}

const root = dirFlag >= 0 && args[dirFlag + 1]
  ? resolve(args[dirFlag + 1])
  : resolve(process.cwd(), "video-projects", slug);

const dirs = [
  "inspiracion/refs",
  "inspiracion/frames",
  "assets/2d",
  "assets/3d",
  "assets/audio",
  "assets/fonts",
  "remotion",
  "renders",
  "qa",
];
for (const dir of dirs) mkdirSync(join(root, dir), { recursive: true });

const files = new Map();
files.set("brief.md", join(templates, "brief.md"));
files.set("storyboard.md", join(templates, "storyboard.md"));
files.set("style.schema.json", join(templates, "style.schema.json"));
files.set("cue-sheet.schema.json", join(templates, "cue-sheet.schema.json"));

const created = [];
const skipped = [];
for (const [name, source] of files) {
  const target = join(root, name);
  if (existsSync(target) && !force) {
    skipped.push(name);
    continue;
  }
  copyFileSync(source, target);
  created.push(name);
}

const generated = {
  "cue-sheet.json": {
    meta: { slug, durationSeconds: 0, fps: 30, aspect: "16:9" },
    beats: [],
  },
  "assets/manifest.json": { assets: [] },
  "inspiracion/metrics.json": { refs: [] },
};
for (const [name, value] of Object.entries(generated)) {
  const target = join(root, name);
  if (existsSync(target) && !force) {
    skipped.push(name);
    continue;
  }
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  created.push(name);
}

console.log(JSON.stringify({
  ok: true,
  root,
  created,
  skipped,
  next: [
    "Completá brief.md",
    "Poné las referencias en inspiracion/refs/ y usá video-inspiracion",
    "Cargá video-inspiracion; no sigas sin style.json",
  ],
}, null, 2));
