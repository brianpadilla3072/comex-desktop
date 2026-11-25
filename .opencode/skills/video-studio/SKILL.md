---
name: video-studio
description: "Dirigir un video con IA de punta a punta: brief, referencias de estilo, storyboard con timecodes, voz clonada, assets 2D/3D, música y SFX, composición y render con QA. Usar SIEMPRE que se pida 'hacé un video', 'armá un clip', 'video para redes', 'explicá esto en video', 'video con mi voz', 'video con estas referencias' o 'video de 30/60 segundos', y también para cambios puntuales sobre un video ya hecho ('sacá el contador', 'cambiá esta frase', 'usá otra foto') sin rehacer el resto. No usar para capturas o guías paso a paso (eso es captura-y-documenta)."
---

# Video Studio

Orquesta un video corto (10–90 s) con un contrato de carpetas y gates
verificables. La dirección la hace el agente; el render lo hace código
determinístico. Nunca se renderiza “a ver qué sale”.

## Contrato de carpetas

```
video-projects/<slug>/
├── brief.md
├── storyboard.md
├── style.json              # lo produce video-inspiracion
├── cue-sheet.json          # tiempo, capa, asset, ganancia
├── inspiracion/
│   ├── refs/               # videos de referencia
│   ├── frames/             # keyframes extraídos
│   └── metrics.json
├── assets/
│   ├── 2d/  3d/  audio/  fonts/
│   └── manifest.json       # origen, licencia, hash
├── remotion/               # proyecto React/TS
├── renders/
└── qa/
```

Crear con:

```bash
node .opencode/skills/video-studio/scripts/init-project.mjs <slug>
node .opencode/skills/video-studio/scripts/validate-project.mjs video-projects/<slug>
```

## Verificación de herramientas

```bash
node .opencode/skills/video-studio/scripts/check_env.mjs
```

`coreReady` cubre ffmpeg/ffprobe/node/npm; `fullReady` agrega whisper, rembg,
vtracer, resvg y Kokoro. Si falta algo, decilo y seguí con lo que sí está:
`references/tools.md` tiene instalación, comandos, licencias y problemas típicos.

## Pipeline y gates

| # | Paso | Gate para avanzar |
|---|---|---|
| 1 | Brief | `brief.md` con objetivo, audiencia, duración, formato, CTA |
| 2 | Referencias | `style.json` válido + `style.md` con el porqué |
| 3 | Storyboard | Cada beat con tiempo, voz, SFX, movimiento y texto |
| 4 | Voz | WAV por línea + `durations.json`; loudness normalizado |
| 5 | Densidad | `word-budget.mjs --check` da ≥ 0,85 de habla (o se justifica por qué no) |
| 6 | Timing | `cue-sheet.json` con duraciones reales, no estimadas |
| 7 | Subtítulos | `.srt` con timecodes crecientes; 3 momentos revisados |
| 8 | Assets | `manifest.json` con licencia y archivo existente |
| 9 | Stills | Keyframes aprobados contra `style.json` |
| 10 | Render | `renders/final.mp4` |
| 11 | QA | `qa/report.md` con métricas y correcciones |

Si falta un gate, **parás y lo decís**. No completás con placeholders.

## Cambios sobre un video existente

Un pedido sobre un video que ya está hecho **no se rehace desde cero**. El
proyecto guarda todo lo que costó tiempo; un cambio chico toca una parte y
reutiliza el resto.

Antes de tocar nada, leé `project.json`, `cue-sheet.json`, `beats.json` y
`assets/manifest.json`: ahí está el orden de las placas, el texto de cada una y
qué imágenes y audios ya existen.

**Se reutiliza siempre** (no se regenera ni se vuelve a pedir):

| Pieza | Dónde vive |
|---|---|
| Voz por línea | `assets/audio/voice/` + `durations.json` |
| Mezcla ya armada | `assets/audio/mix.wav` |
| Fotos recortadas | `assets/2d/*.png` |
| Música y SFX | `assets/audio/music/`, `assets/audio/sfx/` |
| Estilo y guion | `style.json`, `cue-sheet.json` |
| Fuentes y licencias | `inspiracion/fuentes.md`, `assets/manifest.json` |

**Qué toca cada tipo de cambio:**

| Pedido | Editás | Re-renderizás | No repetís |
|---|---|---|---|
| Sacar o mover un elemento de una placa | La composición (`index.html` en HyperFrames, `remotion/` en Remotion) | El video completo | Nada de insumos |
| Cambiar el texto de una línea | `storyboard.md` → voz de esa línea → `durations-to-cue` | El video completo | Las demás líneas de voz |
| Cambiar una foto | Su archivo en `assets/2d/` | El video completo | Los recortes de las demás |
| Cambiar el orden de las placas | `cue-sheet.json` + composición | El video completo | Voz y assets |
| Cambiar sólo lo visual | `style.json` + composición | El video completo | Guion, voz y fuentes |

**El render completo sí se repite**: un MP4 es un archivo entero y no se parchea
un segundo. Lo que no se repite son los insumos, la investigación ni las
licencias.

**Reglas duras:**

1. No vuelvas a pedir el brief ni el enfoque: ya están en `brief.md` y `style.md`.
2. No regeneres una voz que ya existe; si el texto no cambió, el WAV sirve.
3. Revisá el momento cambiado antes del render completo, con
   `hf_render.mjs --at "<segundos>"` (saca stills de esos instantes).
4. Corré sólo los QA que el cambio puede romper: si el audio no cambió, no
   rehagas el `asr-report`.
5. Si el cambio altera la duración, actualizá `cue-sheet.json` con
   `durations-to-cue` antes de renderizar y avisá que se movió el timing.
6. Si el pedido es ambiguo, preguntá **una** cosa concreta, nunca el brief entero.

```bash
# 1. ver el instante que cambió, sin renderizar todo
node "$hf/hf_render.mjs" --dir video-projects/<slug> --out renders/_check.mp4 --at "12.5"

# 2. render final con la mezcla que ya existe
node "$hf/hf_render.mjs" --dir video-projects/<slug> \
  --out video-projects/<slug>/renders/final.mp4 --audio assets/audio/mix.wav --fps 30

# 3. sólo el QA afectado
node .opencode/skills/video-studio/scripts/render_qa.mjs video-projects/<slug>
```

## Del storyboard a los tiempos

```bash
node .opencode/skills/video-studio/scripts/storyboard-to-lines.mjs video-projects/<slug>
# generar la voz con el lines.json resultante (voz-local)
node .opencode/skills/video-studio/scripts/durations-to-cue.mjs video-projects/<slug> --gap 0.4
```

`storyboard-to-lines` parsea la tabla de `storyboard.md` y escribe
`storyboard.json` + `assets/audio/lines.json`. `durations-to-cue` rearma los
tiempos de `cue-sheet.json` con la duración real de cada línea + `--gap`
segundos. Si cambia el texto de una línea, se regenera la voz y se vuelve a
correr el segundo comando.

## Densidad de habla: el error que se siente como lentitud

Un guion corto para la duración pedida no se arregla con más silencio: se
siente lento aunque los cortes estén bien. La referencia principal habla el
96 % del tiempo; un video con 70 % de habla queda hueco, y sin música se nota
mucho más.

Después de generar la voz, medí la densidad real:

```bash
node .opencode/skills/video-studio/scripts/word-budget.mjs video-projects/<slug> \
  --target 30 --gap 0.4 --preRoll 0.5 --endHold 1.2 --check
```

Devuelve la velocidad medida del motor (no la teórica), cuántas palabras
entran en el target y cuántas faltan. Sale con 1 si está por debajo de 0,85.
La corrección es **agregar frases al guion**, no estirar los gaps: el aire
entre líneas se lee como pausa dramática solo si es corto (0,3-0,5 s).

Ojo con la velocidad del motor: Chatterbox con una voz clonada mide ~142
palabras/min de habla real. El número "126 wpm" sale de incluir la cola de
silencio que agrega el TTS; siempre se calcula sobre el WAV ya recortado.

## Subtítulos

Desde el audio o el video final, con whisper.cpp:

```powershell
ffmpeg -i entrada.mp4 -vn -ac 1 -ar 16000 audio.wav
whisper-cli -m ggml-medium.bin -l es -osrt -f audio.wav
```

El `.srt` va a `assets/` y se monta como capa de Remotion, nunca dentro de una
imagen generada. Verificá que los timecodes crezcan y que no haya líneas vacías;
si la música tapa la voz, separá voz antes de transcribir.

## Assets

```powershell
rembg i -m u2net foto.png recorte.png
vtracer --input recorte.png --output recorte.svg --preset poster
resvg recorte.svg recorte-2x.png -z 2
```

- Usá `-m u2net` en rembg; `bria-rmbg` pide licencia comercial.
- Un personaje recurrente se guarda como capas SVG al mismo lienzo.
- Todo asset entra en `assets/manifest.json` con `origen`, `licencia` y hash.
  Sin licencia, no entra.
- El texto **nunca** va dentro de una imagen generada: es capa de Remotion.
- Si el video es una serie con personaje fijo, leé
  `references/personaje-vectorial.md`: contrato de lienzo único, poses por
  prop y por qué el personaje no cambia de escala entre beats.

## Remotion

El starter lee `../style.json` y `../cue-sheet.json`, arma una composición
`Video` con un `Sequence` por beat y deja los frames para QA. Trae componentes
listos: `Caption`, `LowerThird`, `Fade`, `VoiceTrack` (voz por beat) y
`SfxTrack` (audio por cue). El aspecto y la resolución salen de `style.format`
(si existe), no del cue-sheet.

```bash
node .opencode/skills/video-studio/scripts/scaffold-remotion.mjs video-projects/<slug>
cd video-projects/<slug>/remotion
npm install
npm run still     # still del keyframe para aprobar
npm run render    # renders/final.mp4
```

Para 3D sumá `@remotion/three` + React Three Fiber cuando el brief lo pida; no
lo instales por defecto. **Antes de escribir una escena 3D, verificá el
equipo:**

```bash
node .opencode/skills/video-studio/scripts/check-webgl.mjs video-projects/<slug>
```

Si devuelve `ok: true`, WebGL renderiza en headless y podés usar la cámara real
(la prueba deja un cubo en `remotion/.webgl-check/frame.png` para mirar). Si
falla, seguí con 2.5D en capas SVG y anotá el motivo en `style.md`. Versiones,
estructura, reglas y trampas: `references/three-remotion.md`.

### Voz en el render

`VoiceTrack` reproduce el WAV de cada beat en su timecode.

1. Generá las líneas en `assets/audio/voice/<id>.wav` con `voz-local`.
2. Copiá esos WAV a `remotion/public/audio/`.
3. En `cue-sheet.json`, cada beat usa `voice.audio = "audio/<id>.wav"`
   (relativo a `public/`) y opcionalmente `voice.gainDb`.
4. Recalculá `time`, `duration` y `meta.durationSeconds` con `durations.json`.
5. `npm run render` produce el video con voz y SFX.

`style.options` prende o apaga pistas sin borrar datos: `voice`, `captions`,
`lowerThird` y `sfx` (todas activas por defecto). El panel de video solo expone
esas opciones y el formato; la paleta, el guion y los tiempos los define la
referencia que analiza el agente.

## Cómo se encadena

- Paso 2 → skill `video-inspiracion`.
- Paso 4 → skill `voz-local`.
- Pasos 5–7 → Remotion + assets; al principio viven acá, después se separan.
- Paso 8 → agente `revisor-video`.
- Documentos o planillas del proyecto → `documento-docx` / `planilla-xlsx`.

## Reglas de dirección

- **La referencia manda.** `style.json` define paleta, tipografía, ritmo, SFX y
  transiciones; no inventes un estilo distinto.
- **Atención medida**: cortes por minuto, cada cuánto hay un pattern interrupt,
  densidad de SFX y entrada de texto salen de `style.json`.
- **Una idea por plano.** Si un beat necesita dos acciones, son dos beats.
- **La voz primero**: generá la voz y medí duraciones antes de fijar escenas.
- **Stills antes del render**: `remotion still` de los keyframes; si no se
  entiende el mensaje en una imagen, el video tampoco.
- **Datos y marcas**: nada de cifras sin fuente; logos y fuentes con licencia.

## Audio

- Voz −16 LUFS, música −20 LUFS, true peak −1 dBTP; ducking de música bajo voz.
- SFX en los beats de `cue-sheet.json`; no en cada corte.
- Subtítulos desde la transcripción de la voz generada, con timecodes.
- Si el video lleva música o el audio se siente vacío, leé
  `references/audio-post.md`: cadena de ducking, licencias y por qué no se
  entrega una cama musical que nadie escuchó.

## Privacidad y derechos

- Clonar una voz solo con consentimiento explícito y registrado en
  `voices/<nombre>/consentimiento.md`.
- No imitar voces de terceros ni personas reales sin permiso.
- Todo asset con licencia en `manifest.json`; sin licencia, no entra.
- Los outputs de algunos TTS llevan watermark (Chatterbox: PerTh). No lo ocultes.

## QA del render

```bash
node .opencode/skills/video-studio/scripts/render_qa.mjs video-projects/<slug>
```

Escribe `qa/report.json` y `qa/report.md`; compara duración, fps, loudness,
true peak, cortes/min, SFX/min y hook contra `style.json`. Sale con 1 si falta
el render o la duración no coincide con el plan.

## Licencias y problemas

- Remotion: gratis para individuo o ≤3 empleados; 4+ requiere licencia.
- rembg: `u2net`, no `bria-rmbg`.
- MusicGen: CC-BY-NC; no si el video se vende.
- Piper: GPL-3.0 desde 2025.
- Tabla completa y problemas típicos en `references/tools.md`.

## Entregables

- `renders/final.mp4` (H.264, AAC, 1080p o 9:16 según brief).
- `qa/report.md`: duración, fps, loudness, cortes/min, SFX/min, subtítulos.
- `style.json`, `cue-sheet.json`, `assets/manifest.json`.
- Opcional: `renders/poster.png` y versión vertical.

## Pruebas mínimas

1. "Hacé un video de 20 s explicando el sonido de fin de tarea." → brief,
   storyboard, voz, stills, render y QA.
2. "Copiá el estilo de estas 2 referencias." → `style.json` medido y aplicado.
3. "Este video no engancha." → comparar métricas con `style.json` y proponer
   cambios concretos (cortes, SFX, pattern interrupt), sin rehacer todo.
4. "Hacelo en 30 s con voz" y el guion no llega → `word-budget.mjs --check`
   marca densidad baja y pide más frases, no más silencio.
5. "Quiero que la escena sea 3D de verdad" → `check-webgl.mjs` primero; si
   falla, 2.5D documentado; si pasa, `references/three-remotion.md`.
