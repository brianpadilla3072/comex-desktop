import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { listWorkspaceCatalogEntries } from "../src/routes/files.js";
import { ApiError } from "../src/errors.js";

test("catalog preserves sorted paths, revisions and exclusions across metadata batches", async t => {
  const root = await mkdtemp(join(tmpdir(), "openwork-catalog-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = Array.from({ length: 25 }, (_, index) => `report-${index}.txt`);
  await Promise.all(paths.map(path => writeFile(join(root, path), path)));
  for (const dir of ["documents", "documents/nested", ".git", "node_modules", "documents/node_modules"]) await mkdir(join(root, dir), { recursive: true });
  const nested = "documents/nested/informe.txt";
  await writeFile(join(root, nested), "informe");
  for (const dir of [".git", "node_modules", "documents/node_modules"]) await writeFile(join(root, dir, "hidden.txt"), "hidden");
  await symlink(join(root, "report-0.txt"), join(root, "linked-file"));
  await symlink(root, join(root, "linked-directory"), "dir");
  const catalog = await listWorkspaceCatalogEntries(root, true);
  assert.deepEqual(catalog.skippedDirectories, []);
  assert.deepEqual(catalog.items.map(item => item.path), [...paths, "documents", "documents/nested", nested].sort((a, b) => a.localeCompare(b)));
  for (const item of catalog.items) {
    const info = await stat(join(root, item.path));
    const size = info.isDirectory() ? 0 : info.size;
    assert.equal(item.kind, info.isDirectory() ? "dir" : "file");
    assert.equal(item.size, size);
    assert.equal(item.mtimeMs, info.mtimeMs);
    assert.equal(item.revision, `${Math.floor(info.mtimeMs)}:${size}`);
  }
  const complete = await listWorkspaceCatalogEntries(root);
  for (const dir of [".git", "node_modules", "documents/node_modules"]) assert.ok(complete.items.some(item => item.path === `${dir}/hidden.txt`));
  assert.ok(complete.items.every(item => !item.path.startsWith("linked-")));
});

test("catalog keeps empty folders and reports a missing workspace", async t => {
  const root = await mkdtemp(join(tmpdir(), "openwork-catalog-empty-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual(await listWorkspaceCatalogEntries(root), { items: [], skippedDirectories: [] });
  await mkdir(join(root, "empty"));
  const catalog = await listWorkspaceCatalogEntries(root);
  assert.deepEqual(catalog.items.map(item => [item.path, item.kind, item.size]), [["empty", "dir", 0]]);
  await assert.rejects(listWorkspaceCatalogEntries(join(root, "missing")), error => error instanceof ApiError && error.status === 404 && error.code === "workspace_not_found");
});
