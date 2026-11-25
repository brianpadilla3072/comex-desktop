#!/usr/bin/env node
/**
 * Biblioteca de assets, personajes y estilos del estudio.
 *
 *   node library.mjs init   [--root video-projects/library]
 *   node library.mjs add    --file <ruta> --origin "<de dónde>" --license "<licencia>"
 *                           [--kind asset|character|style] [--name "<nombre>"]
 *                           [--tags "logo,marca"] [--force]
 *   node library.mjs list   [--kind asset] [--json]
 *   node library.mjs verify [--json]
 *
 * Reglas:
 *  - Nada entra sin origen ni licencia.
 *  - El mismo archivo (mismo hash) no se guarda dos veces.
 *  - Los proyectos usan la biblioteca por ruta; no copian el archivo.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const argv = process.argv.slice(2);
const cmd = argv[0];
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const flag = (name) => argv.includes(`--${name}`);

const defaultLibrary = () => {
  if (process.env.VIDEO_LIBRARY) return process.env.VIDEO_LIBRARY;
  const globalLibrary = path.join(os.homedir(), ".openwork", "video", "library");
  if (fs.existsSync(globalLibrary)) return globalLibrary;
  return path.join("video-library");
};
const root = path.resolve(arg("root", defaultLibrary()));
const manifestPath = path.join(root, "manifest.json");
const KINDS = { asset: "assets", character: "characters", style: "styles" };

const readManifest = () => {
  if (!fs.existsSync(manifestPath)) return { version: 1, updatedAt: null, items: [] };
  const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8").replace(/^\uFEFF/, ""));
  return { version: 1, items: [], ...raw };
};

const writeManifest = (manifest) => {
  manifest.updatedAt = new Date().toISOString();
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
};

const sha256 = (file) =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

const slug = (text) =>
  String(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "sin-nombre";

const isVerified = (license) => !/por confirmar|desconocid|sin licencia|s\/d/i.test(license);

function init() {
  for (const kind of Object.keys(KINDS)) fs.mkdirSync(path.join(root, KINDS[kind]), { recursive: true });
  if (!fs.existsSync(manifestPath)) writeManifest({ version: 1, items: [] });
  const manifest = readManifest();
  console.log(
    JSON.stringify(
      { ok: true, root, manifest: manifestPath, items: manifest.items.length, kinds: KINDS },
      null,
      2
    )
  );
}

function add() {
  const file = arg("file");
  const origin = arg("origin");
  const license = arg("license");
  const kind = arg("kind", "asset");
  const name = arg("name", path.basename(String(file ?? ""), path.extname(String(file ?? ""))));
  const tags = (arg("tags", "") || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  if (!file || !origin || !license) {
    console.error('faltan datos: --file, --origin y --license son obligatorios');
    process.exit(2);
  }
  if (!(kind in KINDS)) {
    console.error(`kind inválido: ${kind}. Usá ${Object.keys(KINDS).join(", ")}`);
    process.exit(2);
  }
  const source = path.resolve(file);
  if (!fs.existsSync(source)) {
    console.error(`no existe el archivo: ${source}`);
    process.exit(2);
  }

  initRoot();
  const manifest = readManifest();
  const hash = sha256(source);
  const existing = manifest.items.find((item) => item.sha256 === hash && item.kind === kind);
  if (existing && !flag("force")) {
    console.log(
      JSON.stringify({ ok: true, duplicate: true, id: existing.id, file: existing.file }, null, 2)
    );
    return;
  }

  const id = slug(arg("name", name));
  const ext = path.extname(source);
  const relative = path.join(KINDS[kind], `${id}${ext}`).replace(/\\/g, "/");
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);

  const item = {
    id,
    kind,
    file: relative,
    origin: String(origin),
    license: String(license),
    verified: isVerified(license),
    sha256: hash,
    bytes: fs.statSync(target).size,
    tags,
    addedAt: new Date().toISOString(),
  };

  const index = manifest.items.findIndex((entry) => entry.id === id && entry.kind === kind);
  if (index >= 0) manifest.items[index] = item;
  else manifest.items.push(item);
  writeManifest(manifest);

  console.log(
    JSON.stringify(
      {
        ok: true,
        id,
        kind,
        file: path.join(root, relative),
        verified: item.verified,
        warning: item.verified ? null : "licencia sin verificar: revisar antes de publicar",
      },
      null,
      2
    )
  );
}

function initRoot() {
  for (const kind of Object.keys(KINDS)) fs.mkdirSync(path.join(root, KINDS[kind]), { recursive: true });
}

function list() {
  const manifest = readManifest();
  const kind = arg("kind");
  const items = manifest.items
    .filter((item) => !kind || item.kind === kind)
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));

  if (flag("json")) {
    console.log(JSON.stringify({ root, total: items.length, items }, null, 2));
    return;
  }
  if (!items.length) {
    console.log(`Biblioteca vacía en ${root}`);
    return;
  }
  console.log(`Biblioteca: ${root} · ${items.length} ítems\n`);
  for (const item of items) {
    const mark = item.verified ? "ok " : "revisar";
    console.log(`  [${item.kind}] ${item.id}  (${mark})`);
    console.log(`     ${item.file} · ${item.origin} · ${item.license}`);
    if (item.tags.length) console.log(`     tags: ${item.tags.join(", ")}`);
  }
}

function verify() {
  const manifest = readManifest();
  const problems = [];
  for (const item of manifest.items) {
    const abs = path.join(root, item.file);
    if (!fs.existsSync(abs)) {
      problems.push({ id: item.id, problem: "archivo faltante", file: item.file });
      continue;
    }
    if (sha256(abs) !== item.sha256) {
      problems.push({ id: item.id, problem: "hash distinto", file: item.file });
    }
    if (!item.license) {
      problems.push({ id: item.id, problem: "sin licencia", file: item.file });
    }
  }

  const payload = {
    ok: problems.length === 0,
    root,
    items: manifest.items.length,
    unverified: manifest.items.filter((item) => !item.verified).map((item) => item.id),
    problems,
  };
  console.log(JSON.stringify(payload, null, 2));
  if (!payload.ok) process.exit(1);
}

switch (cmd) {
  case "init":
    init();
    break;
  case "add":
    add();
    break;
  case "list":
    list();
    break;
  case "verify":
    verify();
    break;
  default:
    console.log(
      [
        "uso:",
        "  node library.mjs init",
        "  node library.mjs add --file <ruta> --origin \"<origen>\" --license \"<licencia>\" [--kind asset|character|style] [--name <id>] [--tags a,b]",
        "  node library.mjs list [--kind asset] [--json]",
        "  node library.mjs verify",
      ].join("\n")
    );
    process.exit(cmd ? 2 : 0);
}
