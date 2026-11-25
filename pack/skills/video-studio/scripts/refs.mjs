#!/usr/bin/env node
/**
 * Biblioteca global de referencias: sets reutilizables entre videos.
 *
 *   node refs.mjs list
 *   node refs.mjs use --set <id> --project <carpeta>
 *   node refs.mjs add --file <video> [--set <id>] [--name "..."] [--style "..."]
 *                     [--role principal|apoyo] [--tags a,b] [--license "..."]
 *
 * `use` enlaza (hardlink) o copia las referencias del set dentro de
 * `inspiracion/refs/` del proyecto y escribe `inspiracion/fuentes.md`.
 *
 * `add` es el alta: copia el video a la biblioteca global (es lo que debería
 * llamar el botón "agregar referencia de video") y actualiza el catálogo.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
const library = path.resolve(arg("library", defaultLibrary()));
const catalogPath = path.join(library, "references.json");
const referencesDir = path.join(library, "references");

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const writeJson = (file, data) => fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
const slug = (text) =>
  String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const readCatalog = () => {
  if (!fs.existsSync(catalogPath)) return { version: 1, sets: [] };
  return { version: 1, sets: [], ...readJson(catalogPath) };
};

const resolveRef = (setFile, refPath) =>
  path.isAbsolute(refPath) ? refPath : path.resolve(path.dirname(setFile), refPath);

const uniqueName = (dir, name) => {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let candidate = name;
  let index = 2;
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${base}-${index}${ext}`;
    index += 1;
  }
  return candidate;
};

if (cmd === "list" || !cmd) {
  if (!fs.existsSync(catalogPath)) {
    console.error(`no encuentro ${catalogPath}`);
    process.exit(2);
  }
  const catalog = readCatalog();
  for (const set of catalog.sets) {
    console.log(
      `[${set.id}] ${set.name} · ${set.refs} refs · estilo ${set.style ?? "sin medir"} · ${(set.tags ?? []).join(", ")}`
    );
  }
  process.exit(0);
}

if (cmd === "use") {
  const id = arg("set");
  const project = arg("project");
  if (!id || !project) {
    console.error("uso: node refs.mjs use --set <id> --project <carpeta>");
    process.exit(2);
  }
  const catalog = readCatalog();
  const set = catalog.sets.find((item) => item.id === id);
  if (!set) {
    console.error(`no existe el set "${id}" en la biblioteca`);
    process.exit(2);
  }

  const setFile = path.join(library, set.path);
  if (!fs.existsSync(setFile)) {
    console.error(`el set "${id}" no tiene refs.json en ${setFile}`);
    process.exit(2);
  }
  const data = readJson(setFile);
  const projectDir = path.resolve(project);
  const refsDir = path.join(projectDir, "inspiracion", "refs");
  fs.mkdirSync(refsDir, { recursive: true });

  let linked = 0;
  let symlinked = 0;
  let copied = 0;
  const missing = [];

  for (const ref of data.refs) {
    const source = resolveRef(setFile, ref.path);
    const target = path.join(refsDir, ref.file);
    if (!fs.existsSync(source)) {
      missing.push(ref.file);
      continue;
    }
    if (fs.existsSync(target)) {
      linked += 1;
      continue;
    }
    try {
      fs.linkSync(source, target);
      linked += 1;
    } catch {
      try {
        // La biblioteca global suele estar en otro disco: symlink antes que copia.
        fs.symlinkSync(source, target, "file");
        symlinked += 1;
      } catch {
        fs.copyFileSync(source, target);
        copied += 1;
      }
    }
  }

  const fuentes = [
    `# Referencias — ${data.name}`,
    "",
    `Set \`${data.id}\` de la biblioteca global. Estilo medido: \`${data.style ?? "sin medir"}\`.`,
    "",
    "| Archivo | Rol |",
    "|---|---|",
    ...data.refs.map((ref) => `| ${ref.file} | ${ref.role} |`),
    "",
    `Origen: ${data.source}`,
    "",
    data.licenseNote,
    "",
  ].join("\n");

  fs.writeFileSync(path.join(projectDir, "inspiracion", "fuentes.md"), fuentes, "utf8");

  console.log(
    JSON.stringify(
      { ok: missing.length === 0, set: id, style: data.style, linked, symlinked, copied, missing, refsDir },
      null,
      2
    )
  );
  process.exit(missing.length ? 1 : 0);
}

if (cmd === "add") {
  const file = arg("file");
  if (!file || !fs.existsSync(path.resolve(file))) {
    console.error("uso: node refs.mjs add --file <video> [--set <id>] [...]");
    process.exit(2);
  }
  const source = path.resolve(file);
  const id = arg("set", slug(path.basename(source, path.extname(source))));
  const setName = arg("name", id);
  const style = arg("style", null);
  const role = arg("role", "apoyo");
  const tags = String(arg("tags", "")).split(",").map((t) => t.trim()).filter(Boolean);
  const license = arg("license", "Referencia del propio usuario");

  const setDir = path.join(referencesDir, id);
  const refsDir = path.join(setDir, "refs");
  fs.mkdirSync(refsDir, { recursive: true });
  const setFile = path.join(setDir, "refs.json");

  const data = fs.existsSync(setFile)
    ? readJson(setFile)
    : {
        id,
        name: setName,
        style,
        measuredAt: null,
        source: "Biblioteca global",
        licenseNote: license,
        refs: [],
      };

  const targetName = uniqueName(refsDir, path.basename(source));
  fs.copyFileSync(source, path.join(refsDir, targetName));
  data.refs.push({ file: targetName, role, path: `refs/${targetName}` });
  writeJson(setFile, data);

  const catalog = readCatalog();
  const index = catalog.sets.findIndex((item) => item.id === id);
  const entry = {
    id,
    name: data.name,
    style: data.style ?? null,
    refs: data.refs.length,
    measuredAt: data.measuredAt ?? null,
    tags,
    path: `references/${id}/refs.json`,
  };
  if (index >= 0) catalog.sets[index] = entry;
  else catalog.sets.push(entry);
  writeJson(catalogPath, catalog);

  console.log(JSON.stringify({ ok: true, set: id, file: targetName, refs: data.refs.length }, null, 2));
  process.exit(0);
}

console.error(
  "uso: node refs.mjs list | use --set <id> --project <carpeta> | add --file <video> [--set <id>]"
);
process.exit(2);
