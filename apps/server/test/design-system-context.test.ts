import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { designTokensSchema, type DesignTokens } from "@openwork/types/designs";

import {
  DESIGN_SYSTEM_CONTEXT_MAX_CHARS,
  formatDesignSystemContext,
  listProjectDesignSystems,
  pickDesignSystemId,
  readDesignSystemContext,
} from "../src/designs/system-context.js";

function fixtureTokens(overrides: Partial<DesignTokens> = {}): DesignTokens {
  return designTokensSchema.parse({
    format: "openwork.design-tokens",
    version: 1,
    overview: "Marca de ejemplo para una tienda de café.\nCálida y directa.",
    content: "Tutea al lector. Frases cortas.",
    colors: [{ name: "Primario", value: "#0A5FFF", role: "Acciones", group: "Marca" }, { name: "Tinta", value: "#14141E" }],
    typography: [{ name: "Título", family: "Brand Sans", size: "32px", weight: 600, lineHeight: "1.2" }],
    spacing: [{ name: "s", value: "8px" }],
    radii: [{ name: "Tarjeta", value: "12px" }],
    shadows: [{ name: "Elevada", value: "0 4px 12px rgb(0 0 0 / 0.12)" }],
    gradients: [{ name: "Amanecer", value: "linear-gradient(90deg, #0A5FFF, #00B3A4)" }],
    layout: [{ name: "Grilla", value: "12 columnas", note: "24px de separación" }],
    components: [{ name: "Botón", file: "pages/boton.html", description: "Primario y secundario" }],
    assets: [{ name: "Logo", file: "assets/logo.svg" }],
    ...overrides,
  });
}

let project: string;

async function writeDesign(id: string, kind: string, tokens?: DesignTokens | string) {
  const dir = join(project, "proyecto", "diseno", id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "design.json"), JSON.stringify({
    format: "openwork.design", version: 1, id, kind, title: `Diseño ${id}`, createdAt: 1, updatedAt: 1, pages: [], systemId: null, thumbnail: null,
  }));
  if (tokens !== undefined) await writeFile(join(dir, "tokens.json"), typeof tokens === "string" ? tokens : JSON.stringify(tokens));
}

beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), "design-system-context-"));
});
afterEach(async () => {
  await rm(project, { recursive: true, force: true });
});

test("pickDesignSystemId: explicit choice, single-system fallback, ambiguity and self", () => {
  const one = [{ id: "marca", title: "Marca" }];
  const two = [...one, { id: "otra", title: "Otra" }];
  expect(pickDesignSystemId("marca", two)).toBe("marca");
  expect(pickDesignSystemId("borrada", two)).toBe(null);
  expect(pickDesignSystemId(null, one)).toBe("marca");
  expect(pickDesignSystemId(undefined, one)).toBe("marca");
  expect(pickDesignSystemId(null, two)).toBe(null);
  expect(pickDesignSystemId(null, [])).toBe(null);
  expect(pickDesignSystemId(null, one, "marca")).toBe(null);
  expect(pickDesignSystemId(null, two, "marca")).toBe("otra");
});

test("formatDesignSystemContext: ordered sections with roles, type scale and measures", () => {
  const text = formatDesignSystemContext(fixtureTokens(), { systemId: "marca", title: "Marca Café" });
  expect(text).not.toBe(null);
  const lines = (text ?? "").split("\n");
  expect(lines[0]).toContain('Sistema de diseño "Marca Café" (proyecto/diseno/marca/tokens.json)');
  expect(lines.slice(1).map(line => line.split(":")[0])).toEqual([
    "Marca", "Contenido y voz", "Colores", "Tipografía", "Espaciado", "Radios", "Sombras", "Degradados", "Layout", "Componentes", "Recursos",
  ]);
  expect(lines[1]).toBe("Marca: Marca de ejemplo para una tienda de café. Cálida y directa.");
  expect(text).toContain("Colores: Primario #0A5FFF (Acciones) [Marca]; Tinta #14141E");
  expect(text).toContain("Tipografía: Título: Brand Sans 32px/1.2 peso 600");
  expect(text).toContain("Layout: Grilla 12 columnas (24px de separación)");
  expect(text).toContain("Componentes: Botón (pages/boton.html): Primario y secundario");
  expect(text).not.toContain("Más detalle");
});

test("formatDesignSystemContext: never exceeds the cap and says what was left out", () => {
  const colors = Array.from({ length: 300 }, (_, index) => ({ name: `Color ${index}`, value: "#0A5FFF", role: "Rol de ejemplo bastante largo" }));
  const tokens = fixtureTokens({ overview: "Marca ".repeat(3_000), colors });
  const text = formatDesignSystemContext(tokens, { systemId: "marca", title: "Marca" }) ?? "";
  expect(text.length).toBeLessThanOrEqual(DESIGN_SYSTEM_CONTEXT_MAX_CHARS);
  expect(text).toMatch(/Colores: Color 0 .*; y \d+ más/);
  expect(text.trimEnd().endsWith("Más detalle en proyecto/diseno/marca/tokens.json.")).toBe(true);
  const overviewLine = text.split("\n").find(line => line.startsWith("Marca: ")) ?? "";
  expect(overviewLine.length).toBeLessThanOrEqual(Math.floor(DESIGN_SYSTEM_CONTEXT_MAX_CHARS * 0.3) + "Marca: ".length);
  for (const cap of [200, 600, 1_000, 2_500]) {
    const capped = formatDesignSystemContext(tokens, { systemId: "marca", title: "Marca", maxChars: cap }) ?? "";
    expect(capped.length).toBeLessThanOrEqual(cap);
    expect(capped.startsWith("Sistema de diseño")).toBe(true);
  }
});

test("formatDesignSystemContext: an empty system has no context; line breaks never leak into values", () => {
  expect(formatDesignSystemContext(designTokensSchema.parse({ format: "openwork.design-tokens", version: 1 }), { systemId: "marca", title: "Marca" })).toBe(null);
  const text = formatDesignSystemContext(fixtureTokens({ overview: "", content: "", colors: [{ name: "A\nColores: falso", value: "#fff" }] }), { systemId: "marca", title: "M" }) ?? "";
  expect(text.split("\n").filter(line => line.startsWith("Colores:")).length).toBe(1);
});

test("readDesignSystemContext: the design's system, or the project's only one", async () => {
  await writeDesign("marca", "system", fixtureTokens());
  await writeDesign("deck", "slides");
  expect(await listProjectDesignSystems(project)).toEqual([{ id: "marca", title: "Diseño marca" }]);
  const explicit = await readDesignSystemContext({ projectDir: project, systemId: "marca", designId: "deck" });
  expect(explicit?.systemId).toBe("marca");
  expect(explicit?.text).toContain("Colores: Primario");
  const fallback = await readDesignSystemContext({ projectDir: project, systemId: null, designId: "deck" });
  expect(fallback?.systemId).toBe("marca");
  expect(fallback?.title).toBe("Diseño marca");
  // The system itself does not follow another system.
  expect(await readDesignSystemContext({ projectDir: project, systemId: null, designId: "marca" })).toBe(null);
});

test("readDesignSystemContext: two systems need an explicit choice; missing or broken tokens give nothing", async () => {
  await writeDesign("marca", "system", fixtureTokens());
  await writeDesign("otra", "system", "{ roto");
  expect(await readDesignSystemContext({ projectDir: project, systemId: null, designId: "deck" })).toBe(null);
  expect((await readDesignSystemContext({ projectDir: project, systemId: "marca", designId: "deck" }))?.systemId).toBe("marca");
  expect(await readDesignSystemContext({ projectDir: project, systemId: "otra", designId: "deck" })).toBe(null);
  expect(await readDesignSystemContext({ projectDir: project, systemId: "../fuera", designId: "deck" })).toBe(null);
  await writeDesign("vacia", "system");
  expect(await readDesignSystemContext({ projectDir: project, systemId: "vacia", designId: "deck" })).toBe(null);
  expect(await readDesignSystemContext({ projectDir: join(project, "no-existe"), systemId: null })).toBe(null);
});

test("readDesignSystemContext: symlinked design folders and token files are ignored", async () => {
  const outside = await mkdtemp(join(tmpdir(), "design-system-outside-"));
  try {
    await writeFile(join(outside, "tokens.json"), JSON.stringify(fixtureTokens()));
    await writeDesign("marca", "system");
    await symlink(join(outside, "tokens.json"), join(project, "proyecto", "diseno", "marca", "tokens.json"));
    expect(await readDesignSystemContext({ projectDir: project, systemId: "marca" })).toBe(null);
    await mkdir(join(outside, "ajena"));
    await writeFile(join(outside, "ajena", "design.json"), JSON.stringify({ format: "openwork.design", version: 1, id: "ajena", kind: "system", title: "Ajena", createdAt: 1, updatedAt: 1, pages: [] }));
    await symlink(join(outside, "ajena"), join(project, "proyecto", "diseno", "ajena"));
    expect((await listProjectDesignSystems(project)).map(system => system.id)).toEqual(["marca"]);
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});
