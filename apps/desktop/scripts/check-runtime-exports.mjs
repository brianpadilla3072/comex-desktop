import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const runtimeImportPattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])([^"']+)\1/g;

// Type-only references live in JSDoc (`@type {import("@openwork/types/x")}`) and
// in commented-out code; both disappear at runtime, so they must not count.
// JSDoc continuation lines start with `*`, so dropping them plus same-line
// block/line comments is enough — and unlike a tokenizer it never gets fooled
// by quotes or globs inside other strings.
export function codeLines(source) {
  return source
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("*") && !trimmed.startsWith("//");
    })
    .map((line) => line.replace(/\/\*.*?\*\//g, " ").replace(/(^|\s)\/\/.*$/, "$1"));
}

export function findWorkspaceRuntimeImporters(electronRoot) {
  const runtimeImports = new Map();
  for (const fileName of readdirSync(electronRoot).filter((name) => name.endsWith(".mjs") && !name.endsWith(".test.mjs")).sort()) {
    const source = codeLines(readFileSync(resolve(electronRoot, fileName), "utf8")).join("\n");
    for (const match of source.matchAll(runtimeImportPattern)) {
      const specifier = match[2];
      if (!specifier.startsWith("@openwork/")) continue;
      if (!runtimeImports.has(specifier)) runtimeImports.set(specifier, new Set());
      runtimeImports.get(specifier).add(`electron/${fileName}`);
    }
  }
  return runtimeImports;
}

export function findRuntimeTypeScriptImporters(electronRoot) {
  const offenders = [];
  for (const [specifier, importers] of findWorkspaceRuntimeImporters(electronRoot)) {
    let resolved;
    try {
      resolved = import.meta.resolve(specifier);
    } catch (error) {
      offenders.push({
        specifier,
        pathname: `<no resuelve: ${error?.code ?? error?.message ?? "error"}>`,
        importers: [...importers],
      });
      continue;
    }
    const pathname = fileURLToPath(resolved);
    if (/\.tsx?$/.test(pathname)) offenders.push({ specifier, pathname, importers: [...importers] });
  }
  return offenders.sort((a, b) => a.specifier.localeCompare(b.specifier));
}

/**
 * The packaged main process is plain ESM shipped as-is (no bundler): Node loads
 * every import at runtime and refuses to strip TypeScript inside node_modules.
 * A workspace package whose export points at src/*.ts ships an app that dies on
 * boot with ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING — a failure no unit test
 * can see, because tests run with the development/bun conditions that resolve to
 * the TypeScript source on purpose. Fail the build instead of publishing it.
 */
export function assertWorkspaceRuntimeExports(electronRoot) {
  const offenders = findRuntimeTypeScriptImporters(electronRoot);
  if (!offenders.length) return;
  const list = offenders
    .map(({ specifier, pathname, importers }) => `  - ${specifier} → ${pathname}\n      importado por ${importers.join(", ")}`)
    .join("\n");
  console.error(
    `\n[electron-build] El proceso principal importaría TypeScript en runtime:\n${list}\n\n` +
      "El main empaquetado es ESM sin bundler y Node no puede quitar tipos dentro de\n" +
      "node_modules, así que la app se cae al abrir (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING).\n" +
      'Compilá el paquete (tsup) y apuntá su export "default" a dist/*.js, como\n' +
      "@openwork/headless-threads.\n",
  );
  process.exit(1);
}
