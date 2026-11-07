#!/usr/bin/env node
/** Build a relocatable documents sidecar from a CI-provided standalone Python. */
import { constants } from "node:fs";
import { access, cp, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rename, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const execute = promisify(execFile);
const repository = fileURLToPath(new URL("../../", import.meta.url));
const requirements = join(repository, "pack/scripts/requirements.lock.txt");
const documents = join(repository, "pack/scripts/documents.py");
const within = (root, path) => path === root || (!relative(root, path).startsWith(`..${sep}`) && relative(root, path) !== ".." && !isAbsolute(relative(root, path)));
const exists = path => access(path).then(() => true, () => false);
const cleanEnvironment = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(PYTHON|VIRTUAL_ENV|COMEX_DOCUMENTS_PYTHON)/i.test(key)));
async function run(python, args, extraEnv = {}) {
  try {
    return await execute(python, ["-I", ...args], { env: { ...cleanEnvironment(), ...extraEnv }, timeout: 300_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
  } catch {
    // pip errors may contain authenticated index URLs; never echo raw output.
    const stage = args[0] === "-m" ? args[1] : args[0] === "-c" ? "validación de imports" : "doctor";
    throw new Error(`Falló Python durante ${stage}. Revisá la distribución, las dependencias y el acceso al índice de paquetes.`);
  }
}

async function inspectSource(root) {
  if (await exists(join(root, "pyvenv.cfg"))) throw new Error("Se requiere una distribución standalone; no se puede empaquetar un virtualenv.");
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (["site-packages", "__pycache__", ".venv"].includes(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const target = await readlink(path);
        if (isAbsolute(target) || !within(root, resolve(dirname(path), target))) throw new Error(`El runtime tiene un enlace no portable: ${relative(root, path)}`);
        if (!within(root, await realpath(path))) throw new Error("Un enlace del runtime escapa del árbol fuente.");
      } else if (entry.isDirectory()) await walk(path);
      else if (!entry.isFile()) throw new Error("El runtime contiene archivos especiales no soportados.");
    }
  }
  await walk(root);
}

export async function buildPortablePython({ pythonRoot, out, wheelhouse }) {
  const source = await realpath(resolve(pythonRoot));
  await mkdir(dirname(resolve(out)), { recursive: true });
  const target = join(await realpath(dirname(resolve(out))), basename(resolve(out)));
  if (within(source, target) || within(target, source)) throw new Error("El destino y la fuente deben ser árboles separados.");
  if (await lstat(target).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; })) throw new Error("El destino ya existe. Elegí un destino nuevo para conservar la distribución previa.");
  await inspectSource(source);
  const executable = process.platform === "win32" ? "python.exe" : "bin/python3";
  if (!await exists(join(source, executable))) throw new Error(`Falta ${executable}; la distribución debe corresponder al sistema de compilación.`);
  await mkdir(dirname(target), { recursive: true });
  const staging = await mkdtemp(join(dirname(target), ".comex-python-build-"));
  const copy = join(staging, "runtime");
  const relocated = join(staging, "relocated-runtime");
  try {
    await cp(source, copy, { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE,
      filter: path => !["site-packages", "__pycache__", ".venv", "EXTERNALLY-MANAGED"].includes(basename(path)) });
    const python = join(copy, executable);
    const identity = JSON.parse((await run(python, ["-c", "import json,sys;print(json.dumps({'version':list(sys.version_info[:3]),'prefix':sys.prefix,'basePrefix':sys.base_prefix}))"])).stdout);
    if (identity.version[0] !== 3 || identity.version[1] !== 12 || resolve(identity.prefix) !== resolve(copy) || identity.prefix !== identity.basePrefix) throw new Error("El runtime debe ser Python 3.12 standalone y resolver su prefijo en la copia.");
    await run(python, ["-m", "ensurepip", "--default-pip"]);
    const install = ["-m", "pip", "install", "--disable-pip-version-check", "--only-binary=:all:", "-r", requirements];
    if (wheelhouse) install.push("--no-index", "--find-links", resolve(wheelhouse));
    await run(python, install);
    // uv marks its source installation externally managed. Only the staging
    // copy is bootstrapped; restore immutability before publishing the sidecar.
    await run(python, ["-c", "import pathlib,sysconfig;pathlib.Path(sysconfig.get_path('stdlib'),'EXTERNALLY-MANAGED').write_text('[externally-managed]\\nError=This runtime is managed by Comex. Repair or reinstall the application.\\n',encoding='utf-8')"]);
    await cp(copy, relocated, { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE });
    const relocatedPython = join(relocated, executable);
    const hiddenCopy = join(staging, "original-unavailable");
    // Installed files must not depend on the absolute installation location.
    await rename(copy, hiddenCopy);
    let report;
    try {
      const relocationCheck = `import sys,json,pathlib
import docx,openpyxl
from lxml import etree
prefix=pathlib.Path(sys.prefix).resolve()
paths=[pathlib.Path(p).resolve() for p in sys.path if p]
files=[pathlib.Path(m.__file__).resolve() for m in list(sys.modules.values()) if getattr(m,'__file__',None)]
assert all(p==prefix or prefix in p.parents for p in paths+files), 'Import fuera del runtime reubicado'
print(str(prefix))`;
      const relocatedPrefix = (await run(relocatedPython, ["-c", relocationCheck])).stdout.trim();
      if (resolve(relocatedPrefix) !== relocated) throw new Error("El intérprete no pudo reubicarse dentro del sidecar.");
      report = JSON.parse((await run(relocatedPython, [documents, "doctor"], { COMEX_DOCUMENTS_PYTHON: relocatedPython })).stdout);
      if (!report.ready || !report.pythonBundled) throw new Error("Falló doctor del runtime reubicado.");
    } finally { await rename(hiddenCopy, copy); }
    const manifest = { schemaVersion: 1, platform: process.platform, arch: process.arch, pythonVersion: identity.version,
      executable: executable.replaceAll("\\", "/"), lockSha256: createHash("sha256").update(await readFile(requirements)).digest("hex"),
      dependencies: report.versions, relocationVerified: true, source: "CI-provided Python standalone; no runtime download performed by this script" };
    await writeFile(join(copy, "comex-runtime.json"), JSON.stringify(manifest, null, 2) + "\n");
    // Rename only after imports and the relocated doctor succeeded.
    await rename(copy, target);
    return { ...manifest, path: target };
  } finally { await rm(staging, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const options = {};
    for (let index = 0; index < args.length; index += 2) {
      const key = args[index];
      if (!["--python-root", "--out", "--wheelhouse"].includes(key) || !args[index + 1]) throw new Error("Uso: --python-root DIR --out DIR [--wheelhouse DIR]");
      options[key.slice(2)] = args[index + 1];
    }
    if (!options["python-root"] || !options.out) throw new Error("Uso: --python-root DIR --out DIR [--wheelhouse DIR]");
    console.log(JSON.stringify(await buildPortablePython({ pythonRoot: options["python-root"], out: options.out, wheelhouse: options.wheelhouse }), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
