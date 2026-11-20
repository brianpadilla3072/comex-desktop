# Spanish by default in Comex

Feature key: `comexSpanishLocale` (self-hosted, on by default). It only takes
effect while `comexWorkspace` is on.

## Problem

The app has no language picker and starts in English when no language is
stored. The Comex screens are written in Spanish, so a Comex user saw a mix:
"¿Qué querés investigar?" next to "Select model", "Workspaces" or "Retry".

## Behavior

- `GET /comex/features` reports `comexSpanishLocale: true` when both flags
  are on.
- The app stores that as a default-language hint
  (`openwork.language.default`). It never writes the person's own preference
  (`openwork.language`), which always wins.
- `initLocale()` uses the stored preference, then the hint, then English.
- When the hint changes and there is no stored preference, the app reloads
  once so every screen renders in the new language. Turning the flag off
  removes the hint and the app goes back to English on the next reload.

## Turning it off

Set `DEN_FEATURE_COMEX_SPANISH_LOCALE=false` on the server. No deploy is
needed.

## Tests

- `apps/app/tests/comex-spanish-locale.test.ts`: preference, hint and reload
  rules.
- `apps/app/tests/spanish-main-surfaces-i18n.test.ts`: the main surfaces stay
  translated and placeholders match English.
