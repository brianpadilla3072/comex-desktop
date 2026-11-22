/**
 * Generated artefacts of a design system (kind "system"). Pure functions: given the parsed
 * tokens they return text. The HTML export (`html-archive.ts`) writes them into the package
 * so that "what you see in the app = what you export". Everything here is derived from
 * `tokens.json` (the source of truth); nothing is hand-edited.
 *
 * The model is v2 (`DesignTokens`); a themed value is shown with its first theme.
 */

import type { DesignManifest, DesignTokens } from "@openwork/types/designs";
import { systemAssets, systemColors, systemComponents, systemMeasures, systemTypes } from "./system-views.js";

const slug = (value: string): string =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "token";

const cssVar = (name: string): string => `--${slug(name)}`;

/** `tokens.css`: one variable per token, first theme. Values are taken verbatim. */
export function tokensCss(tokens: DesignTokens): string {
  const lines: string[] = ["/* Generated from tokens.json — do not edit */", ":root {"];
  for (const color of systemColors(tokens)) lines.push(`  ${cssVar(color.name)}: ${color.value}; /* ${color.role ?? "color"} */`);
  for (const type of systemTypes(tokens)) {
    lines.push(`  ${cssVar(type.name + "-family")}: ${type.family};`);
    lines.push(`  ${cssVar(type.name + "-size")}: ${type.size};`);
    lines.push(`  ${cssVar(type.name + "-weight")}: ${type.weight};`);
    if (type.lineHeight) lines.push(`  ${cssVar(type.name + "-line-height")}: ${type.lineHeight};`);
  }
  for (const item of systemMeasures(tokens.spacing)) lines.push(`  ${cssVar(item.name)}: ${item.value};`);
  for (const item of systemMeasures(tokens.radius)) lines.push(`  ${cssVar(item.name)}: ${item.value};`);
  for (const item of systemMeasures(tokens.shadow)) lines.push(`  ${cssVar(item.name)}: ${item.value};`);
  for (const item of systemMeasures(tokens.gradient)) lines.push(`  ${cssVar(item.name)}: ${item.value};`);
  for (const item of systemMeasures(tokens.layout)) lines.push(`  ${cssVar(item.name)}: ${item.value};`);
  lines.push("}");
  return `${lines.join("\n")}\n`;
}

/** `api/tokens.md`: one section per group with a table. */
export function tokensMd(tokens: DesignTokens): string {
  const md: string[] = ["<!-- Generated from tokens.json — do not edit -->", "# Tokens", ""];
  if (tokens.overview.trim()) md.push(`> ${tokens.overview.trim()}`, "");
  if (tokens.content.trim()) md.push(`## Voz y contenido`, "", tokens.content.trim(), "");
  const section = (title: string, rows: string[]) => {
    if (!rows.length) return;
    md.push(`## ${title}`, "", ...rows, "");
  };
  section("Colores", systemColors(tokens).map(c => `- **${c.name}** \`${c.value}\`${c.role ? ` — ${c.role}` : ""}${c.group ? ` [${c.group}]` : ""}`));
  section("Tipografía", systemTypes(tokens).map(t => `- **${t.name}**: ${t.family}, ${t.size}, peso ${t.weight}${t.lineHeight ? `, line-height ${t.lineHeight}` : ""}${t.sample ? ` — “${t.sample}”` : ""}`));
  section("Espaciado", systemMeasures(tokens.spacing).map(i => `- **${i.name}**: ${i.value}`));
  section("Radios", systemMeasures(tokens.radius).map(i => `- **${i.name}**: ${i.value}`));
  section("Sombras", systemMeasures(tokens.shadow).map(i => `- **${i.name}**: ${i.value}`));
  section("Degradados", systemMeasures(tokens.gradient).map(i => `- **${i.name}**: ${i.value}`));
  section("Layout", systemMeasures(tokens.layout).map(i => `- **${i.name}**: ${i.value}${i.note ? ` — ${i.note}` : ""}`));
  section("Componentes", systemComponents(tokens).map(c => `- **${c.name}**${c.file ? ` → \`${c.file}\`` : ""}${c.description ? `: ${c.description}` : ""}`));
  section("Recursos", systemAssets(tokens).map(a => `- **${a.name}** → \`${a.file}\``));
  return `${md.join("\n")}\n`;
}

/** `api/components/<Name>.md`: long-form stub for a component. */
export function componentMd(name: string, component: DesignTokens["components"][number]): string {
  const lines = [`<!-- Generated from tokens.json — do not edit -->`, `# ${name}`, ""];
  const description = component.summary ?? component.description;
  if (description) lines.push(description, "");
  if (component.file) lines.push(`Preview: \`${component.file}\``, "");
  lines.push("## Uso", "", "Documentación de uso pendiente de completar.", "");
  return `${lines.join("\n")}\n`;
}

/** `components/index.d.ts`: type declarations as documentation. */
export function indexDts(tokens: DesignTokens): string {
  const lines = ["// Generated from tokens.json — do not edit", ""];
  for (const component of tokens.components) {
    lines.push(`export type ${component.name.replace(/[^a-zA-Z0-9_]/g, "")}Props = Record<string, unknown>;`);
  }
  return `${lines.join("\n")}\n`;
}

/** `components/bundle.css`: shared static styles (placeholder, the real styles live in tokens.css). */
export function bundleCss(tokens: DesignTokens): string {
  return `/* Generated from tokens.json — do not edit */\n/* Shared static styles for component previews. */\n`;
}

/** Package manifest (Noctyx-style) listing the files of the design. */
export function systemManifest(design: DesignManifest, tokens: DesignTokens, files: string[]): Record<string, unknown> {
  return {
    manifestVersion: 3,
    name: design.title,
    namespace: design.title.replace(/[^a-zA-Z0-9]/g, "") || design.id,
    files,
    components: tokens.components.map(c => ({ name: c.name, group: c.group, summary: c.summary })),
    assetGroups: [...new Set(tokens.assets.map(a => a.group).filter((group): group is string => Boolean(group)))],
    storage: { files: {}, blobBytesUsed: 0 },
  };
}
