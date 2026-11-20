/**
 * index.html renders the startup screen before any bundle or server answer
 * exists, so it reads the `startupScreenPolish` flag from the last value the
 * app saw. Only "off" is stored; no entry means the registry default (on).
 * Keep the key in sync with the inline script in index.html.
 */
export const STARTUP_SCREEN_POLISH_KEY = "openwork.startupScreenPolish";

export function rememberStartupScreenPolish(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (enabled) window.localStorage.removeItem(STARTUP_SCREEN_POLISH_KEY);
    else window.localStorage.setItem(STARTUP_SCREEN_POLISH_KEY, "off");
  } catch {
    // Storage unavailable: the next start keeps the default.
  }
}
