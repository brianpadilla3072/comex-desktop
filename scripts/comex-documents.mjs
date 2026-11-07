#!/usr/bin/env node
/** Launcher cross-platform; el runtime documental declara si falta Python. */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../pack/scripts/documents.py", import.meta.url));
const configuredPython = process.env.COMEX_DOCUMENTS_PYTHON || process.env.COMEX_PYTHON;
const candidates = configuredPython
  ? [[configuredPython]]
  : process.platform === "win32" ? [["py", "-3"], ["python"], ["python3"]] : [["python3"], ["python"]];
let selected;
for (const [binary, ...prefix] of candidates) {
  const result = spawnSync(binary, [...prefix, "-X", "utf8", "-I", "-c", "import sys;sys.exit(0 if sys.version_info >= (3,10) else 1)"], { encoding: "utf8", windowsHide: true });
  if (!result.error && result.status === 0) { selected = [binary, ...prefix]; break; }
}
if (!selected) {
  console.error(process.env.COMEX_DOCUMENTS_PYTHON
    ? "No se pudo iniciar el runtime Python incluido. Repará o reinstalá la aplicación."
    : "No se encontró Python 3.10+. Instalá Python y ejecutá de nuevo setup. COMEX_PYTHON permite indicar su ruta; no hay un sidecar configurado.");
  process.exitCode = 1;
} else {
  const [binary, ...prefix] = selected;
  const result = spawnSync(binary, [...prefix, "-X", "utf8", "-I", script, ...process.argv.slice(2)], { stdio: "inherit", windowsHide: true });
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
}
