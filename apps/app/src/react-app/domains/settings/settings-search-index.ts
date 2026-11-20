import type { SettingsTab } from "@/app/types";
import { activityAnimationsToggleAvailable } from "@/app/lib/activity-motion";
import { t } from "@/i18n";

export type SettingsSearchOs = "macos" | "windows" | "linux";

const DESKTOP: SettingsSearchOs[] = ["macos", "windows", "linux"];

/**
 * One setting inside a settings page, as Cmd/Ctrl+K finds it (port of
 * different-ai/openwork#7415). `title` and `detail` repeat the row's own label
 * and description so a search for the words on the page lands on it. Keywords
 * carry English and Spanish words, so either language finds the setting
 * whatever the interface language is.
 */
export type SettingsSearchEntry = {
  tab: SettingsTab;
  /** The row's `LayoutSectionItem anchor`, unique within its page. */
  anchor: string;
  title: string;
  detail?: string;
  /** Heading the setting sits under, shown in the result's path. */
  section?: string;
  keywords?: string[];
  /** Desktop systems that show this setting. Omitted: shown everywhere. */
  os?: SettingsSearchOs[];
  /** Shown only in the web app (no desktop system). */
  webOnly?: boolean;
  /** Feature switch the row itself depends on; false hides the result too. */
  available?: () => boolean;
};

// Flag `paletteSettingSearch` (default on). The desktop config provider pushes the
// server's decision; an older server without the field keeps the default.
let settingSearchEnabled = true;
const settingSearchListeners = new Set<() => void>();

export function setPaletteSettingSearchEnabled(enabled: boolean): void {
  if (settingSearchEnabled === enabled) return;
  settingSearchEnabled = enabled;
  for (const listener of settingSearchListeners) listener();
}

export function paletteSettingSearchEnabled(): boolean {
  return settingSearchEnabled;
}

export function subscribePaletteSettingSearch(listener: () => void): () => void {
  settingSearchListeners.add(listener);
  return () => settingSearchListeners.delete(listener);
}

/** Read at search time so titles follow the chosen language. */
export function getSettingsSearchEntries(options: { webNotifications?: boolean } = {}): SettingsSearchEntry[] {
  return [
    {
      tab: "preferences",
      anchor: "show-model-reasoning",
      title: t("settings.show_model_reasoning"),
      detail: t("settings.show_model_reasoning_desc"),
      section: t("settings.model_title"),
      keywords: ["thinking", "thoughts", "reasoning traces", "razonamiento", "pensamiento"],
    },
    {
      tab: "preferences",
      anchor: "auto-compact",
      title: t("settings.auto_compact"),
      detail: t("settings.auto_compact_desc"),
      section: t("settings.model_title"),
      keywords: ["compaction", "context window", "summarize", "compactar", "contexto", "resumir"],
    },
    {
      tab: "preferences",
      anchor: "desktop-notifications",
      title: t("settings.desktop_notifications.mode"),
      detail: t("settings.desktop_notifications.mode_desc"),
      section: t("settings.desktop_notifications.title"),
      keywords: ["notifications", "alerts", "notify", "notificaciones", "avisos", "alertas", "notificar"],
    },
    {
      tab: "preferences",
      anchor: "web-notifications-permission",
      title: t("web_notifications.permission_title"),
      detail: t("web_notifications.section_desc"),
      section: t("web_notifications.section_title"),
      keywords: ["notifications", "browser notifications", "allow notifications", "notificaciones", "permiso", "navegador"],
      webOnly: true,
      available: () => options.webNotifications === true,
    },
    {
      tab: "preferences",
      anchor: "keep-awake",
      title: t("settings.keep_awake"),
      detail: t("settings.keep_awake_desc"),
      section: t("settings.power_title"),
      keywords: ["sleep", "prevent sleep", "caffeinate", "long tasks", "suspender", "reposo", "despierta", "tareas largas"],
      os: DESKTOP,
    },
    {
      tab: "preferences",
      anchor: "open-links-in",
      title: t("settings.links.open_in"),
      detail: t("settings.links.open_in_desc"),
      section: t("settings.browser_title"),
      keywords: ["links", "external browser", "default browser", "built-in browser", "enlaces", "navegador externo", "vínculos"],
      os: DESKTOP,
    },
    {
      tab: "preferences",
      anchor: "usage-data",
      title: t("settings.analytics_toggle"),
      detail: t("settings.analytics_toggle_desc"),
      section: t("settings.privacy_title"),
      keywords: ["analytics", "telemetry", "tracking", "privacy", "telemetría", "analíticas", "privacidad", "seguimiento"],
    },
    {
      tab: "appearance",
      anchor: "theme",
      title: t("settings.theme_title"),
      detail: t("settings.appearance_hint"),
      keywords: ["dark mode", "light mode", "system theme", "color scheme", "tema", "modo oscuro", "modo claro", "oscuro", "claro", "colores"],
    },
    {
      tab: "appearance",
      anchor: "language",
      title: t("settings.language"),
      detail: t("settings.language.description"),
      keywords: ["locale", "translation", "english", "spanish", "idioma", "lenguaje", "traducción", "español", "inglés"],
    },
    {
      tab: "appearance",
      anchor: "activity-animations",
      title: t("activity_motion.toggle_title"),
      detail: t("activity_motion.toggle_desc"),
      section: t("activity_motion.section_title"),
      keywords: ["animations", "activity animations", "performance", "cpu", "reduce motion", "animaciones", "rendimiento", "movimiento", "consumo"],
      available: activityAnimationsToggleAvailable,
    },
    {
      tab: "appearance",
      anchor: "hide-titlebar",
      title: t("settings.hide_titlebar"),
      detail: t("settings.hide_titlebar_desc"),
      section: t("settings.window_title"),
      keywords: ["title bar", "window frame", "tiling", "barra de título", "ventana", "marco"],
      os: DESKTOP,
    },
    {
      tab: "appearance",
      anchor: "menu-bar",
      title: t("settings_ui.display_menu_bar"),
      detail: t("settings_ui.display_menu_bar_desc"),
      section: t("settings.window_title"),
      keywords: ["menubar", "application menu", "barra de menús", "menú"],
      os: ["windows", "linux"],
    },
    {
      tab: "updates",
      anchor: "release-channel",
      title: t("settings_ui.release_channel"),
      detail: t("settings_ui.release_channel_desc"),
      keywords: ["stable", "alpha", "preview builds", "canal", "estable", "versiones de prueba"],
      os: ["macos"],
    },
    {
      tab: "updates",
      anchor: "check-automatically",
      title: t("settings.background_checks_title"),
      detail: t("settings.background_checks_desc"),
      keywords: ["background checks", "check for updates", "auto update", "buscar actualizaciones", "comprobar"],
    },
    {
      tab: "updates",
      anchor: "download-automatically",
      title: t("settings.auto_update_title"),
      detail: t("settings.auto_update_desc"),
      keywords: ["auto update", "install updates", "background download", "actualizar", "descargar", "instalar actualizaciones"],
    },
    {
      tab: "advanced",
      anchor: "connect-device",
      title: t("pairing.connect_title"),
      detail: t("pairing.connect_desc"),
      section: t("pairing.section_title"),
      keywords: ["devices", "pair", "pairing", "phone", "tablet", "remote access", "dispositivos", "vincular", "emparejar", "teléfono", "celular", "acceso remoto"],
    },
    {
      tab: "advanced",
      anchor: "show-workspace-run-mode",
      title: t("settings_ui.run_mode_show"),
      detail: t("settings_ui.run_mode_show_desc"),
      section: t("settings_ui.run_mode_title"),
      keywords: ["approvals", "ask before acting", "aprobaciones", "preguntar antes de actuar"],
    },
    {
      tab: "advanced",
      anchor: "chat-engine",
      title: t("engine_settings.chat_engine"),
      section: t("engine_settings.title"),
      keywords: ["opencode v1", "opencode v2", "engine preview", "motor", "versión del motor"],
      os: DESKTOP,
    },
    {
      tab: "advanced",
      anchor: "developer-mode",
      title: t("settings.developer_mode_title"),
      detail: t("settings.developer_mode_desc"),
      section: t("settings.developer"),
      keywords: ["debug tools", "diagnostics", "depuración", "diagnóstico", "desarrollador"],
    },
  ];
}
