// Builds only the capsule and a controlled React host into a fresh temporary directory.
import { build } from "vite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const output = mkdtempSync(path.join(tmpdir(), "openwork-companion-performance-"));
await build({ root, configFile: path.join(root, "vite.config.ts"), base: "./", plugins: [{
  name: "isolated-companion-performance", configResolved(config) {
    config.build.rollupOptions.input = { companion: path.join(root, "companion.html"), host: path.join(root, "tests/fixtures/companion-performance.html") };
  },
}], build: { outDir: output, emptyOutDir: false } });
console.log(JSON.stringify({ build: output }));
