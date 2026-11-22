/** @jsxImportSource react */
import { t } from "@/i18n";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { desktopBridge } from "@/app/lib/desktop";
import type {
  DesktopIntegrationResult,
  DesktopIntegrationStatus,
} from "@/app/lib/desktop-types";
import {
  LayoutSection,
  LayoutSectionDescription,
  LayoutSectionHeader,
  LayoutSectionItem,
  LayoutSectionItemDescription,
  LayoutSectionItemHeader,
  LayoutSectionItemHeaderActions,
  LayoutSectionItemTitle,
  LayoutSectionTitle,
} from "./settings-layout";

function statusDescription(status: DesktopIntegrationStatus) {
  if (status.state === "integrated") {
    return t("settings_ui.appimage_integrated_desc");
  }
  if (status.state === "managed_externally") {
    return t("settings_ui.appimage_external_desc");
  }
  if (status.state === "needs_repair" && status.ownership === "external") {
    return status.issues.includes("desktop-entry")
      ? t("settings_ui.appimage_external_entry_desc")
      : t("settings_ui.appimage_external_select_desc");
  }
  if (status.state === "needs_repair") {
    return t("settings_ui.appimage_repair_desc");
  }
  return t("settings_ui.appimage_none_desc");
}

function statusLabel(status: DesktopIntegrationStatus) {
  if (status.state === "integrated") return t("settings_ui.appimage_integrated");
  if (status.state === "managed_externally") return t("settings_ui.appimage_managed_externally");
  if (status.state === "needs_repair") return t("settings_ui.appimage_needs_repair");
  return t("settings_ui.appimage_not_integrated");
}

export function DesktopIntegrationSection() {
  const [status, setStatus] = useState<DesktopIntegrationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setStatus(await desktopBridge.desktopIntegrationStatus());
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(async (action: () => Promise<DesktopIntegrationResult>) => {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      setStatus(result.status);
      if (!result.ok) setError(result.error ?? t("settings_ui.appimage_failed"));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setBusy(false);
    }
  }, []);

  if (!status?.supported) return null;

  const externallyManaged = status.ownership === "external";
  const openworkManaged = status.ownership === "openwork";

  return (
    <LayoutSection>
      <LayoutSectionHeader>
        <LayoutSectionTitle>{t("settings_ui.appimage_title")}</LayoutSectionTitle>
        <LayoutSectionDescription>
          {t("settings_ui.appimage_desc")}
        </LayoutSectionDescription>
      </LayoutSectionHeader>

      <LayoutSectionItem>
        <LayoutSectionItemHeader>
          <LayoutSectionItemTitle>{statusLabel(status)}</LayoutSectionItemTitle>
          <LayoutSectionItemDescription>{statusDescription(status)}</LayoutSectionItemDescription>
          <LayoutSectionItemHeaderActions>
            {status.ownership === "none" ? (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => void run(() => desktopBridge.desktopIntegrationInstall())}
              >
                {t("settings_ui.appimage_integrate")}
              </Button>
            ) : null}
            {openworkManaged ? (
              <>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => void run(() => desktopBridge.desktopIntegrationInstall())}
                >
                  {t("settings_ui.appimage_repair")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void run(() => desktopBridge.desktopIntegrationRemove())}
                >
                  {t("settings_ui.appimage_remove")}
                </Button>
              </>
            ) : null}
            {externallyManaged && status.state === "needs_repair" ? (
              <Button
                size="sm"
                disabled={busy || status.issues.includes("desktop-entry")}
                onClick={() => void run(() => (
                  desktopBridge.desktopIntegrationInstall({ useExternalLauncher: true })
                ))}
              >
                {t("settings_ui.appimage_use_manager_launcher")}
              </Button>
            ) : null}
            {externallyManaged ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void refresh()}>
                {t("settings_ui.appimage_recheck")}
              </Button>
            ) : null}
          </LayoutSectionItemHeaderActions>
        </LayoutSectionItemHeader>
        <p className="break-all text-xs text-muted-foreground">{status.appImagePath}</p>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </LayoutSectionItem>
    </LayoutSection>
  );
}
