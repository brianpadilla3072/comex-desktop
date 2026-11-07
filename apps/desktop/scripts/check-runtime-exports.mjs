import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
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

function walkRuntimeFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    const stats = statSync(file);
    if (stats.isDirectory()) {
      // node_modules and sourcemap caches are build output, not shipped code.
      if (name !== "node_modules") walkRuntimeFiles(file, out);
    } else if ((name.endsWith(".mjs") || name.endsWith(".js")) && !name.endsWith(".test.mjs") && !name.endsWith(".test.js")) {
      out.push(file);
    }
  }
  return out;
}

export function findWorkspaceRuntimeImporters(directories) {
  const runtimeImports = new Map();
  const dirs = Array.isArray(directories) ? directories : [directories];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const file of walkRuntimeFiles(dir).sort()) {
      const source = codeLines(readFileSync(file, "utf8")).join("\n");
      for (const match of source.matchAll(runtimeImportPattern)) {
        const specifier = match[2];
        if (!specifier.startsWith("@openwork/")) continue;
        if (!runtimeImports.has(specifier)) runtimeImports.set(specifier, new Set());
        runtimeImports.get(specifier).add(`${basename(resolve(dir, ".."))}/${basename(dir)}/${join(file.slice(dir.length + 1))}`.replace(/\\/g, "/"));
      }
    }
  }
  return runtimeImports;
}

export function findRuntimeTypeScriptImporters(directories) {
  const offenders = [];
  for (const [specifier, importers] of findWorkspaceRuntimeImporters(directories)) {
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
  // The embedded server runs in the main process, so the emitted server bundle
  // is runtime code too: its bare @openwork/* imports resolve through
  // node_modules exactly like the electron/*.mjs ones. electron-build calls
  // this after the server build, so scan the emitted JS when it exists.
  const repoRoot = resolve(electronRoot, "..", "..");
  const serverDist = resolve(repoRoot, "apps", "server", "dist");
  const offenders = findRuntimeTypeScriptImporters(existsSync(serverDist) ? [electronRoot, serverDist] : electronRoot);
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
