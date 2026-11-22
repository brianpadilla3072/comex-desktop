# Activity animations switch (`activityAnimationsToggle`)

Settings › Apariencia › Rendimiento › **Animaciones de actividad**. On by default; turning it off
freezes the running-work marks (the 3×3 dot matrix next to running tasks in the sidebar and in
tool lines, and the dot ticker) on their first frame — the same still frame used under
`prefers-reduced-motion`.

## Why

Measured in `docs/performance/memory-baseline.md` ("Renderer CPU while waiting"): with 10 running
tasks the marks are ~54 CSS animations that keep Chromium drawing frames. Freezing them took the
renderer from 13.8 % to 8.4 % of a CPU thread and explains most of the GPU process's 10–30 %.
The setting tells the person this ("hasta un 40 % … con muchas tareas"; small with one or two).

## How

- `apps/app/src/app/lib/activity-motion.ts`: the choice lives in localStorage
  (`openwork.activityAnimations = "off"`), applied as the `ow-calm-activity` class on `<html>`
  before the first paint (`index.react.tsx`), so every mark follows without React re-renders.
- `apps/app/src/app/index.css`: `.ow-calm-activity .ow-dot-matrix-dot` / `.ow-dot-ticker` stop
  animating.
- Flag: the server reports `activityAnimationsToggle` in `GET /comex/features`; the app stores
  "off" in `openwork.activityAnimationsToggle` when the operator disables it. Then the switch is
  hidden and marks animate again regardless of the stored choice.

## Tests

`apps/app/tests/activity-motion.test.tsx`: class and persistence, flag off ignores the choice,
the section renders the switch and the measured impact, and hides when the flag is off.
