/** @jsxImportSource react */
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://localhost/" });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { setLocale } = await import("../src/i18n");
const motion = await import("../src/app/lib/activity-motion");
const { ActivityMotionSection } = await import("../src/react-app/domains/settings/appearance/activity-motion-section");

// Freezing the running-work marks saves CPU with many tasks (13.8 % → 8.4 % with 10, measured);
// the choice must apply as one class on <html>, survive reloads and obey the flag.
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  window.localStorage.clear();
  document.documentElement.classList.remove(motion.CALM_ACTIVITY_CLASS);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); setLocale("en"); });
afterAll(async () => { await GlobalRegistrator.unregister(); });
const calm = () => document.documentElement.classList.contains(motion.CALM_ACTIVITY_CLASS);

test("turning animations off freezes the marks and is remembered", () => {
  motion.applyActivityMotion();
  expect(calm()).toBe(false);
  motion.setActivityAnimationsEnabled(false);
  expect(calm()).toBe(true);
  expect(window.localStorage.getItem(motion.ACTIVITY_ANIMATIONS_KEY)).toBe("off");
  document.documentElement.classList.remove(motion.CALM_ACTIVITY_CLASS);
  motion.applyActivityMotion(); // next start
  expect(calm()).toBe(true);
  motion.setActivityAnimationsEnabled(true);
  expect(calm()).toBe(false);
  expect(window.localStorage.getItem(motion.ACTIVITY_ANIMATIONS_KEY)).toBeNull();
});

test("with the flag off the stored choice is ignored and marks animate", () => {
  motion.setActivityAnimationsEnabled(false);
  expect(calm()).toBe(true);
  motion.rememberActivityAnimationsToggle(false);
  expect(calm()).toBe(false);
  motion.rememberActivityAnimationsToggle(true);
  expect(calm()).toBe(true);
});

test("the setting shows the switch with its measured impact, in Spanish, and hides with the flag off", async () => {
  setLocale("es");
  await act(async () => root.render(<ActivityMotionSection busy={false} />));
  expect(host.textContent).toContain("Animaciones de actividad");
  expect(host.querySelector("[data-activity-motion-impact]")?.textContent).toContain("13,8 %");
  const toggle = host.querySelector<HTMLElement>("[role=switch]");
  expect(toggle).not.toBeNull();
  await act(async () => { toggle?.click(); });
  expect(calm()).toBe(true);
  await act(async () => { motion.rememberActivityAnimationsToggle(false); });
  expect(host.textContent).not.toContain("Animaciones de actividad");
});
