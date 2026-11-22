/**
 * Agent ecosystem state: a need bus with atomic claim, a cross-project index and
 * a deliverables board. State lives in workspace-scoped KV stores, the same
 * persistence OpenWork uses for thread approvals — no new database, no new
 * migration. Claims are serialized per workspace so the first claimant wins.
 *
 * Approvals of external actions are deliberately NOT here: agents use OpenWork's
 * native permission system (allow/ask/deny + thread-approvals) for that.
 */
import { z } from "zod";
import { createWorkspaceKvStore, isRecord } from "../workspace-kv-store.js";
import type { ServerConfig } from "../types.js";

export type NeedStatus = "open" | "claimed" | "resolved" | "failed" | "expired";

export interface Need {
  id: string;
  from: string;
  projectId: string;
  sessionId: string;
  need: string;
  contextShort: string;
  priority: "high" | "normal" | "low";
  status: NeedStatus;
  claimedBy: string | null;
  claimedAt: number | null;
  ttlMs: number;
  resultRef: string | null;
  createdAt: number;
  resolvedAt: number | null;
}

export interface ProjectSummary {
  projectId: string;
  sessionId: string;
  agentId: string;
  title: string;
  status: "active" | "paused" | "done" | "halted";
  lastUpdate: number;
  oneLiner: string;
}

export interface Deliverable {
  id: string;
  projectId: string;
  ownerAgent: string;
  title: string;
  status: "draft" | "review" | "done";
  draftPath: string;
  comments: string[];
  approvalState: "none" | "approved" | "rejected";
  createdAt: number;
  updatedAt: number;
}

export interface EcosystemState {
  needs: Need[];
  index: ProjectSummary[];
  board: Deliverable[];
  halted: boolean;
  haltedAt: number | null;
  haltedBy: string | null;
}

// Stored entries keep any extra keys a newer version wrote.
const projectSummarySchema = z.looseObject({
  projectId: z.string(),
  sessionId: z.string(),
  agentId: z.string(),
  title: z.string(),
  status: z.enum(["active", "paused", "done", "halted"]),
  lastUpdate: z.number(),
  oneLiner: z.string(),
}) satisfies z.ZodType<ProjectSummary>;

const deliverableSchema = z.looseObject({
  id: z.string(),
  projectId: z.string(),
  ownerAgent: z.string(),
  title: z.string(),
  status: z.enum(["draft", "review", "done"]),
  draftPath: z.string(),
  comments: z.array(z.string()),
  approvalState: z.enum(["none", "approved", "rejected"]),
  createdAt: z.number(),
  updatedAt: z.number(),
}) satisfies z.ZodType<Deliverable>;

function validItem<T>(schema: z.ZodType<T>, value: unknown): T[] {
  const parsed = schema.safeParse(value);
  return parsed.success ? [parsed.data] : [];
}

function emptyState(): EcosystemState {
  return { needs: [], index: [], board: [], halted: false, haltedAt: null, haltedBy: null };
}

function parseNeed(value: unknown): Need | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.id !== "string" || typeof value.need !== "string") return undefined;
  if (typeof value.projectId !== "string" || typeof value.sessionId !== "string") return undefined;
  if (typeof value.from !== "string" || typeof value.contextShort !== "string") return undefined;
  const status = value.status;
  if (status !== "open" && status !== "claimed" && status !== "resolved" && status !== "failed" && status !== "expired") return undefined;
  const priority = value.priority === "high" || value.priority === "low" ? value.priority : "normal";
  return {
    id: value.id,
    from: value.from,
    projectId: value.projectId,
    sessionId: value.sessionId,
    need: value.need,
    contextShort: value.contextShort,
    priority,
    status,
    claimedBy: typeof value.claimedBy === "string" ? value.claimedBy : null,
    claimedAt: typeof value.claimedAt === "number" ? value.claimedAt : null,
    ttlMs: typeof value.ttlMs === "number" ? value.ttlMs : DEFAULT_TTL_MS,
    resultRef: typeof value.resultRef === "string" ? value.resultRef : null,
    createdAt: typeof value.createdAt === "number" ? value.createdAt : 0,
    resolvedAt: typeof value.resolvedAt === "number" ? value.resolvedAt : null,
  };
}

function parseState(json: string): EcosystemState {
  let value: unknown;
  try {
    const parsed: unknown = JSON.parse(json);
    value = parsed;
  } catch { return emptyState(); }
  if (!isRecord(value)) return emptyState();
  const needs = Array.isArray(value.needs) ? value.needs.map(parseNeed).filter((n): n is Need => Boolean(n)) : [];
  // A malformed summary or deliverable is dropped, like a malformed need.
  const index = Array.isArray(value.index) ? value.index.flatMap(item => validItem(projectSummarySchema, item)) : [];
  const board = Array.isArray(value.board) ? value.board.flatMap(item => validItem(deliverableSchema, item)) : [];
  return {
    needs, index, board,
    halted: value.halted === true,
    haltedAt: typeof value.haltedAt === "number" ? value.haltedAt : null,
    haltedBy: typeof value.haltedBy === "string" ? value.haltedBy : null,
  };
}

export const DEFAULT_TTL_MS = 30 * 60 * 1000;

const stateStore = createWorkspaceKvStore<EcosystemState>({
  tableName: "agent_ecosystem",
  valueColumn: "state_json",
  parse: parseState,
  serialize: value => JSON.stringify(value),
});

/** Serialize mutations per workspace so a claim is first-writer-wins.
 * The queue chain always resolves (it swallows errors into a void link) so a
 * rejected operation never becomes an unhandled rejection; the caller gets
 * the real outcome through its own awaited promise. */
const queues = new Map<string, Promise<void>>();
function serialize<T>(workspaceId: string, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(workspaceId) ?? Promise.resolve();
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const result = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  const link = previous.then(async () => {
    try { resolve(await work()); }
    catch (error) { reject(error); }
  });
  queues.set(workspaceId, link);
  void link.then(() => {
    if (queues.get(workspaceId) === link) queues.delete(workspaceId);
  });
  return result;
}

export interface PublishNeedInput {
  from: string;
  projectId: string;
  sessionId: string;
  need: string;
  contextShort: string;
  priority?: Need["priority"];
  ttlMs?: number;
}

export class ClaimConflict extends Error {
  constructor(public readonly claimedBy: string) {
    super("ALREADY_CLAIMED");
  }
}

export class NotFound extends Error {
  constructor(public readonly kind: string, public readonly id: string) {
    super(`${kind}_not_found`);
  }
}

export class EcosystemHalted extends Error {
  constructor(public readonly haltedBy: string | null) {
    super("ECOSYSTEM_HALTED");
  }
}

/** Set or clear the halt flag for a workspace. A halted board refuses new claims. */
export async function setHalt(config: ServerConfig, workspaceId: string, halted: boolean, by: string): Promise<EcosystemState> {
  return serialize(workspaceId, async () => {
    const state = await stateStore.get(config, workspaceId) ?? emptyState();
    state.halted = halted;
    state.haltedAt = halted ? Date.now() : null;
    state.haltedBy = halted ? by : null;
    await stateStore.set(config, workspaceId, state);
    return state;
  });
}

/** Expire claims older than their TTL. Returns the ids that were released. */
export async function expireStaleClaims(config: ServerConfig, workspaceId: string, now = Date.now()): Promise<string[]> {
  return serialize(workspaceId, async () => {
    const state = await stateStore.get(config, workspaceId) ?? emptyState();
    const released: string[] = [];
    for (const need of state.needs) {
      if (need.status === "claimed" && need.claimedAt !== null && now - need.claimedAt > need.ttlMs) {
        need.status = "open";
        need.claimedBy = null;
        need.claimedAt = null;
        released.push(need.id);
      }
    }
    if (released.length) await stateStore.set(config, workspaceId, state);
    return released;
  });
}

export async function publishNeed(config: ServerConfig, workspaceId: string, input: PublishNeedInput): Promise<Need> {
  return serialize(workspaceId, async () => {
    const state = await stateStore.get(config, workspaceId) ?? emptyState();
    const need: Need = {
      id: `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      from: input.from,
      projectId: input.projectId,
      sessionId: input.sessionId,
      need: input.need,
      contextShort: input.contextShort.slice(0, 200),
      priority: input.priority ?? "normal",
      status: "open",
      claimedBy: null,
      claimedAt: null,
      ttlMs: input.ttlMs ?? DEFAULT_TTL_MS,
      resultRef: null,
      createdAt: Date.now(),
      resolvedAt: null,
    };
    state.needs.push(need);
    await stateStore.set(config, workspaceId, state);
    return need;
  });
}

/** Expire stale claims, then claim an open need. First claimant wins. */
export async function claimNeed(config: ServerConfig, workspaceId: string, needId: string, agentId: string, now = Date.now()): Promise<Need> {
  return serialize(workspaceId, async () => {
    const state = await stateStore.get(config, workspaceId) ?? emptyState();
    if (state.halted) throw new EcosystemHalted(state.haltedBy);
    for (const need of state.needs) {
      if (need.status === "claimed" && need.claimedAt !== null && now - need.claimedAt > need.ttlMs) {
        need.status = "open";
        need.claimedBy = null;
        need.claimedAt = null;
      }
    }
    const need = state.needs.find(n => n.id === needId);
    if (!need) throw new NotFound("need", needId);
    if (need.status !== "open") throw new ClaimConflict(need.claimedBy ?? "unknown");
    need.status = "claimed";
    need.claimedBy = agentId;
    need.claimedAt = now;
    await stateStore.set(config, workspaceId, state);
    return need;
  });
}

export async function resolveNeed(config: ServerConfig, workspaceId: string, needId: string, agentId: string, resultRef: string): Promise<Need> {
  return serialize(workspaceId, async () => {
    const state = await stateStore.get(config, workspaceId) ?? emptyState();
    const need = state.needs.find(n => n.id === needId);
    if (!need) throw new NotFound("need", needId);
    if (need.status !== "claimed") throw new ClaimConflict(need.claimedBy ?? "unknown");
    if (need.claimedBy !== agentId) throw new ClaimConflict(need.claimedBy ?? "unknown");
    need.status = "resolved";
    need.resultRef = resultRef;
    need.resolvedAt = Date.now();
    await stateStore.set(config, workspaceId, state);
    return need;
  });
}

export async function listNeeds(config: ServerConfig, workspaceId: string, status?: Need["status"]): Promise<Need[]> {
  const state = await stateStore.get(config, workspaceId) ?? emptyState();
  return status ? state.needs.filter(n => n.status === status) : state.needs;
}

export async function upsertProjectSummary(config: ServerConfig, workspaceId: string, input: Omit<ProjectSummary, "lastUpdate">): Promise<ProjectSummary> {
  return serialize(workspaceId, async () => {
    const state = await stateStore.get(config, workspaceId) ?? emptyState();
    const summary: ProjectSummary = { ...input, oneLiner: input.oneLiner.slice(0, 120), lastUpdate: Date.now() };
    const at = state.index.findIndex(p => p.projectId === summary.projectId && p.sessionId === summary.sessionId);
    if (at >= 0) state.index[at] = summary; else state.index.push(summary);
    await stateStore.set(config, workspaceId, state);
    return summary;
  });
}

export async function listProjectSummaries(config: ServerConfig, workspaceId: string, projectId?: string): Promise<ProjectSummary[]> {
  const state = await stateStore.get(config, workspaceId) ?? emptyState();
  return projectId ? state.index.filter(p => p.projectId === projectId) : state.index;
}

export async function createDeliverable(config: ServerConfig, workspaceId: string, input: Omit<Deliverable, "id" | "createdAt" | "updatedAt" | "comments" | "approvalState">): Promise<Deliverable> {
  return serialize(workspaceId, async () => {
    const state = await stateStore.get(config, workspaceId) ?? emptyState();
    const now = Date.now();
    const deliverable: Deliverable = {
      ...input,
      id: `e_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      comments: [],
      approvalState: "none",
      createdAt: now,
      updatedAt: now,
    };
    state.board.push(deliverable);
    await stateStore.set(config, workspaceId, state);
    return deliverable;
  });
}

export async function commentDeliverable(config: ServerConfig, workspaceId: string, deliverableId: string, comment: string): Promise<Deliverable> {
  return serialize(workspaceId, async () => {
    const state = await stateStore.get(config, workspaceId) ?? emptyState();
    const deliverable = state.board.find(d => d.id === deliverableId);
    if (!deliverable) throw new NotFound("deliverable", deliverableId);
    deliverable.comments.push(comment);
    deliverable.updatedAt = Date.now();
    await stateStore.set(config, workspaceId, state);
    return deliverable;
  });
}

export async function listDeliverables(config: ServerConfig, workspaceId: string): Promise<Deliverable[]> {
  const state = await stateStore.get(config, workspaceId) ?? emptyState();
  return state.board;
}

export async function getEcosystemState(config: ServerConfig, workspaceId: string): Promise<EcosystemState> {
  return (await stateStore.get(config, workspaceId)) ?? emptyState();
}
