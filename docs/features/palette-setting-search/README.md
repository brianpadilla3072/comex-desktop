# Find individual settings from the command palette (`paletteSettingSearch`)

Port of different-ai/openwork#7415. Cmd/Ctrl+K used to find only settings pages. With the flag on
(default) it also lists individual settings (theme, language, notifications, keep awake, activity
animations, devices, release channel, developer mode…) and opens the page scrolled to the one you
picked, focused and briefly outlined.

## How

- `apps/app/src/react-app/domains/settings/settings-search-index.ts` lists the settings. Titles and
  descriptions come from `t()`, so they follow the language; keywords carry English and Spanish
  words (`tema`, `modo oscuro`, `idioma`, `notificaciones`, `animaciones`, `rendimiento`,
  `dispositivos`, `vincular`…), so either language finds a setting. Entries are offered only where
  the page shows the row: desktop systems (`os`), web only (`webOnly`, the browser notification
  permission) or behind the row's own switch (`available`, e.g. `activityAnimationsToggle`).
- A result opens `/settings/<tab>/<anchor>`. `LayoutSectionItem anchor` marks the row;
  `settings-anchor.ts` `useRevealSetting` scrolls it into view, focuses it and outlines it.
- Fork settings included: Apariencia › Rendimiento › "Animaciones de actividad", Avanzado ›
  Dispositivos › "Conectar otro dispositivo", the web notification permission and the language
  select.
- `rankPaletteItems`: items that contain every typed word win (Latin accents ignored, so
  "compactacion" finds "Compactación"); the letters-in-order match only applies when nothing
  contains the words, so typos still work. `→ › » >` in a pasted menu path count as spaces. This
  ranking applies to every palette result and is not behind the flag.
- The palette lists the same pages as the settings sidebar, including Computer when computer use
  is on.

## Flag

The server reports `paletteSettingSearch` in `GET /comex/features`; the desktop config provider
pushes it to the palette. Off: the palette lists only pages and sections, as before. An older
server without the field keeps the default (on).

## Tests

`apps/app/tests/command-palette-settings-search.test.ts` (upstream's tests adapted, plus Spanish
queries "animaciones", "idioma", "dispositivos" finding and opening the right setting, the flag,
and the reveal hook).
