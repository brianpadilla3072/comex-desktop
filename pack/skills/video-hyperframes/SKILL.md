---
name: video-hyperframes
description: "Motor 2D y 2.5D para videos: composiciones HyperFrames en HTML + GSAP, renderizadas cuadro por cuadro sin React, con generador y 9 bloques listos (caption, lower third, barras, contador, chat, ventana de app, alerta, personaje 2D con poses, cta). Usar cuando se pidan esos bloques, un personaje con poses, una composición escrita a mano en HTML/GSAP, o cuando digan 'HyperFrames', 'un video en HTML', 'algo sin Remotion', 'armalo con bloques' o 'generá el video desde el guion'. El 2.5D por sí solo no alcanza para elegir este motor: para 2.5D también sirve Remotion con perspective + translateZ, que renderiza en paralelo y es más rápido; se prefiere HyperFrames sólo si la escena necesita los bloques o HTML a mano. También aplica cuando haya que decidir entre motor 2D/2.5D (este) y 3D (video-studio con three)."
---

# Video HyperFrames (motor 2D / 2.5D)

Escribe el video como una página HTML con una línea de tiempo GSAP y lo
renderiza cuadro por cuadro con Chrome headless. Es el **otro motor** del pack:
donde `video-studio`/Remotion usa React, acá el diseño se hace con CSS.

## Cuándo este motor y cuándo el otro

Los dos motores son de primera categoría: se elige por **lo que pide el
usuario** o por **lo que muestra la referencia**, no por una regla fija de
profundidad. Este motor no es “el de 2D”: también hace 2.5D y personajes.

**Esta skill la carga el agente, no la persona.** El usuario describe el video
(“2D”, “3D”, “como este”), no elige motor, y no hay que preguntarle cuál usar.
La elección se registra en `style.md` y no se menciona en la entrega.

Orden de decisión:

1. **El usuario nombró el motor** (“hacelo en Remotion”, “en HTML”): ese.
2. **Hay una referencia medida**: el motor que mejor la reproduce. Si los dos
   pueden, gana el que ya tiene las placas.
3. **No hay indicación**: se decide por lo que muestra el video y se dice antes
   de escribir la primera escena.

| Señal | Motor |
|---|---|
| Placas, títulos, datos, motion graphics, lower thirds | **este** |
| 2.5D por capas, parallax, profundidad por perspectiva | **este** |
| Personaje con poses y continuidad | **este** (hay 3 rigs) o Remotion |
| 3D con cámara, luces, materiales, geometría | `video-studio` + `@remotion/three` |
| El usuario pidió React | `video-studio` (Remotion) |

Regla práctica: si el movimiento se explica con **capas que se mueven**, este
motor alcanza. Si se explica con **una cámara que orbita un objeto**, es 3D. Si
el usuario pidió el otro, manda el pedido.

No mezcles los dos motores en la misma pieza: el resultado se ve sucio. Se
puede usar HyperFrames como placa y montarla en el proyecto de Remotion, pero
se renderiza aparte y entra como clip.

## Contrato (lo que el render verifica)

1. Raíz: `<div id="root" data-composition-id="main" data-start="0"
   data-duration="6" data-width="1080" data-height="1920">`.
2. Todo lo temporizado lleva `class="clip"`, `data-start` y `data-duration` en
   segundos; se ve en `[start, start+duration)`.
3. Una sola línea GSAP pausada por composición, registrada al final:
   `window.__timelines["main"] = tl;` (el runtime crea el objeto).
4. Nada de `Date.now()`, `Math.random()` sin semilla, `fetch`, timers ni
   `repeat: -1`: el cuadro es función del tiempo.
5. En un `.clip` no animes `display`, `visibility` ni `autoAlpha`: animá un
   hijo con `opacity`/`transform`.
6. Animá `transform` y `opacity`; no `left`, `top`, `width` ni `height`.
7. Fuentes y medios en `assets/` con ruta relativa, sin `/` inicial.

## Flujo

El recorrido completo —verificar herramientas, crear el video, traer y medir
referencias, escribir `beats.json`, renderizar— está en
`video-studio/SKILL.md`, sección **«Flujo completo»**. Acá va solo lo del motor.

Dos formas de armar el video. **Con bloques** es el camino normal; a mano queda
para cuando la pieza no encaja en ninguna pieza del catálogo.

### Con bloques (recomendado)

```powershell
$hf = ".opencode/skills/video-hyperframes/scripts"

# 1. describir la pieza
#    beats.json: meta + scenes[{start, duration, blocks:[{block, options}]}]

# 2. todo el tramo en un comando (genera, valida, acenta, mezcla, renderiza, QA)
node "$hf/hf_flow.mjs" --dir video-projects/<slug> --style asyncstudio-promo `
  --plan-sfx --emphasize "Twitch,Kick" --audio --workers 4

# --style acepta el nombre de la biblioteca (video-library/styles)
# o una ruta a un style.json. El video no guarda copia: pide el estilo.
# --workers N reparte el render entre N Chromes (ver «Render en paralelo»).

# o paso a paso:
node "$hf/hf_generate.mjs" --beats video-projects/<slug>/beats.json `
  --dir video-projects/<slug> --style video-projects/<slug>/style.json
node "$hf/hf_check.mjs" --dir video-projects/<slug>
node "$hf/hf_render.mjs" --dir video-projects/<slug> --out video-projects/<slug>/renders/final.mp4 --fps 30
node .opencode/skills/video-studio/scripts/render_qa.mjs video-projects/<slug>
```

`hf_flow` se detiene en el primer paso que falla y, si el render no deja un
archivo nuevo, lo trata como error (antes cantaba éxito sin video).

### Render en paralelo

`hf_render` captura cuadro por cuadro con un solo Chrome. Con `--workers N`
reparte los cuadros entre N procesos (cada uno abre su Chrome) y los escribe en
la misma carpeta con el índice global, así la secuencia queda completa sin
renumerar; después codifica una sola vez con ffmpeg, audio incluido.

```powershell
node "$hf/hf_render.mjs" --dir video-projects/<slug> --out renders/final.mp4 --fps 30 --workers 4
```

- Los cuadros salen **idénticos** a los del render secuencial: cada proceso pide
  `__hf.seek(t)` en su propio Chrome y la animación es determinística.
- `--resume` se comporta igual: cada parte saltea los cuadros que ya existen.
- Elegí N según los núcleos libres; cada proceso abre su Chrome (~400 MB). 4 es
  un buen punto de partida; 8 en un equipo de 8 núcleos sin otra carga.
- `--at` (stills) y `--eval` ignoran `--workers`.

### Sin ventana

`hf_render` usa el `chrome-headless-shell` que ya bajó Remotion y, si no lo
encuentra, abre Chrome o Edge con `--headless=new`. En los dos casos **no se ve
ninguna ventana** ni consola: el render corre entero en segundo plano. Con
`--chrome <ruta>` o `HYPERFRAMES_CHROME` se puede forzar otro binario.

El catálogo de piezas y el contrato de `beats.json` están en
`references/bloques.md`: `caption-top`, `lower-third`, `data-bars`, `counter`,
`chat-card`, `app-window`, `alert`, `character`, `cta`, y el set de serie
(`room-desk`, `desk-front`, `character-seated`, `character-stand`,
`hud-serie`, `endcard-ab`). El personaje acepta `mouth` para lipsync. Se pueden
combinar varias en una placa (`caption-top` + contenido).

### A mano

```powershell
$hf = ".opencode/skills/video-hyperframes/scripts"

# 1. crear (1080x1920, 6 s por defecto)
node "$hf/hf_init.mjs" --dir video-projects/<slug> --duration 6

# 2. editar index.html (y compositions/*.html si hay escenas)

# 3. revisar el contrato: exit 1 si hay error
node "$hf/hf_check.mjs" --dir video-projects/<slug>

# 4. render
node "$hf/hf_render.mjs" --dir video-projects/<slug> --out video-projects/<slug>/renders/final.mp4 --fps 30

# 5. QA con el mismo medidor del pack
node .opencode/skills/video-studio/scripts/render_qa.mjs video-projects/<slug>
```

Para videos largos (más de ~20 s) conviene `--format jpg --resume`: JPEG tarda
mucho menos que PNG y, si una captura falla, el segundo intento retoma desde el
cuadro siguiente en vez de empezar de cero.

## Revisar sin renderizar los 60 s

```powershell
node "$hf/hf_render.mjs" --dir <carpeta> --out renders/_tmp.mp4 --at "2.2,13.5,29.5,45"
```

Deja `still-<t>.png` en `.hf-stills/`. Es la forma barata de aprobar keyframes:
texto cortado, contraste y superposiciones no los detecta el linter.

`hf_init` copia GSAP 3.14.2 local, Archivo Black e Inter, y los iconos de
plataforma: la composición renderiza **sin red**.

El render deja `.hf-frames/frame_*.png` con `--keep-frames`; mirá el primero,
el del medio y el último con la herramienta `read` antes de dar el video por
bueno. Texto cortado y contraste no los detecta el linter.

## Audio

El renderer acepta **una pista ya mezclada**:

```powershell
node "$hf/hf_render.mjs" --dir <carpeta> --out <mp4> --audio assets/audio/mix.wav
```

> Para proyectos nuevos la mezcla se arma con la skill **`video-audio`**
> (`audio/tracks.json` → `assets/audio/mix.wav`), que no depende del motor.
> `hf_mix_audio.mjs` queda para los proyectos viejos que ya tienen su
> `cue-sheet` con `sfx` y `music`.

La mezcla la arma el motor desde el `cue-sheet.json` del proyecto:

```powershell
node "$hf/hf_mix_audio.mjs" --dir <carpeta> `
  --assets <carpeta-assets> --cue <cue-sheet.json> `
  --out <carpeta>/assets/audio/mix.wav `
  --music "<track>.mp3" --musicDb -25
```

- Toma la voz y los SFX de cada beat, más `audio-cues.json` si existe (acentos
  sueltos, sin tocar el cue-sheet aprobado).
- `--music` repite la pista hasta cubrir el video y la deja 15 dB debajo de la
  voz (por defecto `--musicDb -28`; −25 si la querés más presente).
- Normaliza el conjunto a −16 LUFS y −1,5 dBTP.
- No usa `sidechaincompress`: en el ffmpeg de este equipo se cuelga con pad.
  Una cama 15 dB abajo no necesita ducking para no competir con la voz.

## Foco de cámara

Cada escena puede pedir un zoom hacia un punto:

```json
{ "id": "s3", "start": 4.2, "duration": 3.2,
  "focus": [ { "at": 0.8, "x": 760, "y": 900, "scale": 1.28 },
             { "at": 2.4, "scale": 1 } ] }
```

- `at` es relativo al inicio de la escena; `x`/`y` son píxeles del lienzo.
- El generador envuelve el contenido en `.focus` y anima escala y desplazamiento.
- **Título y HUD quedan fuera**: no se mueven con el zoom.

## Tiempos por palabra

```powershell
node "$hf/hf_words.mjs" --dir <proyecto> --out <proyecto>/words.json --lang es
```

- Transcribe cada línea de voz del `cue-sheet` con whisper.cpp y devuelve
  `words[]` con `start`/`end` **absolutos** dentro del video.
- Usa `-ojf` (JSON completo) y une los tokens en palabras: una comilla de
  apertura también corta palabra.
- Busca `whisper-cli` y `ggml-*.bin` en `C:\tools\whisper\Release\`, después en
  `WHISPER_CLI` / `WHISPER_MODEL` y por último en el PATH.
- **Límite real:** el modelo base confunde nombres propios (“Twitch” →
  “Tistream”). Para acentos sobre marcas, pasá `--emphasize` con la palabra tal
  como la escribió el transcriptor, o usá un modelo más grande.

## Plan de acentos de sonido

```powershell
node "$hf/hf_plan_sfx.mjs" --beats <proyecto>/beats.json `
  --style <proyecto>/style.json --words <proyecto>/words.json `
  --emphasize "Twitch,Kick,Overlay"
```

Decide **dónde** va cada golpe, no cuántos:

- Estructurales: un acento por corte (alterna whoosh/impacto), un riser 1,2 s
  antes del cierre y un impacto en el cierre.
- Sobre palabras: un acento por **franja de tiempo** (el presupuesto sale de la
  densidad del estilo, la mitad de los SFX/min). Puntajes: dato (número) y
  clave (`--emphasize`) 4; mayúsculas y elementos de lista 3; arranque o cierre
  de frase 2. Se evita repetir la misma palabra y caer a menos de 0,28 s de un
  corte.
- Copia los SFX base del pack y escribe `audio-cues.json`, que
  `hf_mix_audio.mjs` ya lee. `--debug` muestra qué candidatos había por franja.

## Transiciones

```json
{ "id": "s2", "start": 3.1, "duration": 2.9, "transition": "wipe" }
```

- Valores: `cut` (por defecto), `fade`, `wipe`, `slide`, `zoom`.
- `transitionDuration` cambia la duración (0,35–0,5 s por defecto).
- La animación va sobre un envoltorio `.scene-in`, **nunca sobre el `.clip`**:
  el runtime maneja la visibilidad del clip y el linter lo marca.
- Es entrada: la escena anterior se va con corte. Un fundido lee como “dip to
  black” y funciona con placas.

## Música con licencia

```powershell
node "$hf/hf_mix_audio.mjs" --dir <proyecto> --music "<pista>.mp3" `
  --musicDb -27 --musicLicense "Mixkit Stock Music Free License" `
  --musicSource "https://mixkit.co/license/"
```

- Escribe `assets/audio/music.json` con `status: declarada` o `sin-verificar`.
- Sin licencia declarada la mezcla sale igual, pero **ese video no se entrega**.
- Catálogo de la biblioteca local y qué está en duda: `references/musica.md`.

## Lipsync

```powershell
node "$hf/hf_lipsync.mjs" --wav <voz.wav> --fps 30 --out <proyecto>/mouth.json
```

Mide el volumen por cuadro y devuelve una lista 0..3: cerrada, media, abierta,
ancha. Después, en el bloque `character`:

```json
{ "block": "character",
  "options": { "poses": "talk:0", "mouth": "@mouth.json", "mouthStart": 0 } }
```

- `@ruta` se lee relativo al `beats.json` y se incrusta en la composición (no
  hay fetch en el render).
- `mouthStart` es el segundo de la escena donde arranca la voz.
- Si `mouth` viene vacío, manda la boca de la pose.

**Límite:** no reconoce fonemas. Abre la boca según el volumen, así que las
vocales no se distinguen. Para eso haría falta un alineador fonético, que no
está en el pack.
## 2.5D: cómo se logra la profundidad

El template trae el patrón: un `.camera` con `perspective: 1200px`, un `.world`
con `transform-style: preserve-3d` y capas con `translateZ` distinto. La cámara
hace un push-in (`z` y `rotateY`) y las capas se desplazan a distinta velocidad:
eso es paralaje por profundidad, no un zoom de imagen.

## Errores ya pagados

| Síntoma | Causa | Arreglo |
|---|---|---|
| `no registró ninguna línea` | el script corre antes de que exista el registro | `window.__timelines = window.__timelines || {}` antes de asignar |
| Todo aparece a la vez | falta `class="clip"` o `data-start` | el runtime solo oculta lo que tiene la clase |
| El cuadro 0 sale sin fuentes | las fuentes cargan después del primer seek | el renderer espera `document.fonts.ready`; si usás otra fuente, `font-display: block` |
| El linter marca la librería | `assets/gsap` vendorizado | el linter ignora `gsap/`, `vendor/`, `lib/` y `*.min.*` |
| Chrome no aparece | no hay Chrome instalado | usa `--chrome <ruta>` o `HYPERFRAMES_CHROME`; el script también busca el `chrome-headless-shell` de Remotion |
| `timeout CDP Page.captureScreenshot` | mucho PNG + CSS caro (`backdrop-filter`, sombras enormes) | sacá `backdrop-filter`, usá `--format jpg --resume`; cada captura se reintenta 3 veces |
| `ENOENT … .hf-frames/frame_00159.jpg` | dos renders del **mismo proyecto** a la vez: comparten `.hf-frames` | uno a la vez; si quedó a medias, borrá `.hf-frames` y reiniciá |

## Licencias

- HyperFrames (heygen-com): Apache-2.0. Acá se reimplementa su contrato, no se
  copia su código.
- GSAP 3.14.2: licencia estándar gratuita de GreenSock (incluye plugins desde
  3.13). Se vendoriza en `assets/gsap/`.
- Archivo Black e Inter: SIL OFL 1.1 (Google Fonts).
