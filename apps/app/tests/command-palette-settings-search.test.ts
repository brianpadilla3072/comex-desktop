// Port of different-ai/openwork#7415: Cmd/Ctrl+K finds individual settings and opens the page at them.
import { afterAll, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const ownedDom = typeof window === "undefined";
if (ownedDom) GlobalRegistrator.register({ url: "http://localhost/" });
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const { buildCommandPaletteSettingsItems } = await import("../src/react-app/shell/command-palette-settings");
const { rankPaletteItems } = await import("../src/react-app/shell/command-palette-search");
const { getSettingsSearchEntries, setPaletteSettingSearchEnabled, paletteSettingSearchEnabled } = await import("../src/react-app/domains/settings/settings-search-index");
const { isSettingAnchor, useRevealSetting } = await import("../src/react-app/domains/settings/settings-anchor");
const { parseSettingsPath, settingsPathForRoute } = await import("../src/react-app/shell/settings-route");
const { currentLocale, setLocale } = await import("../src/i18n");
const { ACTIVITY_ANIMATIONS_TOGGLE_KEY } = await import("../src/app/lib/activity-motion");
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");

afterAll(async () => {
  if (ownedDom) await GlobalRegistrator.unregister();
});

type Os = "macos" | "windows" | "linux";

function settingsItems(os: Os | undefined, opened: string[] = [], extra: { settingSearch?: boolean; webNotifications?: boolean; computerUse?: boolean } = {}) {
  return buildCommandPaletteSettingsItems({
    developerMode: false,
    capabilities: { autoUpdate: true },
    os,
    computerUse: extra.computerUse ?? true,
    settingSearch: extra.settingSearch,
    webNotifications: extra.webNotifications,
    onOpenSettings: (route) => opened.push(route),
    onOpenExtensions: () => {},
  });
}

function search(query: string, os: Os | undefined = "macos") {
  return rankPaletteItems(query, settingsItems(os), []).flatMap((group) => group.items.map((item) => item.id));
}

function inSpanish<T>(run: () => T): T {
  const previous = currentLocale();
  setLocale("es");
  try {
    return run();
  } finally {
    setLocale(previous);
  }
}

test("the name of one setting finds that setting and opens the page at it", () => {
  const opened: string[] = [];
  const [first, ...rest] = rankPaletteItems("show workspace run mode", settingsItems("macos", opened), [])
    .flatMap((group) => group.items);
  expect(first?.id).toBe("settings:advanced/show-workspace-run-mode");
  expect(first?.breadcrumb).toBe("Settings › Advanced › Workspace run mode");
  expect(rest).toEqual([]);
  first?.action();
  expect(opened).toEqual(["/settings/advanced/show-workspace-run-mode"]);
});

test("a menu path copied from a chat finds the setting it names", () => {
  expect(search("Settings → Advanced → Workspace run mode → Show workspace run mode"))
    .toEqual(["settings:advanced/show-workspace-run-mode"]);
  expect(search("Settings > Preferences > Keep awake")).toEqual(["settings:preferences/keep-awake"]);
});

test("settings inside a page are found by their own words", () => {
  const expected: Array<[query: string, id: string]> = [
    ["keep awake", "settings:preferences/keep-awake"],
    ["notifications", "settings:preferences/desktop-notifications"],
    ["open links in", "settings:preferences/open-links-in"],
    ["telemetry", "settings:preferences/usage-data"],
    ["language", "settings:appearance/language"],
    ["titlebar", "settings:appearance/hide-titlebar"],
    ["activity animations", "settings:appearance/activity-animations"],
    ["release channel", "settings:updates/release-channel"],
    ["background download", "settings:updates/download-automatically"],
    ["chat engine", "settings:advanced/chat-engine"],
    ["pair", "settings:advanced/connect-device"],
  ];
  for (const [query, id] of expected) expect([query, search(query)[0]]).toEqual([query, id]);
});

test("a real match is not buried under items that only share scattered letters", () => {
  expect(search("sleep")).toEqual(["settings:preferences/keep-awake"]);
  expect(search("alpha")).toEqual(["settings:updates/release-channel"]);
});

test("a typo still finds the nearest setting", () => {
  expect(search("wokspace run mode")[0]).toBe("settings:advanced/workspace-run-mode");
  expect(search("notifcations")[0]).toBe("settings:preferences/desktop-notifications");
});

test("Spanish words find the setting and open the page at it", () => {
  inSpanish(() => {
    const opened: string[] = [];
    const first = (query: string) => rankPaletteItems(query, settingsItems("linux", opened), []).flatMap((group) => group.items)[0];

    const animations = first("animaciones");
    expect(animations?.id).toBe("settings:appearance/activity-animations");
    expect(animations?.title).toBe("Animaciones de actividad");
    expect(animations?.breadcrumb).toBe("Ajustes › Apariencia › Rendimiento");

    const language = first("idioma");
    expect(language?.id).toBe("settings:appearance/language");
    expect(language?.title).toBe("Idioma");

    const devices = first("dispositivos");
    expect(devices?.id).toBe("settings:advanced/connect-device");
    expect(devices?.breadcrumb).toBe("Ajustes › Avanzado › Dispositivos");

    animations?.action();
    language?.action();
    devices?.action();
    expect(opened).toEqual([
      "/settings/appearance/activity-animations",
      "/settings/appearance/language",
      "/settings/advanced/connect-device",
    ]);
  });
});

test("Spanish keywords work without accents and in the English interface too", () => {
  inSpanish(() => {
    expect(search("modo oscuro")[0]).toBe("settings:appearance/theme");
    expect(search("notificaciones")[0]).toBe("settings:preferences/desktop-notifications");
    expect(search("rendimiento")[0]).toBe("settings:appearance/activity-animations");
    expect(search("compactacion")[0]).toBe("settings:preferences/auto-compact");
  });
  expect(search("idioma")[0]).toBe("settings:appearance/language");
  expect(search("dispositivos")[0]).toBe("settings:advanced/connect-device");
});

test("search lists the same pages as the settings sidebar", () => {
  const desktop = settingsItems("macos").map((item) => item.id);
  const web = settingsItems(undefined).map((item) => item.id);
  expect(desktop).toContain("settings:computer");
  expect(web).not.toContain("settings:computer");
  expect(settingsItems("macos", [], { computerUse: false }).map((item) => item.id)).not.toContain("settings:computer");
  expect(search("computer use")[0]).toBe("settings:computer");
});

test("a setting is offered only where its page shows it", () => {
  const ids = (os: Os | undefined, extra: { webNotifications?: boolean } = {}) => settingsItems(os, [], extra).map((item) => item.id);
  expect(ids(undefined)).not.toContain("settings:preferences/keep-awake");
  expect(ids("windows")).toContain("settings:preferences/keep-awake");
  expect(ids("macos")).not.toContain("settings:appearance/menu-bar");
  expect(ids("linux")).toContain("settings:appearance/menu-bar");
  expect(ids("windows")).not.toContain("settings:updates/release-channel");
  expect(ids("macos")).toContain("settings:updates/release-channel");
  expect(ids(undefined)).not.toContain("settings:advanced/chat-engine");
  expect(ids(undefined)).not.toContain("settings:advanced/experimental-engine");
  // The browser permission row exists only in the web app with web notifications on.
  expect(ids(undefined, { webNotifications: true })).toContain("settings:preferences/web-notifications-permission");
  expect(ids(undefined)).not.toContain("settings:preferences/web-notifications-permission");
  expect(ids("linux", { webNotifications: true })).not.toContain("settings:preferences/web-notifications-permission");
  const withoutUpdates = buildCommandPaletteSettingsItems({
    developerMode: false,
    capabilities: { autoUpdate: false },
    os: "macos",
    onOpenSettings: () => {},
    onOpenExtensions: () => {},
  }).map((item) => item.id);
  expect(withoutUpdates).not.toContain("settings:updates/check-automatically");
});

test("the activity animations setting follows its own flag", () => {
  window.localStorage.setItem(ACTIVITY_ANIMATIONS_TOGGLE_KEY, "off");
  try {
    expect(settingsItems("linux").map((item) => item.id)).not.toContain("settings:appearance/activity-animations");
  } finally {
    window.localStorage.removeItem(ACTIVITY_ANIMATIONS_TOGGLE_KEY);
  }
  expect(settingsItems("linux").map((item) => item.id)).toContain("settings:appearance/activity-animations");
});

test("flag paletteSettingSearch off lists only the pages, as before", () => {
  expect(paletteSettingSearchEnabled()).toBe(true);
  const ids = settingsItems("macos", [], { settingSearch: false }).map((item) => item.id);
  expect(ids).toContain("settings:appearance");
  expect(ids.some((id) => getSettingsSearchEntries().some((entry) => id === `settings:${entry.tab}/${entry.anchor}`))).toBe(false);
  setPaletteSettingSearchEnabled(false);
  try {
    expect(paletteSettingSearchEnabled()).toBe(false);
  } finally {
    setPaletteSettingSearchEnabled(true);
  }
});

test("the empty palette still previews pages, not settings inside them", () => {
  const preview = rankPaletteItems("", settingsItems("macos"), [])
    .flatMap((group) => group.items.map((item) => item.id));
  expect(preview.length).toBeGreaterThan(0);
  expect(preview.filter((id) => /^settings:[a-z-]+\/[a-z-]+$/.test(id) && !id.startsWith("settings:advanced/") && !id.startsWith("settings:extensions/"))).toEqual([]);
});

test("a settings link keeps the setting it names when the workspace is added to the path", () => {
  const route = parseSettingsPath("/settings/preferences/keep-awake");
  expect([route.tab, route.anchor]).toEqual(["preferences", "keep-awake"]);
  expect(settingsPathForRoute(route)).toBe("preferences/keep-awake");

  const advanced = parseSettingsPath("/workspace/w1/settings/advanced/show-workspace-run-mode");
  expect(advanced.anchor).toBe("show-workspace-run-mode");
  expect(settingsPathForRoute(advanced)).toBe("advanced/show-workspace-run-mode");

  const devices = parseSettingsPath("/settings/advanced/connect-device");
  expect([devices.tab, devices.anchor]).toEqual(["advanced", "connect-device"]);

  expect(parseSettingsPath("/settings/preferences/Not%20a%20setting").anchor).toBeUndefined();
  expect(settingsPathForRoute(parseSettingsPath("/settings/preferences"))).toBe("preferences");
});

test("opening a setting scrolls to it, focuses it and outlines it", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const row = document.createElement("div");
  row.setAttribute("data-setting-anchor", "language");
  row.tabIndex = -1;
  let scrolled = false;
  row.scrollIntoView = () => { scrolled = true; };
  document.body.appendChild(row);
  function Reveal() {
    useRevealSetting("language", "key-1");
    return null;
  }
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(React.createElement(Reveal));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(scrolled).toBe(true);
    expect(document.activeElement).toBe(row);
    expect(row.hasAttribute("data-setting-found")).toBe(true);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    row.remove();
  }
  expect(row.hasAttribute("data-setting-found")).toBe(false);
});

function settingsSources(directory: string): string {
  return readdirSync(directory, { withFileTypes: true })
    .map((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return settingsSources(path);
      return entry.name.endsWith(".tsx") ? readFileSync(path, "utf8") : "";
    })
    .join("\n");
}

test("every indexed setting has its anchor on a settings page", () => {
  const source = settingsSources(join(import.meta.dir, "../src/react-app/domains/settings"));
  const entries = getSettingsSearchEntries();
  const missing = entries.filter((entry) => !isSettingAnchor(entry.anchor) || !source.includes(`anchor="${entry.anchor}"`));
  expect(missing.map((entry) => `${entry.tab}/${entry.anchor}`)).toEqual([]);
  const keys = entries.map((entry) => `${entry.tab}/${entry.anchor}`);
  expect(new Set(keys).size).toBe(keys.length);
});

test("every indexed setting is titled in Spanish", () => {
  const english = getSettingsSearchEntries({ webNotifications: true }).map((entry) => entry.title);
  const spanish = inSpanish(() => getSettingsSearchEntries({ webNotifications: true }).map((entry) => entry.title));
  const untranslated = spanish.filter((title, index) => title === english[index] || /^[a-z_]+\.[a-z_.]+$/.test(title));
  expect(untranslated).toEqual([]);
});
