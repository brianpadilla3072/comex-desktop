import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

import {
  decideWebNotification,
  notificationPreferenceAllows,
  readWebNotificationPermission,
  requestWebNotificationPermission,
  setWebNotificationsFeatureEnabled,
  showWebNotification,
  webNotificationsFeatureEnabled,
  type WebNotificationApi,
  type WebNotificationHandle,
} from "../src/react-app/shell/web-notifications";
import { notifyDesktopEvent, sessionNotificationHref } from "../src/react-app/shell/desktop-notifications";
import { LOCAL_PREFERENCES_KEY } from "../src/react-app/kernel/local-preferences-storage";

const ownedDom = !GlobalRegistrator.isRegistered && typeof document === "undefined";
beforeAll(() => {
  if (ownedDom) GlobalRegistrator.register({ url: "http://localhost/" });
});
afterAll(async () => {
  if (ownedDom) await GlobalRegistrator.unregister();
});

type Shown = { title: string; options?: NotificationOptions; handle: WebNotificationHandle; closed: boolean };

/** A fake browser Notification: records every notification and the permission prompts. */
function fakeNotificationApi(initial: NotificationPermission, answer: NotificationPermission = "granted") {
  const shown: Shown[] = [];
  let prompts = 0;
  class FakeNotification implements WebNotificationHandle {
    static permission: NotificationPermission = initial;
    static async requestPermission(): Promise<NotificationPermission> {
      prompts += 1;
      FakeNotification.permission = answer;
      return answer;
    }
    onclick: ((event: Event) => void) | null = null;
    constructor(title: string, options?: NotificationOptions) {
      const entry: Shown = { title, options, handle: this, closed: false };
      this.close = () => { entry.closed = true; };
      shown.push(entry);
    }
    close: () => void = () => undefined;
  }
  const api: WebNotificationApi = FakeNotification;
  return { api, shown, prompts: () => prompts, ctor: FakeNotification };
}

const base = {
  featureEnabled: true,
  preference: "all" as const,
  importance: "routine" as const,
  permission: "granted" as const,
  visibility: "hidden" as const,
};

describe("decideWebNotification", () => {
  test("shows only for a hidden tab with permission, the feature and the preference", () => {
    expect(decideWebNotification(base)).toBe("show");
    expect(decideWebNotification({ ...base, visibility: "visible" })).toBe("tab_visible");
    expect(decideWebNotification({ ...base, featureEnabled: false })).toBe("feature_off");
    expect(decideWebNotification({ ...base, preference: "off" })).toBe("preference_off");
  });

  test("routine events wait for All; important events pass with Important", () => {
    expect(decideWebNotification({ ...base, preference: "important" })).toBe("preference_off");
    expect(decideWebNotification({ ...base, preference: "important", importance: "important" })).toBe("show");
    expect(notificationPreferenceAllows("all", "routine")).toBe(true);
    expect(notificationPreferenceAllows("off", "important")).toBe(false);
  });

  test("never prompts from an event: default, denied, insecure and unsupported stay quiet", () => {
    expect(decideWebNotification({ ...base, permission: "default" })).toBe("permission_needed");
    expect(decideWebNotification({ ...base, permission: "denied" })).toBe("permission_denied");
    expect(decideWebNotification({ ...base, permission: "insecure" })).toBe("unsupported");
    expect(decideWebNotification({ ...base, permission: "unsupported" })).toBe("unsupported");
  });
});

describe("permission", () => {
  test("reads the browser state, plain http and a missing API", () => {
    const { api } = fakeNotificationApi("denied");
    expect(readWebNotificationPermission({ api, secureContext: true })).toBe("denied");
    expect(readWebNotificationPermission({ api, secureContext: false })).toBe("insecure");
    expect(readWebNotificationPermission({ api: undefined, secureContext: true })).toBe("unsupported");
  });

  test("asks the browser once when it has not answered, and not again after", async () => {
    const fake = fakeNotificationApi("default", "granted");
    expect(await requestWebNotificationPermission({ api: fake.api, secureContext: true })).toBe("granted");
    expect(await requestWebNotificationPermission({ api: fake.api, secureContext: true })).toBe("granted");
    expect(fake.prompts()).toBe(1);
  });

  test("does not prompt on plain http", async () => {
    const fake = fakeNotificationApi("default");
    expect(await requestWebNotificationPermission({ api: fake.api, secureContext: false })).toBe("insecure");
    expect(fake.prompts()).toBe(0);
  });
});

test("clicking a notification focuses the tab, opens the session and closes it", () => {
  const fake = fakeNotificationApi("granted");
  const calls: string[] = [];
  showWebNotification(fake.api, { title: "Task completed", body: "Done", href: "/workspace/w1/session/s1", tag: "t" }, {
    focus: () => calls.push("focus"),
    navigate: (href) => calls.push(`navigate:${href}`),
  });
  expect(fake.shown).toHaveLength(1);
  expect(fake.shown[0]?.options).toEqual({ body: "Done", tag: "t" });
  fake.shown[0]?.handle.onclick?.(new Event("click"));
  expect(calls).toEqual(["focus", "navigate:/workspace/w1/session/s1"]);
  expect(fake.shown[0]?.closed).toBe(true);
});

test("session links open the session inside its workspace when known", () => {
  expect(sessionNotificationHref({ sessionId: "s 1", workspaceId: "w1" })).toBe("/workspace/w1/session/s%201");
  expect(sessionNotificationHref({ sessionId: "s1" })).toBe("/session/s1");
});

describe("notifyDesktopEvent in the web app", () => {
  let fake = fakeNotificationApi("granted");
  const setVisibility = (value: DocumentVisibilityState) =>
    Object.defineProperty(document, "visibilityState", { value, configurable: true });
  const install = (permission: NotificationPermission, preference: string) => {
    fake = fakeNotificationApi(permission);
    Reflect.set(window, "Notification", fake.ctor);
    window.localStorage.setItem(LOCAL_PREFERENCES_KEY, JSON.stringify({ desktopNotifications: preference }));
  };

  afterEach(() => {
    setWebNotificationsFeatureEnabled(false);
    setVisibility("visible");
    window.localStorage.removeItem(LOCAL_PREFERENCES_KEY);
    Reflect.deleteProperty(window, "Notification");
  });

  test("a finished scheduled run notifies a hidden tab and the click opens its session", () => {
    install("granted", "all");
    setWebNotificationsFeatureEnabled(true);
    setVisibility("hidden");
    notifyDesktopEvent({ type: "task.completed", sessionId: "sched-1", workspaceId: "w1", observed: true });
    expect(fake.shown.map((item) => item.title)).toEqual(["Task completed"]);
    expect(fake.shown[0]?.options?.tag).toBe("openwork-session-sched-1");
    fake.shown[0]?.handle.onclick?.(new Event("click"));
    expect(window.location.pathname).toBe("/workspace/w1/session/sched-1");
  });

  test("the same terminal edge from two workspace syncs notifies once", () => {
    install("granted", "all");
    setWebNotificationsFeatureEnabled(true);
    setVisibility("hidden");
    notifyDesktopEvent({ type: "task.failed", sessionId: "dup-1", workspaceId: "w1", errorText: "Model unavailable" });
    notifyDesktopEvent({ type: "task.failed", sessionId: "dup-1", workspaceId: "w1", errorText: "Model unavailable" });
    expect(fake.shown).toHaveLength(1);
    expect(fake.shown[0]?.options?.body).toBe("Model unavailable");
  });

  test("a visible tab, the Off preference or a missing permission show nothing", () => {
    install("granted", "all");
    setWebNotificationsFeatureEnabled(true);
    setVisibility("visible");
    notifyDesktopEvent({ type: "task.completed", sessionId: "v-1", workspaceId: "w1" });
    expect(fake.shown).toHaveLength(0);

    install("granted", "off");
    setVisibility("hidden");
    notifyDesktopEvent({ type: "task.completed", sessionId: "v-2", workspaceId: "w1" });
    expect(fake.shown).toHaveLength(0);

    install("default", "all");
    notifyDesktopEvent({ type: "task.completed", sessionId: "v-3", workspaceId: "w1" });
    expect(fake.shown).toHaveLength(0);
    expect(fake.prompts()).toBe(0);
  });

  test("with the flag off, runs this window only watched stay quiet", () => {
    install("granted", "all");
    expect(webNotificationsFeatureEnabled()).toBe(false);
    setVisibility("hidden");
    notifyDesktopEvent({ type: "task.completed", sessionId: "off-1", workspaceId: "w1", observed: true });
    expect(fake.shown).toHaveLength(0);
  });
});
