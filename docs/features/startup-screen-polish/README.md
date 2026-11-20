# Startup screen polish

Feature `startupScreenPolish` (self-hosted, on by default).

## Problem

Before React mounts, `apps/app/index.html` shows a static screen. It was always in English,
revealed its Reload hint only after 45 seconds, and never noticed when the main bundle failed
to load, so a broken start looked like a slow one with no way out but waiting.

## Behavior

- Text in the person's language without React, for the four strings the screen needs:
  the saved choice (`openwork.language`), else the suggested default (`openwork.language.default`,
  set by Comex), else English, the same fallback the app uses once it mounts (a browser-language
  fallback would show Spanish here and English right after). Spanish and English have strings;
  other languages show English. Spanish uses tú.
- The Reload hint appears after 12 seconds (`data-reveal-after-ms` on `#startup-screen`).
- It appears at once, with "OpenWork could not load. Reload to try again.", when a module script
  fails to load (capture-phase `error` on window, because a script load error does not bubble)
  or an uncaught error happens before mount. Image or stylesheet errors do not count.
- Everything stops once React replaces `#startup-screen`.
- No framework, no network, no new request: the logic is the inline script
  `#startup-screen-script`.

## Flag

The screen runs before any bundle or server answer exists, so it cannot read the server flag.
It follows the pattern of the Comex language hint: the app reads `startupScreenPolish` from
`/comex/features` (`startupScreenPolishEnabled()` in `apps/server/src/comex/features.ts`) and
stores `openwork.startupScreenPolish = "off"` in localStorage when it is off, removing the
entry when it is on (`apps/app/src/app/lib/startup-screen-flag.ts`). The next start reads it.
Off restores the previous screen: English, Reload after 45 seconds, no failure detection.
Turning the flag off takes effect from the start after the app has seen the new value.

## Tests

`apps/app/tests/startup-screen.test.ts` extracts the real markup and inline script from
`index.html` and runs them in happy-dom: language order, the short delay, bundle load failure,
uncaught errors, non-script errors, after-mount silence, and the flag off.
