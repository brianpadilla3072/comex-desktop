import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { designHtmlArchive } from "../src/designs/html-archive.js";
import { designsRoot } from "../src/designs/store.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "design-"));
  const ddir = join(dir, "proyecto", "diseno", "sys1");
  await mkdir(join(ddir, "pages"), { recursive: true });
  await writeFile(join(ddir, "design.json"), JSON.stringify({
    format: "openwork.design", version: 1, id: "sys1", kind: "system", title: "Sys", createdAt: 1, updatedAt: 2,
    pages: [], systemId: null, thumbnail: null,
  }));
  await writeFile(join(ddir, "tokens.json"), JSON.stringify({
    format: "openwork.design-tokens", version: 1, overview: "ov", content: "ct",
    colors: [{ name: "Primario", value: "#1E3A8A", role: "primary" }],
    typography: [{ name: "Título", family: "system-ui", size: "48px", weight: 700 }],
    spacing: [{ name: "S", value: "8px" }], radii: [], shadows: [], gradients: [], layout: [], components: [], assets: [],
  }));
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

test("system export includes generated artefacts", async () => {
  const archive = await designHtmlArchive(dir, "sys1");
  const files = unzipSync(archive.bytes);
  const names = Object.keys(files);
  expect(names).toContain("sys1/tokens.css");
  expect(names).toContain("sys1/api/tokens.md");
  expect(names).toContain("sys1/components/index.d.ts");
  expect(names).toContain("sys1/components/bundle.css");
  expect(names).toContain("sys1/manifest.json");
  expect(strFromU8(files["sys1/tokens.css"])).toContain("--primario");
  expect(strFromU8(files["sys1/api/tokens.md"])).toContain("Primario");
});