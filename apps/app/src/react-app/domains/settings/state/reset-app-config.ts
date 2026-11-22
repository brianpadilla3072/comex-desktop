/**
 * App preferences that "Reset to defaults" clears: appearance, the default model, update,
 * startup and developer choices. Never tokens, server connections, history, workspace order,
 * per-chat model choices or the interface language. A usage-data opt-out survives the reset:
 * a privacy choice is never turned back on behind the person's back.
 */
export const APP_CONFIG_PREFERENCE_KEYS = [
  "openwork.react.settings.theme-mode",
  "openwork.themePref",
  "openwork.defaultModel",
  "openwork.modelVariant",
  "openwork.modelChoice.explicit",
  "openwork.preferences",
  "openwork.react.settings.hide-titlebar",
  "openwork.react.settings.update-auto-check",
  "openwork.react.settings.update-auto-download.v2",
  "openwork.developerMode",
  "openwork.startupPref",
  "openwork.startupPreference",
  "openwork.desktop-font-zoom.v1",
  "openwork:ui-state:v1",
] as const;

export type PreferenceStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

const PREFERENCES_KEY = "openwork.preferences";

function analyticsOptedOut(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Boolean(parsed) && typeof parsed === "object" && Reflect.get(parsed as object, "analyticsEnabled") === false;
  } catch {
    return false;
  }
}

/** Remove the preference keys that are set; returns how many were reset. */
export function resetAppConfigDefaults(storage: PreferenceStorage): number {
  const keepOptOut = analyticsOptedOut(storage.getItem(PREFERENCES_KEY));
  let reset = 0;
  for (const key of APP_CONFIG_PREFERENCE_KEYS) {
    if (storage.getItem(key) === null) continue;
    storage.removeItem(key);
    reset += 1;
  }
  if (keepOptOut) storage.setItem(PREFERENCES_KEY, JSON.stringify({ analyticsEnabled: false, showThinkingResetToOff: true }));
  return reset;
}
