import { externalDelegatesEnabled } from "../comex/features.js";
import { runtimeStorageDir } from "../runtime-db.js";
import { runtimeMcpMap, writeRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import type { ServerConfig } from "../types.js";
import { addRoute, type RequestContext, type Route } from "../routes/registry.js";
import { DELEGATES_MCP_NAME, delegatesMcpRuntimeEntry, handleDelegatesMcp } from "./mcp.js";
import { DelegationService, type DelegationApprovals } from "./service.js";
import { DELEGATE_DECIDERS, delegateSettings, type DelegateDecider } from "./schema.js";

/**
 * Wires delegation into openwork-server: one DelegationService per server
 * config (owner: startServer, closed by its stop), the loopback MCP route, and
 * the `openwork-delegates` entry in each workspace's engine MCP config. With
 * the externalDelegates flag off the entry is removed and the route answers 503.
 */

const services = new WeakMap<ServerConfig, DelegationService>();

/** Operator lock: OPENWORK_DELEGATES_DECIDER=person|orchestrator. Anything else is ignored. */
export function deciderFromEnvironment(env: Record<string, string | undefined>): DelegateDecider | undefined {
  const value = env.OPENWORK_DELEGATES_DECIDER?.trim();
  return DELEGATE_DECIDERS.find((decider) => decider === value);
}

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function serviceFor(config: ServerConfig, approvals: DelegationApprovals): DelegationService | null {
  if (!externalDelegatesEnabled()) return null;
  const existing = services.get(config);
  if (existing) return existing;
  const service = new DelegationService({
    runtimeDir: runtimeStorageDir(config),
    workspacePath: (workspaceId) => config.workspaces.find((workspace) => workspace.id === workspaceId)?.path ?? null,
    approvals,
    ptyFactory: config.delegationPty,
    deciderOverride: deciderFromEnvironment(process.env),
  });
  services.set(config, service);
  return service;
}

export type ApprovalQueue = {
  requestApproval(input: { workspaceId: string; action: string; summary: string; paths: string[]; actor: { type: "host" } }): Promise<{ id: string; allowed: boolean; reason?: string }>;
};

/** Desktop: its native dialog (engine tools cannot answer it). Elsewhere: the server's approval queue. */
export function delegationApprovals(config: ServerConfig, queue: ApprovalQueue): DelegationApprovals {
  return {
    async confirm(input) {
      const native = config.delegationApproval;
      if (native) return { allowed: await native({ action: input.action, title: input.title, detail: input.detail }), reason: "denied" };
      const result = await queue.requestApproval({ workspaceId: input.workspaceId, action: `delegates.${input.action}`, summary: `${input.title} ${input.detail}`, paths: [], actor: { type: "host" } });
      // With automatic approvals ("auto" mode) nobody actually looked at a risky
      // permission request, so it is refused rather than allowed.
      if (input.action === "permission" && result.id === "auto") return { allowed: false, reason: "no_responder" };
      return result;
    },
  };
}

export function registerDelegatesRoutes(routes: Route[], config: ServerConfig, queue: ApprovalQueue): void {
  const approvals = delegationApprovals(config, queue);
  const handler = async (ctx: RequestContext) => handleDelegatesMcp({
    owner: config,
    service: serviceFor(config, approvals),
    request: ctx.request,
    workspaceId: ctx.params.workspaceId ?? "",
    port: config.port,
  });
  addRoute(routes, "POST", "/mcp/delegates/:workspaceId", "none", handler);
  addRoute(routes, "GET", "/mcp/delegates/:workspaceId", "none", handler);
  addRoute(routes, "DELETE", "/mcp/delegates/:workspaceId", "none", handler);

  // Who decides about external agents. Host (owner) access only: engine tools never hold this token.
  addRoute(routes, "GET", "/delegates/settings", "host", async () => {
    const service = serviceFor(config, approvals);
    if (!service) return jsonResponse({ code: "delegates_disabled", message: "External delegates are turned off." }, 404);
    return jsonResponse(await service.settings());
  });
  addRoute(routes, "PUT", "/delegates/settings", "host", async (ctx) => {
    const service = serviceFor(config, approvals);
    if (!service) return jsonResponse({ code: "delegates_disabled", message: "External delegates are turned off." }, 404);
    let body: unknown = null;
    try {
      body = await ctx.request.json();
    } catch {
      body = null;
    }
    const parsed = delegateSettings.safeParse(body);
    if (!parsed.success) return jsonResponse({ code: "invalid_payload", message: "Send { \"decider\": \"person\" | \"orchestrator\" }." }, 400);
    return jsonResponse(await service.updateSettings(parsed.data));
  });
}

/** Adds (flag on) or removes (flag off) the engine MCP entry for every local workspace. */
export async function reconcileDelegatesRuntimeEntries(config: ServerConfig): Promise<void> {
  const enabled = externalDelegatesEnabled();
  for (const workspace of config.workspaces) {
    if (workspace.workspaceType !== "local" || !workspace.path) continue;
    await writeRuntimeOpencodeConfig(config, workspace.id, (current) => {
      const mcp = { ...runtimeMcpMap(current) };
      if (enabled) mcp[DELEGATES_MCP_NAME] = delegatesMcpRuntimeEntry(config, config.port, workspace.id);
      else if (mcp[DELEGATES_MCP_NAME]) delete mcp[DELEGATES_MCP_NAME];
      else return current;
      return { ...current, mcp };
    });
  }
}

export function closeDelegationService(config: ServerConfig): void {
  services.get(config)?.close();
  services.delete(config);
}
