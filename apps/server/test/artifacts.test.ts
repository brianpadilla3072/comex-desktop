import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApiError } from "../src/errors.js";
import { listArtifacts, readArtifact, revertArtifact, writeArtifact } from "../src/specialists/artifacts.js";

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "artifacts-"));
  await mkdir(join(root, "proyecto"), { recursive: true });
  return root;
}

const metadata = { workspaceId: "ws_local", schemaVersion: 1 as const, workspaceName: "Proyecto local" };

test("artifacts are workspace files with immutable versions and a revertible working copy", async () => {
  const root = await workspace();
  try {
    const first = await writeArtifact(root, {
      type: "doc", title: "Informe de soja", content: "# Versión 1\n\nDatos iniciales.", metadata,
      label: "Versión inicial",
    });
    assert.equal(first.created, true);
    assert.match(first.meta.id, /^art-/);
    assert.equal(first.meta.versions.length, 1);
    assert.equal(first.meta.status, "draft");

    const second = await writeArtifact(root, {
      type: "doc", title: "Informe de soja", content: "# Versión 2\n\nDatos revisados.", metadata,
      id: first.meta.id, label: "Tras revisión",
    });
    assert.equal(second.created, false);
    assert.deepEqual(second.meta.versions.map(version => version.id), ["v1", "v2"]);
    assert.equal((await listArtifacts(root)).length, 1);
    assert.match((await readArtifact(root, first.meta.id)).content, /Versión 2/);

    // The first version is still on disk after the second save.
    assert.match(await readFile(join(root, "proyecto", "artefactos", first.meta.id, first.meta.versions[0]!.contentRef), "utf8"), /Datos iniciales/);

    await revertArtifact(root, first.meta.id, "v1");
    assert.match((await readArtifact(root, first.meta.id)).content, /Versión 1/);
    assert.equal((await listArtifacts(root))[0]?.versions.length, 2, "revert must not delete later versions");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("artifact writes fail loud on empty content, broken JSON and wrong ids", async () => {
  const root = await workspace();
  try {
    await assert.rejects(writeArtifact(root, { type: "doc", title: "x", content: "   ", metadata }),
      (error: unknown) => error instanceof ApiError && error.code === "invalid_artifact");
    await assert.rejects(writeArtifact(root, { type: "doc", title: "x", content: "sin título", metadata }),
      (error: unknown) => error instanceof ApiError && error.code === "invalid_artifact");
    await assert.rejects(writeArtifact(root, { type: "data", title: "x", content: "{roto", metadata }),
      (error: unknown) => error instanceof ApiError && error.code === "invalid_artifact");
    await assert.rejects(writeArtifact(root, { type: "doc", title: "x", content: "# ok", metadata, id: "ID CON ESPACIOS" }),
      (error: unknown) => error instanceof ApiError && error.code === "invalid_artifact");
    await assert.rejects(readArtifact(root, "no-existe"),
      (error: unknown) => error instanceof ApiError && error.code === "artifact_not_found");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a missing content file falls back to the last version and still says so if none exists", async () => {
  const root = await workspace();
  try {
    const created = await writeArtifact(root, {
      type: "doc", title: "x", content: "# Respaldo", metadata, label: "v1",
    });
    await rm(join(root, "proyecto", "artefactos", created.meta.id, "content.md"));
    assert.match((await readArtifact(root, created.meta.id)).content, /Respaldo/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
