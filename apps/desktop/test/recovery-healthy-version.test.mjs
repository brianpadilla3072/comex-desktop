import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordHealthyVersion, shouldRecordHealthyVersion } from "../electron/recovery.mjs";

// Every development launch logged "Error occurred in handler for
// 'openwork:recovery:recordHealthy'" because 0.0.0-dev is not a release.
test("development builds skip the healthy-version record; packaged builds keep it", () => {
  assert.equal(shouldRecordHealthyVersion({ isPackaged: false }), false);
  assert.equal(shouldRecordHealthyVersion({}), false);
  assert.equal(shouldRecordHealthyVersion({ isPackaged: true }), true);
});

test("a packaged build still records a stable version and rejects a non-release one", async () => {
  const root = await mkdtemp(join(tmpdir(), "openwork-recovery-"));
  const app = { isPackaged: true, getPath: () => root };
  try {
    await recordHealthyVersion(app, "stable", "1.2.3");
    const files = await import("node:fs/promises").then((fs) => fs.readdir(root, { recursive: true }));
    const state = files.find((name) => String(name).endsWith(".json"));
    assert.ok(state, `no recovery state written in ${files.join(",")}`);
    assert.equal(JSON.parse(await readFile(join(root, String(state)), "utf8")).currentVersion, "1.2.3");
    await assert.rejects(recordHealthyVersion(app, "stable", "0.0.0-dev"), /stable x\.y\.z/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
