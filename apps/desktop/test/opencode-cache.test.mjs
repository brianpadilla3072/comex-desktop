import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { opencodeCacheCandidates, resetOpencodeCache } from "../electron/opencode-cache.mjs";

// "Repair OpenCode cache" in Settings was a disabled stub after the move from Tauri.
test("dev mode repairs the dev profile's isolated cache, never the person's real one", () => {
  const dev = opencodeCacheCandidates({ env: { OPENWORK_DEV_MODE: "1" }, homedir: "/home/person", platform: "linux", userDataPath: "/home/person/.config/app.dev" });
  assert.deepEqual(dev, ["/home/person/.config/app.dev/openwork-dev-data/xdg/cache/opencode", "/home/person/.config/app.dev/openwork-dev-data/home/.cache/opencode"]);
  const release = opencodeCacheCandidates({ env: {}, homedir: "/home/person", platform: "linux", userDataPath: "/home/person/.config/app" });
  assert.deepEqual(release, ["/home/person/.cache/opencode"]);
  const mac = opencodeCacheCandidates({ env: {}, homedir: "/Users/p", platform: "darwin", userDataPath: "/Users/p/Library/Application Support/app" });
  assert.ok(mac.includes("/Users/p/Library/Caches/opencode"));
  // Roaming APPDATA holds configuration, not cache: never a candidate.
  const win = opencodeCacheCandidates({ env: { LOCALAPPDATA: "C:\\Users\\p\\AppData\\Local", APPDATA: "C:\\Users\\p\\AppData\\Roaming" }, homedir: "C:\\Users\\p", platform: "win32", userDataPath: "C:\\Users\\p\\AppData\\Roaming\\app" });
  assert.ok(win.includes("C:\\Users\\p\\AppData\\Local\\opencode"));
  assert.equal(win.some(path => path.includes("Roaming")), false);
});

test("existing cache folders are removed, missing ones reported, symlinks never followed", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-cache-"));
  try {
    const present = join(root, "present", "opencode");
    await mkdir(join(present, "node_modules"), { recursive: true });
    await writeFile(join(present, "node_modules", "x.js"), "x");
    const outside = join(root, "outside"); await mkdir(outside); await writeFile(join(outside, "keep.txt"), "keep");
    const linked = join(root, "linked-opencode"); await symlink(outside, linked);
    const result = await resetOpencodeCache([present, join(root, "missing", "opencode"), linked]);
    assert.deepEqual(result.removed, [present]);
    assert.deepEqual(result.missing, [join(root, "missing", "opencode")]);
    assert.match(result.errors[0] ?? "", /symbolic link/);
    await assert.rejects(stat(present));
    assert.ok((await stat(join(outside, "keep.txt"))).isFile());
  } finally { await rm(root, { recursive: true, force: true }); }
});
