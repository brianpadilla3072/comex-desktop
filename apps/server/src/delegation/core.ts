import { ACP_TOOL_KINDS, DelegationError, type AcpToolKind, type DelegateRecipe, type KeyName, type PermissionPolicy } from "./schema.js";

/**
 * Pure decision logic for external agent delegation: command rendering,
 * per-platform spawn plans, executable lookup candidates, output reading and
 * a small terminal screen. No I/O here; process.ts and service.ts are the edges.
 * contracts/delegation/v1 pins this behavior for other implementations.
 */

export type Platform = "darwin" | "linux" | "win32" | (string & {});

// ── Recipes ───────────────────────────────────────────────────────────────

/** Problems that make a recipe unusable, as stable short codes. Empty when valid. */
export function recipeProblems(recipe: DelegateRecipe): string[] {
  const problems: string[] = [];
  const all = [...recipe.command, ...(recipe.resume ?? []), ...(recipe.versionCommand ?? [])];
  if (all.some((part) => part.includes("\0"))) problems.push("nul_byte");
  if (/[{}]/.test(recipe.command[0] ?? "")) problems.push("placeholder_in_executable");
  if (recipe.resume && /[{}]/.test(recipe.resume[0] ?? "")) problems.push("placeholder_in_executable");
  const hasPrompt = (template: string[]) => template.some((part) => part.includes("{prompt}"));
  if (recipe.prompt === "arg" && !hasPrompt(recipe.command)) problems.push("prompt_placeholder_missing");
  if (recipe.prompt === "stdin" && hasPrompt(recipe.command)) problems.push("prompt_placeholder_with_stdin");
  if (recipe.command.some((part) => part.includes("{sessionId}"))) problems.push("session_placeholder_in_command");
  if (recipe.resume && !recipe.resume.some((part) => part.includes("{sessionId}"))) problems.push("resume_session_placeholder_missing");
  if (recipe.resume && recipe.prompt === "arg" && !hasPrompt(recipe.resume)) problems.push("prompt_placeholder_missing");
  if (recipe.versionCommand && /[{}]/.test(recipe.versionCommand.join(" "))) problems.push("placeholder_in_version_command");
  if (recipe.output === "jsonl" && recipe.kind === "pty") problems.push("jsonl_requires_cli");
  if (recipe.output === "text" && (recipe.resultField || recipe.sessionIdField)) problems.push("fields_require_jsonl");
  if (recipe.kind === "cli" && (recipe.readyText || recipe.doneText)) problems.push("screen_text_requires_pty");
  if (recipe.kind === "acp") {
    if (hasPrompt(recipe.command)) problems.push("prompt_placeholder_with_acp");
    if (recipe.resume) problems.push("resume_not_used_by_acp");
    if (recipe.output === "jsonl") problems.push("jsonl_requires_cli");
    if (recipe.readyText || recipe.doneText) problems.push("screen_text_requires_pty");
  } else if (recipe.acpMode || recipe.permissions) problems.push("acp_options_require_acp");
  if (recipe.keepStdinOpen && recipe.kind !== "cli") problems.push("stdin_option_requires_cli");
  return [...new Set(problems.filter((problem) => !(recipe.kind === "acp" && problem === "prompt_placeholder_missing")))];
}

/** Substitute {prompt} and {sessionId} inside each argv part. Never joins into a shell string. */
export function renderCommand(template: readonly string[], values: { prompt?: string; sessionId?: string }): string[] {
  return template.map((part) => {
    if (part.includes("{sessionId}") && values.sessionId === undefined) {
      throw new DelegationError("delegate_invalid_recipe", "This command needs a sessionId.");
    }
    return part.replace(/\{(prompt|sessionId)\}/g, (_match, key: string) => (key === "prompt" ? values.prompt ?? "" : values.sessionId ?? ""));
  });
}

const SHELL_SYMBOLS = /["'`\\$|&;<>(){}*?!~\n\r]/;

/** A command given as an array is used as is; a plain string is split on spaces, never interpreted by a shell. */
export function normalizeCommand(input: string | readonly string[]): string[] {
  if (typeof input !== "string") return [...input];
  if (SHELL_SYMBOLS.test(input)) {
    throw new DelegationError("delegate_argument_unsafe", "Give the command as an array of arguments, e.g. [\"devin\", \"-p\", \"text with spaces\"]. A string may only hold plain words: quotes and shell symbols are not interpreted.");
  }
  const parts = input.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) throw new DelegationError("delegate_argument_unsafe", "The command is empty.");
  return parts;
}

/** Which template a run uses and what is left for stdin. */
export function planRun(recipe: DelegateRecipe, input: { prompt: string; sessionId?: string }): { argv: string[]; stdin: string | null } {
  const template = input.sessionId !== undefined ? recipe.resume : recipe.command;
  if (!template) throw new DelegationError("delegate_invalid_recipe", `${recipe.name} has no resume command, so it cannot continue a session.`);
  const argv = renderCommand(template, { prompt: recipe.prompt === "arg" ? input.prompt : undefined, sessionId: input.sessionId });
  return { argv, stdin: recipe.prompt === "stdin" ? input.prompt : null };
}

// ── Executables and spawn plans ───────────────────────────────────────────

function hasPathSeparator(value: string, platform: Platform): boolean {
  return value.includes("/") || (platform === "win32" && value.includes("\\"));
}

function joinPath(dir: string, name: string, platform: Platform): string {
  const sep = platform === "win32" ? "\\" : "/";
  return dir.endsWith("/") || dir.endsWith("\\") ? `${dir}${name}` : `${dir}${sep}${name}`;
}

/** Ordered absolute candidates for an executable name. The edge checks which exists. */
export function executableCandidates(name: string, env: { platform: Platform; path: string; pathExt?: string }): string[] {
  const isWindows = env.platform === "win32";
  const extensions = isWindows
    ? (env.pathExt || ".COM;.EXE;.BAT;.CMD").split(";").map((ext) => ext.trim().toLowerCase()).filter(Boolean)
    : [];
  const withExtensions = (base: string) => {
    if (!isWindows) return [base];
    const lower = base.toLowerCase();
    if (extensions.some((ext) => lower.endsWith(ext))) return [base];
    return extensions.map((ext) => `${base}${ext}`);
  };
  if (hasPathSeparator(name, env.platform)) return withExtensions(name);
  const dirs = env.path.split(isWindows ? ";" : ":").map((dir) => dir.trim()).filter(Boolean);
  return dirs.flatMap((dir) => withExtensions(joinPath(dir, name, env.platform)));
}

export type SpawnPlan = { file: string; args: string[]; windowsVerbatimArguments: boolean };

const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

/** Quote one argument for cmd.exe running a .cmd/.bat shim (the cross-spawn rules). */
export function escapeCmdArgument(arg: string, doubleEscape: boolean): string {
  let value = arg.replace(/(\\*)"/g, "$1$1\\\"");
  value = value.replace(/(\\*)$/, "$1$1");
  value = `"${value}"`;
  value = value.replace(CMD_META, "^$1");
  if (doubleEscape) value = value.replace(CMD_META, "^$1");
  return value;
}

/**
 * How to start an executable without a shell. On Windows, .cmd and .bat files
 * can only run through cmd.exe, so the arguments are escaped for it, and line
 * breaks (which cmd.exe cannot carry) are rejected.
 */
export function planSpawn(executable: string, args: readonly string[], platform: Platform, comspec?: string): SpawnPlan {
  if (platform === "win32" && /\.(cmd|bat)$/i.test(executable)) {
    if (args.some((arg) => /[\r\n]/.test(arg))) {
      throw new DelegationError("delegate_argument_unsafe", "This program is a .cmd/.bat script on Windows, which cannot receive line breaks in an argument. Send the prompt through stdin instead (recipe prompt: \"stdin\").");
    }
    const line = [executable.replace(CMD_META, "^$1"), ...args.map((arg) => escapeCmdArgument(arg, true))].join(" ");
    return { file: comspec || "cmd.exe", args: ["/d", "/s", "/c", `"${line}"`], windowsVerbatimArguments: true };
  }
  return { file: executable, args: [...args], windowsVerbatimArguments: false };
}

/** POSIX single-quote an argument for `sh -c` (used only by the `script` PTY fallback). */
export function posixQuote(arg: string): string {
  return /^[A-Za-z0-9_\/.,:=@%+-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * The `script` utility gives a real terminal without native modules on macOS
 * (BSD script) and Linux (util-linux script). Windows has no equivalent: the
 * desktop app supplies ConPTY through node-pty instead.
 */
export function scriptPtyPlan(executable: string, args: readonly string[], platform: Platform): SpawnPlan | null {
  if (platform === "darwin") return { file: "script", args: ["-q", "/dev/null", executable, ...args], windowsVerbatimArguments: false };
  if (platform === "linux") {
    return { file: "script", args: ["-q", "-f", "-e", "-c", [executable, ...args].map(posixQuote).join(" "), "/dev/null"], windowsVerbatimArguments: false };
  }
  return null;
}

/** The environment a delegate inherits: never OpenWork's own credentials. */
export function delegateEnvironment(parent: Record<string, string | undefined>, extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(parent)) {
    if (value === undefined) continue;
    const upper = key.toUpperCase();
    if (upper.startsWith("OPENWORK_") || upper.startsWith("OPENCODE_SERVER_") || upper.startsWith("DEN_") || upper === "ELECTRON_RUN_AS_NODE" || upper === "OPENCODE_CONFIG" || upper === "OPENCODE_CONFIG_CONTENT") continue;
    env[key] = value;
  }
  return { ...env, ...extra };
}

// ── Output ────────────────────────────────────────────────────────────────

export function tail(text: string, max: number): string {
  if (text.length <= max) return text;
  return `…${text.slice(text.length - max + 1)}`;
}

/** Remove escape sequences and control characters other than newlines and tabs. */
export function stripAnsi(text: string): string {
  return text
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b[@-Z\\-_]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
}

function parseJsonLine(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return null;
  }
}

function pathValue(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const key of path.split(".")) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) return undefined;
    current = Reflect.get(current, key);
  }
  return current;
}

function textOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts = value.map((item) => (typeof item === "string" ? item : textOf(pathValue(item, "text")))).filter((part): part is string => typeof part === "string");
    return parts.length ? parts.join("") : null;
  }
  return null;
}

/**
 * Read a JSON-lines run. The answer is the configured field of the last line
 * that has it; without a field, the last `result`, `text`, `content` or
 * `message` string. Lines that are not JSON are ignored.
 */
export function readJsonl(stdout: string, fields: { resultField?: string; sessionIdField?: string }): { text: string | null; sessionId: string | null; events: number } {
  let text: string | null = null;
  let sessionId: string | null = null;
  let events = 0;
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    const value = parseJsonLine(trimmed);
    if (typeof value !== "object" || value === null) continue;
    events += 1;
    const found = fields.resultField
      ? textOf(pathValue(value, fields.resultField))
      : textOf(pathValue(value, "result")) ?? textOf(pathValue(value, "text")) ?? textOf(pathValue(value, "content")) ?? textOf(pathValue(value, "message.content")) ?? textOf(pathValue(value, "message"));
    if (found !== null && found.trim()) text = found;
    const id = fields.sessionIdField
      ? pathValue(value, fields.sessionIdField)
      : pathValue(value, "session_id") ?? pathValue(value, "sessionId") ?? pathValue(value, "sessionID");
    if (typeof id === "string" && id) sessionId = id;
  }
  return { text, sessionId, events };
}

/** What a finished cli run answered. */
export function finalAnswer(recipe: Pick<DelegateRecipe, "output" | "resultField" | "sessionIdField">, stdout: string, max: number): { text: string; sessionId: string | null } {
  if (recipe.output === "jsonl") {
    const read = readJsonl(stdout, recipe);
    return { text: tail(read.text ?? stripAnsi(stdout).trim(), max), sessionId: read.sessionId };
  }
  return { text: tail(stripAnsi(stdout).trim(), max), sessionId: null };
}

// ── Keys ──────────────────────────────────────────────────────────────────

const KEY_SEQUENCES: Record<KeyName, string> = {
  enter: "\r",
  tab: "\t",
  escape: "\u001b",
  backspace: "\u007f",
  up: "\u001b[A",
  down: "\u001b[B",
  right: "\u001b[C",
  left: "\u001b[D",
  "ctrl-c": "\u0003",
  "ctrl-d": "\u0004",
  space: " ",
  y: "y",
  n: "n",
};

export function keySequence(key: KeyName): string {
  return KEY_SEQUENCES[key];
}

// ── Terminal screen ───────────────────────────────────────────────────────

const SCROLLBACK_LINES = 2000;
const PLAIN_LOG_CHARS = 262_144;

type ParserState = "text" | "escape" | "csi" | "osc" | "osc_escape" | "charset";

/**
 * A small VT100 screen: enough of the cursor, erase and alternate-screen
 * sequences for prompts, wizards and full-screen TUIs to read as text.
 * Colors and attributes are dropped. Owned by one terminal session.
 */
export class TerminalScreen {
  private grid: string[][];
  private row = 0;
  private col = 0;
  private scrollback: string[] = [];
  private state: ParserState = "text";
  private params = "";
  private plain = "";
  private plainOffset = 0;
  /** Increments on every change, so callers can notice an idle screen. */
  revision = 0;

  constructor(readonly cols: number, readonly rows: number) {
    this.grid = Array.from({ length: rows }, () => this.blankRow());
  }

  private blankRow(): string[] {
    return Array.from({ length: this.cols }, () => " ");
  }

  feed(data: string): void {
    if (!data) return;
    this.revision += 1;
    for (const char of data) this.feedChar(char);
  }

  private appendPlain(text: string): void {
    this.plain += text;
    if (this.plain.length > PLAIN_LOG_CHARS) {
      const drop = this.plain.length - PLAIN_LOG_CHARS;
      this.plain = this.plain.slice(drop);
      this.plainOffset += drop;
    }
  }

  private feedChar(char: string): void {
    switch (this.state) {
      case "escape":
        if (char === "[") { this.state = "csi"; this.params = ""; }
        else if (char === "]") this.state = "osc";
        else if (char === "(" || char === ")" || char === "*" || char === "+") this.state = "charset";
        else {
          if (char === "c") this.clearScreen();
          else if (char === "M") this.row = Math.max(0, this.row - 1);
          else if (char === "D" || char === "E") { if (char === "E") this.col = 0; this.lineFeed(); }
          this.state = "text";
        }
        return;
      case "charset":
        this.state = "text";
        return;
      case "osc":
        if (char === "\u0007") this.state = "text";
        else if (char === "\u001b") this.state = "osc_escape";
        return;
      case "osc_escape":
        this.state = char === "\\" ? "text" : "osc";
        return;
      case "csi": {
        const code = char.codePointAt(0) ?? 0;
        if (code >= 0x40 && code <= 0x7e) {
          this.state = "text";
          this.csi(char, this.params);
        } else {
          this.params += char;
        }
        return;
      }
      case "text":
        break;
    }
    if (char === "\u001b") { this.state = "escape"; return; }
    if (char === "\r") { this.col = 0; return; }
    if (char === "\n" || char === "\u000b" || char === "\u000c") { this.lineFeed(); this.appendPlain("\n"); return; }
    if (char === "\b") { this.col = Math.max(0, this.col - 1); return; }
    if (char === "\t") { this.col = Math.min(this.cols - 1, (Math.floor(this.col / 8) + 1) * 8); this.appendPlain("\t"); return; }
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return;
    if (this.col >= this.cols) {
      this.col = 0;
      this.lineFeed();
    }
    const line = this.grid[this.row];
    if (line) line[this.col] = char;
    this.col += 1;
    this.appendPlain(char);
  }

  private lineFeed(): void {
    if (this.row < this.rows - 1) {
      this.row += 1;
      return;
    }
    const top = this.grid.shift();
    if (top) {
      this.scrollback.push(top.join("").trimEnd());
      if (this.scrollback.length > SCROLLBACK_LINES) this.scrollback.shift();
    }
    this.grid.push(this.blankRow());
  }

  private clearScreen(): void {
    this.grid = Array.from({ length: this.rows }, () => this.blankRow());
    this.row = 0;
    this.col = 0;
  }

  private csi(final: string, rawParams: string): void {
    const isPrivate = rawParams.startsWith("?");
    const numbers = rawParams.replace(/^[?>=!]/, "").split(";").map((part) => Number.parseInt(part, 10));
    const n = (index: number, fallback: number) => {
      const value = numbers[index];
      return value === undefined || Number.isNaN(value) ? fallback : value;
    };
    const clampRow = (value: number) => Math.min(this.rows - 1, Math.max(0, value));
    const clampCol = (value: number) => Math.min(this.cols - 1, Math.max(0, value));
    const line = this.grid[this.row] ?? this.blankRow();
    switch (final) {
      case "A": this.row = clampRow(this.row - Math.max(1, n(0, 1))); break;
      case "B": this.row = clampRow(this.row + Math.max(1, n(0, 1))); break;
      case "C": this.col = clampCol(this.col + Math.max(1, n(0, 1))); break;
      case "D": this.col = clampCol(this.col - Math.max(1, n(0, 1))); break;
      case "E": this.row = clampRow(this.row + Math.max(1, n(0, 1))); this.col = 0; break;
      case "F": this.row = clampRow(this.row - Math.max(1, n(0, 1))); this.col = 0; break;
      case "G": case "`": this.col = clampCol(n(0, 1) - 1); break;
      case "d": this.row = clampRow(n(0, 1) - 1); break;
      case "H": case "f": this.row = clampRow(n(0, 1) - 1); this.col = clampCol(n(1, 1) - 1); break;
      case "J": {
        const mode = n(0, 0);
        if (mode === 2 || mode === 3) {
          for (let r = 0; r < this.rows; r += 1) this.grid[r] = this.blankRow();
        } else if (mode === 0) {
          for (let c = this.col; c < this.cols; c += 1) line[c] = " ";
          for (let r = this.row + 1; r < this.rows; r += 1) this.grid[r] = this.blankRow();
        } else if (mode === 1) {
          for (let c = 0; c <= Math.min(this.col, this.cols - 1); c += 1) line[c] = " ";
          for (let r = 0; r < this.row; r += 1) this.grid[r] = this.blankRow();
        }
        break;
      }
      case "K": {
        const mode = n(0, 0);
        const from = mode === 0 ? this.col : 0;
        const to = mode === 1 ? Math.min(this.col, this.cols - 1) : this.cols - 1;
        for (let c = from; c <= to; c += 1) line[c] = " ";
        break;
      }
      case "X": for (let c = this.col; c < Math.min(this.cols, this.col + Math.max(1, n(0, 1))); c += 1) line[c] = " "; break;
      case "P": {
        const count = Math.max(1, n(0, 1));
        line.splice(this.col, count);
        while (line.length < this.cols) line.push(" ");
        break;
      }
      case "@": {
        const count = Math.max(1, n(0, 1));
        line.splice(this.col, 0, ...Array.from({ length: count }, () => " "));
        line.length = this.cols;
        break;
      }
      case "L": {
        const count = Math.min(this.rows - this.row, Math.max(1, n(0, 1)));
        this.grid.splice(this.row, 0, ...Array.from({ length: count }, () => this.blankRow()));
        this.grid.length = this.rows;
        break;
      }
      case "M": {
        const count = Math.min(this.rows - this.row, Math.max(1, n(0, 1)));
        this.grid.splice(this.row, count);
        while (this.grid.length < this.rows) this.grid.push(this.blankRow());
        break;
      }
      case "h": case "l":
        if (isPrivate && [47, 1047, 1049].includes(n(0, 0))) this.clearScreen();
        break;
      default:
        break;
    }
  }

  /** The visible screen (and optionally recent scrollback) as text, trailing blanks removed. */
  text(scrollbackLines = 0): string {
    const visible = this.grid.map((line) => line.join("").trimEnd());
    while (visible.length && visible[visible.length - 1] === "") visible.pop();
    const history = scrollbackLines > 0 ? this.scrollback.slice(-scrollbackLines) : [];
    return [...history, ...visible].join("\n");
  }

  /** Plain output since `cursor` (an offset returned by a previous call). */
  readSince(cursor: number): { text: string; cursor: number; truncated: boolean } {
    const start = Math.max(cursor, this.plainOffset);
    return { text: this.plain.slice(start - this.plainOffset), cursor: this.plainOffset + this.plain.length, truncated: cursor < this.plainOffset };
  }

  contains(needle: string): boolean {
    return this.text(50).includes(needle) || this.plain.slice(-8192).includes(needle);
  }
}

// ── Permissions (ACP session/request_permission) ──────────────────────────

export type PermissionDecision = "allow" | "agent" | "person" | "deny";

export type PermissionRequestView = {
  kind: AcpToolKind;
  title: string;
  command: string | null;
  paths: string[];
};

function isToolKind(value: unknown): value is AcpToolKind {
  return typeof value === "string" && ACP_TOOL_KINDS.some((kind) => kind === value);
}

function stringsAt(value: unknown, keys: readonly string[]): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  const found: string[] = [];
  for (const key of keys) {
    const item: unknown = Reflect.get(value, key);
    if (typeof item === "string" && item) found.push(item);
    else if (Array.isArray(item)) for (const entry of item) if (typeof entry === "string" && entry) found.push(entry);
  }
  return found;
}

/** The parts of an ACP tool call that matter for a decision, read defensively. */
export function permissionRequestView(toolCall: unknown): PermissionRequestView {
  const kindValue = typeof toolCall === "object" && toolCall !== null ? Reflect.get(toolCall, "kind") : undefined;
  const titleValue = typeof toolCall === "object" && toolCall !== null ? Reflect.get(toolCall, "title") : undefined;
  const rawInput = typeof toolCall === "object" && toolCall !== null ? Reflect.get(toolCall, "rawInput") : undefined;
  const locations = typeof toolCall === "object" && toolCall !== null ? Reflect.get(toolCall, "locations") : undefined;
  const commandParts = stringsAt(rawInput, ["command", "cmd", "commandLine"]);
  const paths = [
    ...stringsAt(rawInput, ["path", "file_path", "filePath", "paths", "abs_path", "absolutePath", "target", "destination", "cwd"]),
    ...(Array.isArray(locations) ? locations.flatMap((location) => stringsAt(location, ["path"])) : []),
  ];
  return {
    kind: isToolKind(kindValue) ? kindValue : "other",
    title: typeof titleValue === "string" ? titleValue.slice(0, 500) : "",
    command: commandParts.length ? commandParts.join(" ").slice(0, 2000) : null,
    paths: [...new Set(paths)].slice(0, 50),
  };
}

function normalizePath(path: string, platform: Platform): { root: string; parts: string[] } {
  const windows = platform === "win32";
  let value = windows ? path.replace(/\\/g, "/") : path;
  let root = "";
  const drive = windows ? /^([a-zA-Z]:)\//.exec(value) : null;
  if (drive?.[1]) { root = drive[1].toLowerCase(); value = value.slice(2); }
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(windows ? part.toLowerCase() : part);
  }
  return { root, parts };
}

/** True when `path` (absolute, or relative to `folder`) stays inside `folder`. */
export function isInsideFolder(path: string, folder: string, platform: Platform): boolean {
  const windows = platform === "win32";
  const absolute = windows ? /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\\\") : path.startsWith("/");
  const base = normalizePath(folder, platform);
  const target = normalizePath(absolute ? path : `${folder}/${path}`, platform);
  if (base.root !== target.root || target.parts.length < base.parts.length) return false;
  return base.parts.every((part, index) => target.parts[index] === part);
}

const RISKY_COMMAND = /(^|[\s;&|(`])(sudo|su|doas|pkexec|curl|wget|ssh|scp|sftp|rsync|nc|ncat|telnet|ftp|docker|podman|kubectl|helm|terraform|gh|mkfs(\.\w+)?|dd|shutdown|reboot|crontab|systemctl|launchctl|reg|setx|git\s+push|git\s+remote|(npm|pnpm|yarn|bun|cargo|twine|gem)\s+publish|chmod\s+(-R\s+)?777|rm\s+-[a-zA-Z]*[rR][a-zA-Z]*\s+(\/|~|\$HOME|\.\.))(?=$|[\s;&|)`])/;

/** Who answers one permission request. Risky requests always reach the person. */
export function classifyPermission(view: PermissionRequestView, policy: PermissionPolicy, folder: string, platform: Platform): { decision: PermissionDecision; reason: string } {
  if (view.paths.some((path) => !isInsideFolder(path, folder, platform))) return { decision: "person", reason: "outside_folder" };
  if (view.command && RISKY_COMMAND.test(view.command)) return { decision: "person", reason: "risky_command" };
  if (policy.deny.includes(view.kind)) return { decision: "deny", reason: "policy_deny" };
  if (policy.person.includes(view.kind)) return { decision: "person", reason: "policy_person" };
  if (policy.agent.includes(view.kind)) return { decision: "agent", reason: "policy_agent" };
  if (policy.allow.includes(view.kind)) return { decision: "allow", reason: "policy_allow" };
  return { decision: "agent", reason: "unlisted_kind" };
}

export type PermissionOption = { optionId: string; kind: string; name?: string };

/** The option that carries a decision, preferring the one-time variants. Null when the agent offered none. */
export function pickPermissionOption(options: readonly PermissionOption[], decision: "allow" | "allow_always" | "reject"): string | null {
  const order = decision === "allow" ? ["allow_once", "allow_always"] : decision === "allow_always" ? ["allow_always", "allow_once"] : ["reject_once", "reject_always"];
  for (const kind of order) {
    const option = options.find((item) => item.kind === kind);
    if (option) return option.optionId;
  }
  return null;
}

// ── JSON-RPC over newline-delimited stdio ─────────────────────────────────

/** Splits a byte stream into JSON values, one per line. Lines that are not JSON are skipped. */
export class JsonLineDecoder {
  private buffer = "";

  push(chunk: string): unknown[] {
    this.buffer += chunk;
    const values: unknown[] = [];
    let index = this.buffer.indexOf("\n");
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line.startsWith("{")) {
        const value = parseJsonLine(line);
        if (value !== null) values.push(value);
      }
      index = this.buffer.indexOf("\n");
    }
    // A runaway line without a newline is dropped instead of growing forever.
    if (this.buffer.length > 16_777_216) this.buffer = "";
    return values;
  }
}
