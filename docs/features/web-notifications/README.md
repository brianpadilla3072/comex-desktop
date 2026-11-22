# Web notifications (`webNotifications`)

Someone working from a phone or another tab (for example over remote access with Tailscale) gets a
browser notification when a chat turn or a scheduled task finishes or fails, the same way the
desktop app shows a native notification.

## Behavior

- The existing **Notify me** preference (Off / Important / All) decides what is sent, on desktop
  and on the web. Failures, permission requests and questions are important; finished turns are
  routine and need **All**. The default stays **Off**.
- The web app notifies only while its tab is **hidden** (`document.visibilityState === "hidden"`).
  A visible tab already shows the change.
- The browser permission is asked only from **Settings › Preferences › Notifications › Allow
  notifications**, a user gesture. An event never opens the prompt: without permission it is
  skipped. The row says when the browser blocked notifications, when it does not support them,
  and when the page runs on plain `http` (browsers only allow notifications on `https` or
  `localhost`, so a Tailscale URL needs `tailscale serve` with https).
- Clicking a notification brings the tab forward and opens the session inside its workspace
  (`/workspace/<id>/session/<id>`). Notifications for the same session share a tag, so a newer one
  replaces the older one.
- Runs that this window did not start also notify: a scheduled specialist task, or a turn started
  from another device. The session sync already watches every session's status; when a session it
  saw running goes idle without an error, it reports `task.completed` with `observed: true`.
  Subagent sessions stay quiet (their parent reports), and the same edge from two workspace syncs
  notifies once.
- Notification copy goes through `t()` (`web_notifications.*`), so the Spanish app gets Spanish
  text on both desktop and web.

## Where it lives

- `apps/app/src/react-app/shell/web-notifications.ts`: the decision (`decideWebNotification`),
  permission read and request, showing a notification and its click. All inputs are injected, so
  tests use a fake `Notification`.
- `apps/app/src/react-app/shell/desktop-notifications.ts`: `notifyDesktopEvent` routes to the web
  path when the flag is on and the runtime is not the desktop app.
- `apps/app/src/react-app/domains/session/sync/session-sync.ts`: emits the events, with the
  workspace id for the click, plus the observed completion.
- `apps/app/src/react-app/domains/settings/web-notification-permission.tsx`: the permission row.
- The flag reaches the app through `GET /comex/features` (`webNotifications`), read by
  `DesktopConfigProvider`. Unknown or unreachable means off.

## Turning it off

`DEN_FEATURE_WEB_NOTIFICATIONS=false` (or the Helm value) returns the web app to the previous
behavior and stops notifications for runs this window only watched, on desktop too. Desktop
notifications for runs started from the window keep working as before.

## Tests

- `apps/app/tests/web-notifications.test.ts`: decision table (feature, preference, hidden tab,
  permission states), permission request only once and never on `http`, the click, and
  `notifyDesktopEvent` end to end with a fake `Notification` in a DOM.
- `apps/server/test/web-notifications-feature.test.ts`: the operator switch.
