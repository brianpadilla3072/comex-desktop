import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { DELEGATION_GUIDE, DELEGATION_INSTRUCTIONS } from "./guide.js";
import {
  DelegationError,
  nameArgs,
  probeArgs,
  registerArgs,
  replyArgs,
  resultArgs,
  startArgs,
  statusArgs,
  taskArgs,
  termCloseArgs,
  termOpenArgs,
  termReadArgs,
  termSendArgs,
  termWaitArgs,
} from "./schema.js";
import type { DelegationService } from "./service.js";

/**
 * The `openwork-delegates` MCP server that OpenCode (v1 and v2) reaches over
 * loopback, one URL per workspace with an HMAC bearer token, like the local
 * managed MCP gateway. Stateless: every request builds a server and transport.
 */

export const DELEGATES_MCP_NAME = "openwork-delegates";

const TOOLS = {
  delegate_guide: {
    description: "How to learn a new external agent CLI (find it, read its help, sign in, test, register) and how to delegate to it. Read this before registering a tool.",
    args: z.object({}).strict(),
  },
  delegate_list: {
    description: "List registered external agents with status: ready, missing (not installed or not on PATH) or changed (new version or path: test it again before relying on it).",
    args: z.object({}).strict(),
  },
  delegate_probe: {
    description: "Run a command once and return its exit code, stdout and stderr, to learn how a CLI works (--version, --help, a trivial test task). Runs in an empty temporary folder by default. The first command of each program asks the person.",
    args: probeArgs,
  },
  delegate_register: {
    description: "Save a tested recipe for an external agent CLI so tasks can be delegated to it. The person approves it. Follow delegate_guide first.",
    args: registerArgs,
  },
  delegate_unregister: {
    description: "Forget a registered external agent.",
    args: nameArgs,
  },
  delegate_start: {
    description: "Hand a self-contained task to a registered external agent. Returns a taskId immediately; the agent works in an isolated git worktree unless isolation is workspace.",
    args: startArgs,
  },
  delegate_status: {
    description: "State, recent activity and output of one delegated task, or of all tasks of this project. state needs_input means it waits for you: read pendingInput and answer with delegate_reply.",
    args: statusArgs,
  },
  delegate_result: {
    description: "Wait (up to waitSeconds) for a delegated task to finish or to need input. Finished: its answer, changed files, diff summary, worktree path and session id. needs_input: the permission request or question in pendingInput, to answer with delegate_reply.",
    args: resultArgs,
  },
  delegate_reply: {
    description: "Answer a delegated agent. For a permission request (pendingInput.type permission) give decision allow, allow_always, reject, or ask_person when unsure or risky; judge it by the task you gave: allow what the task needs inside the task folder, reject anything else. For a question, or a follow-up after the agent finished its turn, give text. decision done stops a program that already finished its work.",
    args: replyArgs,
  },
  delegate_cancel: {
    description: "Stop a delegated task. Its worktree stays until delegate_discard.",
    args: taskArgs,
  },
  delegate_discard: {
    description: "Remove a finished task's isolated worktree and branch after you reviewed or merged its changes.",
    args: taskArgs,
  },
  term_open: {
    description: "Open any program in a real terminal (pseudo-terminal) to drive it: sign-in prompts, first-run wizards, interactive CLIs or TUIs. Returns the screen. The first command of each program asks the person.",
    args: termOpenArgs,
  },
  term_read: {
    description: "Read a terminal: the visible screen, or only the output since the last read.",
    args: termReadArgs,
  },
  term_send: {
    description: "Type text and/or press keys in a terminal, then return the screen. Never type secrets the person did not give you for this program.",
    args: termSendArgs,
  },
  term_wait: {
    description: "Wait until a text appears on a terminal, the screen is idle, or the program exits.",
    args: termWaitArgs,
  },
  term_close: {
    description: "Close a terminal and stop its program.",
    args: termCloseArgs,
  },
} as const satisfies Record<string, { description: string; args: z.ZodObject }>;

type ToolName = keyof typeof TOOLS;

function isToolName(name: string): name is ToolName {
  return Object.hasOwn(TOOLS, name);
}

export function delegationToolNames(): string[] {
  return Object.keys(TOOLS);
}

async function runTool(service: DelegationService, workspaceId: string, name: ToolName, raw: unknown): Promise<unknown> {
  switch (name) {
    case "delegate_guide": return { guide: DELEGATION_GUIDE };
    case "delegate_list": return { agents: await service.list() };
    case "delegate_probe": return service.probe(workspaceId, probeArgs.parse(raw));
    case "delegate_register": return service.register(workspaceId, registerArgs.parse(raw).recipe);
    case "delegate_unregister": return service.unregister(nameArgs.parse(raw).name);
    case "delegate_start": return service.start(workspaceId, startArgs.parse(raw));
    case "delegate_status": return service.status(workspaceId, statusArgs.parse(raw).taskId);
    case "delegate_result": {
      const args = resultArgs.parse(raw);
      return service.result(args.taskId, args.waitSeconds);
    }
    case "delegate_reply": {
      const args = replyArgs.parse(raw);
      return service.reply(args.taskId, args);
    }
    case "delegate_cancel": return service.cancel(taskArgs.parse(raw).taskId);
    case "delegate_discard": return service.discard(taskArgs.parse(raw).taskId);
    case "term_open": return service.termOpen(workspaceId, termOpenArgs.parse(raw));
    case "term_read": {
      const args = termReadArgs.parse(raw);
      return service.termRead(args.terminalId, args.mode);
    }
    case "term_send": {
      const args = termSendArgs.parse(raw);
      return service.termSend(args.terminalId, args);
    }
    case "term_wait": {
      const args = termWaitArgs.parse(raw);
      return service.termWait(args.terminalId, args);
    }
    case "term_close": return service.closeTerminal(termCloseArgs.parse(raw).terminalId);
  }
}

function errorPayload(error: unknown): { error: string; message: string } {
  if (error instanceof DelegationError) return { error: error.code, message: error.message };
  if (error instanceof z.ZodError) return { error: "delegate_invalid_arguments", message: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") };
  return { error: "delegate_internal_error", message: error instanceof Error ? error.message : "Unexpected error." };
}

/** Owner: the delegates MCP route; lifetime: one server process. Signs per-workspace tokens. */
const tokenSecrets = new WeakMap<object, Buffer>();

export function delegatesMcpToken(owner: object, workspaceId: string): string {
  let secret = tokenSecrets.get(owner);
  if (!secret) {
    secret = randomBytes(32);
    tokenSecrets.set(owner, secret);
  }
  return createHmac("sha256", secret).update(`delegates\0${workspaceId}`).digest("base64url");
}

export function delegatesMcpPath(workspaceId: string): string {
  return `/mcp/delegates/${encodeURIComponent(workspaceId)}`;
}

/** The engine's MCP entry for one workspace. */
export function delegatesMcpRuntimeEntry(owner: object, port: number, workspaceId: string): Record<string, unknown> {
  return {
    type: "remote",
    url: `http://127.0.0.1:${port}${delegatesMcpPath(workspaceId)}`,
    enabled: true,
    headers: { Authorization: `Bearer ${delegatesMcpToken(owner, workspaceId)}` },
    oauth: false,
  };
}

function authorized(owner: object, request: Request, workspaceId: string): boolean {
  const supplied = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!supplied) return false;
  const expected = Buffer.from(delegatesMcpToken(owner, workspaceId));
  const given = Buffer.from(supplied);
  return given.byteLength === expected.byteLength && timingSafeEqual(given, expected);
}

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export async function handleDelegatesMcp(input: {
  owner: object;
  service: DelegationService | null;
  request: Request;
  workspaceId: string;
  port: number;
}): Promise<Response> {
  if (!authorized(input.owner, input.request, input.workspaceId)) return json({ error: "unauthorized" }, 401);
  const service = input.service;
  if (!service) return json({ error: "delegates_disabled" }, 503);
  const server = new Server({ name: DELEGATES_MCP_NAME, version: "1.0.0" }, { capabilities: { tools: {} }, instructions: DELEGATION_INSTRUCTIONS });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Object.entries(TOOLS).map(([name, tool]) => {
      const schema = z.toJSONSchema(tool.args);
      return { name, description: tool.description, inputSchema: { ...schema, type: "object" as const } };
    }),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (call) => {
    const name = call.params.name;
    if (!isToolName(name)) return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error: "delegate_unknown_tool", message: `Unknown tool ${name}.` }) }] };
    try {
      const result = await runTool(service, input.workspaceId, name, call.params.arguments ?? {});
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text" as const, text: JSON.stringify(errorPayload(error)) }] };
    }
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    enableDnsRebindingProtection: true,
    allowedHosts: [`127.0.0.1:${input.port}`, `localhost:${input.port}`],
  });
  await server.connect(transport);
  return transport.handleRequest(input.request);
}
