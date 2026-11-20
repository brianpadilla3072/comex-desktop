import { z } from "zod";

/**
 * Persisted and wire formats for external agent delegation
 * (docs/features/external-delegates). Every format is versioned and read
 * through these schemas; the JSON vectors in contracts/delegation/v1 pin them.
 */

export const DELEGATE_STORE_VERSION = 1;

/** Stable error codes. Clients and tests depend on these, never on messages. */
export const DELEGATION_ERROR_CODES = [
  "delegate_not_found",
  "delegate_invalid_recipe",
  "delegate_executable_not_found",
  "delegate_approval_denied",
  "delegate_task_not_found",
  "delegate_terminal_not_found",
  "delegate_pty_unavailable",
  "delegate_worktree_unavailable",
  "delegate_argument_unsafe",
  "delegate_limit_reached",
  "delegate_workspace_not_found",
  "delegate_not_waiting",
  "delegate_protocol_error",
] as const;
export type DelegationErrorCode = (typeof DELEGATION_ERROR_CODES)[number];

export class DelegationError extends Error {
  constructor(readonly code: DelegationErrorCode, message: string) {
    super(message);
    this.name = "DelegationError";
  }
}

export const delegateName = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, "Use lowercase letters, digits and dashes, starting with a letter.");

const commandPart = z.string().min(1).max(4096);
/** argv template. The first element is the executable (a name on PATH or an absolute path). Never a shell string. */
export const commandTemplate = z.array(commandPart).min(1).max(64);

export const RECIPE_PLACEHOLDERS = ["{prompt}", "{sessionId}"] as const;

/** ACP tool kinds (Agent Client Protocol `ToolKind`). */
export const ACP_TOOL_KINDS = ["read", "edit", "delete", "move", "search", "execute", "think", "fetch", "switch_mode", "other"] as const;
export type AcpToolKind = (typeof ACP_TOOL_KINDS)[number];

/**
 * Who answers a permission the external agent asks for, by tool kind.
 * allow: answered yes at once. agent: the OpenCode agent decides (delegate_reply).
 * person: the person confirms in OpenWork. deny: answered no at once.
 * Risky requests (paths outside the task folder, privileged or network commands)
 * always go to the person, whatever the policy says.
 */
export const permissionPolicy = z.object({
  allow: z.array(z.enum(ACP_TOOL_KINDS)).default(["read", "search", "think", "edit", "move"]),
  agent: z.array(z.enum(ACP_TOOL_KINDS)).default(["execute", "delete", "switch_mode", "other"]),
  person: z.array(z.enum(ACP_TOOL_KINDS)).default(["fetch"]),
  deny: z.array(z.enum(ACP_TOOL_KINDS)).default([]),
}).strict();
export type PermissionPolicy = z.infer<typeof permissionPolicy>;

export const delegateRecipe = z.object({
  name: delegateName,
  description: z.string().max(500).default(""),
  /**
   * cli: non-interactive run, output read from stdout. pty: drive it in a pseudo-terminal.
   * acp: speak the Agent Client Protocol over stdio (permissions and follow-ups are structured).
   */
  kind: z.enum(["cli", "pty", "acp"]),
  command: commandTemplate,
  /** Start a follow-up turn of an earlier run; must contain {sessionId}. */
  resume: commandTemplate.optional(),
  /** arg: substitute {prompt} in the command. stdin: write the prompt (cli closes stdin; pty types it and presses Enter). */
  prompt: z.enum(["arg", "stdin"]).default("arg"),
  output: z.enum(["text", "jsonl"]).default("text"),
  /** jsonl only: dot path of the final answer (e.g. "result" or "message.content"). */
  resultField: z.string().max(200).optional(),
  /** jsonl only: dot path of the session id used by resume. */
  sessionIdField: z.string().max(200).optional(),
  /** pty only: text that shows the program is ready for the prompt. */
  readyText: z.string().max(200).optional(),
  /** pty only: text that shows the task finished. Without it, the run ends when the program exits or the screen is idle for idleSeconds. */
  doneText: z.string().max(200).optional(),
  idleSeconds: z.number().int().min(5).max(3600).default(60),
  timeoutSeconds: z.number().int().min(10).max(86_400).default(1800),
  isolation: z.enum(["worktree", "workspace"]).default("worktree"),
  /** cli only: keep stdin open so delegate_reply can answer questions the program asks. */
  keepStdinOpen: z.boolean().default(false),
  /** acp only: session mode to select after the session starts (e.g. "accept-edits"). */
  acpMode: z.string().min(1).max(100).optional(),
  /** acp only: who answers the agent's permission requests. */
  permissions: permissionPolicy.optional(),
  /** Command that prints the version, used to notice upgrades that need a new check. */
  versionCommand: commandTemplate.optional(),
  notes: z.array(z.string().max(500)).max(20).default([]),
}).strict();
export type DelegateRecipe = z.infer<typeof delegateRecipe>;
export type DelegateRecipeInput = z.input<typeof delegateRecipe>;

export const storedDelegate = z.object({
  recipe: delegateRecipe,
  /** Resolved absolute executable path at registration. */
  executable: z.string(),
  /** Output of versionCommand at registration, trimmed to one line. */
  version: z.string().max(200).nullable(),
  registeredAt: z.number().int().nonnegative(),
}).strict();
export type StoredDelegate = z.infer<typeof storedDelegate>;

/**
 * Who answers decisions about external agents.
 * person: the person confirms each new program once (remembered) and every risky permission request.
 * orchestrator: the OpenCode agent that delegates decides everything; it may still ask the person.
 * Only the person changes this (host route or OPENWORK_DELEGATES_DECIDER), never an agent tool.
 */
export const DELEGATE_DECIDERS = ["person", "orchestrator"] as const;
export type DelegateDecider = (typeof DELEGATE_DECIDERS)[number];

export const delegateSettings = z.object({
  decider: z.enum(DELEGATE_DECIDERS).default("person"),
}).strict();
export type DelegateSettings = z.infer<typeof delegateSettings>;

/** A program the person allowed agents to learn and use, remembered across restarts. */
export const approvedProgram = z.object({ approvedAt: z.number().int().nonnegative() }).strict();

export const delegateStore = z.object({
  version: z.literal(DELEGATE_STORE_VERSION),
  agents: z.record(delegateName, storedDelegate),
  settings: delegateSettings.default({ decider: "person" }),
  /** Keyed by the resolved absolute executable path. */
  approvedPrograms: z.record(z.string(), approvedProgram).default({}),
}).strict();
export type DelegateStore = z.infer<typeof delegateStore>;

export const TASK_STATES = ["starting", "running", "needs_input", "succeeded", "failed", "cancelled", "timed_out"] as const;
export type TaskState = (typeof TASK_STATES)[number];

export const KEY_NAMES = ["enter", "tab", "escape", "backspace", "up", "down", "left", "right", "ctrl-c", "ctrl-d", "space", "y", "n"] as const;
export type KeyName = (typeof KEY_NAMES)[number];

// ── Tool arguments (what OpenCode sends through MCP) ──────────────────────

/** A command as an argv array, or a plain string of words (split on spaces; quotes and shell symbols are refused). */
export const commandInput = z.union([commandTemplate, z.string().min(1).max(4096)]);

export const probeArgs = z.object({
  command: commandInput.describe("argv to run, e.g. [\"devin\", \"--help\"] (or the plain string \"devin --help\"). Not a shell: no pipes, redirects or &&."),
  stdin: z.string().max(65_536).optional().describe("Text written to stdin, then closed."),
  timeoutSeconds: z.number().int().min(1).max(300).optional().describe("Default 30."),
  where: z.enum(["scratch", "workspace"]).optional().describe("scratch (default) runs in an empty temporary folder; workspace runs in the project folder, read-only use only."),
}).strict();

export const registerArgs = z.object({
  recipe: delegateRecipe.describe("The tested recipe."),
}).strict();

export const nameArgs = z.object({ name: delegateName }).strict();

export const startArgs = z.object({
  agent: delegateName.describe("Registered delegate name (delegate_list)."),
  prompt: z.string().min(1).max(100_000).describe("Complete, self-contained task for the external agent."),
  isolation: z.enum(["worktree", "workspace"]).optional().describe("Override the recipe: worktree (isolated git copy) or workspace (edits the project directly)."),
  sessionId: z.string().min(1).max(200).optional().describe("Continue an earlier run with the recipe's resume command."),
  timeoutSeconds: z.number().int().min(10).max(86_400).optional(),
}).strict();

export const taskArgs = z.object({ taskId: z.string().regex(/^dt_[a-z0-9]{6,32}$/) }).strict();

export const REPLY_DECISIONS = ["allow", "allow_always", "reject", "ask_person", "done"] as const;
export type ReplyDecision = (typeof REPLY_DECISIONS)[number];

export const replyArgs = z.object({
  taskId: z.string().regex(/^dt_[a-z0-9]{6,32}$/),
  decision: z.enum(REPLY_DECISIONS).optional().describe("For a permission request: allow (once), allow_always, reject, or ask_person to let the person decide. done: the task is finished, stop the program."),
  text: z.string().min(1).max(100_000).optional().describe("An answer to the agent's question or a follow-up instruction. ACP: sent as the next message once its turn ended. Terminal and cli: typed, then Enter."),
  keys: z.array(z.enum(KEY_NAMES)).max(32).optional().describe("Terminal tasks: keys pressed after the text."),
}).strict();

export const statusArgs = z.object({ taskId: z.string().regex(/^dt_[a-z0-9]{6,32}$/).optional() }).strict();

export const resultArgs = z.object({
  taskId: z.string().regex(/^dt_[a-z0-9]{6,32}$/),
  waitSeconds: z.number().int().min(0).max(120).optional().describe("Wait up to this long for the task to finish. Default 30."),
}).strict();

export const termOpenArgs = z.object({
  command: commandInput.describe("argv of the program to open in a terminal, e.g. [\"devin\"] or [\"devin\", \"auth\", \"login\"]."),
  where: z.enum(["workspace", "scratch"]).optional().describe("workspace (default) or an empty temporary folder."),
  cols: z.number().int().min(40).max(400).optional(),
  rows: z.number().int().min(10).max(200).optional(),
}).strict();

const terminalId = z.string().regex(/^term_[a-z0-9]{6,32}$/);

export const termReadArgs = z.object({
  terminalId,
  mode: z.enum(["screen", "new"]).optional().describe("screen (default): what is visible now. new: only output since the last read."),
}).strict();

export const termSendArgs = z.object({
  terminalId,
  text: z.string().max(65_536).optional().describe("Text to type, sent as is."),
  keys: z.array(z.enum(KEY_NAMES)).max(32).optional().describe("Keys pressed after the text, in order."),
}).strict();

export const termWaitArgs = z.object({
  terminalId,
  text: z.string().min(1).max(200).optional().describe("Return as soon as this text is on screen."),
  idleMs: z.number().int().min(200).max(60_000).optional().describe("Return once the screen has not changed for this long. Default 1500."),
  timeoutSeconds: z.number().int().min(1).max(120).optional().describe("Default 30."),
}).strict();

export const termCloseArgs = z.object({ terminalId }).strict();
