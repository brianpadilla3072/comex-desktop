import { t } from "@/i18n";
import type { BrowserPanelTab } from "./panel-tab-store";

const browserOperationKeys: Record<string, string> = {
  observe: "session_ui.browser_op_observe", site_tools: "session_ui.browser_op_site_tools", site_tool: "session_ui.browser_op_site_tool",
  navigate: "session_ui.browser_op_navigate", click: "session_ui.browser_op_click", fill: "session_ui.browser_op_fill", key: "session_ui.browser_op_key", scroll: "session_ui.browser_op_scroll",
  website_blocked: "session_ui.browser_op_website_blocked", browser_disabled: "session_ui.browser_op_browser_disabled",
  stale_observation: "session_ui.browser_op_stale_observation", stale_tool: "session_ui.browser_op_stale_tool", user_denied: "session_ui.browser_op_user_denied",
  needs_attention: "session_ui.browser_review_page", sign_in_required: "session_ui.browser_op_sign_in_required", payment_required: "session_ui.browser_op_payment_required", timeout: "session_ui.browser_op_timeout",
  result_withheld: "session_ui.browser_op_result_withheld",
};

/** The translated line for what the agent is doing in the browser, when the operation is known. */
export function browserOperationLabel(operation: string | null | undefined): string | undefined {
  const key = operation && Object.hasOwn(browserOperationKeys, operation) ? browserOperationKeys[operation] : undefined;
  return key ? t(key) : undefined;
}

/** The page needs attention or a human handoff. */
export function browserNeedsPerson(tab: BrowserPanelTab | null | undefined): boolean {
  return tab?.browserTask?.status === "needs_attention";
}

/** One short state line for the browser's header button. */
export function browserStatusLabel(tab: BrowserPanelTab | null | undefined): string {
  if (!tab) return t("session_ui.browser_status_no_page");
  if (browserNeedsPerson(tab)) return t("session_ui.browser_status_needs_you");
  const task = tab.browserTask;
  if (task?.status === "paused") return t("session_ui.browser_status_you_have_control");
  if (task?.status === "running") return browserOperationLabel(task.operation) ?? t("session_ui.browser_working_on_page");
  if (tab.status === "suspended") return t("session_ui.browser_status_suspended");
  if (tab.status === "loading" || tab.status === "restoring") return t("session_ui.browser_status_loading");
  if (tab.loadError) return t("session_ui.browser_status_load_failed");
  return t("session_ui.browser_status_ready");
}
