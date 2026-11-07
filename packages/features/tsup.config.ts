import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/registry.ts", "src/resolve.ts"],
  format: ["esm"],
  target: "es2022",
  clean: true,
  // Self-references stay unresolved in the dist output: at runtime the package
  // "exports" map points them at the compiled siblings, so dist/index.js works
  // packaged under node_modules without a bundler. Config (not CLI flags) so the
  // pattern behaves the same on Windows, where npm scripts run through cmd.exe
  // and single quotes are literal characters.
  external: ["zod", /^@openwork\/features(\/|$)/],
});
