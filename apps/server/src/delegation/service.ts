import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join, relative, resolve as resolvePath } from "node:path";
import {
  TerminalScreen,
  classifyPermission,
  delegateEnvironment,
  finalAnswer,
  keySequence,
  normalizeCommand,
  permissionRequestView,
  pickPermissionOption,
  planRun,
  planSpawn,
  recipeProblems,
  stripAnsi,
  tail,
  type PermissionOption,
  type Platform,
} from "./core.js";
import { ACP_PROTOCOL_VERSION, AcpConnection, acpUpdateEffect, loadSessionSupported, sessionIdOf, stopReasonOf } from "./acp.js";
import { resolveExecutable, runToCompletion, spawnPipe, spawnTerminal, type DelegateProcess, type PtyFactory } from "./process.js";
import {
  DelegationError,
  delegateRecipe,
  permissionPolicy,
  type DelegateRecipe,
  type KeyName,
  type ReplyDecision,
  type StoredDelegate,
  type TaskState,
} from "./schema.js";
import { delegateStorePath, putDelegate, readDelegateStore, removeDelegate } from "./store.js";

/**
 * Runs external agent CLIs for OpenCode. One service per running OpenWork
 * server (owner: startServer; lifetime: until close()). It owns every process,
 * terminal and worktree it starts and stops them on close.
 *
 * A task is `running`, or `needs_input` when the external agent waits for an
 * answer (an ACP permission request, a terminal or stdin question). The
 * managing agent answers with reply(); risky permissions go to the person.
 */

/** Asks the person. The desktop shows a native dialog; other hosts use OpenWork's approval queue. */
export type DelegationApprovals = {
  confirm(input: { workspaceId: string; action: "run" | "register" | "permission"; title: string; detail: string }): Promise<{ allowed: boolean; reason?: string }>;
};

export type DelegationServiceOptions = {
  runtimeDir: string;
  workspacePath: (workspaceId: string) => string | null;
  approvals: DelegationApprovals;
  ptyFactory?: PtyFactory;
  platform?: Platform;
  env?: Record<string, string | undefined>;
  now?: () => number;
  /** How long a finished ACP session or terminal task stays open for follow-ups. */
  keepAliveMs?: number;
};

const MAX_LIVE_TASKS = 8;
const MAX_TERMINALS = 8;
const LOG_CHARS = 262_144;
const ANSWER_CHARS = 16_000;
const PREVIEW_CHARS = 4_000;
const ACTIVITY_LINES = 40;
const ACP_HANDSHAKE_MS = 60_000;

type Worktree = { path: string; branch: string; repoRoot: string };

export type PendingInput =
  | { type: "permission"; title: string; kind: string; command: string | null; paths: string[]; options: PermissionOption[]; reason: string }
  | { type: "question"; text: string };

type FinishedBy = "exit" | "done_text" | "turn_end" | "reply_done" | "timeout" | "cancel" | "error";

type Task = {
  id: string;
  workspaceId: string;
  agent: string;
  recipe: DelegateRecipe;
  state: TaskState;
  finishedBy: FinishedBy | null;
  startedAt: number;
  endedAt: number | null;
  exitCode: number | null;
  alive: boolean;
  cwd: string;
  worktree: Worktree | null;
  projectHadUncommittedChanges: boolean;
  stdout: string;
  stderr: string;
  /** ACP: the agent's message text for the current turn. */
  answer: string;
  activity: string[];
  turns: number;
  sessionId: string | null;
  terminalId: string | null;
  process: DelegateProcess;
  acp: AcpConnection | null;
  stdinOpen: boolean;
  lastOutputAt: number;
  pendingInput: PendingInput | null;
  answerPermission: ((decision: "allow" | "allow_always" | "reject") => void) | null;
  error: string | null;
  timer: ReturnType<typeof setTimeout> | null;
  keepAliveTimer: ReturnType<typeof setTimeout> | null;
  waiters: Array<() => void>;
};

type Terminal = {
  id: string;
  workspaceId: string;
  command: string[];
  process: DelegateProcess;
  screen: TerminalScreen;
  readCursor: number;
  exit: { code: number | null; signal: string | null } | null;
  changedAt: number;
  scratchDir: string | null;
  taskId: string | null;
};

function id(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new DelegationError("delegate_protocol_error", message)), ms);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error: unknown) => { clearTimeout(timer); reject(error); });
  });
}

function permissionOptions(params: unknown): PermissionOption[] {
  const options = typeof params === "object" && params !== null ? Reflect.get(params, "options") : undefined;
  if (!Array.isArray(options)) return [];
  return options.flatMap((option): PermissionOption[] => {
    if (typeof option !== "object" || option === null) return [];
    const optionId: unknown = Reflect.get(option, "optionId");
    const kind: unknown = Reflect.get(option, "kind");
    const name: unknown = Reflect.get(option, "name");
    return typeof optionId === "string" && typeof kind === "string" ? [{ optionId, kind, ...(typeof name === "string" ? { name } : {}) }] : [];
  });
}

export class DelegationService {
  private readonly tasks = new Map<string, Task>();
  private readonly terminals = new Map<string, Terminal>();
  /** Executables the person allowed the agent to run for discovery during this server's lifetime. */
  private readonly approvedExecutables = new Set<string>();
  private readonly platform: Platform;
  private readonly env: Record<string, string | undefined>;
  private readonly now: () => number;
  private readonly keepAliveMs: number;
  private closed = false;

  constructor(private readonly options: DelegationServiceOptions) {
    this.platform = options.platform ?? process.platform;
    this.env = options.env ?? process.env;
    this.now = options.now ?? Date.now;
    this.keepAliveMs = options.keepAliveMs ?? 30 * 60_000;
  }

  get storePath(): string {
    return delegateStorePath(this.options.runtimeDir);
  }

  private workspaceDir(workspaceId: string): string {
    const path = this.options.workspacePath(workspaceId);
    if (!path) throw new DelegationError("delegate_workspace_not_found", "This project is no longer open in OpenWork.");
    return path;
  }

  private childEnv(extra: Record<string, string> = {}): Record<string, string> {
    return delegateEnvironment(this.env, extra);
  }

  private get comspec(): string | undefined {
    return this.env.ComSpec ?? this.env.COMSPEC;
  }

  private async approve(workspaceId: string, action: "run" | "register", title: string, detail: string): Promise<void> {
    const result = await this.options.approvals.confirm({ workspaceId, action, title, detail });
    if (!result.allowed) {
      throw new DelegationError("delegate_approval_denied", result.reason === "no_responder"
        ? "Nobody is available to approve this in OpenWork right now. Ask the person to open the app and try again."
        : "The person did not approve this. Ask them what they want instead.");
    }
  }

  private async approveExecutable(workspaceId: string, executable: string, argv: string[]): Promise<void> {
    if (this.approvedExecutables.has(executable)) return;
    await this.approve(workspaceId, "run", `Let the agent run ${argv[0] ?? executable}?`, `The agent wants to run this program to learn how it works or to use it in a terminal. Later commands of the same program in this session will not ask again.\n\nProgram: ${executable}\nFirst command: ${argv.join(" ").slice(0, 300)}`);
    this.approvedExecutables.add(executable);
  }

  private async scratchDir(): Promise<string> {
    return mkdtemp(join(tmpdir(), "openwork-delegate-"));
  }

  // ── Registered recipes ────────────────────────────────────────────────

  async list(): Promise<Array<{ name: string; kind: string; description: string; command: string[]; status: "ready" | "missing" | "changed"; version: string | null; notes: string[] }>> {
    const store = await readDelegateStore(this.storePath);
    return Promise.all(Object.values(store.agents).map(async (entry) => {
      let status: "ready" | "missing" | "changed" = "ready";
      try {
        const executable = await resolveExecutable(entry.recipe.command[0] ?? "", this.env, this.platform);
        if (executable !== entry.executable) status = "changed";
        else if (entry.recipe.versionCommand && entry.version !== null) {
          const version = await this.readVersion(entry.recipe.versionCommand);
          if (version !== null && version !== entry.version) status = "changed";
        }
      } catch {
        status = "missing";
      }
      return { name: entry.recipe.name, kind: entry.recipe.kind, description: entry.recipe.description, command: entry.recipe.command, status, version: entry.version, notes: entry.recipe.notes };
    }));
  }

  private async readVersion(command: string[]): Promise<string | null> {
    try {
      const executable = await resolveExecutable(command[0] ?? "", this.env, this.platform);
      const plan = planSpawn(executable, command.slice(1), this.platform, this.comspec);
      const result = await runToCompletion(plan, { cwd: tmpdir(), env: this.childEnv({ NO_COLOR: "1" }), timeoutMs: 15_000, maxChars: 4000 }, this.platform);
      const line = stripAnsi(`${result.stdout}\n${result.stderr}`).split("\n").map((part) => part.trim()).find(Boolean);
      return line ? line.slice(0, 200) : null;
    } catch {
      return null;
    }
  }

  async register(workspaceId: string, input: unknown): Promise<{ registered: StoredDelegate }> {
    const parsed = delegateRecipe.safeParse(input);
    if (!parsed.success) throw new DelegationError("delegate_invalid_recipe", parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
    const recipe = parsed.data;
    const problems = recipeProblems(recipe);
    if (problems.length) throw new DelegationError("delegate_invalid_recipe", `Fix the recipe: ${problems.join(", ")}.`);
    const executable = await resolveExecutable(recipe.command[0] ?? "", this.env, this.platform);
    const permissions = recipe.kind === "acp" ? permissionPolicy.parse(recipe.permissions ?? {}) : null;
    const policyText = permissions ? `\nPermissions it asks for: automatic for ${permissions.allow.join(", ") || "nothing"}; the agent decides ${permissions.agent.join(", ") || "nothing"}; you decide ${permissions.person.join(", ") || "nothing"} and anything risky or outside the project.` : "";
    await this.approve(workspaceId, "register", `Let the agent hand tasks to "${recipe.name}"?`, `From now on the agent can run this program with tasks it writes, without asking again.\n\nCommand: ${[executable, ...recipe.command.slice(1)].join(" ").slice(0, 400)}\nWorks: ${recipe.isolation === "worktree" ? "in an isolated git copy of the project" : "directly in the project folder"}${policyText}${recipe.notes.length ? `\nNotes: ${recipe.notes.join(" · ").slice(0, 400)}` : ""}`);
    this.approvedExecutables.add(executable);
    const version = recipe.versionCommand ? await this.readVersion(recipe.versionCommand) : null;
    const entry: StoredDelegate = { recipe, executable, version, registeredAt: this.now() };
    await putDelegate(this.storePath, entry);
    return { registered: entry };
  }

  async unregister(name: string): Promise<{ removed: boolean }> {
    const store = await readDelegateStore(this.storePath);
    if (!store.agents[name]) return { removed: false };
    await removeDelegate(this.storePath, name);
    return { removed: true };
  }

  // ── Discovery ─────────────────────────────────────────────────────────

  async probe(workspaceId: string, input: { command: string | string[]; stdin?: string; timeoutSeconds?: number; where?: "scratch" | "workspace" }) {
    const command = normalizeCommand(input.command);
    const executable = await resolveExecutable(command[0] ?? "", this.env, this.platform);
    await this.approveExecutable(workspaceId, executable, command);
    const scratch = input.where === "workspace" ? null : await this.scratchDir();
    try {
      const cwd = scratch ?? this.workspaceDir(workspaceId);
      const plan = planSpawn(executable, command.slice(1), this.platform, this.comspec);
      const result = await runToCompletion(plan, {
        cwd,
        env: this.childEnv({ NO_COLOR: "1" }),
        stdin: input.stdin ?? null,
        timeoutMs: (input.timeoutSeconds ?? 30) * 1000,
        maxChars: 64_000,
      }, this.platform);
      return {
        executable,
        exitCode: result.code,
        timedOut: result.timedOut,
        durationMs: result.durationMs,
        stdout: tail(stripAnsi(result.stdout), 24_000),
        stderr: tail(stripAnsi(result.stderr), 8_000),
        hint: result.timedOut ? "It did not finish in time. It may be waiting for input: try a non-interactive flag, an ACP mode, or open it with term_open." : undefined,
      };
    } finally {
      if (scratch) await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  // ── Worktrees ─────────────────────────────────────────────────────────

  private async git(args: string[], cwd: string, timeoutMs = 60_000) {
    const git = await resolveExecutable("git", this.env, this.platform);
    return runToCompletion(planSpawn(git, args, this.platform, this.comspec), { cwd, env: this.childEnv({ GIT_TERMINAL_PROMPT: "0" }), timeoutMs, maxChars: 200_000 }, this.platform);
  }

  private async createWorktree(workspaceDir: string, taskId: string): Promise<{ worktree: Worktree; cwd: string; dirty: boolean }> {
    const top = await this.git(["rev-parse", "--show-toplevel"], workspaceDir).catch(() => null);
    const repoRoot = top && top.code === 0 ? top.stdout.trim() : "";
    if (!repoRoot) {
      throw new DelegationError("delegate_worktree_unavailable", "This project is not a git repository, so the task cannot run in an isolated copy. Start it with isolation \"workspace\" only if the person agrees to direct edits.");
    }
    const head = await this.git(["rev-parse", "--verify", "HEAD"], repoRoot);
    if (head.code !== 0) throw new DelegationError("delegate_worktree_unavailable", "This git repository has no commits yet, so there is nothing to copy. Commit first or use isolation \"workspace\".");
    const status = await this.git(["status", "--porcelain"], repoRoot);
    const path = join(this.options.runtimeDir, "delegates", "worktrees", taskId);
    await mkdir(join(this.options.runtimeDir, "delegates", "worktrees"), { recursive: true });
    const branch = `openwork-delegate/${taskId}`;
    const added = await this.git(["worktree", "add", "-b", branch, path, "HEAD"], repoRoot);
    if (added.code !== 0) throw new DelegationError("delegate_worktree_unavailable", `git could not create the isolated copy: ${tail(added.stderr.trim(), 500)}`);
    const inside = relative(resolvePath(repoRoot), resolvePath(workspaceDir));
    const cwd = inside && !inside.startsWith("..") ? join(path, inside) : path;
    return { worktree: { path, branch, repoRoot }, cwd, dirty: status.stdout.trim().length > 0 };
  }

  private async worktreeChanges(worktree: Worktree): Promise<{ files: string[]; diffStat: string }> {
    const status = await this.git(["status", "--porcelain=v1", "-uall"], worktree.path);
    const diff = await this.git(["diff", "--stat", "HEAD"], worktree.path);
    const files = status.stdout.split("\n").map((line) => line.trimEnd()).filter(Boolean).slice(0, 500);
    return { files, diffStat: tail(diff.stdout.trim(), 4000) };
  }

  private async removeWorktree(worktree: Worktree): Promise<void> {
    await this.git(["worktree", "remove", "--force", worktree.path], worktree.repoRoot).catch(() => null);
    await this.git(["branch", "-D", worktree.branch], worktree.repoRoot).catch(() => null);
    await rm(worktree.path, { recursive: true, force: true }).catch(() => undefined);
  }

  // ── Tasks ─────────────────────────────────────────────────────────────

  async start(workspaceId: string, input: { agent: string; prompt: string; isolation?: "worktree" | "workspace"; sessionId?: string; timeoutSeconds?: number }) {
    if (this.closed) throw new DelegationError("delegate_limit_reached", "OpenWork is shutting down.");
    const live = [...this.tasks.values()].filter((task) => task.alive).length;
    if (live >= MAX_LIVE_TASKS) throw new DelegationError("delegate_limit_reached", `${MAX_LIVE_TASKS} delegated tasks are already open. Wait for one to finish, or cancel or discard one.`);
    const store = await readDelegateStore(this.storePath);
    const entry = store.agents[input.agent];
    if (!entry) throw new DelegationError("delegate_not_found", `No delegate named "${input.agent}". Use delegate_list, or learn it first (delegate_guide).`);
    const recipe = entry.recipe;
    const executable = await resolveExecutable(recipe.command[0] ?? "", this.env, this.platform);
    const workspaceDir = this.workspaceDir(workspaceId);
    const run = recipe.kind === "acp"
      ? { argv: [...recipe.command], stdin: null }
      : planRun(recipe, { prompt: input.prompt, sessionId: input.sessionId });
    const isolation = input.isolation ?? recipe.isolation;
    const taskId = id("dt");
    let worktree: Worktree | null = null;
    let cwd = workspaceDir;
    let dirty = false;
    if (isolation === "worktree") {
      const created = await this.createWorktree(workspaceDir, taskId);
      worktree = created.worktree;
      cwd = created.cwd;
      dirty = created.dirty;
    }
    const plan = planSpawn(executable, run.argv.slice(1), this.platform, this.comspec);
    let processHandle: DelegateProcess;
    let terminal: Terminal | null = null;
    try {
      if (recipe.kind === "pty") {
        terminal = this.openTerminalProcess(workspaceId, [executable, ...run.argv.slice(1)], plan, cwd, null, 120, 40);
        terminal.taskId = taskId;
        processHandle = terminal.process;
      } else {
        processHandle = spawnPipe(plan, { cwd, env: this.childEnv({ NO_COLOR: "1" }) }, this.platform);
      }
    } catch (error) {
      if (worktree) await this.removeWorktree(worktree);
      throw error;
    }
    const task: Task = {
      id: taskId,
      workspaceId,
      agent: recipe.name,
      recipe,
      state: "running",
      finishedBy: null,
      startedAt: this.now(),
      endedAt: null,
      exitCode: null,
      alive: true,
      cwd,
      worktree,
      projectHadUncommittedChanges: dirty,
      stdout: "",
      stderr: "",
      answer: "",
      activity: [],
      turns: 0,
      sessionId: input.sessionId ?? null,
      terminalId: terminal?.id ?? null,
      process: processHandle,
      acp: null,
      stdinOpen: recipe.kind === "cli" && recipe.keepStdinOpen,
      lastOutputAt: this.now(),
      pendingInput: null,
      answerPermission: null,
      error: null,
      timer: null,
      keepAliveTimer: null,
      waiters: [],
    };
    this.tasks.set(taskId, task);
    processHandle.onExit((exit) => {
      task.alive = false;
      task.exitCode = exit.code;
      if (task.keepAliveTimer) clearTimeout(task.keepAliveTimer);
      if (task.answerPermission) task.answerPermission("reject");
      if (task.state === "running" || task.state === "needs_input") {
        const failed = exit.code !== 0 || (task.acp !== null && task.turns > 0);
        if (task.acp && !task.error && failed) task.error = tail(stripAnsi(task.acp.stderr).trim(), 1500) || "The agent stopped unexpectedly.";
        this.finish(task, failed ? "failed" : "succeeded", "exit");
      }
    });
    this.armTimeout(task, input.timeoutSeconds ?? recipe.timeoutSeconds);
    if (recipe.kind === "acp") {
      processHandle.onData((chunk, stream) => {
        if (stream === "stderr") task.stderr = tail(task.stderr + chunk, LOG_CHARS);
      });
      task.acp = new AcpConnection(processHandle, {
        onUpdate: (update) => this.onAcpUpdate(task, update),
        onPermission: (params) => this.onAcpPermission(task, params),
      });
      void this.runAcp(task, input.prompt, input.sessionId);
    } else if (terminal) {
      void this.drivePty(task, terminal, run.stdin);
    } else {
      processHandle.onData((chunk, stream) => {
        task.lastOutputAt = this.now();
        if (stream === "stdout") task.stdout = tail(task.stdout + chunk, LOG_CHARS);
        else task.stderr = tail(task.stderr + chunk, LOG_CHARS);
        if (task.state === "needs_input" && task.pendingInput?.type === "question") this.setRunning(task);
      });
      if (run.stdin !== null) processHandle.write(task.stdinOpen ? `${run.stdin}\n` : run.stdin);
      if (task.stdinOpen) void this.watchCli(task);
      else processHandle.closeInput();
    }
    return this.describe(task);
  }

  private armTimeout(task: Task, seconds: number): void {
    if (task.timer) clearTimeout(task.timer);
    task.timer = setTimeout(() => {
      if (task.state !== "running" && task.state !== "needs_input") return;
      task.process.kill();
      this.finish(task, "timed_out", "timeout");
    }, seconds * 1000);
    task.timer.unref?.();
  }

  private notify(task: Task): void {
    for (const waiter of task.waiters.splice(0)) waiter();
  }

  private needInput(task: Task, pending: PendingInput): void {
    task.pendingInput = pending;
    task.state = "needs_input";
    this.notify(task);
  }

  private setRunning(task: Task): void {
    task.pendingInput = null;
    task.answerPermission = null;
    task.state = "running";
  }

  private addActivity(task: Task, line: string): void {
    task.activity.push(line.slice(0, 600));
    if (task.activity.length > ACTIVITY_LINES) task.activity.splice(0, task.activity.length - ACTIVITY_LINES);
  }

  private finish(task: Task, state: TaskState, by: FinishedBy): void {
    if (task.state !== "running" && task.state !== "needs_input" && task.state !== "starting") return;
    task.state = state;
    task.finishedBy = by;
    task.endedAt = this.now();
    task.pendingInput = null;
    task.answerPermission = null;
    if (task.timer) clearTimeout(task.timer);
    task.timer = null;
    if (task.recipe.output === "jsonl") {
      const answer = finalAnswer(task.recipe, task.stdout, ANSWER_CHARS);
      if (answer.sessionId) task.sessionId = answer.sessionId;
    }
    // A finished ACP session or terminal program stays open for follow-ups, then is stopped.
    if (task.alive && state === "succeeded") {
      if (task.keepAliveTimer) clearTimeout(task.keepAliveTimer);
      task.keepAliveTimer = setTimeout(() => { if (task.state !== "running" && task.state !== "needs_input") task.process.kill(); }, this.keepAliveMs);
      task.keepAliveTimer.unref?.();
    } else if (task.alive && state !== "succeeded") {
      task.process.kill();
    }
    this.notify(task);
  }

  // ── ACP ───────────────────────────────────────────────────────────────

  private async runAcp(task: Task, prompt: string, resumeSessionId: string | undefined): Promise<void> {
    const acp = task.acp;
    if (!acp) return;
    try {
      const init = await withTimeout(acp.request("initialize", {
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: "openwork-delegates", title: "OpenWork", version: "1.0.0" },
      }), ACP_HANDSHAKE_MS, "The agent did not answer the ACP handshake. Is this really its ACP command?");
      if (resumeSessionId) {
        if (!loadSessionSupported(init)) throw new DelegationError("delegate_protocol_error", "This agent cannot reopen earlier sessions. Start a new task instead.");
        await withTimeout(acp.request("session/load", { sessionId: resumeSessionId, cwd: task.cwd, mcpServers: [] }), ACP_HANDSHAKE_MS, "The agent did not reopen the session in time.");
        task.sessionId = resumeSessionId;
      } else {
        const created = await withTimeout(acp.request("session/new", { cwd: task.cwd, mcpServers: [] }), ACP_HANDSHAKE_MS, "The agent did not start a session in time. It may need you to sign in: try its login command with term_open.");
        task.sessionId = sessionIdOf(created);
        if (!task.sessionId) throw new DelegationError("delegate_protocol_error", "The agent did not return a session id.");
      }
      if (task.recipe.acpMode) {
        await acp.request("session/set_mode", { sessionId: task.sessionId, modeId: task.recipe.acpMode })
          .catch((error: unknown) => this.addActivity(task, `could not select mode ${task.recipe.acpMode}: ${error instanceof Error ? error.message : "error"}`));
      }
      await this.acpTurn(task, prompt);
    } catch (error) {
      task.error = error instanceof Error ? error.message : "The agent could not start.";
      if (task.state === "running" || task.state === "needs_input") this.finish(task, "failed", "error");
    }
  }

  private async acpTurn(task: Task, text: string): Promise<void> {
    const acp = task.acp;
    if (!acp || !task.sessionId) return;
    task.answer = "";
    task.turns += 1;
    const result = await acp.request("session/prompt", { sessionId: task.sessionId, prompt: [{ type: "text", text }] });
    if (task.state !== "running" && task.state !== "needs_input") return;
    const stopReason = stopReasonOf(result);
    if (stopReason === "cancelled") this.finish(task, "cancelled", "cancel");
    else if (stopReason === "refusal") {
      task.error = "The agent refused this request.";
      this.finish(task, "failed", "turn_end");
    } else {
      if (stopReason !== "end_turn") this.addActivity(task, `turn ended: ${stopReason}`);
      this.finish(task, "succeeded", "turn_end");
    }
  }

  private onAcpUpdate(task: Task, update: unknown): void {
    task.lastOutputAt = this.now();
    const effect = acpUpdateEffect(update);
    if (effect.type === "message") task.answer = tail(task.answer + effect.text, LOG_CHARS);
    else if (effect.type === "activity") this.addActivity(task, effect.line);
  }

  private async onAcpPermission(task: Task, params: unknown): Promise<unknown> {
    const toolCall = typeof params === "object" && params !== null ? Reflect.get(params, "toolCall") : undefined;
    const view = permissionRequestView(toolCall);
    const options = permissionOptions(params);
    const policy = permissionPolicy.parse(task.recipe.permissions ?? {});
    const { decision, reason } = classifyPermission(view, policy, task.cwd, this.platform);
    const selected = (choice: "allow" | "allow_always" | "reject") => {
      const optionId = pickPermissionOption(options, choice);
      return optionId ? { outcome: { outcome: "selected", optionId } } : { outcome: { outcome: "cancelled" } };
    };
    const label = view.command ?? (view.title || view.kind);
    if (decision === "allow") {
      this.addActivity(task, `allowed automatically: ${label}`);
      return selected("allow");
    }
    if (decision === "deny") {
      this.addActivity(task, `rejected by policy: ${label}`);
      return selected("reject");
    }
    if (decision === "person") {
      const allowed = await this.askPerson(task, view.title, view.command, view.paths, reason);
      this.addActivity(task, `${allowed ? "allowed" : "rejected"} by the person: ${label}`);
      return selected(allowed ? "allow" : "reject");
    }
    return new Promise((resolve) => {
      task.answerPermission = (choice) => {
        task.answerPermission = null;
        this.addActivity(task, `${choice === "reject" ? "rejected" : "allowed"} by the agent: ${label}`);
        resolve(selected(choice));
      };
      this.needInput(task, { type: "permission", title: view.title, kind: view.kind, command: view.command, paths: view.paths, options, reason });
    });
  }

  private async askPerson(task: Task, title: string, command: string | null, paths: string[], reason: string): Promise<boolean> {
    const why = reason === "outside_folder" ? "It touches files outside the task folder." : reason === "risky_command" ? "The command can reach the network, use privileges or change things outside the project." : "Your OpenWork settings ask you to decide this kind of action.";
    const result = await this.options.approvals.confirm({
      workspaceId: task.workspaceId,
      action: "permission",
      title: `Let ${task.agent} do this?`,
      detail: `${title || "An action"}${command ? `\n\nCommand: ${command.slice(0, 600)}` : ""}${paths.length ? `\nFiles: ${paths.slice(0, 5).join(", ").slice(0, 600)}` : ""}\n\n${why}\nTask folder: ${task.cwd}`,
    }).catch(() => ({ allowed: false }));
    return result.allowed;
  }

  // ── Terminal and stdin questions ──────────────────────────────────────

  /** Types the prompt when the program is ready, then watches for doneText, or an idle screen that waits for an answer. */
  private async drivePty(task: Task, terminal: Terminal, stdin: string | null): Promise<void> {
    const recipe = task.recipe;
    if (stdin !== null) {
      await this.waitForScreen(terminal, { text: recipe.readyText, idleMs: 1500, timeoutMs: 60_000 });
      if (task.state !== "running") return;
      terminal.process.write(stdin.replace(/\r?\n/g, "\r"));
      await sleep(150);
      terminal.process.write("\r");
    }
    const promptCursor = terminal.screen.readSince(0).cursor;
    let flaggedRevision = -1;
    while ((task.state === "running" || task.state === "needs_input") && !terminal.exit) {
      await sleep(500);
      if (task.state === "needs_input") {
        // New output after a question means the program moved on by itself.
        if (terminal.screen.revision !== flaggedRevision && this.now() - terminal.changedAt < 1000) this.setRunning(task);
        continue;
      }
      if (task.state !== "running") return;
      const since = terminal.screen.readSince(promptCursor).text;
      if (recipe.doneText && since.includes(recipe.doneText)) {
        this.finish(task, "succeeded", "done_text");
        return;
      }
      // A quiet screen means it waits for something: the program may also have asked before the prompt was typed.
      if (terminal.screen.revision > 0 && this.now() - terminal.changedAt >= recipe.idleSeconds * 1000) {
        flaggedRevision = terminal.screen.revision;
        this.needInput(task, { type: "question", text: terminal.screen.text(5) });
      }
    }
  }

  private async watchCli(task: Task): Promise<void> {
    while (task.alive && (task.state === "running" || task.state === "needs_input")) {
      await sleep(1000);
      if (task.state === "running" && this.now() - task.lastOutputAt >= task.recipe.idleSeconds * 1000) {
        this.needInput(task, { type: "question", text: tail(stripAnsi(`${task.stdout}\n${task.stderr}`).trim(), 3000) });
      }
    }
  }

  // ── Replies ───────────────────────────────────────────────────────────

  async reply(taskId: string, input: { decision?: ReplyDecision; text?: string; keys?: KeyName[] }) {
    const task = this.task(taskId);
    if (task.pendingInput?.type === "permission") {
      const answer = task.answerPermission;
      if (!answer) throw new DelegationError("delegate_not_waiting", "This permission request was already answered.");
      const decision = input.decision;
      if (!decision || decision === "done") throw new DelegationError("delegate_not_waiting", "The agent is waiting for a permission decision: reply with decision allow, allow_always, reject or ask_person.");
      const pending = task.pendingInput;
      let choice: "allow" | "allow_always" | "reject";
      if (decision === "ask_person") choice = (await this.askPerson(task, pending.title, pending.command, pending.paths, "policy_person")) ? "allow" : "reject";
      else choice = decision;
      if (task.state === "needs_input") this.setRunning(task);
      answer(choice);
      return this.describe(task);
    }
    if (input.decision === "done") {
      if (task.alive) task.process.kill();
      if (task.state === "running" || task.state === "needs_input") this.finish(task, "succeeded", "reply_done");
      return this.describe(task);
    }
    if (input.decision) throw new DelegationError("delegate_not_waiting", "There is no permission request to decide. Send text to answer a question or give a follow-up.");
    if (!input.text && !input.keys?.length) throw new DelegationError("delegate_not_waiting", "Send text, keys or a decision.");
    if (!task.alive) throw new DelegationError("delegate_not_waiting", "This task's program is no longer running. Start a new task (with sessionId to continue the conversation, when the agent supports it).");
    if (task.acp) {
      if (task.state === "running" || task.state === "needs_input") throw new DelegationError("delegate_not_waiting", "The agent is still working on its turn. Wait for delegate_result, then send the follow-up.");
      if (!input.text) throw new DelegationError("delegate_not_waiting", "Send the follow-up as text.");
      this.reopen(task);
      void this.acpTurn(task, input.text).catch((error: unknown) => {
        task.error = error instanceof Error ? error.message : "The follow-up failed.";
        this.finish(task, "failed", "error");
      });
      return this.describe(task);
    }
    if (task.terminalId) {
      const terminal = this.terminal(task.terminalId);
      // The watch loop keeps running while a question is pending; a finished task needs a new one.
      const finished = task.state !== "running" && task.state !== "needs_input";
      if (finished) this.reopen(task);
      if (input.text) terminal.process.write(input.text.replace(/\r?\n/g, "\r"));
      const keys = input.keys?.length ? input.keys : (["enter"] satisfies KeyName[]);
      for (const key of keys) {
        await sleep(40);
        terminal.process.write(keySequence(key));
      }
      this.setRunning(task);
      if (finished) void this.drivePty(task, terminal, null);
      return this.describe(task);
    }
    if (task.stdinOpen) {
      if (task.state !== "running" && task.state !== "needs_input") throw new DelegationError("delegate_not_waiting", "This task already finished.");
      task.process.write(`${input.text ?? ""}\n`);
      task.lastOutputAt = this.now();
      this.setRunning(task);
      return this.describe(task);
    }
    throw new DelegationError("delegate_not_waiting", "This program cannot receive answers: its recipe closes stdin. Use an acp or pty recipe, or keepStdinOpen.");
  }

  /** A finished but still open task (ACP session, terminal program) takes another turn. */
  private reopen(task: Task): void {
    if (task.keepAliveTimer) clearTimeout(task.keepAliveTimer);
    task.keepAliveTimer = null;
    task.state = "running";
    task.finishedBy = null;
    task.endedAt = null;
    task.error = null;
    this.armTimeout(task, task.recipe.timeoutSeconds);
  }

  // ── Views ─────────────────────────────────────────────────────────────

  private task(taskId: string): Task {
    const task = this.tasks.get(taskId);
    if (!task) throw new DelegationError("delegate_task_not_found", `No delegated task ${taskId}. It may belong to an earlier OpenWork session.`);
    return task;
  }

  private output(task: Task): string {
    if (task.acp) return task.answer;
    const terminal = task.terminalId ? this.terminals.get(task.terminalId) : undefined;
    return terminal ? terminal.screen.text(20) : stripAnsi(task.stdout);
  }

  private describe(task: Task) {
    const quietSeconds = Math.round((this.now() - task.lastOutputAt) / 1000);
    return {
      taskId: task.id,
      agent: task.agent,
      kind: task.recipe.kind,
      state: task.state,
      finishedBy: task.finishedBy,
      startedAt: task.startedAt,
      endedAt: task.endedAt,
      elapsedSeconds: Math.round(((task.endedAt ?? this.now()) - task.startedAt) / 1000),
      isolation: task.worktree ? "worktree" : "workspace",
      worktreePath: task.worktree?.path ?? null,
      branch: task.worktree?.branch ?? null,
      terminalId: task.terminalId,
      sessionId: task.sessionId,
      pendingInput: task.pendingInput,
      canReply: task.pendingInput !== null || (task.alive && task.state === "succeeded" && (task.acp !== null || task.terminalId !== null)),
      quietSeconds: task.state === "running" ? quietSeconds : null,
      activity: task.activity.slice(-15),
      error: task.error,
      outputPreview: tail(this.output(task).trim(), PREVIEW_CHARS),
      hint: task.pendingInput?.type === "permission"
        ? `${task.agent} asks permission. Decide with delegate_reply (allow, allow_always, reject), or ask_person when unsure or risky.`
        : task.pendingInput?.type === "question"
          ? `${task.agent} seems to wait for an answer. Reply with delegate_reply text, or decision done if it already finished.`
          : task.state === "running" && !task.stdinOpen && !task.acp && !task.terminalId && quietSeconds >= task.recipe.idleSeconds
            ? `No output for ${quietSeconds}s. If it waits for input it cannot get, cancel it and use an acp or pty recipe.`
            : undefined,
    };
  }

  status(workspaceId: string, taskId?: string) {
    if (taskId) return { tasks: [this.describe(this.task(taskId))] };
    return { tasks: [...this.tasks.values()].filter((task) => task.workspaceId === workspaceId).map((task) => this.describe(task)) };
  }

  async result(taskId: string, waitSeconds = 30) {
    const task = this.task(taskId);
    if (task.state === "running" && waitSeconds > 0) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, waitSeconds * 1000);
        task.waiters.push(() => { clearTimeout(timer); resolve(); });
      });
    }
    const base = this.describe(task);
    if (task.state === "running") return { ...base, done: false, hint: base.hint ?? "Still running. Call delegate_result again, or delegate_status to see progress." };
    if (task.state === "needs_input") return { ...base, done: false };
    const answer = task.acp
      ? { text: tail(task.answer.trim(), ANSWER_CHARS), sessionId: task.sessionId }
      : task.terminalId && this.terminals.has(task.terminalId)
        ? { text: tail(this.terminal(task.terminalId).screen.text(200).trim(), ANSWER_CHARS), sessionId: task.sessionId }
        : finalAnswer(task.recipe, task.stdout, ANSWER_CHARS);
    const changes = task.worktree ? await this.worktreeChanges(task.worktree).catch(() => null) : null;
    return {
      ...base,
      done: true,
      exitCode: task.exitCode,
      answer: answer.text,
      sessionId: answer.sessionId ?? task.sessionId,
      stderrTail: task.acp ? null : tail(stripAnsi(task.stderr).trim(), 4000),
      changedFiles: changes?.files ?? null,
      diffStat: changes?.diffStat ?? null,
      notes: [
        ...(task.alive && (task.acp || task.terminalId) ? ["The session is still open: send a follow-up or answer a question with delegate_reply text. It closes after 30 idle minutes, or with delegate_discard."] : []),
        ...(task.worktree ? [`Review the changes in ${task.worktree.path} (branch ${task.worktree.branch}) before bringing them into the project, then call delegate_discard.`] : []),
        ...(task.projectHadUncommittedChanges ? ["The project had uncommitted changes when the task started; the isolated copy did not include them."] : []),
      ],
    };
  }

  cancel(taskId: string) {
    const task = this.task(taskId);
    if (task.acp && task.sessionId && task.alive) task.acp.notify("session/cancel", { sessionId: task.sessionId });
    if (task.answerPermission) task.answerPermission("reject");
    if (task.state === "running" || task.state === "needs_input" || task.state === "starting") this.finish(task, "cancelled", "cancel");
    if (task.alive) task.process.kill();
    if (task.terminalId) this.closeTerminal(task.terminalId);
    return this.describe(task);
  }

  async discard(taskId: string) {
    const task = this.task(taskId);
    this.cancel(taskId);
    if (task.keepAliveTimer) clearTimeout(task.keepAliveTimer);
    if (task.worktree) await this.removeWorktree(task.worktree);
    this.tasks.delete(taskId);
    return { taskId, discarded: true, removedWorktree: task.worktree?.path ?? null };
  }

  // ── Terminals ─────────────────────────────────────────────────────────

  private openTerminalProcess(workspaceId: string, command: string[], plan: ReturnType<typeof planSpawn>, cwd: string, scratchDir: string | null, cols: number, rows: number): Terminal {
    const open = [...this.terminals.values()].filter((terminal) => !terminal.exit).length;
    if (open >= MAX_TERMINALS) throw new DelegationError("delegate_limit_reached", `${MAX_TERMINALS} terminals are already open. Close one with term_close.`);
    const processHandle = spawnTerminal(plan, { cwd, env: this.childEnv(), cols, rows }, this.options.ptyFactory, this.platform);
    const terminal: Terminal = {
      id: id("term"),
      workspaceId,
      command,
      process: processHandle,
      screen: new TerminalScreen(cols, rows),
      readCursor: 0,
      exit: null,
      changedAt: this.now(),
      scratchDir,
      taskId: null,
    };
    processHandle.onData((chunk) => {
      terminal.screen.feed(chunk);
      terminal.changedAt = this.now();
    });
    processHandle.onExit((exit) => {
      terminal.exit = exit;
      terminal.changedAt = this.now();
    });
    this.terminals.set(terminal.id, terminal);
    return terminal;
  }

  async termOpen(workspaceId: string, input: { command: string | string[]; where?: "workspace" | "scratch"; cols?: number; rows?: number }) {
    const command = normalizeCommand(input.command);
    const executable = await resolveExecutable(command[0] ?? "", this.env, this.platform);
    await this.approveExecutable(workspaceId, executable, command);
    const scratch = input.where === "scratch" ? await this.scratchDir() : null;
    const cwd = scratch ?? this.workspaceDir(workspaceId);
    const plan = planSpawn(executable, command.slice(1), this.platform, this.comspec);
    try {
      const terminal = this.openTerminalProcess(workspaceId, command, plan, cwd, scratch, input.cols ?? 120, input.rows ?? 40);
      await this.waitForScreen(terminal, { idleMs: 800, timeoutMs: 5000 });
      return this.terminalView(terminal, "screen");
    } catch (error) {
      if (scratch) await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  private terminal(terminalId: string): Terminal {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) throw new DelegationError("delegate_terminal_not_found", `No terminal ${terminalId}. It was closed or belongs to an earlier OpenWork session.`);
    return terminal;
  }

  private terminalView(terminal: Terminal, mode: "screen" | "new") {
    const base = { terminalId: terminal.id, command: terminal.command, running: terminal.exit === null, exitCode: terminal.exit?.code ?? null, taskId: terminal.taskId };
    if (mode === "new") {
      const read = terminal.screen.readSince(terminal.readCursor);
      terminal.readCursor = read.cursor;
      return { ...base, output: tail(read.text, 24_000), truncated: read.truncated };
    }
    terminal.readCursor = terminal.screen.readSince(terminal.readCursor).cursor;
    return { ...base, screen: terminal.screen.text(10) };
  }

  termRead(terminalId: string, mode: "screen" | "new" = "screen") {
    return this.terminalView(this.terminal(terminalId), mode);
  }

  async termSend(terminalId: string, input: { text?: string; keys?: KeyName[] }) {
    const terminal = this.terminal(terminalId);
    if (terminal.exit) return { ...this.terminalView(terminal, "screen"), sent: false };
    if (input.text) terminal.process.write(input.text);
    for (const key of input.keys ?? []) {
      await sleep(40);
      terminal.process.write(keySequence(key));
    }
    const task = terminal.taskId ? this.tasks.get(terminal.taskId) : undefined;
    if (task?.state === "needs_input") this.setRunning(task);
    await this.waitForScreen(terminal, { idleMs: 600, timeoutMs: 4000 });
    return { ...this.terminalView(terminal, "screen"), sent: true };
  }

  private async waitForScreen(terminal: Terminal, input: { text?: string; idleMs?: number; timeoutMs: number }): Promise<"text" | "idle" | "exit" | "timeout"> {
    const deadline = this.now() + input.timeoutMs;
    const idleMs = input.idleMs ?? 1500;
    while (this.now() < deadline) {
      if (input.text && terminal.screen.contains(input.text)) return "text";
      if (terminal.exit) return "exit";
      if (!input.text && terminal.screen.revision > 0 && this.now() - terminal.changedAt >= idleMs) return "idle";
      await sleep(100);
    }
    return "timeout";
  }

  async termWait(terminalId: string, input: { text?: string; idleMs?: number; timeoutSeconds?: number }) {
    const terminal = this.terminal(terminalId);
    const reason = await this.waitForScreen(terminal, { text: input.text, idleMs: input.idleMs, timeoutMs: (input.timeoutSeconds ?? 30) * 1000 });
    return { ...this.terminalView(terminal, "screen"), reason };
  }

  closeTerminal(terminalId: string) {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) return { terminalId, closed: false };
    if (!terminal.exit) terminal.process.kill();
    this.terminals.delete(terminalId);
    if (terminal.scratchDir) void rm(terminal.scratchDir, { recursive: true, force: true }).catch(() => undefined);
    return { terminalId, closed: true };
  }

  /** Stops every process and terminal this service started. Worktrees stay for review. */
  close(): void {
    this.closed = true;
    for (const task of this.tasks.values()) {
      if (task.keepAliveTimer) clearTimeout(task.keepAliveTimer);
      if (task.state === "running" || task.state === "needs_input") this.finish(task, "cancelled", "cancel");
      if (task.alive) task.process.kill();
    }
    for (const terminalId of [...this.terminals.keys()]) this.closeTerminal(terminalId);
  }
}
