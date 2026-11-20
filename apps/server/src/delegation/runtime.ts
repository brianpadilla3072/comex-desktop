import { externalDelegatesEnabled } from "../comex/features.js";
import { runtimeStorageDir } from "../runtime-db.js";
import { runtimeMcpMap, writeRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import type { ServerConfig } from "../types.js";
import { addRoute, type RequestContext, type Route } from "../routes/registry.js";
import { DELEGATES_MCP_NAME, delegatesMcpRuntimeEntry, handleDelegatesMcp } from "./mcp.js";
import { DelegationService, type DelegationApprovals } from "./service.js";

/**
 * Wires delegation into openwork-server: one DelegationService per server
 * config (owner: startServer, closed by its stop), the loopback MCP route, and
 * the `openwork-delegates` entry in each workspace's engine MCP config. With
 * the externalDelegates flag off the entry is removed and the route answers 503.
 */

const services = new WeakMap<ServerConfig, DelegationService>();

function serviceFor(config: ServerConfig, approvals: DelegationApprovals): DelegationService | null {
  if (!externalDelegatesEnabled()) return null;
  const existing = services.get(config);
  if (existing) return existing;
  const service = new DelegationService({
    runtimeDir: runtimeStorageDir(config),
    workspacePath: (workspaceId) => config.workspaces.find((workspace) => workspace.id === workspaceId)?.path ?? null,
    approvals,
    ptyFactory: config.delegationPty,
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
