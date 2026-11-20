const OZONE = /(?:^|\s)--ozone-platform(?:=|\s)/;
const PLATFORMS = new Set(["x11", "wayland", "headless"]);

/**
 * Chromium flags for the dev Electron process. The ozone platform must be on
 * the command line: Electron picks it before main.mjs runs, so
 * ELECTRON_EXTRA_LAUNCH_ARGS (applied from main.mjs) is too late for it.
 *
 * - OPENWORK_ELECTRON_OZONE_PLATFORM=x11|wayland|headless chooses it explicitly
 *   (x11 shows the window under XWayland when a Wayland session hides it).
 * - Otherwise the desktop companion still forces x11 on Linux, as before.
 */
export function electronPlatformArgs({ env, platform, companionEnabled }) {
  const args = ["--no-sandbox", "--disable-gpu", "--disable-software-rasterizer"];
  if (platform !== "linux" || OZONE.test(env.ELECTRON_EXTRA_LAUNCH_ARGS ?? "")) return args;
  const requested = (env.OPENWORK_ELECTRON_OZONE_PLATFORM ?? "").trim().toLowerCase();
  if (requested) {
    if (!PLATFORMS.has(requested)) throw new Error(`OPENWORK_ELECTRON_OZONE_PLATFORM must be x11, wayland or headless, got "${requested}".`);
    return [...args, `--ozone-platform=${requested}`];
  }
  return companionEnabled && env.DISPLAY ? [...args, "--ozone-platform=x11"] : args;
}
