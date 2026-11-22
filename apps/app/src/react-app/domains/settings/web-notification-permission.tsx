/** @jsxImportSource react */
import { useEffect, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { isDesktopRuntime } from "@/app/utils";
import {
  browserNotificationEnvironment,
  readWebNotificationPermission,
  requestWebNotificationPermission,
  subscribeWebNotificationsFeature,
  webNotificationsFeatureEnabled,
  type WebNotificationEnvironment,
  type WebNotificationPermissionState,
} from "@/react-app/shell/web-notifications";
import {
  LayoutSectionItem,
  LayoutSectionItemDescription,
  LayoutSectionItemHeader,
  LayoutSectionItemHeaderActions,
  LayoutSectionItemTitle,
} from "./settings-layout";

export function webNotificationPermissionCopy(state: WebNotificationPermissionState): string {
  switch (state) {
    case "granted":
      return t("web_notifications.permission_granted");
    case "denied":
      return t("web_notifications.permission_denied");
    case "insecure":
      return t("web_notifications.permission_insecure");
    case "unsupported":
      return t("web_notifications.permission_unsupported");
    case "default":
      return t("web_notifications.permission_default");
  }
}

export function useWebNotificationsAvailable(): boolean {
  const enabled = useSyncExternalStore(subscribeWebNotificationsFeature, webNotificationsFeatureEnabled, webNotificationsFeatureEnabled);
  return enabled && !isDesktopRuntime();
}

/**
 * Browser permission row under "Notify me" in the web app. The browser prompt
 * only opens from the button, a user gesture, never on its own.
 */
export function WebNotificationPermissionItem(props: {
  env?: WebNotificationEnvironment;
  /** Shown only when the browser has not answered yet and the preference is not off. */
  preferenceOff: boolean;
}) {
  const env = props.env ?? browserNotificationEnvironment();
  const [state, setState] = useState<WebNotificationPermissionState>(() => readWebNotificationPermission(env));
  const [asking, setAsking] = useState(false);

  // The person may change the permission from the browser's site settings.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const refresh = () => setState(readWebNotificationPermission(props.env ?? browserNotificationEnvironment()));
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [props.env]);

  return (
    <LayoutSectionItem anchor="web-notifications-permission">
      <LayoutSectionItemHeader>
        <LayoutSectionItemTitle>{t("web_notifications.permission_title")}</LayoutSectionItemTitle>
        <LayoutSectionItemDescription>
          <span role="status" data-web-notification-permission={state}>{webNotificationPermissionCopy(state)}</span>
          {props.preferenceOff && state === "granted" ? <> {t("web_notifications.preference_off_hint")}</> : null}
        </LayoutSectionItemDescription>
        {state === "default" ? (
          <LayoutSectionItemHeaderActions>
            <Button
              variant="outline"
              disabled={asking}
              data-testid="web-notifications-allow"
              onClick={() => {
                setAsking(true);
                void requestWebNotificationPermission(env)
                  .then(setState)
                  .finally(() => setAsking(false));
              }}
            >
              {t("web_notifications.allow")}
            </Button>
          </LayoutSectionItemHeaderActions>
        ) : null}
      </LayoutSectionItemHeader>
    </LayoutSectionItem>
  );
}
