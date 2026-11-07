import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, closeSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Windows half of the packaged gate. Installs the real NSIS installer into an
// isolated directory, boots the installed app, and requires it to reach a CDP
// endpoint with a renderer page and the stamped version. This is what stops a
// release whose packaged main process cannot start (the 1.0.3/1.0.4 regression
// where Node refused to strip TypeScript inside node_modules) from publishing.
//
// Usage:
//   node apps/desktop/scripts/windows-packaged-smoke.mjs [--installer PATH_OR_DIR] [--version X.Y.Z]
// On the release runner the staged installer lives in release-assets/; the
// script resolves the newest openwork-win-x64-*.exe there when no explicit
// file is given. Everything is installed per-user under RUNNER_TEMP (or
// OPENWORK_WINDOWS_SMOKE_DIR) and uninstalled again in a finally block.

export const MAIN_CRASH_PATTERNS = [
  "ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING",
  "JavaScript error occurred in the main process",
];

export function findWindowsInstaller(dir) {
  const candidates = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^openwork-win-x64-(.+)\.exe$/i.test(entry.name))
    .map((entry) => ({ path: join(dir, entry.name), version: /^openwork-win-x64-(.+)\.exe$/i.exec(entry.name)[1], mtime: statSync(join(dir, entry.name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime || b.version.localeCompare(a.version, undefined, { numeric: true }));
  if (!candidates.length) throw new Error(`No openwork-win-x64-*.exe installer in ${dir}`);
  return candidates[0].path;
}

export function findInstalledExe(installDir) {
  const direct = [join(installDir, "OpenWork.exe"), join(installDir, "openwork.exe")];
  const hit = direct.find((candidate) => existsSync(candidate));
  if (hit) return hit;
  const found = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "resources" || entry.name === "node_modules") continue;
        walk(full);
      } else if (entry.isFile() && /^openwork\.exe$/i.test(entry.name)) {
        found.push(full);
      }
    }
  };
  walk(installDir);
  if (!found.length) throw new Error(`Installed executable not found under ${installDir}`);
  return found.sort((a, b) => a.length - b.length)[0];
}

export function normalizeVersion(value) {
  return String(value ?? "").trim().replace(/^v/i, "").replace(/^["']/, "").replace(/["']$/, "");
}

export function scanLogForMainCrash(text) {
  return MAIN_CRASH_PATTERNS.filter((pattern) => text.includes(pattern));
}

export function hasPageTarget(targets) {
  if (!Array.isArray(targets)) return false;
  return targets.some((target) => target?.type === "page" && typeof target?.webSocketDebuggerUrl === "string" && target.webSocketDebuggerUrl !== "");
}

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function run(label, command, args, { timeout = 180_000 } = {}) {
  console.log(`[windows-packaged-smoke] ${label}: ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { timeout, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status}`);
  return result;
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

async function waitFor(predicate, { timeoutMs, intervalMs, label }) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, intervalMs));
  }
  throw new Error(`${label} timed out after ${timeoutMs}ms${lastError ? ` (last error: ${lastError.message})` : ""}`);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response.json();
}

function powershellVersion(exe) {
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", `(Get-Item '${exe.replace(/'/g, "''")}').VersionInfo.ProductVersion`],
    { encoding: "utf8", timeout: 30_000 },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`VersionInfo read failed: ${result.stderr}`);
  return normalizeVersion(result.stdout);
}

function parseArgs() {
  const output = resolve(process.env.OPENWORK_WINDOWS_SMOKE_DIR || join(tmpdir(), "openwork-windows-smoke"));
  const installerArg = arg("--installer");
  const installer = installerArg?.endsWith(".exe")
    ? resolve(installerArg)
    : findWindowsInstaller(resolve(installerArg || "release-assets"));
  return {
    output,
    installer,
    expectedVersion: normalizeVersion(arg("--version")),
    installDir: join(output, "install"),
    profileDir: join(output, "profile"),
    logPath: join(output, "app.log"),
  };
}

function findUninstaller(exe) {
  const candidate = join(dirname(exe), "Uninstall.exe");
  return existsSync(candidate) ? candidate : null;
}

async function smoke() {
  if (process.platform !== "win32") throw new Error("The Windows packaged smoke runs on Windows only.");
  const { output, installer, expectedVersion, installDir, profileDir, logPath } = parseArgs();
  mkdirSync(output, { recursive: true });
  const port = await freePort();
  const started = performance.now();
  const phases = [];
  const phase = async (name, fn) => {
    const t0 = performance.now();
    const value = await fn();
    phases.push({ name, milliseconds: Math.round(performance.now() - t0) });
    console.log(`[windows-packaged-smoke] ${JSON.stringify(phases[phases.length - 1])}`);
    return value;
  };

  let child = null;
  let exe = null;
  let logFd = null;
  let passed = false;
  try {
    if (!existsSync(installer)) throw new Error(`Installer not found: ${installer}`);
    console.log(`[windows-packaged-smoke] installer=${installer} expectedVersion=${expectedVersion || "(any)"} installDir=${installDir} port=${port}`);

    await phase("install", async () => {
      await run("NSIS silent install", installer, ["/S", `/D=${installDir}`], { timeout: 240_000 });
      exe = findInstalledExe(installDir);
      const version = powershellVersion(exe);
      console.log(`[windows-packaged-smoke] installed exe=${exe} version=${version}`);
      if (expectedVersion && version !== expectedVersion) {
        throw new Error(`Installed version is ${version}, expected ${expectedVersion}`);
      }
      return version;
    });

    // Parent process output goes straight to the log fd (no JS buffering), so a
    // main-process crash message is greppable from disk even while the app runs.
    logFd = openSync(logPath, "w");
    child = spawn(exe, [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
    ], { detached: true, stdio: ["ignore", logFd, logFd], shell: false });

    await phase("boot", async () => {
      await waitFor(async () => {
        if (child.exitCode !== null) throw new Error(`App exited early with code ${child.exitCode}`);
        try {
          const info = await fetchJson(`http://127.0.0.1:${port}/json/version`);
          if (info?.Browser) return info;
        } catch { /* not up yet */ }
        return null;
      }, { timeoutMs: 90_000, intervalMs: 500, label: "CDP endpoint" });
      const targets = await waitFor(async () => {
        const list = await fetchJson(`http://127.0.0.1:${port}/json/list`);
        return hasPageTarget(list) ? list : null;
      }, { timeoutMs: 60_000, intervalMs: 500, label: "renderer page target" });
      console.log(`[windows-packaged-smoke] page targets=${targets.length}`);
    });

    await phase("main-crash-check", async () => {
      // A main-process exception (the type-stripping regression) shows a dialog
      // and then exits; give a delayed crash time to happen and re-check liveness.
      await new Promise((resolveWait) => setTimeout(resolveWait, 8_000));
      if (child.exitCode !== null) throw new Error(`App exited after boot with code ${child.exitCode}`);
      const crashes = scanLogForMainCrash(readFileSync(logPath, "utf8"));
      if (crashes.length) throw new Error(`Main process crash patterns in log: ${crashes.join(", ")}`);
      const aliveTargets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
      if (!hasPageTarget(aliveTargets)) throw new Error("No renderer page target after startup grace period");
    });

    passed = true;
  } finally {
    if (child && child.exitCode === null) {
      // TerminateProcess does not fire the app quit event, so an update that
      // happened to download in the background can never install mid-smoke.
      try { run("kill app", "taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { timeout: 30_000 }); } catch { /* already gone */ }
    }
    if (logFd !== null) { try { closeSync(logFd); } catch { /* already closed */ } }
    if (exe && existsSync(exe)) {
      const uninstaller = findUninstaller(exe);
      if (uninstaller) {
        try { run("NSIS silent uninstall", uninstaller, ["/S"], { timeout: 120_000 }); } catch { /* best effort */ }
      }
    }
  }
  return { passed, started, phases, logPath, output, installer: basename(installer), expectedVersion: expectedVersion || null };
}


function conclude(result) {
  const report = {
    passed: result.passed,
    milliseconds: Math.round(performance.now() - result.started),
    phases: result.phases,
    installer: result.installer,
    expectedVersion: result.expectedVersion,
  };
  writeFileSync(join(result.output, "timing.json"), `${JSON.stringify(report, null, 2)}\n`);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    let tail = "";
    try { tail = readFileSync(result.logPath, "utf8").slice(-4000); } catch { /* no log yet */ }
    writeFileSync(
      summary,
      `\n### Windows packaged smoke\n\n${report.passed ? "Passed" : "Failed"} in ${Math.round(report.milliseconds / 1000)}s. Installed ${report.installer} silently, booted it, and required a CDP-ready renderer with no main-process crash.\n\n${tail ? "```\n" + tail + "\n```\n" : ""}`,
      { flag: "a" },
    );
  }
  console.log(`[windows-packaged-smoke] ${JSON.stringify(report)}`);
  if (!report.passed) process.exitCode = 1;
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  (async () => {
    try {
      const result = await smoke();
      conclude(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[windows-packaged-smoke] FAILED: ${message}`);
      if (process.env.GITHUB_ACTIONS) console.log(`::error title=Windows packaged smoke::${message.slice(0, 500)}`);
      process.exit(1);
    }
  })();
}
