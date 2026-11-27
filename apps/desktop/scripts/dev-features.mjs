/** Defaults owned by the development launcher, never packaged desktop policy. */
export function desktopDevFeatureEnvironment(env) {
  return {
    // Vite serves the Electron renderer, which cannot connect on its own in Chrome.
    // Keep View → Ir a web available after every dev restart via the embedded
    // server's authenticated web surface. Its port is discovered at runtime.
    // Preserve explicit false (and invalid values for normal feature validation).
    DEN_FEATURE_DESKTOP_LOCAL_WEB: env.DEN_FEATURE_DESKTOP_LOCAL_WEB ?? "true",
  };
}
