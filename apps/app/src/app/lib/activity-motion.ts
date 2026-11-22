import { useSyncExternalStore } from "react";

/**
 * "Animaciones de actividad" (flag `activityAnimationsToggle`): the running-work mark
 * (the 3×3 dot matrix in sidebar rows and tool lines, and the dot ticker) can be frozen on its
 * first frame. With 10 running tasks those marks are ~54 CSS animations that keep Chromium
 * drawing frames: freezing them took the renderer from 13.8 % to 8.4 % of a CPU thread and cut
 * GPU-process work (docs/performance/memory-baseline.md, "Renderer CPU while waiting").
 *
 * Plain localStorage + a class on <html>, so the choice applies before React mounts and every
 * mark follows without re-rendering. Only "off" values are stored; no entry means defaults
 * (animations on, option available).
 */
export const ACTIVITY_ANIMATIONS_KEY = "openwork.activityAnimations";
export const ACTIVITY_ANIMATIONS_TOGGLE_KEY = "openwork.activityAnimationsToggle";
export const CALM_ACTIVITY_CLASS = "ow-calm-activity";
const CHANGE_EVENT = "openwork:activity-animations";

function read(key: string): string | null {
  try { return typeof window === "undefined" ? null : window.localStorage.getItem(key); } catch { return null; }
}

function write(key: string, off: boolean): void {
  try {
    if (off) window.localStorage.setItem(key, "off");
    else window.localStorage.removeItem(key);
  } catch {
    // Storage unavailable: the choice lasts until reload.
  }
}

/** False when the server switched the option off (last value the app saw). */
export function activityAnimationsToggleAvailable(): boolean {
  return read(ACTIVITY_ANIMATIONS_TOGGLE_KEY) !== "off";
}

/** The person's choice; true unless they turned the animations off. */
export function activityAnimationsEnabled(): boolean {
  return read(ACTIVITY_ANIMATIONS_KEY) !== "off";
}

/** Put the class on <html> when the option is available and the animations are off. */
export function applyActivityMotion(): void {
  if (typeof document === "undefined") return;
  const calm = activityAnimationsToggleAvailable() && !activityAnimationsEnabled();
  document.documentElement.classList.toggle(CALM_ACTIVITY_CLASS, calm);
}

function notify(): void {
  applyActivityMotion();
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function setActivityAnimationsEnabled(enabled: boolean): void {
  write(ACTIVITY_ANIMATIONS_KEY, !enabled);
  notify();
}

/** Called with the server flag every time the app reads its features. */
export function rememberActivityAnimationsToggle(available: boolean): void {
  if (available === activityAnimationsToggleAvailable()) return;
  write(ACTIVITY_ANIMATIONS_TOGGLE_KEY, !available);
  notify();
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useActivityAnimations(): { available: boolean; enabled: boolean } {
  const available = useSyncExternalStore(subscribe, activityAnimationsToggleAvailable, () => true);
  const enabled = useSyncExternalStore(subscribe, activityAnimationsEnabled, () => true);
  return { available, enabled };
}
