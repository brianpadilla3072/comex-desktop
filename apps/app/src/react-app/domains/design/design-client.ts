import { createContext, use } from "react";
import { OpenworkServerError, type OpenworkServerClient } from "@/app/lib/openwork-server";
import { t } from "@/i18n";

/** The design methods of the server client; tests pass a fake with the same shape. */
export type DesignClient = Pick<OpenworkServerClient,
  | "baseUrl" | "listDesigns" | "createDesign" | "getDesign" | "updateDesign" | "deleteDesign" | "readDesignFile"
  | "writeDesignFile" | "addDesignPage" | "updateDesignPage" | "reorderDesignPages" | "deleteDesignPage" | "putDesignThumbnail" | "exportDesignHtml"
  | "listDesignChats" | "bindDesignChat" | "exportDesignPptx">;

/**
 * The client the design page and gallery work with. `DesignFrame` and the editors read it from
 * here, so a frame needs only the design and the page.
 */
export const DesignClientContext = createContext<DesignClient | null>(null);
export const useDesignClient = () => use(DesignClientContext);

export const designQueryKeys = {
  list: (baseUrl: string) => ["designs", baseUrl, "list"],
  detail: (baseUrl: string, workspaceId: string, designId: string) => ["designs", baseUrl, "detail", workspaceId, designId],
  chats: (baseUrl: string, workspaceId: string, designId: string) => ["designs", baseUrl, "chats", workspaceId, designId],
  file: (baseUrl: string, workspaceId: string, designId: string, path: string) => ["designs", baseUrl, "file", workspaceId, designId, path],
};

/** What a person reads when a design request fails. */
export function designErrorText(cause: unknown): string {
  if (cause instanceof OpenworkServerError) {
    if (cause.status === 401 || cause.status === 403) return t("design_ui.studio.error_read_only");
    if (cause.code === "design_studio_disabled") return t("design_ui.studio.error_disabled");
    if (cause.code === "design_not_found") return t("design_ui.studio.error_not_found");
    if (cause.code === "project_not_found") return t("design_ui.studio.error_project_not_found");
    if (cause.code === "design_file_too_large" || cause.code === "design_capacity_bytes") return t("design_ui.studio.error_too_large");
    if (cause.code === "design_capacity" || cause.code === "design_pages_capacity") return t("design_ui.studio.error_capacity");
    if (cause.code === "design_last_page") return t("design_ui.studio.error_last_page");
  }
  return cause instanceof Error && cause.message.trim() ? cause.message : t("design_ui.studio.error_unknown");
}
