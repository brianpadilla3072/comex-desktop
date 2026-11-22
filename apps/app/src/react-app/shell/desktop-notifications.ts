import { desktopNotificationShow } from "@/app/lib/desktop";
import { isDesktopRuntime } from "@/app/utils";
import { t } from "@/i18n";
import {
  DEFAULT_DESKTOP_NOTIFICATION_PREFERENCE,
  isDesktopNotificationPreference,
  type DesktopNotificationPreference,
} from "@/react-app/kernel/desktop-notification-preferences";
import { LOCAL_PREFERENCES_KEY } from "@/react-app/kernel/local-preferences-storage";
import {
  browserNotificationEnvironment,
  decideWebNotification,
  navigateWebApp,
  notificationPreferenceAllows,
  readWebNotificationPermission,
  showWebNotification,
  webNotificationsFeatureEnabled,
  type NotificationImportance,
} from "./web-notifications";
import { legacySessionRoute, workspaceSessionRoute } from "./workspace-routes";

type WebNotificationHandler = (title: string, description?: string, href?: string) => Promise<void>;

type SessionTarget = {
  sessionId: string;
  /** Lets a click open the session inside its workspace. */
  workspaceId?: string;
};

export type DesktopNotificationEvent =
  | (SessionTarget & {
    type: "task.completed";
    /**
     * The run was not started from this window (a scheduled task, another
     * device or tab); this window only watched it finish. Behind `webNotifications`.
     */
    observed?: boolean;
  })
  | (SessionTarget & { type: "task.failed"; errorText?: string })
  | (SessionTarget & { type: "permission.asked"; detail?: string })
  | (SessionTarget & { type: "question.asked"; question?: string });

type NotificationCopy = {
  title: string;
  body: string;
  importance: NotificationImportance;
};

let webNotificationHandler: WebNotificationHandler | null = null;

export function setWebNotificationHandler(handler: WebNotificationHandler | null): void {
  webNotificationHandler = handler;
}

function readDesktopNotificationPreference(): DesktopNotificationPreference {
  if (typeof window === "undefined") return DEFAULT_DESKTOP_NOTIFICATION_PREFERENCE;
  try {
    const raw = window.localStorage.getItem(LOCAL_PREFERENCES_KEY);
    if (!raw) return DEFAULT_DESKTOP_NOTIFICATION_PREFERENCE;
    const parsed: unknown = JSON.parse(raw);
    const value = parsed && typeof parsed === "object"
      ? Reflect.get(parsed, "desktopNotifications")
      : undefined;
    return isDesktopNotificationPreference(value)
      ? value
      : DEFAULT_DESKTOP_NOTIFICATION_PREFERENCE;
  } catch {
    return DEFAULT_DESKTOP_NOTIFICATION_PREFERENCE;
  }
}

function isAppInView() {
  if (typeof document === "undefined") return false;
  return document.visibilityState === "visible" && document.hasFocus();
}

function copyForEvent(event: DesktopNotificationEvent): NotificationCopy {
  switch (event.type) {
    case "task.completed":
      return {
        title: t("web_notifications.task_completed_title"),
        body: t("web_notifications.task_completed_body"),
        importance: "routine",
      };
    case "task.failed":
      return {
        title: t("web_notifications.task_failed_title"),
        body: event.errorText?.trim() || t("web_notifications.task_failed_body"),
        importance: "important",
      };
    case "permission.asked":
      return {
        title: t("web_notifications.permission_asked_title"),
        body: event.detail?.trim() || t("web_notifications.permission_asked_body"),
        importance: "important",
      };
    case "question.asked":
      return {
        title: t("web_notifications.question_asked_title"),
        body: event.question?.trim() || t("web_notifications.question_asked_body"),
        importance: "important",
      };
  }
}

export function sessionNotificationHref(target: SessionTarget): string {
  return target.workspaceId?.trim()
    ? workspaceSessionRoute(target.workspaceId, target.sessionId)
    : legacySessionRoute(target.sessionId);
}

// Two workspace syncs can report the same terminal edge: one notification per session and outcome.
const DEDUPE_WINDOW_MS = 10_000;
const recentTerminal = new Map<string, number>();

function isDuplicateTerminal(event: DesktopNotificationEvent, now: number): boolean {
  if (event.type !== "task.completed" && event.type !== "task.failed") return false;
  for (const [key, at] of recentTerminal) if (now - at > DEDUPE_WINDOW_MS) recentTerminal.delete(key);
  const key = `${event.type}:${event.sessionId}`;
  if (recentTerminal.has(key)) return true;
  recentTerminal.set(key, now);
  return false;
}

export function notifyDesktopEvent(event: DesktopNotificationEvent): void {
  const featureOn = webNotificationsFeatureEnabled();
  if (event.type === "task.completed" && event.observed && !featureOn) return;
  const copy = copyForEvent(event);
  const preference = readDesktopNotificationPreference();
  if (!notificationPreferenceAllows(preference, copy.importance)) return;

  if (!isDesktopRuntime() && featureOn) {
    const env = browserNotificationEnvironment();
    const decision = decideWebNotification({
      featureEnabled: featureOn,
      preference,
      importance: copy.importance,
      permission: readWebNotificationPermission(env),
      visibility: typeof document === "undefined" ? undefined : document.visibilityState,
    });
    if (decision !== "show" || !env.api) return;
    if (isDuplicateTerminal(event, Date.now())) return;
    showWebNotification(env.api, {
      title: copy.title,
      body: copy.body,
      href: sessionNotificationHref(event),
      tag: `openwork-session-${event.sessionId}`,
    }, {
      focus: () => window.focus(),
      navigate: navigateWebApp,
    });
    return;
  }

  if (isAppInView()) return;
  if (isDuplicateTerminal(event, Date.now())) return;

  if (!isDesktopRuntime()) {
    void webNotificationHandler?.(copy.title, copy.body).catch(() => undefined);
    return;
  }

  void desktopNotificationShow({
    title: copy.title,
    body: copy.body,
  }).catch(() => undefined);
}
