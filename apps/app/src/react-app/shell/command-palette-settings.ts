import type { PlatformCapabilities } from "@/app/lib/platform-capabilities";
import { isSettingsTabAllowed, type DesktopAppRestrictionChecker } from "@/app/cloud/desktop-app-restrictions";
import type { SettingsTab } from "@/app/types";
import {
  CLOUD_SETTINGS_TABS,
  getGlobalSettingsTabs,
  getSettingsTabDescription,
  getSettingsTabLabel,
  getWorkspaceSettingsTabs,
} from "@/react-app/domains/settings/shell/settings-page";

import { ADVANCED_SETTINGS_SECTIONS, advancedSectionTitle } from "@/react-app/domains/settings/advanced-sections";
import { getSettingsSearchEntries, type SettingsSearchOs } from "@/react-app/domains/settings/settings-search-index";

import { t } from "@/i18n";

import type { PaletteItem } from "./command-palette-search";

const SETTINGS_KEYWORDS: Partial<Record<SettingsTab, string[]>> = {
  ai: ["provider", "providers", "api key", "anthropic", "openai", "openrouter", "google", "gemini", "claude", "gpt", "connect model", "models"],
  preferences: ["default model", "reasoning", "thinking", "compaction", "effort"],
  permissions: ["authorized folders", "folder access", "file access", "allow", "permission denied", "sandbox", "approvals"],
  extensions: ["library", "skills", "plugins", "mcp", "connections", "tools", "apps"],
  import: ["claude", "claude code", "chat history", "migrate"],
  environment: ["env", "environment variables", "secrets", "tokens", "api keys"],
  computer: ["desktop control", "accessibility", "screen recording", "macos permissions", "mouse", "keyboard", "apps"],
  advanced: ["advanced settings", "runtime", "developer", "connection", "server", "port", "reset", "fix", "repair", "clean up", "troubleshoot", "recovery"],
  shortcuts: ["shortcut", "shortcuts", "keyboard", "keys", "hotkey", "keybinding", "switch model", "fast"],
  appearance: ["theme", "dark mode", "light mode", "color", "font", "look"],
  updates: ["version", "upgrade", "check for updates", "release"],
  debug: ["logs", "diagnostics", "developer mode"],
  usage: ["usage", "limit", "spend", "budget", "quota", "increase"],
  "cloud-account": ["sign in", "sign out", "log in", "log out", "login", "account", "organization", "org", "den", "cloud", "openwork cloud"],
  general: ["settings", "preferences", "options", "configure"],
};

// Titles and details are read when the palette builds its items, so they follow the language.
const librarySections = () => [
  { slug: "skills", title: t("secondary_ui.palette.lib_skills"), detail: t("secondary_ui.palette.lib_skills_detail"), keywords: ["skill", "instructions", "workflows"] },
  { slug: "mcps", title: t("secondary_ui.palette.lib_mcps"), detail: t("secondary_ui.palette.lib_mcps_detail"), keywords: ["mcp", "servers", "tools"] },
  { slug: "connections", title: t("secondary_ui.palette.lib_connections"), detail: t("secondary_ui.palette.lib_connections_detail"), keywords: ["apps", "services", "sign in"] },
  { slug: "plugins", title: t("secondary_ui.palette.lib_plugins"), detail: t("secondary_ui.palette.lib_plugins_detail"), keywords: ["extensions", "tools", "hooks"] },
  { slug: "agents", title: t("secondary_ui.palette.lib_agents"), detail: t("secondary_ui.palette.lib_agents_detail"), keywords: ["agent", "assistants", "modes"] },
  { slug: "commands", title: t("secondary_ui.palette.lib_commands"), detail: t("secondary_ui.palette.lib_commands_detail"), keywords: ["command", "slash", "prompts"] },
] satisfies Array<{ slug: string; title: string; detail: string; keywords: string[] }>;

export function buildCommandPaletteSettingsItems(input: {
  developerMode: boolean;
  capabilities: Pick<PlatformCapabilities, "autoUpdate">;
  /** The desktop app's system. Left out on the web, which has no desktop-only settings. */
  os?: SettingsSearchOs;
  /** Computer use is on for this desktop app (the sidebar's Computer page). */
  computerUse?: boolean;
  /** Flag `paletteSettingSearch`: list individual settings inside pages. */
  settingSearch?: boolean;
  /** Web notifications are available (Preferences shows the browser permission row). */
  webNotifications?: boolean;
  /** Desktop policy checker; when `allowControlSettings` is blocked only the Cloud tabs remain. */
  checkRestriction?: DesktopAppRestrictionChecker;
  onOpenSettings: (route: string) => void;
  onOpenExtensions: (section?: string) => void;
}): PaletteItem[] {
  const checkRestriction = input.checkRestriction ?? (() => false);
  // The settings sidebar's pages, in its order (`useSettingsNavGroups`).
  const tabs = ([
    "general",
    ...getWorkspaceSettingsTabs(),
    ...getGlobalSettingsTabs(input.developerMode, input.capabilities, { computerUse: input.computerUse === true && input.os !== undefined }),
    ...CLOUD_SETTINGS_TABS,
  ] satisfies SettingsTab[]).filter((tab) => isSettingsTabAllowed({ tab, checkRestriction }));

  const tabItems = tabs.map((tab): PaletteItem => ({
    id: `settings:${tab}`,
    title: tab === "advanced" ? t("secondary_ui.palette.advanced_settings") : getSettingsTabLabel(tab),
    detail: getSettingsTabDescription(tab),
    keywords: SETTINGS_KEYWORDS[tab],
    breadcrumb: t("secondary_ui.palette.breadcrumb_settings"),
    group: "settings",
    action: () => {
      if (tab === "extensions") {
        input.onOpenExtensions();
        return;
      }
      input.onOpenSettings(`/settings/${tab}`);
    },
  }));

  const libraryItems = librarySections().map((section): PaletteItem => ({
    id: `settings:extensions/${section.slug}`,
    title: section.title,
    detail: section.detail,
    keywords: section.keywords,
    breadcrumb: t("secondary_ui.palette.breadcrumb_library"),
    group: "settings",
    action: () => input.onOpenExtensions(section.slug),
  }));

  const advancedItems: PaletteItem[] = tabs.includes("advanced")
    ? ADVANCED_SETTINGS_SECTIONS.filter((section) => section.id !== "experimental-engine" || input.os !== undefined).map((section) => ({
        id: `settings:advanced/${section.id}`,
        title: advancedSectionTitle(section),
        keywords: section.keywords,
        breadcrumb: t("secondary_ui.palette.breadcrumb_advanced"),
        group: "settings",
        action: () => input.onOpenSettings(`/settings/advanced/${section.id}`),
      }))
    : [];

  // One result per setting inside a page, so a search for an option's own
  // name opens the page at that option.
  const settingItems: PaletteItem[] = input.settingSearch === false ? [] : getSettingsSearchEntries({ webNotifications: input.webNotifications })
    .filter((entry) => tabs.includes(entry.tab))
    .filter((entry) => !entry.os || (input.os !== undefined && entry.os.includes(input.os)))
    .filter((entry) => !entry.webOnly || input.os === undefined)
    .filter((entry) => !entry.available || entry.available())
    .map((entry): PaletteItem => ({
      id: `settings:${entry.tab}/${entry.anchor}`,
      title: entry.title,
      detail: entry.detail,
      keywords: entry.keywords,
      breadcrumb: [t("secondary_ui.palette.breadcrumb_settings"), getSettingsTabLabel(entry.tab), entry.section].filter(Boolean).join(" › "),
      group: "settings",
      action: () => input.onOpenSettings(`/settings/${entry.tab}/${entry.anchor}`),
    }));

  // Settings inside pages come last: the empty palette previews the first few
  // entries, which stay the pages themselves.
  return input.developerMode
    ? [...advancedItems, ...tabItems, ...libraryItems, ...settingItems]
    : [...tabItems, ...advancedItems, ...libraryItems, ...settingItems];
}
