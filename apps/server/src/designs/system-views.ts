/**
 * Read-only views of a v2 `tokens.json` in the flat shape the server's brand context and
 * generated artefacts use. The document stays v2; a themed value is shown with its first theme.
 */

import type { DesignMeasureGroup, DesignTokens, ThemedTokenValue } from "@openwork/types/designs";

export type SystemColorView = { name: string; value: string; role?: string; group?: string };
export type SystemTypeView = { name: string; family: string; size: string; weight: number | string; lineHeight?: string; sample?: string };
export type SystemMeasureView = { name: string; value: string; note?: string };
export type SystemComponentView = { name: string; file?: string; description?: string; group?: string };
export type SystemAssetView = { name: string; file: string; group?: string };

const value = (entry: ThemedTokenValue): string => typeof entry === "string" ? entry : Object.values(entry)[0] ?? "";

export function systemColors(tokens: DesignTokens): SystemColorView[] {
  return tokens.color.tokens.map(token => ({
    name: token.name,
    value: value(token.value),
    ...(token.usage ? { role: token.usage } : {}),
    ...(token.group ? { group: token.group } : {}),
  }));
}

export function systemTypes(tokens: DesignTokens): SystemTypeView[] {
  const views: SystemTypeView[] = [];
  for (const group of tokens.type.groups) {
    const family = tokens.type.families[group.family ?? ""] ?? group.family ?? "";
    for (const style of group.styles) views.push({
      name: style.name,
      family,
      size: style.fontSize,
      weight: style.fontWeight ?? 400,
      ...(style.lineHeight ? { lineHeight: style.lineHeight } : {}),
      ...(style.sample ? { sample: style.sample } : {}),
    });
  }
  return views;
}

export function systemMeasures(group: DesignMeasureGroup): SystemMeasureView[] {
  return group.tokens.map(token => ({
    name: token.name,
    value: value(token.value),
    ...(token.usage ? { note: token.usage } : {}),
  }));
}

export function systemComponents(tokens: DesignTokens): SystemComponentView[] {
  return tokens.components.map(component => {
    const description = component.summary ?? component.description;
    return {
      name: component.name,
      ...(component.file ? { file: component.file } : {}),
      ...(description ? { description } : {}),
      ...(component.group ? { group: component.group } : {}),
    };
  });
}

export function systemAssets(tokens: DesignTokens): SystemAssetView[] {
  return tokens.assets.map(asset => ({
    name: asset.name,
    file: asset.file,
    ...(asset.group ? { group: asset.group } : {}),
  }));
}
