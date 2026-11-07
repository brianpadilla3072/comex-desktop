import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { findRuntimeTypeScriptImporters } from "./check-runtime-exports.mjs";

const electronRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "electron");

// Its "default" export still points at src, so importing it from the packaged
// main process would crash on boot: the exact shape of the 1.0.3/1.0.4 bug.
const TYPESCRIPT_ONLY_SPECIFIER = "@openwork/types/connect-link";

function scaffold(files) {
  const dir = mkdtempSync(join(tmpdir(), "openwork-runtime-exports-"));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

test("flags a runtime import that resolves to TypeScript", () => {
  const dir = scaffold({
    "index.mjs": `import { verify } from "${TYPESCRIPT_ONLY_SPECIFIER}";\nexport const ok = verify;\n`,
  });
  try {
    const offenders = findRuntimeTypeScriptImporters(dir);
    assert.deepEqual(
      offenders.map((entry) => [entry.specifier, entry.importers]),
      [[TYPESCRIPT_ONLY_SPECIFIER, ["electron/index.mjs"]]],
    );
    assert.match(offenders[0].pathname, /\.ts$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ignores type-only and commented references", () => {
  const dir = scaffold({
    "main.mjs": [
      `/** @type {import("${TYPESCRIPT_ONLY_SPECIFIER}").Claims} */`,
      "export let claims;",
      ` * @returns {import("${TYPESCRIPT_ONLY_SPECIFIER}").Claims}`,
      `// import { verify } from "${TYPESCRIPT_ONLY_SPECIFIER}";`,
      `/* import { verify } from "${TYPESCRIPT_ONLY_SPECIFIER}"; */`,
      "export const note = 'https://example.test/path';",
      "",
    ].join("\n"),
  });
  try {
    assert.deepEqual(findRuntimeTypeScriptImporters(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the shipped main process imports only compiled workspace packages", () => {
  assert.deepEqual(findRuntimeTypeScriptImporters(electronRoot), []);
});
