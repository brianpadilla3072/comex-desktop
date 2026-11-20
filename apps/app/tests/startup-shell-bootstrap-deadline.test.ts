import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeAll, expect, test } from "bun:test";

import {
  SHELL_BOOTSTRAP_READ_TIMEOUT_MS,
  getDenBootstrapResolution,
  initializeDenBootstrapConfig,
} from "../src/app/lib/den";

// orch-2: a fresh desktop profile under load stayed on "Starting OpenWork"
// until a manual reload. Startup awaits the shell's bootstrap over IPC before
// the first screen mounts, and that invoke had no deadline: a main process that
// never answered kept the startup promise (and the Suspense fallback) pending
// forever. Every read is now bounded and boot falls back to the in-memory
// placeholder, which heals in the background.

let invocations: string[] = [];

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(async () => {
  // Leave the desktop runtime and start a new generation so the background
  // heal loop of the hung run stops.
  Reflect.deleteProperty(window, "__OPENWORK_ELECTRON__");
  await initializeDenBootstrapConfig();
  await GlobalRegistrator.unregister();
});

test("startup finishes when the shell never answers the bootstrap read", async () => {
  invocations = [];
  // No preload snapshot (the sync read failed), and an IPC bridge that never settles.
  Reflect.set(window, "__OPENWORK_ELECTRON__", {
    meta: {},
    invokeDesktop: (command: string) => {
      invocations.push(command);
      return new Promise(() => {});
    },
  });

  const started = Date.now();
  const config = await initializeDenBootstrapConfig();
  const elapsed = Date.now() - started;

  expect(config.baseUrl.length).toBeGreaterThan(0);
  // The placeholder never counts as an authoritative selection.
  expect(getDenBootstrapResolution()).toBe("unresolved");
  expect(invocations.filter((command) => command === "getDesktopBootstrapConfig")).toHaveLength(3);
  // Three bounded attempts plus the short retry pauses, nowhere near "forever".
  expect(elapsed).toBeLessThan(3 * SHELL_BOOTSTRAP_READ_TIMEOUT_MS + 3_000);
}, 20_000);
