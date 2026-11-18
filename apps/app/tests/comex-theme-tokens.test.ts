import { describe, expect, test } from "bun:test";

import { comexDefaultTheme, type ComexTheme } from "../src/react-app/design-system/comex-theme";

describe("comex artifact theme tokens (issue #7)", () => {
  test("default theme uses the system font stack, not a copied webfont", () => {
    expect(comexDefaultTheme.typography.fontFamily).toContain("system-ui");
    expect(comexDefaultTheme.typography.fontFamily).not.toContain("http");
  });

  test("covers surface, text, border, accent, radii and a type scale", () => {
    const theme: ComexTheme = comexDefaultTheme;
    for (const token of [theme.surface, theme.text, theme.border, theme.accent]) {
      expect(token.startsWith("var(")).toBe(true);
    }
    expect(Object.keys(theme.radii)).toEqual(["control", "shell", "window"]);
    expect(Object.keys(theme.typography.fontSize)).toEqual(["xs", "sm", "base", "md", "lg", "xl"]);
  });

  test("chart series keep the previous hardcoded colors so the migration has no visual effect", () => {
    expect(comexDefaultTheme.chartSeries).toEqual(["#2563eb", "#dc2626", "#059669", "#d97706"]);
  });
});
