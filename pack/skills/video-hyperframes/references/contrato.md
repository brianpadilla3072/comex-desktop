# Contrato HyperFrames — detalle

El contrato es el mismo que usa HyperFrames para poder seekear sin ambigüedad.
El runtime de este pack (`assets/runtime.js`) lo implementa sin el CLI.

## Raíz

```html
<div id="root" data-composition-id="main"
     data-start="0" data-duration="6"
     data-width="1080" data-height="1920">
```

- `data-duration` de la raíz es la duración del video.
- `data-width`/`data-height` son el lienzo lógico; el render usa `--scale` para
  exportar a otra resolución sin reescribir el CSS.

## Clips

```html
<div class="clip" data-start="1.2" data-duration="2.4">…</div>
```

- Se ve en `[start, start + duration)`.
- Un clip puede contener otros clips; el runtime aplica la visibilidad a todos.
- No animes el clip: animá un hijo. El clip se oculta con `visibility`, y si
  además animás su `visibility` o `autoAlpha` se pelean.

## Línea de tiempo

```js
window.__timelines = window.__timelines || {};
const tl = gsap.timeline({ paused: true });
tl.fromTo(".card", { y: 60, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6 }, 0);
window.__timelines["main"] = tl;
```

- Una sola línea por composición, **pausada**.
- El runtime hace `tl.pause(); tl.seek(t, false)` en cada cuadro.
- Los `delays` y `stagger` son parte de la línea: no uses `setTimeout` para
  escalonar.

## Determinismo

| Prohibido | Por qué |
|---|---|
| `Date.now()` | el cuadro dependería del reloj real |
| `Math.random()` | dos renders darían distinto |
| `fetch()` | la composición no debe depender de la red |
| `setInterval` / `setTimeout` | no hay reloj propio |
| `repeat: -1` | un seek no termina nunca |
| `requestAnimationFrame` | el render avanza a mano |

Las animaciones CSS están permitidas: el runtime las pausa y les fija
`currentTime = t`. Aun así, GSAP es más fácil de depurar.

## Medios

- Imágenes y fuentes: `assets/…`, ruta relativa.
- Video embebido: `<video>` **mudo**; si necesita sonido, va en el mix de audio.
- Audio: no se reproduce solo. El sonido entra por `--audio` como una pista
  mezclada; así el render es reproducible y el QA de loudness mide lo mismo que
  se entrega.

## Escenas

```html
<div data-composition-src="compositions/intro.html"
     data-start="0" data-duration="4"></div>
```

Cada escena es un archivo con su propio `<template>` y su línea registrada con
el id de la escena. El reloj de la escena empieza en el `data-start` del host.
El renderer de este pack renderiza la raíz: si usás escenas, mantené el host y
verificá con `hf_check` que los archivos existan.
