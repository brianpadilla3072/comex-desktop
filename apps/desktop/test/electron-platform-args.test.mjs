import { test } from "node:test";
import assert from "node:assert/strict";
import { electronPlatformArgs } from "../scripts/electron-platform-args.mjs";

const base = ["--no-sandbox", "--disable-gpu", "--disable-software-rasterizer"];

// On Wayland the dev window could only be shown by enabling the desktop
// companion, because ELECTRON_EXTRA_LAUNCH_ARGS is applied too late for ozone.
test("an explicit ozone platform reaches the command line without the companion", () => {
  assert.deepEqual(electronPlatformArgs({ env: { OPENWORK_ELECTRON_OZONE_PLATFORM: "x11" }, platform: "linux", companionEnabled: false }), [...base, "--ozone-platform=x11"]);
  assert.deepEqual(electronPlatformArgs({ env: { OPENWORK_ELECTRON_OZONE_PLATFORM: " Wayland " }, platform: "linux", companionEnabled: true }), [...base, "--ozone-platform=wayland"]);
  assert.throws(() => electronPlatformArgs({ env: { OPENWORK_ELECTRON_OZONE_PLATFORM: "mir" }, platform: "linux", companionEnabled: false }), /x11, wayland or headless/);
});

test("the companion keeps forcing x11 when a display exists, as before", () => {
  assert.deepEqual(electronPlatformArgs({ env: { DISPLAY: ":0" }, platform: "linux", companionEnabled: true }), [...base, "--ozone-platform=x11"]);
  assert.deepEqual(electronPlatformArgs({ env: {}, platform: "linux", companionEnabled: true }), base);
  assert.deepEqual(electronPlatformArgs({ env: { DISPLAY: ":0" }, platform: "linux", companionEnabled: false }), base);
});

test("an ozone flag already in ELECTRON_EXTRA_LAUNCH_ARGS and other systems add nothing", () => {
  assert.deepEqual(electronPlatformArgs({ env: { ELECTRON_EXTRA_LAUNCH_ARGS: "--ozone-platform=wayland", OPENWORK_ELECTRON_OZONE_PLATFORM: "x11", DISPLAY: ":0" }, platform: "linux", companionEnabled: true }), base);
  assert.deepEqual(electronPlatformArgs({ env: { OPENWORK_ELECTRON_OZONE_PLATFORM: "x11" }, platform: "darwin", companionEnabled: true }), base);
});
