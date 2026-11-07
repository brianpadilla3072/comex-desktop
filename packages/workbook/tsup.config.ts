// No import { defineConfig } from "tsup" here: the config is bundled by tsup
// itself and resolves "tsup" from this directory. In CI, pnpm links it; in a
// partially installed checkout it may not be — a plain object avoids the lookup.
export default {
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "es2022",
  clean: true,
  // Ship compiled JS (dist/index.js): the packaged app imports
  // @openwork/workbook at runtime, and Node cannot strip TypeScript inside
  // node_modules. Keep htmlparser2 external — the packaged runtime provides it.
  external: ["htmlparser2"],
};
