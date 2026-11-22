import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir, userInfo } from "node:os";
import { join, relative, isAbsolute } from "node:path";
import { openworkConfigDir, openworkServerDataDir } from "@openwork/paths";
import { resolveDefaultEnvStorePath } from "../src/env-file.js";

// Guard for `test/setup/isolate-home.mjs`: a server test once wrote a variable into the person's
// real ~/.config/openwork/env.json. Every user-level path the server resolves must land in the
// per-run temp dir, even when a test forgets to isolate OPENWORK_ENV_STORE.
const root = process.env.OPENWORK_TEST_ISOLATED_HOME ?? "";
const realHome = userInfo().homedir;

function inside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

test("the test preload is active and owns HOME and the XDG roots", () => {
  assert.notEqual(root, "", "run server tests with the isolate-home preload (bunfig.toml or --import)");
  for (const name of ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"]) {
    assert.equal(inside(root, process.env[name] ?? ""), true, `${name} must point under the temp dir`);
  }
  assert.equal(inside(root, homedir()), true);
});

test("the env store and other user-level files resolve under the temp dir, never the real home", () => {
  const userLevel = [resolveDefaultEnvStorePath(), openworkConfigDir(), openworkServerDataDir()];
  for (const path of userLevel) {
    assert.equal(inside(root, path), true, `${path} must be under ${root}`);
    assert.equal(inside(join(realHome, ".config"), path), false);
    assert.equal(inside(join(realHome, ".openwork"), path), false);
  }
});

test("a test that drops OPENWORK_ENV_STORE still falls back to the temp config dir", () => {
  const previous = process.env.OPENWORK_ENV_STORE;
  delete process.env.OPENWORK_ENV_STORE;
  try {
    const path = resolveDefaultEnvStorePath();
    assert.equal(inside(root, path), true);
    assert.equal(inside(join(realHome, ".config"), path), false);
  } finally {
    if (previous === undefined) delete process.env.OPENWORK_ENV_STORE;
    else process.env.OPENWORK_ENV_STORE = previous;
  }
});
