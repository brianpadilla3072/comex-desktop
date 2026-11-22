import { afterEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createManagedOpencodeServer } from "../src/managed-opencode.js";

// Engine v1 announces "opencode server listening on <url>". OpenCode v2 prints
// "server listening on <url>". When OPENWORK_OPENCODE_BIN (or the `opencode` on
// PATH) is a v2 binary, the v1 launcher must say so at once and stop that
// engine, instead of waiting for its startup timeout with no explanation.

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const FAKE_V2_ENGINE = `#!/usr/bin/env node
require("node:fs").writeFileSync(process.env.FAKE_PID, String(process.pid));
process.stdout.write("server listening on http://127.0.0.1:" + process.env.FAKE_PORT + "\\n");
setInterval(() => {}, 1 << 30);
`;

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

test("a v2 binary handed to the v1 launcher fails fast with a clear message and is stopped", async () => {
  const root = await mkdtemp(join(tmpdir(), "openwork-v1-launcher-v2-bin-"));
  roots.push(root);
  const cwd = join(root, "cwd");
  await mkdir(cwd, { recursive: true });
  const bin = join(root, "opencode.cjs");
  await writeFile(bin, FAKE_V2_ENGINE, "utf8");
  await chmod(bin, 0o755);
  const pidFile = join(root, "engine.pid");
  const started = Date.now();
  const error = await createManagedOpencodeServer({
    bin, cwd, timeoutMs: 20_000,
    env: { FAKE_PID: pidFile, FAKE_PORT: "39999" },
  }).then(() => null, (reason: unknown) => reason);
  expect(error).toBeInstanceOf(Error);
  expect(error instanceof Error ? error.message : "").toContain("OpenCode v2");
  expect(error instanceof Error ? error.message : "").toContain("OPENWORK_OPENCODE_BIN");
  expect(Date.now() - started).toBeLessThan(10_000);
  const pid = Number(await readFile(pidFile, "utf8"));
  for (let attempt = 0; attempt < 50 && alive(pid); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  expect(alive(pid)).toBe(false);
});
