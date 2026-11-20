import { JsonLineDecoder } from "./core.js";
import type { DelegateProcess } from "./process.js";
import { DelegationError } from "./schema.js";

/**
 * Agent Client Protocol client over a child's stdio (JSON-RPC 2.0, one JSON
 * value per line). OpenWork is the client: it starts sessions, sends prompts,
 * receives `session/update` notifications and answers the agent's
 * `session/request_permission` requests. It advertises no file system or
 * terminal capabilities, so the agent uses its own tools inside the task folder.
 * Rust equivalent: the `agent-client-protocol` crate or serde_json over tokio stdio.
 */

export const ACP_PROTOCOL_VERSION = 1;

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

export type AcpHandlers = {
  /** `session/update` notifications. */
  onUpdate(update: unknown): void;
  /** `session/request_permission`; resolves to the ACP result object. */
  onPermission(params: unknown): Promise<unknown>;
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : null;
}

export class AcpConnection {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly decoder = new JsonLineDecoder();
  private closed = false;
  stderr = "";

  constructor(private readonly process: DelegateProcess, private readonly handlers: AcpHandlers) {
    process.onData((chunk, stream) => {
      if (stream === "stderr") {
        this.stderr = (this.stderr + chunk).slice(-16_000);
        return;
      }
      for (const message of this.decoder.push(chunk)) this.receive(message);
    });
    process.onExit(() => {
      this.closed = true;
      for (const pending of this.pending.values()) pending.reject(new DelegationError("delegate_protocol_error", "The agent stopped before answering."));
      this.pending.clear();
    });
  }

  private write(message: Record<string, unknown>): void {
    if (this.closed) return;
    this.process.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (this.closed) return Promise.reject(new DelegationError("delegate_protocol_error", "The agent is not running."));
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    this.write({ method, params });
  }

  private receive(raw: unknown): void {
    const message = record(raw);
    if (!message) return;
    const id = message.id;
    const method = typeof message.method === "string" ? message.method : null;
    if (method === null && (typeof id === "number" || typeof id === "string")) {
      const pending = this.pending.get(Number(id));
      if (!pending) return;
      this.pending.delete(Number(id));
      const error = record(message.error);
      if (error) {
        const text = typeof error.message === "string" ? error.message : "The agent returned an error.";
        pending.reject(new DelegationError("delegate_protocol_error", `${text}${typeof error.code === "number" ? ` (${error.code})` : ""}`));
      } else pending.resolve(message.result ?? null);
      return;
    }
    if (method === null) return;
    if (id === undefined || id === null) {
      if (method === "session/update") this.handlers.onUpdate(record(message.params)?.update);
      return;
    }
    // A request from the agent: answer every one, or the agent waits forever.
    if (method === "session/request_permission") {
      this.handlers.onPermission(message.params).then(
        (result) => this.write({ id, result }),
        () => this.write({ id, result: { outcome: { outcome: "cancelled" } } }),
      );
      return;
    }
    this.write({ id, error: { code: -32601, message: `OpenWork does not provide ${method}.` } });
  }

  get isClosed(): boolean {
    return this.closed;
  }
}

/** Reads `{ sessionId }` from a session/new or session/load result. */
export function sessionIdOf(result: unknown): string | null {
  const value = record(result)?.sessionId;
  return typeof value === "string" && value ? value : null;
}

export function stopReasonOf(result: unknown): string {
  const value = record(result)?.stopReason;
  return typeof value === "string" ? value : "end_turn";
}

export function loadSessionSupported(initializeResult: unknown): boolean {
  return record(record(initializeResult)?.agentCapabilities)?.loadSession === true;
}

export type AcpUpdateEffect =
  | { type: "message"; text: string }
  | { type: "thought"; text: string }
  | { type: "activity"; line: string }
  | { type: "none" };

function contentText(content: unknown): string {
  const value = record(content);
  if (!value) return "";
  if (value.type === "text" && typeof value.text === "string") return value.text;
  return "";
}

/** What one `session/update` changes in a task's view: answer text, thoughts or an activity line. */
export function acpUpdateEffect(update: unknown): AcpUpdateEffect {
  const value = record(update);
  if (!value) return { type: "none" };
  switch (value.sessionUpdate) {
    case "agent_message_chunk": {
      const text = contentText(value.content);
      return text ? { type: "message", text } : { type: "none" };
    }
    case "agent_thought_chunk": {
      const text = contentText(value.content);
      return text ? { type: "thought", text } : { type: "none" };
    }
    case "tool_call": {
      const title = typeof value.title === "string" ? value.title : "tool";
      const status = typeof value.status === "string" ? value.status : "pending";
      return { type: "activity", line: `${title} (${status})` };
    }
    case "tool_call_update": {
      if (typeof value.status !== "string" || !["completed", "failed"].includes(value.status)) return { type: "none" };
      const title = typeof value.title === "string" ? value.title : typeof value.toolCallId === "string" ? value.toolCallId : "tool";
      return { type: "activity", line: `${title} (${value.status})` };
    }
    case "plan": {
      const entries = Array.isArray(value.entries) ? value.entries : [];
      const lines = entries.map((entry) => {
        const item = record(entry);
        return item && typeof item.content === "string" ? `${item.status === "completed" ? "[x]" : "[ ]"} ${item.content}` : "";
      }).filter(Boolean);
      return lines.length ? { type: "activity", line: `plan: ${lines.join(" · ").slice(0, 600)}` } : { type: "none" };
    }
    default:
      return { type: "none" };
  }
}
