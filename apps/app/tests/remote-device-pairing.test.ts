import { afterEach, beforeEach, expect, test } from "bun:test";

// A paired browser keeps its own owner token: the collaborator token the page injects on every
// load must not replace it, and forgetting the pairing hands the page's token back.
const store = new Map<string, string>();
const storage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value); },
  removeItem: (key: string) => { store.delete(key); },
};
const original = Object.getOwnPropertyDescriptor(globalThis, "window");
beforeEach(() => {
  store.clear();
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: storage, location: { origin: "http://localhost", href: "http://localhost/" }, __OPENWORK_BOOTSTRAP__: { token: "page-collaborator" } } });
});
afterEach(() => {
  if (original) Object.defineProperty(globalThis, "window", original);
  else Reflect.deleteProperty(globalThis, "window");
});

const { forgetPairedDevice, hydrateOpenworkServerSettingsFromEnv, isPairedDevice, readOpenworkServerSettings, savePairedDeviceToken } = await import("../src/app/lib/openwork-server");

test("the page token is used until the device is paired, then the paired token always wins", () => {
  hydrateOpenworkServerSettingsFromEnv();
  expect(readOpenworkServerSettings().token).toBe("page-collaborator");
  savePairedDeviceToken("device-owner");
  expect(isPairedDevice()).toBe(true);
  hydrateOpenworkServerSettingsFromEnv();
  expect(readOpenworkServerSettings().token).toBe("device-owner");
});

test("code that rewrites the connection with the page token never replaces the paired token", async () => {
  const { writeOpenworkServerSettings } = await import("../src/app/lib/openwork-server");
  savePairedDeviceToken("device-owner");
  writeOpenworkServerSettings({ ...readOpenworkServerSettings(), token: "page-collaborator" });
  expect(readOpenworkServerSettings().token).toBe("device-owner");
  hydrateOpenworkServerSettingsFromEnv();
  expect(readOpenworkServerSettings().token).toBe("device-owner");
});

test("forgetting the pairing goes back to the page token on the next load", () => {
  savePairedDeviceToken("device-owner");
  forgetPairedDevice();
  expect(isPairedDevice()).toBe(false);
  hydrateOpenworkServerSettingsFromEnv();
  expect(readOpenworkServerSettings().token).toBe("page-collaborator");
});
