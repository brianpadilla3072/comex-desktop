// Run before the main module's asynchronous dependencies initialize Chromium.
import { createRequire } from "node:module";
import { parseFeatureEnvironment, resolveFeature } from "@openwork/features";
import { resolveDesktopDistribution } from "./desktop-distribution.mjs";

const require = createRequire(import.meta.url);
const { app } = require("electron");
const metadata = require("../package.json");
const distribution = resolveDesktopDistribution({
  isPackaged: app.isPackaged,
  packageFlavor: Reflect.get(metadata, "openworkDistribution"),
  environmentFlavor: process.env.OPENWORK_DESKTOP_DISTRIBUTION,
});
const context = parseFeatureEnvironment(process.env);
export const companionEnabled = !context.problems.some(problem => problem.fatal)
  && distribution.flavor === "public"
  && resolveFeature("desktopCompanion", { ...context, rollouts: {}, overrides: {} }).enabled;

// Native Wayland cannot anchor windows to a screen coordinate.
if (companionEnabled && process.platform === "linux" && process.env.DISPLAY
  && !app.commandLine.hasSwitch("ozone-platform")
  && !/(?:^|\s)--ozone-platform(?:=|\s)/.test(process.env.ELECTRON_EXTRA_LAUNCH_ARGS ?? "")) {
  app.commandLine.appendSwitch("ozone-platform", "x11");
}
