import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  MAIN_CRASH_PATTERNS,
  findInstalledExe,
  findWindowsInstaller,
  hasPageTarget,
  normalizeVersion,
  scanLogForMainCrash,
} from "./windows-packaged-smoke.mjs";

function tempDir() {
  return mkdtempSync(join(tmpdir(), "openwork-windows-smoke-test-"));
}

test("findWindowsInstaller picks the newest staged installer", () => {
  const dir = tempDir();
  try {
    writeFileSync(join(dir, "openwork-win-x64-1.0.6.exe"), "");
    writeFileSync(join(dir, "openwork-win-x64-1.0.7.exe"), "");
    writeFileSync(join(dir, "latest.yml"), "");
    writeFileSync(join(dir, "openwork-linux-x86_64-1.0.7.AppImage"), "");
    mkdirSync(join(dir, "openwork-win-x64-1.0.7.exe.d"));
    const found = findWindowsInstaller(dir);
    assert.equal(join(found), join(dir, "openwork-win-x64-1.0.7.exe"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("findWindowsInstaller fails when no installer is staged", () => {
  const dir = tempDir();
  try {
    assert.throws(() => findWindowsInstaller(dir), /No openwork-win-x64-\*\.exe/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("findInstalledExe finds the product exe at the install root", () => {
  const dir = tempDir();
  try {
    writeFileSync(join(dir, "OpenWork.exe"), "");
    mkdirSync(join(dir, "resources"));
    assert.equal(findInstalledExe(dir), join(dir, "OpenWork.exe"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("findInstalledExe walks subdirectories and throws when absent", () => {
  const dir = tempDir();
  try {
    assert.throws(() => findInstalledExe(dir), /not found/);
    mkdirSync(join(dir, "OpenWork"));
    writeFileSync(join(dir, "OpenWork", "openwork.exe"), "");
    assert.equal(findInstalledExe(dir), join(dir, "OpenWork", "openwork.exe"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("normalizeVersion strips quotes, a leading v, and the Windows .0 build suffix", () => {
  assert.equal(normalizeVersion('"1.0.7"'), "1.0.7");
  assert.equal(normalizeVersion("v1.0.7\n"), "1.0.7");
  assert.equal(normalizeVersion(" 1.0.8 "), "1.0.8");
  assert.equal(normalizeVersion("1.0.8.0"), "1.0.8");
  assert.equal(normalizeVersion("9.9.9.1"), "9.9.9.1");
  assert.equal(normalizeVersion(null), "");
});

test("scanLogForMainCrash detects the packaged-boot crash signatures", () => {
  assert.deepEqual(scanLogForMainCrash("starting…\nDevTools listening on ws://…\n"), []);
  assert.deepEqual(
    scanLogForMainCrash('Error [ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING]: Stripping types is currently unsupported for files under node_modules, for "file:///…/app.asar/node_modules/@openwork/features/src/index.ts"'),
    ["ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING"],
  );
  assert.deepEqual(scanLogForMainCrash("A JavaScript error occurred in the main process"), [MAIN_CRASH_PATTERNS[1]]);
});

test("hasPageTarget requires a page with a debugger socket", () => {
  assert.equal(hasPageTarget([]), false);
  assert.equal(hasPageTarget([{ type: "page" }]), false);
  assert.equal(hasPageTarget([{ type: "service_worker", webSocketDebuggerUrl: "ws://x" }]), false);
  assert.equal(hasPageTarget(["nope", { type: "page", webSocketDebuggerUrl: "ws://127.0.0.1:9333/devtools/page/1" }]), true);
});
