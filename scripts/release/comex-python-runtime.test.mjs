import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPortablePython } from "./comex-python-runtime.mjs";

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), "comex-python-builder-"));
  try { const source = join(root, "source"); await mkdir(source); await run(root, source); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test("portable runtime refuses virtual environments", () => fixture(async (root, source) => {
  await writeFile(join(source, "pyvenv.cfg"), "home = /external/python");
  await assert.rejects(buildPortablePython({ pythonRoot: source, out: join(root, "out") }), /standalone/);
}));

test("portable runtime rejects links escaping source and preserves existing output", () => fixture(async (root, source) => {
  await writeFile(join(root, "outside"), "reference");
  await symlink(join(root, "outside"), join(source, "link"));
  await assert.rejects(buildPortablePython({ pythonRoot: source, out: join(root, "out") }), /enlace no portable/);
  await mkdir(join(root, "out"));
  await assert.rejects(buildPortablePython({ pythonRoot: source, out: join(root, "out") }), /ya existe/);
}));

test("portable runtime rejects recursive targets even through parent symlinks", () => fixture(async (root, source) => {
  await symlink(source, join(root, "alias"), "dir");
  await assert.rejects(buildPortablePython({ pythonRoot: source, out: join(root, "alias", "nested") }), /árboles separados/);
}));

test("portable runtime requires the platform interpreter", () => fixture(async (root, source) => {
  await assert.rejects(buildPortablePython({ pythonRoot: source, out: join(root, "out") }), /Falta.*distribución/);
}));
