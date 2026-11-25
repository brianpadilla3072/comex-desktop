#!/usr/bin/env node
/**
 * Crea una composición HyperFrames lista para renderizar.
 *
 *   node hf_init.mjs --dir <carpeta> [--width 1080] [--height 1920]
 *                    [--duration 6] [--title "..."]
 *
 * Copia el template, las fuentes (Archivo Black e Inter), GSAP local y los
 * iconos de plataforma. No pisa una carpeta que ya tenga index.html.
 */
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};

const dirArg = arg("dir");
if (!dirArg) {
  console.log(
    "uso: node hf_init.mjs --dir <carpeta> [--width 1080] [--height 1920] [--duration 6] [--title \"...\"]"
  );
  process.exit(2);
}

const skillDir = path.resolve(import.meta.dirname, "..");
const target = path.resolve(dirArg);
const indexPath = path.join(target, "index.html");

if (fs.existsSync(indexPath)) {
  console.error(`Ya existe ${indexPath}: no lo piso.`);
  process.exit(1);
}

const width = Number(arg("width", 1080));
const height = Number(arg("height", 1920));
const duration = Number(arg("duration", 6));
const title = arg("title", "Composición HyperFrames");

const copyDir = (from, to) => {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, e.name);
    const dst = path.join(to, e.name);
    if (e.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
};

let html = fs.readFileSync(path.join(skillDir, "templates", "index.html"), "utf8");
html = html
  .replace(/data-width="\d+"/, `data-width="${width}"`)
  .replace(/data-height="\d+"/, `data-height="${height}"`)
  .replace(/data-duration="[\d.]+"/, `data-duration="${duration}"`)
  .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);

// el escenario y el push-in de cámara se ajustan a la duración pedida
html = html.replace(/width: 1080px;\s*\n\s*height: 1920px;/, `width: ${width}px;\n        height: ${height}px;`);
html = html.replace(/duration: 6, ease: "none"/g, `duration: ${duration}, ease: "none"`);

fs.mkdirSync(target, { recursive: true });
fs.writeFileSync(indexPath, html);

copyDir(path.join(skillDir, "assets", "fonts"), path.join(target, "assets", "fonts"));
copyDir(path.join(skillDir, "assets", "gsap"), path.join(target, "assets", "gsap"));
if (fs.existsSync(path.join(skillDir, "assets", "icons"))) {
  copyDir(path.join(skillDir, "assets", "icons"), path.join(target, "assets", "icons"));
}
fs.mkdirSync(path.join(target, "assets", "audio"), { recursive: true });

console.log(
  JSON.stringify({ ok: true, dir: target, width, height, duration, index: indexPath }, null, 2)
);
