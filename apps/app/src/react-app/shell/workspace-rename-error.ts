import { OpenworkServerError } from "@/app/lib/openwork-server";
import { t } from "@/i18n";

/** Toast copy for a failed workspace rename. Renaming is a host route: the web app's collaborator
 *  token gets 401 "Invalid host token", which is said in plain words instead (hive QA w5-9). */
export function workspaceRenameFailure(error: unknown, describe: (error: unknown) => string) {
  const denied = error instanceof OpenworkServerError && (error.status === 401 || error.status === 403);
  return { title: t("workspace_list.rename_failed"), description: denied ? t("workspace_list.rename_desktop_only") : describe(error) };
}
