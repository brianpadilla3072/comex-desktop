import { spawn } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { executableCandidates, scriptPtyPlan, type Platform, type SpawnPlan } from "./core.js";
import { DelegationError } from "./schema.js";

/**
 * Process edges for delegation. Pipes use node:child_process (Rust:
 * std::process / tokio::process). Pseudo-terminals come from an injected
 * factory (the desktop passes node-pty, which gives ConPTY on Windows; Rust:
 * portable-pty), else the `script` utility on macOS and Linux.
 */

export type ProcessExit = { code: number | null; signal: string | null };

export interface DelegateProcess {
  readonly pid: number | undefined;
  readonly terminal: boolean;
  write(data: string): void;
  closeInput(): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(listener: (chunk: string, stream: "stdout" | "stderr") => void): void;
  onExit(listener: (exit: ProcessExit) => void): void;
}

/** The subset of node-pty's IPty that delegation uses. */
export interface PtyLike {
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(listener: (data: string) => void): unknown;
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): unknown;
}

export type PtySpawnSpec = {
  file: string;
  /** A string is a verbatim Windows command line (cmd.exe /d /s /c "..."). */
  args: string[] | string;
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
};

export type PtyFactory = (spec: PtySpawnSpec) => PtyLike;

export type SpawnOptions = { cwd: string; env: Record<string, string> };

function killTree(pid: number | undefined, platform: Platform): void {
  if (!pid) return;
  if (platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    killer.on("error", () => undefined);
    return;
  }
  const signalGroup = (signal: NodeJS.Signals) => {
    try { process.kill(-pid, signal); } catch {
      try { process.kill(pid, signal); } catch { /* already gone */ }
    }
  };
  signalGroup("SIGTERM");
  setTimeout(() => signalGroup("SIGKILL"), 3000).unref();
}

export function spawnPipe(plan: SpawnPlan, options: SpawnOptions, platform: Platform = process.platform): DelegateProcess {
  const child = spawn(plan.file, plan.args, {
    cwd: options.cwd,
    env: options.env,
    // Own process group on POSIX so cancel reaches the agent's children too.
    detached: platform !== "win32",
    windowsHide: true,
    windowsVerbatimArguments: plan.windowsVerbatimArguments,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const dataListeners: Array<(chunk: string, stream: "stdout" | "stderr") => void> = [];
  const exitListeners: Array<(exit: ProcessExit) => void> = [];
  let exited: ProcessExit | null = null;
  const finish = (exit: ProcessExit) => {
    if (exited) return;
    exited = exit;
    for (const listener of exitListeners) listener(exit);
  };
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => { for (const listener of dataListeners) listener(chunk, "stdout"); });
  child.stderr?.on("data", (chunk: string) => { for (const listener of dataListeners) listener(chunk, "stderr"); });
  child.stdin?.on("error", () => undefined);
  child.on("error", (error) => {
    for (const listener of dataListeners) listener(`${error.message}\n`, "stderr");
    finish({ code: null, signal: "spawn_error" });
  });
  child.on("close", (code, signal) => finish({ code, signal }));
  return {
    pid: child.pid,
    terminal: false,
    write: (data) => { if (child.stdin?.writable) child.stdin.write(data); },
    closeInput: () => { child.stdin?.end(); },
    resize: () => undefined,
    kill: () => killTree(child.pid, platform),
    onData: (listener) => { dataListeners.push(listener); },
    onExit: (listener) => { if (exited) listener(exited); else exitListeners.push(listener); },
  };
}

export function spawnTerminal(
  plan: SpawnPlan,
  options: SpawnOptions & { cols: number; rows: number },
  factory: PtyFactory | undefined,
  platform: Platform = process.platform,
): DelegateProcess {
  const env = { ...options.env, TERM: "xterm-256color", COLUMNS: String(options.cols), LINES: String(options.rows) };
  if (factory) {
    const pty = factory({
      file: plan.file,
      args: plan.windowsVerbatimArguments ? plan.args.join(" ") : plan.args,
      cwd: options.cwd,
      env,
      cols: options.cols,
      rows: options.rows,
    });
    const exitListeners: Array<(exit: ProcessExit) => void> = [];
    let exited: ProcessExit | null = null;
    pty.onExit(({ exitCode, signal }) => {
      exited = { code: exitCode, signal: signal ? String(signal) : null };
      for (const listener of exitListeners) listener(exited);
    });
    const dataListeners: Array<(chunk: string, stream: "stdout" | "stderr") => void> = [];
    pty.onData((data) => { for (const listener of dataListeners) listener(data, "stdout"); });
    return {
      pid: pty.pid,
      terminal: true,
      write: (data) => { if (!exited) pty.write(data); },
      closeInput: () => { if (!exited) pty.write("\u0004"); },
      resize: (cols, rows) => { if (!exited) pty.resize(cols, rows); },
      kill: () => {
        if (exited) return;
        if (platform === "win32") killTree(pty.pid, platform);
        else { try { pty.kill(); } catch { killTree(pty.pid, platform); } }
      },
      onData: (listener) => { dataListeners.push(listener); },
      onExit: (listener) => { if (exited) listener(exited); else exitListeners.push(listener); },
    };
  }
  const fallback = plan.windowsVerbatimArguments ? null : scriptPtyPlan(plan.file, plan.args, platform);
  if (!fallback) {
    throw new DelegationError("delegate_pty_unavailable", "Interactive terminals need the OpenWork desktop app on Windows. Use a non-interactive (cli) recipe here.");
  }
  const child = spawnPipe(fallback, { cwd: options.cwd, env }, platform);
  return { ...child, terminal: true };
}

async function isExecutableFile(path: string, platform: Platform): Promise<boolean> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return false;
    if (platform !== "win32") await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** First existing candidate for a command name, or a delegate_executable_not_found error. */
export async function resolveExecutable(name: string, env: Record<string, string | undefined>, platform: Platform = process.platform): Promise<string> {
  const pathValue = env.PATH ?? env.Path ?? env.path ?? "";
  for (const candidate of executableCandidates(name, { platform, path: pathValue, pathExt: env.PATHEXT })) {
    if (await isExecutableFile(candidate, platform)) return candidate;
  }
  throw new DelegationError("delegate_executable_not_found", `"${name}" is not installed or not on PATH for OpenWork. Install it, or give its absolute path.`);
}

export type CommandResult = { code: number | null; stdout: string; stderr: string; timedOut: boolean; durationMs: number };

/** Run to completion with a time limit and an output cap (keeps the last `maxChars` of each stream). */
export function runToCompletion(
  plan: SpawnPlan,
  options: SpawnOptions & { stdin?: string | null; timeoutMs: number; maxChars: number },
  platform: Platform = process.platform,
): Promise<CommandResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawnPipe(plan, options, platform);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const cap = (value: string) => (value.length > options.maxChars ? value.slice(value.length - options.maxChars) : value);
    child.onData((chunk, stream) => {
      if (stream === "stdout") stdout = cap(stdout + chunk);
      else stderr = cap(stderr + chunk);
    });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, options.timeoutMs);
    child.onExit((exit) => {
      clearTimeout(timer);
      resolve({ code: exit.code, stdout, stderr, timedOut, durationMs: Date.now() - started });
    });
    if (options.stdin !== undefined && options.stdin !== null) child.write(options.stdin);
    child.closeInput();
  });
}
