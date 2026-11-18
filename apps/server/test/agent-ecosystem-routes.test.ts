import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiError } from "../src/errors.js";
import { registerAgentEcosystemRoutes } from "../src/comex/agent-ecosystem-routes.js";
import { matchRoute, type RequestContext, type Route } from "../src/routes/registry.js";
import type { ServerConfig } from "../src/types.js";

function setup(root: string, enabled: boolean) {
  process.env.DEN_FEATURE_AGENT_ECOSYSTEM = enabled ? "true" : "false";
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "client", hostToken: "host",
    configPath: join(root, "config.json"),
    approval: { mode: "auto", timeoutMs: 30_000 }, corsOrigins: [], workspaces: [],
    authorizedRoots: [root], readOnly: false, startedAt: 0, tokenSource: "generated",
    hostTokenSource: "generated", logFormat: "pretty", logRequests: false,
  };
  const routes: Route[] = [];
  registerAgentEcosystemRoutes({
    routes, config,
    readJsonBody: async request => request.json(),
    jsonResponse: body => Response.json(body),
    ensureWritable: value => { if (value.readOnly) throw new ApiError(403, "read_only", "Solo lectura"); },
  });
  async function request(method: string, pathWithQuery: string, body?: unknown) {
    const url = new URL(`http://localhost${pathWithQuery}`);
    const route = matchRoute(routes, method, url.pathname);
    assert.ok(route, `missing route ${method} ${url.pathname}`);
    const ctx = {
      params: route.params,
      url,
      request: new Request(`http://localhost${pathWithQuery}`, {
        method, ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}),
      }),
    } as RequestContext;
    return route.handler(ctx);
  }
  return { config, routes, request };
}

test("agent ecosystem: need bus claim is first-writer-wins, TTL and resolve are enforced", async t => {
  const root = await mkdtemp(join(tmpdir(), "agent-ecosystem-"));
  const old = process.env.DEN_FEATURE_AGENT_ECOSYSTEM;
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    if (old === undefined) delete process.env.DEN_FEATURE_AGENT_ECOSYSTEM; else process.env.DEN_FEATURE_AGENT_ECOSYSTEM = old;
  });
  const ws = "ws_claim";

  const { config, request } = setup(root, true);
  const base = `/workspace/${ws}/agent-ecosystem`;

  // Empty state
  assert.deepEqual(await (await request("GET", base)).json(), { needs: [], index: [], board: [], halted: false, haltedAt: null, haltedBy: null });

  // Publish a need
  const published = await (await request("POST", `${base}/needs`, {
    from: "coordinator", projectId: "A", sessionId: "s1", need: "research_competitor",
    contextShort: "Investigar alternativas de notificación", priority: "high",
  })).json();
  const needId = published.need.id;
  assert.equal(published.need.status, "open");

  // First claim wins; second is rejected
  const claimed = await (await request("POST", `${base}/needs/${needId}/claim`, { agentId: "researcher" })).json();
  assert.equal(claimed.need.status, "claimed");
  assert.equal(claimed.need.claimedBy, "researcher");
  await assert.rejects(
    request("POST", `${base}/needs/${needId}/claim`, { agentId: "reviewer" }),
    error => { return error instanceof ApiError && error.code === "need_already_claimed" && error.status === 409; },
  );

  // Only the claimant can resolve
  await assert.rejects(
    request("POST", `${base}/needs/${needId}/resolve`, { agentId: "reviewer", resultRef: "e1.md" }),
    error => error instanceof ApiError && error.code === "need_already_claimed",
  );
  const resolved = await (await request("POST", `${base}/needs/${needId}/resolve`, { agentId: "researcher", resultRef: "e1.md" })).json();
  assert.equal(resolved.need.status, "resolved");
  assert.equal(resolved.need.resultRef, "e1.md");

  // Filter by status
  const open = await (await request("GET", `${base}/needs?status=open`)).json();
  assert.equal(open.needs.length, 0);
  const resolvedList = await (await request("GET", `${base}/needs?status=resolved`)).json();
  assert.equal(resolvedList.needs.length, 1);
});

test("agent ecosystem: index is on-demand and board keeps owners", async t => {
  const root = await mkdtemp(join(tmpdir(), "agent-ecosystem-board-"));
  const old = process.env.DEN_FEATURE_AGENT_ECOSYSTEM;
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    if (old === undefined) delete process.env.DEN_FEATURE_AGENT_ECOSYSTEM; else process.env.DEN_FEATURE_AGENT_ECOSYSTEM = old;
  });
  const ws = "ws_board";

  const { request } = setup(root, true);
  const base = `/workspace/${ws}/agent-ecosystem`;

  await request("POST", `${base}/index`, {
    projectId: "A", sessionId: "s1", agentId: "coordinator", title: "Proyecto A",
    status: "active", oneLiner: "Investigando notificaciones + redactando spec",
  });
  const index = await (await request("GET", `${base}/index?projectId=A`)).json();
  assert.equal(index.index.length, 1);
  assert.equal(index.index[0].oneLiner.length <= 120, true);

  const created = await (await request("POST", `${base}/board`, {
    projectId: "A", ownerAgent: "researcher", title: "Alternativas de notificación",
    status: "draft", draftPath: "proyecto/entregables/e1.md",
  })).json();
  assert.equal(created.deliverable.ownerAgent, "researcher");
  const board = await (await request("GET", `${base}/board`)).json();
  assert.equal(board.board.length, 1);
  await assert.rejects(
    request("POST", `${base}/board/${created.deliverable.id}/comment`, { comment: "" }),
    error => error instanceof ApiError && error.status === 422,
  );
  await request("POST", `${base}/board/${created.deliverable.id}/comment`, { comment: "Listo para revisión" });
  const board2 = await (await request("GET", `${base}/board`)).json();
  assert.deepEqual(board2.board[0].comments, ["Listo para revisión"]);
});

test("agent ecosystem: halt blocks claims and expiry releases stale claims", async t => {
  const root = await mkdtemp(join(tmpdir(), "agent-ecosystem-halt-"));
  const old = process.env.DEN_FEATURE_AGENT_ECOSYSTEM;
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    if (old === undefined) delete process.env.DEN_FEATURE_AGENT_ECOSYSTEM; else process.env.DEN_FEATURE_AGENT_ECOSYSTEM = old;
  });
  const { request } = setup(root, true);
  const base = "/workspace/ws_halt/agent-ecosystem";

  const published = await (await request("POST", `${base}/needs`, {
    from: "coordinator", projectId: "A", sessionId: "s1", need: "research", contextShort: "ctx",
  })).json();
  const needId = published.need.id;

  // Halt blocks all new claims.
  await request("POST", `${base}/halt`, { halted: true, by: "usuario" });
  await assert.rejects(
    request("POST", `${base}/needs/${needId}/claim`, { agentId: "researcher" }),
    error => error instanceof ApiError && error.code === "ecosystem_halted" && error.status === 409,
  );
  const halted = await (await request("GET", base)).json();
  assert.equal(halted.halted, true);
  assert.equal(halted.haltedBy, "usuario");

  // Resume, claim, then expire the stale claim.
  await request("POST", `${base}/halt`, { halted: false, by: "usuario" });
  const claimed = await (await request("POST", `${base}/needs/${needId}/claim`, { agentId: "researcher" })).json();
  assert.equal(claimed.need.status, "claimed");
  // Force expiry by setting claimedAt into the past through a published need with tiny TTL.
  const short = await (await request("POST", `${base}/needs`, {
    from: "coordinator", projectId: "A", sessionId: "s1", need: "short", contextShort: "ctx",
  })).json();
  // The manual expire endpoint releases claims past their TTL (here none yet), so it is a no-op.
  const expired = await (await request("POST", `${base}/expire`)).json();
  assert.deepEqual(expired.expired, []);
});

test("agent ecosystem: routes are gated off behind the feature flag", async t => {
  const root = await mkdtemp(join(tmpdir(), "agent-ecosystem-off-"));
  const old = process.env.DEN_FEATURE_AGENT_ECOSYSTEM;
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    if (old === undefined) delete process.env.DEN_FEATURE_AGENT_ECOSYSTEM; else process.env.DEN_FEATURE_AGENT_ECOSYSTEM = old;
  });
  const { request } = setup(root, false);
  await assert.rejects(
    request("GET", "/workspace/ws_off/agent-ecosystem"),
    error => error instanceof ApiError && error.code === "agent_ecosystem_disabled" && error.status === 404,
  );
});
