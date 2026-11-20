import { afterEach, beforeEach, expect, test } from "bun:test";

import { DEFAULT_LANGUAGE_HINT_KEY, LANGUAGE_PREF_KEY, applyDefaultLanguageHint, currentLocale, initLocale } from "../src/i18n";

// The app always started in English when no language was stored, next to the
// hand-written Spanish Comex screens. Comex now suggests Spanish; the person's
// own choice always wins and the suggestion never becomes that choice.

const store = new Map<string, string>();
const storage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value); },
  removeItem: (key: string) => { store.delete(key); },
};
const original = Object.getOwnPropertyDescriptor(globalThis, "window");
beforeEach(() => {
  store.clear();
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: storage } });
});
afterEach(() => {
  if (original) Object.defineProperty(globalThis, "window", original);
  else Reflect.deleteProperty(globalThis, "window");
});

test("with no preference the Comex hint picks Spanish and asks for one reload", () => {
  expect(initLocale()).toBe("en");
  expect(applyDefaultLanguageHint("es")).toBe(true);
  expect(store.get(DEFAULT_LANGUAGE_HINT_KEY)).toBe("es");
  expect(store.has(LANGUAGE_PREF_KEY)).toBe(false);
  expect(initLocale()).toBe("es");
  expect(currentLocale()).toBe("es");
  // Already on Spanish: the next poll does not reload again.
  expect(applyDefaultLanguageHint("es")).toBe(false);
});

test("an explicit language always wins over the hint and never reloads", () => {
  store.set(LANGUAGE_PREF_KEY, "en");
  expect(applyDefaultLanguageHint("es")).toBe(false);
  expect(initLocale()).toBe("en");
});

test("turning the flag off clears the hint and returns to English", () => {
  store.set(DEFAULT_LANGUAGE_HINT_KEY, "es");
  expect(initLocale()).toBe("es");
  expect(applyDefaultLanguageHint(null)).toBe(true);
  expect(store.has(DEFAULT_LANGUAGE_HINT_KEY)).toBe(false);
  expect(initLocale()).toBe("en");
  expect(applyDefaultLanguageHint(null)).toBe(false);
});

test("an invalid stored hint is ignored", () => {
  store.set(DEFAULT_LANGUAGE_HINT_KEY, "klingon");
  expect(initLocale()).toBe("en");
});
