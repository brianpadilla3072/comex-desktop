import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeWorkspaceTextArtifact } from "../src/routes/files.js";
import { ApiError } from "../src/errors.js";

test("creating a page never overwrites an existing document and leaves no temporary file", async t => {
  const root = await mkdtemp(join(tmpdir(), "workspace-page-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "notes.md");
  await writeFile(path, "original");
  await assert.rejects(writeWorkspaceTextArtifact(path, "replacement", true), error => error instanceof ApiError && error.status === 409);
  assert.equal(await readFile(path, "utf8"), "original");
  assert.deepEqual(await readdir(root), ["notes.md"]);
});

test("two concurrent new pages with the same name produce one winner and one conflict", async t => {
  const root = await mkdtemp(join(tmpdir(), "workspace-page-race-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "nested", "notes.md");
  const results = await Promise.allSettled([writeWorkspaceTextArtifact(path, "one", true), writeWorkspaceTextArtifact(path, "two", true)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const rejected = results.find(result => result.status === "rejected");
  assert.ok(rejected?.status === "rejected" && rejected.reason instanceof ApiError && rejected.reason.status === 409);
  assert.ok(["one", "two"].includes(await readFile(path, "utf8")));
  assert.deepEqual(await readdir(join(root, "nested")), ["notes.md"]);
});
