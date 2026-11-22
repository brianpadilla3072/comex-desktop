import { formatAutomationSchedule } from "@openwork/types/automation-schedule";
import { t } from "@/i18n";
import type { AutomationRun, AutomationRunEvent } from "@openwork/types/automations";
import { denYourConnectionUrl } from "@/app/lib/den-dashboard-links";

type RunReceiptState = Pick<AutomationRun, "status" | "error" | "attemptCount" | "startedAt">;

type RunNotice = {
  variant: "default" | "destructive";
  title: string;
  message: string;
};

export function automationRunNotice(run: RunReceiptState): RunNotice | null {
  if (!run.error) return null;
  if (run.status === "skipped" && run.error.code === "runner_unavailable") {
    if (run.attemptCount === 0 && run.startedAt == null) {
      return {
        variant: "default",
        title: t("secondary_ui.automations.run.missed"),
        message: t("secondary_ui.automations.run.missed_message", { cause: run.error.message.trim() || t("secondary_ui.automations.run.runner_unavailable") }),
      };
    }
    return {
      variant: "destructive",
      title: t("secondary_ui.automations.run.interrupted"),
      message: t("secondary_ui.automations.run.interrupted_message", { cause: run.error.message }),
    };
  }
  if (run.error.code === "connection_action_required") {
    return { variant: "destructive", title: t("secondary_ui.automations.run.connection_needed"), message: run.error.message };
  }
  return {
    variant: "destructive",
    title: run.status === "failed" && run.error.code === "lease_lost" ? t("secondary_ui.automations.run.interrupted") : run.error.code,
    message: run.error.message,
  };
}

export function runStatusLabel(run: RunReceiptState) {
  const notice = automationRunNotice(run);
  if (notice && ((run.status === "skipped" && run.error?.code === "runner_unavailable")
    || (run.status === "failed" && run.error?.code === "lease_lost")
    || run.error?.code === "connection_action_required")) {
    return notice.title;
  }
  if (run.status === "skipped" && (run.error?.code === "model_access_lost" || run.error?.code === "provider_unavailable")) {
    return t("secondary_ui.automations.run.skipped_model");
  }
  if (run.status === "succeeded") return t("session.remote_task_completed");
  if (run.status === "failed") return t("secondary_ui.automations.run.failed");
  if (run.status === "queued") return t("secondary_ui.automations.run.queued");
  if (run.status === "running") return t("secondary_ui.automations.run.running");
  if (run.status === "cancelled") return t("secondary_ui.automations.run.cancelled");
  if (run.status === "skipped") return t("secondary_ui.automations.run.skipped");
  if (run.status === "claimed") return t("secondary_ui.automations.run.claimed");
  return run.status;
}

/**
 * The fix for a run that could not use a connection: the connection named in
 * the run's warning event, opened on Your Connections in the signed-in Den.
 * The link is built here from the connection id, never taken from the run.
 */
export function automationRunConnectionFix(
  run: Pick<AutomationRun, "error">,
  events: readonly Pick<AutomationRunEvent, "type" | "payload">[],
  denBaseUrl: string,
): { label: string; url: string } | null {
  if (run.error?.code !== "connection_action_required") return null;
  const warning = [...events].reverse().find((event) => event.type === "warning" && event.payload.code === "connection_action_required");
  const { connectionId, connectionName, state } = warning?.payload ?? {};
  if (typeof connectionId !== "string" || typeof connectionName !== "string") return null;
  const url = denYourConnectionUrl(denBaseUrl, connectionId);
  return url ? { label: state === "needs_connection" ? t("secondary_ui.automations.run.connect", { name: connectionName }) : t("secondary_ui.automations.run.reconnect", { name: connectionName }), url } : null;
}

export function formatAutomationTime(value: number | null | undefined) {
  return typeof value === "number" ? new Date(value).toLocaleString() : "—";
}

/** One shared label for every schedule kind; Den web and the agent listing use the same one. */
export { formatAutomationSchedule };
