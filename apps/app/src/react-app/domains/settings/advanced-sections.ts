import { t } from "@/i18n";

// `titleKey` is a locale key: read the title through `advancedSectionTitle` so it follows the language.
export const ADVANCED_SETTINGS_SECTIONS = [
  { id: "organization-server", titleKey: "settings.organization_server_title", keywords: ["den", "control plane", "server url", "reset server"] },
  { id: "runtime", titleKey: "settings.runtime_title", keywords: ["opencode engine", "openwork server", "connection status"] },
  { id: "agent-access", titleKey: "secondary_ui.advanced.agent_access_title", keywords: ["cloud mcp", "health", "tools", "connections"] },
  { id: "config-sources", titleKey: "secondary_ui.advanced.config_sources_title", keywords: ["runtime db", "injected config", "project config", "global config"] },
  { id: "experimental-engine", titleKey: "engine_settings.title", keywords: ["engine v2", "experimental engine", "preview"] },
  { id: "workspace-run-mode", titleKey: "settings_ui.run_mode_title", keywords: ["approvals", "permissions", "keep going", "feature flag"] },
  { id: "developer", titleKey: "settings.developer", keywords: ["developer mode", "debug", "deep link"] },
];

/** The section's title in the current language. */
export function advancedSectionTitle(section: { titleKey: string }): string {
  return t(section.titleKey);
}
