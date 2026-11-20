import { isDesktopRuntime } from "@/app/lib/runtime-env";
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

import { ADVANCED_SETTINGS_SECTIONS } from "@/react-app/domains/settings/advanced-sections";

import { t } from "@/i18n";

import type { PaletteItem } from "./command-palette-search";

const SETTINGS_KEYWORDS: Partial<Record<SettingsTab, string[]>> = {
  ai: ["provider", "providers", "api key", "anthropic", "openai", "openrouter", "google", "gemini", "claude", "gpt", "connect model", "models"],
  preferences: ["default model", "reasoning", "thinking", "compaction", "effort"],
  permissions: ["authorized folders", "folder access", "file access", "allow", "permission denied", "sandbox", "approvals"],
  extensions: ["library", "skills", "plugins", "mcp", "connections", "tools", "apps"],
  environment: ["env", "environment variables", "secrets", "tokens", "api keys"],
  advanced: ["advanced settings", "runtime", "developer", "connection", "server", "port", "reset", "fix", "repair", "clean up", "troubleshoot", "recovery"],
  shortcuts: ["shortcut", "shortcuts", "keyboard", "keys", "hotkey", "keybinding", "switch model", "fast"],
  appearance: ["theme", "dark mode", "light mode", "color", "font", "look"],
  updates: ["version", "upgrade", "check for updates", "release"],
  debug: ["logs", "diagnostics", "developer mode"],
  usage: ["usage", "limit", "spend", "budget", "quota", "increase"],
  "cloud-account": ["sign in", "log in", "login", "account", "organization", "org", "den", "cloud", "openwork cloud"],
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
  /** Desktop policy checker; when `allowControlSettings` is blocked only the Cloud tabs remain. */
  checkRestriction?: DesktopAppRestrictionChecker;
  onOpenSettings: (route: string) => void;
  onOpenExtensions: (section?: string) => void;
}): PaletteItem[] {
  const checkRestriction = input.checkRestriction ?? (() => false);
  const tabs = ([
    "general",
    ...getWorkspaceSettingsTabs(),
    ...getGlobalSettingsTabs(input.developerMode, input.capabilities),
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
    ? ADVANCED_SETTINGS_SECTIONS.filter((section) => section.id !== "experimental-engine" || isDesktopRuntime()).map((section) => ({
        id: `settings:advanced/${section.id}`,
        title: section.title,
        keywords: section.keywords,
        breadcrumb: t("secondary_ui.palette.breadcrumb_advanced"),
        group: "settings",
        action: () => input.onOpenSettings(`/settings/advanced/${section.id}`),
      }))
    : [];

  return input.developerMode
    ? [...advancedItems, ...tabItems, ...libraryItems]
    : [...tabItems, ...advancedItems, ...libraryItems];
}
