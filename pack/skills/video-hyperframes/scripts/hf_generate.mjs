#!/usr/bin/env node
/**
 * Genera una composición HyperFrames a partir de un estilo medido y una lista
 * de escenas con bloques.
 *
 *   node hf_generate.mjs --beats <beats.json> --dir <carpeta>
 *                        [--style style.json] [--title "..."] [--force]
 *
 * beats.json:
 * {
 *   "meta": { "duration": 15, "width": 1080, "height": 1920, "fps": 30 },
 *   "scenes": [
 *     { "id": "s1", "start": 0.5, "duration": 3.5,
 *       "block": "caption-top",
 *       "options": { "text": "MULTISTREAM", "accent": "NATIVO" } }
 *   ]
 * }
 *
 * Cada bloque vive en `blocks/<id>/` con `block.html`, `block.css` y
 * `block.js`. Los placeholders son `{{clave}}` y las listas se expanden con:
 *   <!-- each:items --> ... {{name}} ... <!-- /each:items -->
 *
 * Salida: index.html listo para `hf_check.mjs` y `hf_render.mjs`.
 */
import fs from "node:fs";
import path from "node:path";
import { resolveStyle } from "./style_path.mjs";

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const flag = (name) => argv.includes(`--${name}`);

const beatsPath = arg("beats");
const outDir = arg("dir");
if (!beatsPath || !outDir) {
  console.log(
    "uso: node hf_generate.mjs --beats <beats.json> --dir <carpeta> [--style style.json] [--title \"...\"] [--force]"
  );
  process.exit(2);
}

const skillDir = path.resolve(import.meta.dirname, "..");
const readJson = (file) => {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) return null;
  return JSON.parse(fs.readFileSync(abs, "utf8").replace(/^\uFEFF/, ""));
};

const beats = readJson(beatsPath);
if (!beats || !Array.isArray(beats.scenes) || !beats.scenes.length) {
  console.error("beats.json no tiene scenes[]");
  process.exit(1);
}
const styleArg = arg("style");
// --style acepta ruta o nombre de la biblioteca (video-library/styles).
const styleFile = styleArg ? resolveStyle(styleArg, path.dirname(path.resolve(beatsPath))) : null;
if (styleArg && !styleFile) {
  console.error(
    `no encuentro el estilo "${styleArg}" (ruta ni biblioteca: video-library/styles)`
  );
  process.exit(1);
}
const style = styleFile ? readJson(styleFile) : null;

const meta = beats.meta ?? {};
const width = Number(meta.width ?? 1080);
const height = Number(meta.height ?? 1920);
const duration = Number(meta.duration ?? 0);
if (!duration) {
  console.error("meta.duration es obligatorio");
  process.exit(1);
}

const target = path.resolve(outDir);
const indexPath = path.join(target, "index.html");
if (fs.existsSync(indexPath) && !flag("force")) {
  console.error(`Ya existe ${indexPath}: usá --force para reemplazarlo.`);
  process.exit(1);
}

// ------------------------------------------------------------------ color --
const hexToRgb = (hex) => {
  const h = String(hex).replace("#", "").trim();
  if (h.length !== 6) return null;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const rgba = (hex, alpha) => {
  const rgb = hexToRgb(hex);
  if (!rgb) return `rgba(79, 70, 229, ${alpha})`;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
};

const roles = style?.paletteRoles ?? {};
const palette = Array.isArray(style?.palette) ? style.palette : [];
const pick = (role, fallback, index) => {
  const value = roles[role] ?? palette[index] ?? fallback;
  return /^#?[0-9a-f]{6}$/i.test(String(value)) ? (String(value).startsWith("#") ? value : `#${value}`) : fallback;
};

const c = {
  bg: pick("background", "#0b0b14", 0),
  primary: pick("primary", "#4f46e5", 1),
  secondary: pick("secondary", "#8b5cf6", 2),
  accent: pick("accent", "#22d3ee", 3),
  paper: pick("paper", "#dbe5ec", 4),
  yellow: pick("yellow", "#fcd03d", 5),
  red: pick("red", "#e63249", 6),
};

const typo = style?.typography ?? {};
const display = typo.display && !/archivo/i.test(typo.display) ? typo.display : "Archivo Black";
const body = typo.body && !/inter/i.test(typo.body) ? typo.body : "Inter";
const scale = Array.isArray(typo.scale) ? Number(typo.scale[0]) : 0;
const captionSize = scale >= 48 && scale <= 140 ? Math.round(scale) : 86;

const vars = [
  `--bg: ${c.bg};`,
  `--primary: ${c.primary};`,
  `--secondary: ${c.secondary};`,
  `--accent: ${c.accent};`,
  `--paper: ${c.paper};`,
  `--ink: ${c.paper};`,
  `--yellow: ${c.yellow};`,
  `--red: ${c.red};`,
  `--display: "${display}";`,
  `--body: "${body}";`,
  `--caption-size: ${captionSize}px;`,
]
  .map((line) => `        ${line}`)
  .join("\n");

// ------------------------------------------------------------- plantillas --
const fill = (template, values, label) => {
  const missing = new Set();
  const out = template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key) => {
    if (key in values && values[key] !== undefined && values[key] !== null) {
      const value = values[key];
      return typeof value === "object" ? JSON.stringify(value) : String(value);
    }
    missing.add(key);
    return "";
  });
  if (missing.size) {
    throw new Error(`${label}: faltan valores para ${[...missing].join(", ")}`);
  }
  return out;
};

const expandLoops = (template, values, label) => {
  const loopRe = /<!--\s*each:([a-zA-Z0-9_]+)\s*-->([\s\S]*?)<!--\s*\/each:\1\s*-->/g;
  let out = template;
  for (let pass = 0; pass < 5; pass++) {
    if (!loopRe.test(out)) break;
    loopRe.lastIndex = 0;
    out = out.replace(loopRe, (_, key, inner) => {
      const list = values[key];
      if (!Array.isArray(list)) {
        throw new Error(`${label}: "${key}" no es una lista`);
      }
      return list
        .map((item, index) =>
          fill(inner, { ...values, ...item, "@index": index }, `${label}>${key}[${index}]`)
        )
        .join("\n");
    });
  }
  return out;
};

// ------------------------------------------------------------------ bloques --
const blockCss = [];
const blockJs = [];
const scenesHtml = [];
const used = new Set();

for (const scene of beats.scenes) {
  // Una escena puede llevar varios bloques: `block` (uno) o `blocks` (lista).
  const specs = Array.isArray(scene.blocks)
    ? scene.blocks
    : [{ block: scene.block, options: scene.options }];
  if (!specs.length) throw new Error(`escena ${scene.id ?? "?"} sin block`);

  const id = scene.id ?? `s${scenesHtml.length + 1}`;
  const start = Number(scene.start ?? 0);
  const dur = Number(scene.duration ?? 2);
  if (!(dur > 0)) throw new Error(`escena ${id} con duration inválida`);

  // Título y HUD no se mueven con el foco: quedan fuera de la capa.
  const FIXED_BLOCKS = new Set(["caption-top", "hud-serie"]);
  const fragments = [];
  const fixedFragments = [];
  const names = [];

  for (const spec of specs) {
    const name = typeof spec === "string" ? spec : spec.block;
    if (!name) throw new Error(`escena ${id} con un bloque sin nombre`);
    const blockDir = path.join(skillDir, "blocks", name);
    if (!fs.existsSync(blockDir)) {
      throw new Error(`no existe el bloque "${name}" (${blockDir})`);
    }
    const schemaFile = path.join(blockDir, "block.json");
    const schema = fs.existsSync(schemaFile)
      ? JSON.parse(fs.readFileSync(schemaFile, "utf8").replace(/^\uFEFF/, ""))
      : {};

    const values = {
      ...(schema.defaults ?? {}),
      ...(scene.options ?? {}),
      ...(typeof spec === "string" ? {} : (spec.options ?? {})),
      id,
      start: start.toFixed(3),
      duration: dur.toFixed(3),
      index: scenesHtml.length,
    };

    // "@ruta.json" en una opción se reemplaza por el contenido del archivo
    for (const [key, value] of Object.entries(values)) {
      if (typeof value !== "string" || !value.startsWith("@")) continue;
      const abs = path.resolve(path.dirname(path.resolve(beatsPath)), value.slice(1));
      if (!fs.existsSync(abs)) {
        throw new Error(`escena ${id}: no existe el archivo ${abs} (opción ${key})`);
      }
      const raw = fs.readFileSync(abs, "utf8");
      values[key] = key && abs.toLowerCase().endsWith(".json") ? JSON.parse(raw) : raw;
    }

    const read = (file) => {
      const abs = path.join(blockDir, file);
      return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
    };

    let html = read("block.html");
    if (!html) throw new Error(`el bloque ${name} no tiene block.html`);
    html = expandLoops(html, values, `${name}/${id}`);
    html = fill(html, values, `${name}/${id}`);
    (FIXED_BLOCKS.has(name) ? fixedFragments : fragments).push(html.trim());

    const css = read("block.css");
    if (css && !used.has(`css:${name}`)) {
      blockCss.push(`      /* ---- ${name} ---- */\n${fill(css, values, `${name}/css`).trim()}`);
      used.add(`css:${name}`);
    }
    const js = read("block.js");
    if (js) {
      blockJs.push(
        `      // ---- ${name} · ${id} ----\n` +
          fill(js, values, `${name}/js`)
            .trim()
            .split("\n")
            .map((line) => `      ${line}`)
            .join("\n")
      );
    }
    used.add(name);
    names.push(name);
  }

  const indent = (text, spaces) =>
    text
      .split("\n")
      .map((line) => `${" ".repeat(spaces)}${line}`)
      .join("\n");

  const inner =
    fixedFragments.join("\n") +
    `\n  <div class="focus" id="${id}-focus">\n` +
    indent(fragments.join("\n"), 4) +
    `\n  </div>`;

  scenesHtml.push(
    `      <!-- ${names.join(" + ")} · ${id} -->\n` +
      `      <section class="scene clip" id="${id}" data-start="${start.toFixed(3)}" data-duration="${dur.toFixed(3)}">\n` +
      `        <div class="scene-in" id="${id}-in">\n` +
      indent(inner, 10) +
      `\n        </div>\n      </section>`
  );

  // Transición de entrada (la escena anterior se va con corte duro).
  const transition = String(scene.transition ?? "cut").toLowerCase();
  if (transition !== "cut") {
    const presets = {
      fade: {
        from: { opacity: 0 },
        to: { opacity: 1 },
        ease: "power1.out",
        duration: 0.35,
      },
      wipe: {
        from: { clipPath: "inset(0% 100% 0% 0%)" },
        to: { clipPath: "inset(0% 0% 0% 0%)" },
        ease: "power2.inOut",
        duration: 0.45,
      },
      slide: {
        from: { xPercent: 100 },
        to: { xPercent: 0 },
        ease: "power3.out",
        duration: 0.5,
      },
      zoom: {
        from: { opacity: 0, scale: 1.08 },
        to: { opacity: 1, scale: 1 },
        ease: "power2.out",
        duration: 0.4,
      },
    };
    const preset = presets[transition];
    if (!preset) {
      throw new Error(
        `escena ${id}: transición "${transition}" desconocida (usá cut, fade, wipe, slide o zoom)`
      );
    }
    const duration = Number(scene.transitionDuration ?? preset.duration);
    blockJs.push(
      `      // ---- transición · ${id} (${transition}) ----\n` +
        `      tl.fromTo("#${id}-in", ${JSON.stringify(preset.from)}, ` +
        `{ ...${JSON.stringify(preset.to)}, duration: ${duration}, ease: "${preset.ease}" }, ${start.toFixed(3)});`
    );
  }

  // Foco de cámara: zoom hacia un punto de la escena (opcional).
  if (Array.isArray(scene.focus) && scene.focus.length) {
    const lines = [];
    for (const step of scene.focus) {
      const scale = Number(step.scale ?? 1);
      const px = Number(step.x ?? width / 2);
      const py = Number(step.y ?? height / 2);
      // Origen 0 0: el punto (px,py) queda fijo y el resto se abre desde ahí.
      const tx = Math.round(px * (1 - scale) * 100) / 100;
      const ty = Math.round(py * (1 - scale) * 100) / 100;
      const at = (start + Number(step.at ?? 0)).toFixed(3);
      lines.push(
        `tl.to("#${id}-focus", { scale: ${scale}, x: ${tx}, y: ${ty}, duration: ${Number(
          step.duration ?? 0.55
        )}, ease: "${step.ease ?? "power3.out"}" }, ${at});`
      );
    }
    blockJs.push(
      `      // ---- foco · ${id} ----\n` +
        lines
          .map((line) => `      ${line}`)
          .join("\n")
    );
  }
}

// ---------------------------------------------------------------- index.html
const base = fs.readFileSync(path.join(skillDir, "templates", "hf-base.html"), "utf8");
const html = fill(
  base,
  {
    title: arg("title", "Composición HyperFrames"),
    duration: duration.toFixed(3),
    width,
    height,
    vars,
    glow1: rgba(c.primary, 0.32),
    glow2: rgba(c.secondary, 0.2),
    glow3: rgba(c.accent, 0.12),
    grid: rgba(c.secondary, 0.14),
    blockCss: blockCss.join("\n\n"),
    blockJs: blockJs.join("\n\n"),
    scenes: scenesHtml.join("\n\n"),
  },
  "base"
);

fs.mkdirSync(target, { recursive: true });
fs.writeFileSync(indexPath, html, "utf8");

// ------------------------------------------------------------------- assets
const copyDir = (from, to) => {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
  }
};
const assets = path.join(target, "assets");
copyDir(path.join(skillDir, "assets", "fonts"), path.join(assets, "fonts"));
copyDir(path.join(skillDir, "assets", "gsap"), path.join(assets, "gsap"));
copyDir(path.join(skillDir, "assets", "icons"), path.join(assets, "icons"));
fs.mkdirSync(path.join(assets, "audio"), { recursive: true });

console.log(
  JSON.stringify(
    {
      ok: true,
      index: indexPath,
      width,
      height,
      duration,
      scenes: beats.scenes.length,
      blocks: [...used].filter((u) => !u.startsWith("css:")),
      style: styleFile ?? null,
      styleArg: styleArg ?? null,
    },
    null,
    2
  )
);
