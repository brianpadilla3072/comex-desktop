import { z } from "zod";
import { addProviderSafeTool } from "./provider-safe-tool-schema.js";

type ToolCall = { signal: AbortSignal; sessionID: string; messageID?: string; id?: string; agent?: string };
type Tool = {
  name: string;
  description: string;
  input: Record<string, unknown>;
  options: { codemode: boolean };
  execute(input: unknown, context: ToolCall): Promise<{ content: Array<{ type: "text"; text: string }> }>;
};

// These tools expose the agent ecosystem board (need bus, cross-project index
// and deliverables) to the model. They are thin HTTP wrappers over the server
// routes — no business logic lives here. The server owns the feature flag; the
// tools also check it so they are not advertised when the feature is off.
type Editor = { add(tool: Tool): void };
type Context = {
  options: { url: string; token: string };
  env?: NodeJS.ProcessEnv;
  tool: { transform(callback: (editor: Editor) => void): Promise<{ dispose(): Promise<void> }> };
};

const okSchema = z.object({ status: z.string().optional() }).passthrough();

export default {
  id: "openwork.ecosystem",
  async setup(context: Context) {
    const enabled = () => {
      const env = context.env ?? process.env;
      return env.DEN_FEATURE_AGENT_ECOSYSTEM?.trim().toLowerCase() === "true";
    };
    const call = async (
      name: string,
      method: "GET" | "POST",
      path: string,
      input: unknown,
      toolCall: ToolCall,
    ) => {
      toolCall.signal.throwIfAborted();
      if (!enabled()) throw new Error("El ecosistema de agentes está desactivado.");
      const url = new URL(path, context.options.url);
      const response = await fetch(url.toString(), {
        method,
        redirect: "error",
        signal: toolCall.signal,
        headers: {
          Authorization: `Bearer ${context.options.token}`,
          "Content-Type": "application/json",
        },
        ...(method === "POST" ? { body: JSON.stringify(input) } : {}),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`Ecosistema ${name} falló (${response.status}): ${text}`);
      return { content: [{ type: "text" as const, text }] };
    };
    const ws = (workspaceId: string) => `/workspace/${encodeURIComponent(workspaceId)}/agent-ecosystem`;

    const tools: Array<{ name: string; description: string; input: Record<string, unknown>; method: "GET" | "POST"; path: (i: Record<string, string>) => string }> = [
      {
        name: "ecosystem_state",
        description: "Read the full agent ecosystem board: open/claimed needs, the cross-project index and deliverables. Use at the start of a coordinator run to see what is active before publishing work.",
        input: { type: "object", properties: { workspaceId: { type: "string", minLength: 1 } }, required: ["workspaceId"], additionalProperties: false },
        method: "GET",
        path: i => ws(i.workspaceId),
      },
      {
        name: "ecosystem_publish",
        description: "Publish a need on the board for workers to claim. Give a short context so a worker can decide without loading a whole project. The first worker to claim it wins; work is never assigned to a specific worker.",
        input: {
          type: "object",
          properties: {
            workspaceId: { type: "string", minLength: 1 }, from: { type: "string", minLength: 1 },
            projectId: { type: "string", minLength: 1 }, sessionId: { type: "string", minLength: 1 },
            need: { type: "string", minLength: 1 }, contextShort: { type: "string", minLength: 1, maxLength: 200 },
            priority: { type: "string", enum: ["high", "normal", "low"] },
          },
          required: ["workspaceId", "from", "projectId", "sessionId", "need", "contextShort"],
          additionalProperties: false,
        },
        method: "POST",
        path: i => `${ws(i.workspaceId)}/needs`,
      },
      {
        name: "ecosystem_claim",
        description: "Claim an open need as a worker. Returns ALREADY_CLAIMED if another worker took it. Only the claimant can resolve it.",
        input: {
          type: "object",
          properties: { workspaceId: { type: "string", minLength: 1 }, needId: { type: "string", minLength: 1 }, agentId: { type: "string", minLength: 1 } },
          required: ["workspaceId", "needId", "agentId"],
          additionalProperties: false,
        },
        method: "POST",
        path: i => `${ws(i.workspaceId)}/needs/${encodeURIComponent(i.needId)}/claim`,
      },
      {
        name: "ecosystem_resolve",
        description: "Resolve a need you claimed, with a reference to the deliverable produced. Only the claimant may resolve.",
        input: {
          type: "object",
          properties: { workspaceId: { type: "string", minLength: 1 }, needId: { type: "string", minLength: 1 }, agentId: { type: "string", minLength: 1 }, resultRef: { type: "string", minLength: 1 } },
          required: ["workspaceId", "needId", "agentId", "resultRef"],
          additionalProperties: false,
        },
        method: "POST",
        path: i => `${ws(i.workspaceId)}/needs/${encodeURIComponent(i.needId)}/resolve`,
      },
      {
        name: "ecosystem_index",
        description: "Upsert this project's short one-line summary so other agents can see what is happening here without loading the whole project. Read the shared index with ecosystem_state.",
        input: {
          type: "object",
          properties: {
            workspaceId: { type: "string", minLength: 1 }, projectId: { type: "string", minLength: 1 },
            sessionId: { type: "string", minLength: 1 }, agentId: { type: "string", minLength: 1 },
            title: { type: "string", minLength: 1 }, status: { type: "string", enum: ["active", "paused", "done", "halted"] },
            oneLiner: { type: "string", minLength: 1, maxLength: 120 },
          },
          required: ["workspaceId", "projectId", "sessionId", "agentId", "title", "status", "oneLiner"],
          additionalProperties: false,
        },
        method: "POST",
        path: i => `${ws(i.workspaceId)}/index`,
      },
      {
        name: "ecosystem_board",
        description: "Create a deliverable on the shared board with a single owner agent. Other agents comment instead of editing. approvalState is informational only — external actions use OpenWork's native permission system.",
        input: {
          type: "object",
          properties: {
            workspaceId: { type: "string", minLength: 1 }, projectId: { type: "string", minLength: 1 },
            ownerAgent: { type: "string", minLength: 1 }, title: { type: "string", minLength: 1 },
            status: { type: "string", enum: ["draft", "review", "done"] }, draftPath: { type: "string", minLength: 1 },
          },
          required: ["workspaceId", "projectId", "ownerAgent", "title", "status", "draftPath"],
          additionalProperties: false,
        },
        method: "POST",
        path: i => `${ws(i.workspaceId)}/board`,
      },
      {
        name: "ecosystem_halt",
        description: "Halt or resume the agent ecosystem. When halted, new claims are rejected and workers stop. Use as the coordinator's red line when something goes wrong or the human asks to stop. Pass halted=true to stop, halted=false to resume.",
        input: {
          type: "object",
          properties: {
            workspaceId: { type: "string", minLength: 1 },
            halted: { type: "boolean" },
            by: { type: "string", minLength: 1 },
          },
          required: ["workspaceId", "halted", "by"],
          additionalProperties: false,
        },
        method: "POST",
        path: i => `${ws(i.workspaceId)}/halt`,
      },
    ];

    return context.tool.transform(editor => {
      if (!enabled()) return;
      for (const t of tools) {
        addProviderSafeTool(editor, {
          name: t.name,
          description: t.description,
          input: t.input,
          options: { codemode: true },
          async execute(input: unknown, toolCall: ToolCall) {
            const i = z.object({ workspaceId: z.string() }).passthrough().parse(input) as Record<string, string>;
            return call(t.name, t.method, t.path(i), input, toolCall);
          },
        } satisfies Tool);
      }
    });
  },
};
