import { expect, test } from "bun:test";

import { currentLocale, setLocale } from "../src/i18n";
import { agentViewportLabel } from "../src/react-app/domains/session/panel/agent-viewport";
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
