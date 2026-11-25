#!/usr/bin/env node
/**
 * Revisión estática de una composición HyperFrames antes de renderizar.
 *
 *   node hf_check.mjs --dir <carpeta> [--json]
 *
 * Devuelve exit 1 si hay errores. Los avisos no bloquean.
 * No valida texto cortado ni contraste: eso se mira en los cuadros
 * (hf_preview.mjs) o en el render.
 */
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const dirArg = argv.includes("--dir") ? argv[argv.indexOf("--dir") + 1] : null;
const asJson = argv.includes("--json");
if (!dirArg) {
  console.log("uso: node hf_check.mjs --dir <carpeta> [--json]");
  process.exit(2);
}

const dir = path.resolve(dirArg);
const indexPath = path.join(dir, "index.html");
if (!fs.existsSync(indexPath)) {
  console.error(`No encuentro ${indexPath}`);
  process.exit(2);
}

const errors = [];
const warnings = [];
const infos = [];
const add = (list, code, msg, file) => list.push({ code, msg, file });

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      // las librerías vendorizadas no se auditan: no son autoría de la composición
      if (/^(gsap|vendor|libs?)$/i.test(e.name)) continue;
      walk(p);
    } else if (/\.(html|js|css)$/i.test(e.name)) {
      if (/\.min\.(js|css)$/i.test(e.name)) continue;
      files.push(p);
    }
  }
})(dir);

const html = fs.readFileSync(indexPath, "utf8");
const rel = (p) => path.relative(dir, p).replace(/\\/g, "/");

// ------------------------------------------------------------------ contrato
const rootTag = /<div[^>]*data-composition-id[^>]*>/i.exec(html)?.[0] ?? "";
if (!rootTag) {
  add(errors, "root", 'falta la raíz <div id="root" data-composition-id="main" ...>', "index.html");
} else {
  for (const attr of ["data-composition-id", "data-width", "data-height", "data-duration"]) {
    if (!new RegExp(`${attr}="[^"]+"`).test(rootTag)) {
      add(errors, "root-attr", `la raíz no declara ${attr}`, "index.html");
    }
  }
  const dur = /data-duration="([\d.]+)"/.exec(rootTag)?.[1];
  if (dur && Number(dur) > 0) infos.push({ code: "duracion", msg: `${dur} s`, file: "index.html" });
}

// --------------------------------------------------------- clips temporizados
for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  const tagRe = /<[a-z][^>]*class="[^"]*\bclip\b[^"]*"[^>]*>/gi;
  let m;
  while ((m = tagRe.exec(src))) {
    const tag = m[0];
    if (!/data-start="/.test(tag)) {
      add(errors, "clip-start", `un .clip no declara data-start: ${tag.slice(0, 100)}`, rel(file));
    }
    if (!/data-duration="/.test(tag)) {
      add(errors, "clip-duration", `un .clip no declara data-duration: ${tag.slice(0, 100)}`, rel(file));
    }
  }

  // ------------------------------------------------------------ determinismo
  const forbidden = [
    [/\bDate\.now\s*\(/, "date-now", "usa Date.now(): el cuadro dejaría de ser determinista"],
    [/\bMath\.random\s*\(/, "random", "usa Math.random(): sembralo o quitá la aleatoriedad"],
    [/\bfetch\s*\(/, "fetch", "usa fetch(): la composición no debe depender de la red"],
    [/\bsetInterval\s*\(/, "interval", "usa setInterval(): no hay reloj propio"],
    [/repeat\s*:\s*-1/, "repeat-infinite", "usa repeat: -1, que nunca termina en un seek"],
    [/\bautoAlpha\b/, "autoalpha", "anima autoAlpha en un .clip: usá un hijo"],
  ];
  for (const [re, code, msg] of forbidden) {
    if (re.test(src)) add(errors, code, msg, rel(file));
  }

  // animar tamaño/posición rompe el layout determinista
  const tweenRe = /gsap\s*\.\s*(?:to|from|fromTo|timeline)\s*\(([\s\S]{0,400}?)\)\s*;/g;
  let t;
  while ((t = tweenRe.exec(src))) {
    const block = t[1];
    if (/\b(left|top|width|height)\s*:/.test(block)) {
      add(warnings, "layout-tween", "anima left/top/width/height: preferí transform", rel(file));
    }
    if (/\bvisibility\s*:/.test(block)) {
      add(warnings, "visibility-tween", "anima visibility en un clip: usá un hijo", rel(file));
    }
  }

  // ------------------------------------------------------------------ assets
  const assetRe = /(?:src|href)="(assets\/[^"]+)"|url\((['"]?)(assets\/[^'")]+)\2\)/g;
  let a;
  while ((a = assetRe.exec(src))) {
    const ref = a[1] || a[3];
    const target = path.join(dir, ref);
    if (!fs.existsSync(target)) {
      add(errors, "asset-missing", `no existe el asset ${ref}`, rel(file));
    }
  }

  // medios externos
  if (/(?:src|href)="https?:\/\//.test(src) && !/fonts\.googleapis|cdn\.jsdelivr\.net\/npm\/gsap/.test(src)) {
    add(warnings, "remote-asset", "referencia un recurso remoto: conviene copiarlo a assets/", rel(file));
  }
}

// ------------------------------------------------------------- línea de tiempo
const hasTimeline = files.some((f) =>
  /window\.__timelines\s*\[[^\]]+\]\s*=/.test(fs.readFileSync(f, "utf8"))
);
if (!hasTimeline) {
  add(
    errors,
    "timeline",
    "nadie registra la línea: falta `window.__timelines[<id>] = tl` (timeline pausada)",
    "index.html"
  );
}

// ------------------------------------------------------------- composiciones
const hostRe = /data-composition-src="([^"]+)"/g;
let h;
while ((h = hostRe.exec(html))) {
  const target = path.join(dir, h[1]);
  if (!fs.existsSync(target)) {
    add(errors, "host-missing", `la escena ${h[1]} no existe`, "index.html");
  }
}

// ------------------------------------------------------------------- salida
const report = { ok: errors.length === 0, errors, warnings, infos };
if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`HyperFrames · ${rel(dir) || "."}`);
  if (infos.length) console.log(`  · ${infos.map((i) => i.msg).join(", ")}`);
  for (const e of errors) console.log(`  ERROR  [${e.code}] ${e.file}: ${e.msg}`);
  for (const w of warnings) console.log(`  aviso  [${w.code}] ${w.file}: ${w.msg}`);
  if (report.ok) console.log("  OK: la composición cumple el contrato.");
}
process.exit(report.ok ? 0 : 1);
