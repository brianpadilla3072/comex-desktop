import type { DesktopNotificationPreference } from "@/react-app/kernel/desktop-notification-preferences";

/**
 * Browser notifications for the web app (feature `webNotifications`).
 *
 * A person working remotely (a phone, another tab) learns that a chat turn or
 * a scheduled task finished or failed while the tab was hidden. Every input
 * the decision needs is passed in, so tests drive it with a fake Notification
 * and a fake document instead of a browser.
 */

export type NotificationImportance = "important" | "routine";

/** "insecure": the page is served over plain http, where browsers refuse notifications. */
export type WebNotificationPermissionState = "unsupported" | "insecure" | "default" | "granted" | "denied";

export type WebNotificationHandle = {
  onclick: ((event: Event) => void) | null;
  close: () => void;
};

/** The part of the browser's `Notification` constructor this module uses. */
export type WebNotificationApi = {
  readonly permission: NotificationPermission;
  requestPermission: () => Promise<NotificationPermission>;
  new (title: string, options?: NotificationOptions): WebNotificationHandle;
};

export type WebNotificationEnvironment = {
  api: WebNotificationApi | undefined;
  /** `window.isSecureContext`; undefined outside a browser. */
  secureContext: boolean | undefined;
};

export type WebNotificationDecision =
  | "show"
  | "feature_off"
  | "preference_off"
  | "tab_visible"
  | "unsupported"
  | "permission_needed"
  | "permission_denied";

let featureEnabled = false;
const featureListeners = new Set<() => void>();

/** The host's registry decision, pushed by the desktop config provider. Unknown means off. */
export function setWebNotificationsFeatureEnabled(enabled: boolean): void {
  if (featureEnabled === enabled) return;
  featureEnabled = enabled;
  for (const listener of featureListeners) listener();
}

export function webNotificationsFeatureEnabled(): boolean {
  return featureEnabled;
}

export function subscribeWebNotificationsFeature(listener: () => void): () => void {
  featureListeners.add(listener);
  return () => featureListeners.delete(listener);
}

/** The existing "Notify me" preference: off, important events only, or everything. */
export function notificationPreferenceAllows(
  preference: DesktopNotificationPreference,
  importance: NotificationImportance,
): boolean {
  if (preference === "off") return false;
  if (preference === "important") return importance === "important";
  return true;
}

function isNotificationApi(value: unknown): value is WebNotificationApi {
  return typeof value === "function"
    && "permission" in value
    && typeof Reflect.get(value, "requestPermission") === "function";
}

/** The real browser environment, read lazily so server-side code and tests never touch globals. */
export function browserNotificationEnvironment(): WebNotificationEnvironment {
  if (typeof window === "undefined") return { api: undefined, secureContext: undefined };
  const api: unknown = Reflect.get(window, "Notification");
  return {
    api: isNotificationApi(api) ? api : undefined,
    secureContext: window.isSecureContext,
  };
}

export function readWebNotificationPermission(env: WebNotificationEnvironment): WebNotificationPermissionState {
  if (env.secureContext === false) return "insecure";
  if (!env.api) return "unsupported";
  return env.api.permission;
}

/**
 * Ask the browser for permission. Call it only from a user gesture (a click in
 * Settings): browsers ignore or penalize prompts that appear on their own.
 */
export async function requestWebNotificationPermission(
  env: WebNotificationEnvironment,
): Promise<WebNotificationPermissionState> {
  const current = readWebNotificationPermission(env);
  if (current !== "default" || !env.api) return current;
  try {
    return await env.api.requestPermission();
  } catch {
    return "denied";
  }
}

export function decideWebNotification(input: {
  featureEnabled: boolean;
  preference: DesktopNotificationPreference;
  importance: NotificationImportance;
  permission: WebNotificationPermissionState;
  visibility: DocumentVisibilityState | undefined;
}): WebNotificationDecision {
  if (!input.featureEnabled) return "feature_off";
  if (!notificationPreferenceAllows(input.preference, input.importance)) return "preference_off";
  // Someone looking at the tab already sees the session change; only a hidden tab is notified.
  if (input.visibility !== "hidden") return "tab_visible";
  if (input.permission === "unsupported" || input.permission === "insecure") return "unsupported";
  // Never prompt from an event: the prompt belongs to the Settings button.
  if (input.permission === "default") return "permission_needed";
  if (input.permission === "denied") return "permission_denied";
  return "show";
}

export type WebNotificationContent = {
  title: string;
  body: string;
  /** In-app route of the session; clicking the notification opens it. */
  href?: string;
  /** Same tag replaces an older notification for the same session. */
  tag?: string;
};

export type WebNotificationActions = {
  focus: () => void;
  navigate: (href: string) => void;
};

/** Shows one notification; clicking it brings the tab forward and opens the session. */
export function showWebNotification(
  api: WebNotificationApi,
  content: WebNotificationContent,
  actions: WebNotificationActions,
): WebNotificationHandle | null {
  try {
    const notification = new api(content.title, {
      body: content.body,
      ...(content.tag ? { tag: content.tag } : {}),
    });
    notification.onclick = (event) => {
      event.preventDefault();
      actions.focus();
      if (content.href) actions.navigate(content.href);
      notification.close();
    };
    return notification;
  } catch {
    return null;
  }
}

/** Router-agnostic navigation for the web app's BrowserRouter. */
export function navigateWebApp(href: string): void {
  if (typeof window === "undefined") return;
  window.history.pushState(null, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
