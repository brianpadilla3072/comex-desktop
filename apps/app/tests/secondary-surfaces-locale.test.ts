import { expect, test } from "bun:test";

import { currentLocale, setLocale } from "../src/i18n";
import { runStatusLabel } from "../src/react-app/domains/automations/automation-format";
import { agentViewportLabel } from "../src/react-app/domains/session/panel/agent-viewport";
import { ADVANCED_SETTINGS_SECTIONS, advancedSectionTitle } from "../src/react-app/domains/settings/advanced-sections";
import { rankPaletteItems } from "../src/react-app/shell/command-palette-search";

// Agent page sizes kept the English labels of @openwork/browser-tabs ("Desktop", "Phone")
// inside the Spanish app; the label is now read from the locale at render time.
test("agent page sizes follow the language while their keys stay the same", () => {
  const previous = currentLocale();
  setLocale("es");
  try {
    expect((["panel", "desktop", "tablet", "phone"] as const).map(agentViewportLabel)).toEqual(["Panel", "Escritorio", "Tableta", "Teléfono"]);
  } finally {
    setLocale(previous);
  }
  expect(agentViewportLabel("phone")).toBe("Phone");
});

// Settings › Advanced section titles ("Agent access diagnostics") were English constants, also shown in the palette.
test("advanced settings sections are titled in the current language", () => {
  const previous = currentLocale();
  setLocale("es");
  try {
    const titles = ADVANCED_SETTINGS_SECTIONS.map(advancedSectionTitle);
    expect(titles).toContain("Servidor de la organización");
    expect(titles.some((title) => /Agent access|config sources|Experimental engine|Developer/.test(title))).toBe(false);
  } finally {
    setLocale(previous);
  }
});

// Den automation run statuses were English ("failed", "queued") inside the Spanish app.
test("automation run statuses follow the language", () => {
  const run = (status: "failed" | "queued") => ({ status, error: null, attemptCount: 1, startedAt: null });
  const previous = currentLocale();
  const english = [runStatusLabel(run("failed")), runStatusLabel(run("queued"))];
  setLocale("es");
  try {
    const spanish = [runStatusLabel(run("failed")), runStatusLabel(run("queued"))];
    expect(spanish).not.toEqual(english);
    expect(spanish.every((label) => label.length > 0)).toBe(true);
  } finally {
    setLocale(previous);
  }
});

// The command palette's group headings ("Recent", "Actions") were English constants.
test("command palette groups keep their ids and translate their headings", () => {
  const item = (id: string, group: "actions" | "settings") => ({ id, title: id, group, action: () => {} });
  const previous = currentLocale();
  setLocale("es");
  try {
    const groups = rankPaletteItems("", [item("a", "actions"), item("b", "settings")], ["a"]);
    expect(groups.map((group) => [group.value, group.label])).toEqual([["recent", "Recientes"], ["settings", "Ajustes"]]);
  } finally {
    setLocale(previous);
  }
});
