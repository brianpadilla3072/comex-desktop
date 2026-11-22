import type { ApprovalConfig, ApprovalRequest } from "./types.js";
import { shortId } from "./utils.js";

interface ApprovalResult {
  id: string;
  allowed: boolean;
  reason?: string;
}

interface PendingApproval {
  request: ApprovalRequest;
  resolve: (result: ApprovalResult) => void;
  timeout?: NodeJS.Timeout;
}

export class ApprovalService {
  private config: ApprovalConfig;
  private pending = new Map<string, PendingApproval>();
  private lastResponderAt: number | null = null;

  constructor(config: ApprovalConfig) {
    this.config = config;
  }

  /** Records that a client with owner access is watching for approvals (it polled the list). */
  noteResponder(now: number = Date.now()): void {
    this.lastResponderAt = now;
  }

  /** False when this server needs a live responder and none polled within the window. */
  hasResponder(now: number = Date.now()): boolean {
    const windowMs = this.config.responderWindowMs;
    if (windowMs === undefined) return true;
    return this.lastResponderAt !== null && now - this.lastResponderAt <= windowMs;
  }

  list(): ApprovalRequest[] {
    return Array.from(this.pending.values()).map((entry) => entry.request);
  }

  async requestApproval(
    input: Omit<ApprovalRequest, "id" | "createdAt">,
  ): Promise<ApprovalResult> {
    if (this.config.mode === "auto") {
      return { id: "auto", allowed: true };
    }
    const id = shortId();
    // Nobody can answer: say so now instead of holding the request until the timeout.
    if (!this.hasResponder()) return { id, allowed: false, reason: "no_responder" };
    const request: ApprovalRequest = {
      ...input,
      id,
      createdAt: Date.now(),
    };

    const result = await new Promise<ApprovalResult>((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        resolve({ id, allowed: false, reason: "timeout" });
      }, this.config.timeoutMs);

      this.pending.set(id, { request, resolve, timeout });
    });

    return result;
  }

  respond(id: string, reply: "allow" | "deny"): ApprovalResult | null {
    const pending = this.pending.get(id);
    if (!pending) return null;
    if (pending.timeout) clearTimeout(pending.timeout);
    this.pending.delete(id);
    const result: ApprovalResult = {
      id,
      allowed: reply === "allow",
      reason: reply === "allow" ? undefined : "denied",
    };
    pending.resolve(result);
    return result;
  }
}
