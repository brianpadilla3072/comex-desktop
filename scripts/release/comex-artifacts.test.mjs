import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { stageComexArtifacts } from "./comex-artifacts.mjs";

async function fixture(t, target = "win") {
  const root = await mkdtemp(path.join(os.tmpdir(), "comex-release-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source");
  const destination = path.join(root, "staged");
  await mkdir(source);
  const version = "1.0.12";
  const file = target === "win" ? `openwork-win-x64-${version}.exe` : `openwork-linux-x86_64-${version}.AppImage`;
  const manifest = target === "win" ? "latest.yml" : "latest-linux.yml";
  const bytes = Buffer.from("fixture installer");
  const digest = createHash("sha512").update(bytes).digest("base64");
  await writeFile(path.join(source, file), bytes);
  if (target === "win") await writeFile(path.join(source, `${file}.blockmap`), "blockmap fixture");
  const yaml = `version: ${version}\nfiles:\n  - url: ${file}\n    sha512: ${digest}\n    size: ${bytes.length}\npath: ${file}\nsha512: ${digest}\n`;
  await writeFile(path.join(source, manifest), yaml);
  return { source, destination, version, file, manifest, yaml, bytes, digest };
}

for (const target of ["win", "linux"]) {
  test(`stages verified ${target} installer and metadata without unpacked files`, async (t) => {
    const f = await fixture(t, target);
    await writeFile(path.join(f.source, "builder-debug.yml"), "not an updater file");
    const files = await stageComexArtifacts(f.source, f.version, target, f.destination);
    assert.ok(files.includes(f.file));
    assert.ok(files.includes(f.manifest));
    assert.ok(!files.includes("builder-debug.yml"));
    assert.deepEqual(await readFile(path.join(f.destination, f.file)), f.bytes);
    assert.equal((await readdir(f.destination)).length, target === "win" ? 3 : 2);
  });
}

test("rejects a corrupted installer", async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.source, f.file), Buffer.alloc(f.bytes.length));
  await assert.rejects(stageComexArtifacts(f.source, f.version, "win", f.destination), /SHA-512 mismatch/);
});

test("rejects mismatched version and truncated installers", async (t) => {
  const f = await fixture(t);
  await assert.rejects(stageComexArtifacts(f.source, "1.0.13", "win", f.destination), /version does not match/);
  await writeFile(path.join(f.source, f.file), "short");
  await assert.rejects(stageComexArtifacts(f.source, f.version, "win", f.destination), /incorrect artifact size/);
});

test("rejects a missing Windows blockmap", async (t) => {
  const f = await fixture(t);
  await rm(path.join(f.source, `${f.file}.blockmap`));
  await assert.rejects(stageComexArtifacts(f.source, f.version, "win", f.destination), /ENOENT/);
});

test("rejects upstream recovery URLs and path traversal", async (t) => {
  const f = await fixture(t);
  for (const url of [`https://github.com/different-ai/openwork/releases/download/v${f.version}/${f.file}`, `../${f.file}`]) {
    await writeFile(path.join(f.source, f.manifest), f.yaml.replace(`url: ${f.file}`, `url: ${url}`));
    await assert.rejects(stageComexArtifacts(f.source, f.version, "win", f.destination));
  }
});

test("does not stage a partial release when the other platform is missing", async (t) => {
  const f = await fixture(t);
  await assert.rejects(stageComexArtifacts(f.source, f.version, "all", f.destination), /ENOENT/);
  await assert.rejects(readdir(f.destination), /ENOENT/);
});

test("stages both complete platforms together", async (t) => {
  const win = await fixture(t);
  const linux = await fixture(t, "linux");
  for (const file of [linux.file, linux.manifest]) {
    await writeFile(path.join(win.source, file), await readFile(path.join(linux.source, file)));
  }
  const staged = await stageComexArtifacts(win.source, win.version, "all", win.destination);
  assert.equal(staged.length, 5);
});
