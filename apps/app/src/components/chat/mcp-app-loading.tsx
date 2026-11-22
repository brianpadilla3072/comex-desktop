import { t } from "@/i18n"

/** A quiet placeholder that holds the App's space until its document arrives. */
export function McpAppLoading() {
  return (
    <div role="status" aria-label={t("chat_ui.loading_app")} className="flex min-h-60 items-center justify-center" data-mcp-app-loading>
      <span className="sr-only">{t("chat_ui.loading_app")}</span>
      <div className="ow-app-loading-grid grid size-24 gap-1.5" aria-hidden="true">
        {Array.from({ length: 9 }, (_, index) => <span key={index} className="min-h-0 min-w-0 rounded-sm bg-muted" />)}
      </div>
    </div>
  );
}
