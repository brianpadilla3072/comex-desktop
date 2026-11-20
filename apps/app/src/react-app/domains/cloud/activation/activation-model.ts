import {
  activationChecklistPresentation,
  activationProgress,
  nextActivationStep,
  orderedActivationSteps,
  type ActivationClientEvent,
  type ActivationState,
  type ActivationStepId,
} from "@openwork/types/den/activation";
import { t } from "@/i18n";

/**
 * The Desktop "Get set up" card: what it shows for a checklist Den computed, and
 * when this app reports a step only it can observe. Pure, so the rules are unit-tested.
 */

export type ActivationRowAction = "invite" | "skill" | "provider" | "gateway" | "connect";

export type ActivationRow = {
  id: ActivationStepId;
  title: string;
  state: "done" | "open" | "locked";
  /** State in a person's words (done) or who can do it (locked). */
  line: string | null;
  /** At most one action, only for an open step. */
  action: { kind: ActivationRowAction; label: string } | null;
};

/** Each step's title in the app's language; Den's `ACTIVATION_STEP_TITLES` holds the same English. */
const STEP_TITLE_KEYS: Record<ActivationStepId, string> = {
  first_response: "secondary_ui.cloud.activation.step_first_response",
  invite_teammate: "secondary_ui.cloud.activation.step_invite_teammate",
  use_skill: "secondary_ui.cloud.activation.step_use_skill",
  own_provider: "secondary_ui.cloud.activation.step_own_provider",
  gateway_provider: "secondary_ui.cloud.activation.step_gateway_provider",
  connector: "secondary_ui.cloud.activation.step_connector",
};

function activationStepTitle(id: ActivationStepId): string {
  return t(STEP_TITLE_KEYS[id]);
}

const ACTIONS: Partial<Record<ActivationStepId, { kind: ActivationRowAction; labelKey: string }>> = {
  invite_teammate: { kind: "invite", labelKey: "secondary_ui.cloud.activation.action_invite" },
  use_skill: { kind: "skill", labelKey: "secondary_ui.cloud.activation.action_skill" },
  own_provider: { kind: "provider", labelKey: "secondary_ui.cloud.activation.action_provider" },
  gateway_provider: { kind: "gateway", labelKey: "secondary_ui.cloud.activation.action_gateway" },
  connector: { kind: "connect", labelKey: "secondary_ui.cloud.activation.action_connect" },
};

function activationAction(id: ActivationStepId): { kind: ActivationRowAction; label: string } | null {
  const action = ACTIONS[id];
  return action ? { kind: action.kind, label: t(action.labelKey) } : null;
}

export type ActivationCardModel =
  | { presentation: "hidden" }
  | { presentation: "next" | "full"; done: number; total: number; next: string | null; rows: ActivationRow[]; dismissed: boolean };

export function activationCardModel(state: ActivationState | null | undefined): ActivationCardModel {
  const presentation = activationChecklistPresentation(state);
  if (presentation === "hidden" || !state) return { presentation: "hidden" };
  const progress = activationProgress(state);
  const next = nextActivationStep(state);
  return {
    presentation,
    done: progress.done,
    total: progress.total,
    next: next ? activationStepTitle(next.id) : null,
    dismissed: state.dismissed,
    rows: orderedActivationSteps(state).map((step) => {
      const rowState = step.done ? "done" : step.lockedReason ? "locked" : "open";
      return {
        id: step.id,
        title: activationStepTitle(step.id),
        state: rowState,
        line: step.done ? step.detail ?? null : step.lockedReason ?? null,
        action: rowState === "open" ? activationAction(step.id) : null,
      };
    }),
  };
}

/**
 * Report only while Den shows the checklist for this person and the step is still open: nothing is sent when the
 * checklist is unavailable, before it loaded, or once Den already counts the step.
 */
export function shouldReportActivationEvent(state: ActivationState | null | undefined, step: ActivationClientEvent): boolean {
  if (!state) return false;
  if (step === "dismiss") return !state.dismissed;
  return orderedActivationSteps(state).some((entry) => entry.id === step && !entry.done);
}

/**
 * One report per step and scope at a time; a failure is swallowed (it never affects the person) and may be retried
 * on the next occurrence, since Den ignores repeats anyway.
 */
export function createActivationReporter<Scope extends { key: string }>(input: {
  readState: (scope: Scope) => ActivationState | null | undefined;
  send: (scope: Scope, step: ActivationClientEvent, durationMs: number | undefined) => Promise<ActivationState | null>;
  onState: (scope: Scope, state: ActivationState) => void;
}) {
  const inFlight = new Set<string>();
  return async function report(scope: Scope, step: ActivationClientEvent, durationMs?: number): Promise<boolean> {
    if (!shouldReportActivationEvent(input.readState(scope), step)) return false;
    const key = `${scope.key}:${step}`;
    if (inFlight.has(key)) return false;
    inFlight.add(key);
    try {
      const next = await input.send(scope, step, durationMs);
      if (next) input.onState(scope, next);
      return true;
    } catch {
      return false;
    } finally {
      inFlight.delete(key);
    }
  };
}

/** Composer draft parts that run a skill (a local skill or one assigned through OpenWork). */
export function draftUsesSkill(parts: readonly { type: string }[] | undefined): boolean {
  return Boolean(parts?.some((part) => part.type === "skill" || part.type === "connect-skill"));
}
