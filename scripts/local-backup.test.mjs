import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, mkdir, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { createBackup, restoreBackup, verifyBackup } from "./local-backup.mjs";

test("backup snapshots WAL, verifies, restores privately and never overwrites an existing profile", async () => {
  const root = await mkdtemp(join(tmpdir(), "openwork-backup-"));
  try {
    const source = join(root, "profile"); await mkdir(source);
    await writeFile(join(source, "notes.txt"), "fixture notes");
    const db = new DatabaseSync(join(source, "runtime.sqlite"));
    db.exec("PRAGMA journal_mode=WAL; CREATE TABLE notes (text TEXT); INSERT INTO notes VALUES ('persisted')");
    const destination = join(root, "backup");
    await assert.rejects(createBackup({ sources: [source], destination, appClosed: false }));
    const created = await createBackup({ sources: [source], destination, appClosed: true });
    db.close();
    assert.equal(created.files, 2);
    await assert.rejects(createBackup({ sources: [source], destination, appClosed: true }));
    await restoreBackup({ directory: destination, destination: join(root, "restored") });
    const restored = new DatabaseSync(join(root, "restored/1-profile/runtime.sqlite"), { readOnly: true });
    assert.equal(restored.prepare("SELECT text FROM notes").get().text, "persisted"); restored.close();
    assert.equal(await readFile(join(root, "restored/1-profile/notes.txt"), "utf8"), "fixture notes");
    await assert.rejects(restoreBackup({ directory: destination, destination: source }));
    await writeFile(join(destination, "1-profile/notes.txt"), "changed");
    await assert.rejects(verifyBackup(destination));
    await assert.rejects(restoreBackup({ directory: destination, destination: join(root, "bad-restore") }));
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("symlinks and escaping manifests are rejected", async () => {
  const root = await mkdtemp(join(tmpdir(), "openwork-backup-paths-"));
  try {
    const source = join(root, "profile"); await mkdir(source); await writeFile(join(source, "a"), "a");
    await symlink(join(source, "a"), join(source, "link"));
    await assert.rejects(createBackup({ sources: [source], destination: join(root, "backup"), appClosed: true }));
    await mkdir(join(root, "bad")); await writeFile(join(root, "bad/manifest.json"), JSON.stringify({ version: 1, directories: [], files: [{ path: "../escape", bytes: 1, sha256: "a".repeat(64) }] }));
    await assert.rejects(verifyBackup(join(root, "bad")));
  } finally { await rm(root, { recursive: true, force: true }); }
});
