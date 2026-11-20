// Test preload: keeps every server test away from the person's real files.
//
// Server code resolves user-level files through `@openwork/paths` (for example the env store at
// `~/.config/openwork/env.json`, the server data dir at `~/.openwork/openwork-server`, OpenCode's
// config and data under XDG). A test that isolates only some of them can still write into the
// real home, so this preload points HOME, the XDG roots and OPENWORK_ENV_STORE at one temp dir
// per run before any test module loads. A test that needs other values sets them itself; its
// assignments run later and win.
//
// Bun loads it through `[test] preload` in `apps/server/bunfig.toml`. Node loads it with
// `--import ./apps/server/test/setup/isolate-home.mjs` (see the root `test:comex` script).
// Child processes inherit the marker and reuse the parent's dir.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os, { tmpdir } from "node:os";
import { join } from "node:path";

const MARKER = "OPENWORK_TEST_ISOLATED_HOME";

function isolate() {
  const inherited = process.env[MARKER];
  const root = inherited || mkdtempSync(join(tmpdir(), "openwork-test-home-"));
  const dirs = {
    HOME: join(root, "home"),
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_DATA_HOME: join(root, "data"),
    XDG_STATE_HOME: join(root, "state"),
    XDG_CACHE_HOME: join(root, "cache"),
  };
  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });
  Object.assign(process.env, dirs, {
    [MARKER]: root,
    OPENWORK_ENV_STORE: join(dirs.XDG_CONFIG_HOME, "openwork", "env.json"),
  });
  if (process.platform === "win32") {
    process.env.USERPROFILE = dirs.HOME;
    process.env.APPDATA = join(root, "appdata");
    process.env.LOCALAPPDATA = join(root, "localappdata");
  }
  return inherited ? null : root;
}

// Only the process (or Bun isolation context) that created the dir removes it. `bun test
// --isolate` re-runs this preload per file without firing earlier exit handlers, so Bun cleans
// up in a global afterAll instead.
async function removeWhenDone(root) {
  if (!root) return;
  const remove = () => rmSync(root, { recursive: true, force: true });
  if (typeof Bun === "undefined") {
    process.on("exit", remove);
    return;
  }
  const { afterAll } = await import("bun:test");
  afterAll(remove);
}

// Node's os.homedir() reads HOME on every call. Bun's caches the startup value, so server code
// that calls homedir() directly (global OpenCode commands, plugins, MCP auth) would still reach
// the real home under `bun test`. Make it follow HOME like Node does, for both `require("os")`
// and ESM named imports.
async function followHomeUnderBun() {
  if (typeof Bun === "undefined") return;
  const startupHome = os.homedir;
  const homedir = () => process.env.HOME || startupHome();
  os.homedir = homedir;
  const { mock } = await import("bun:test");
  const patched = { ...os, homedir };
  mock.module("node:os", () => ({ ...patched, default: patched }));
  mock.module("os", () => ({ ...patched, default: patched }));
}

await removeWhenDone(isolate());
await followHomeUnderBun();
