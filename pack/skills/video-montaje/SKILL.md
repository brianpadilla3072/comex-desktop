---
name: video-montaje
description: "Editar material ya existente con ffmpeg: cortar tramos, unir clips con o sin transición, reencuadrar a 9:16/1:1/16:9, reemplazar o sumar audio, y exportar una timeline editable (OTIO, FCPXML, EDL) para DaVinci o Premiere. Usar SIEMPRE que se pida 'cortá este video', 'uní estos clips', 'sacá un tramo', 'reencuadrá a vertical', 'cambiá la música del video', 'abrilo en DaVinci/Premiere', 'exportá la timeline' o 'terminá esta edición a mano'."
---

# Video Montaje

Edición de material existente. A diferencia de `video-studio`, acá no se compone
desde cero: se trabaja sobre un render o un clip que la persona ya tiene.

**Regla de oro:** nunca se sobrescribe el original. Todo sale a un archivo nuevo
y, si es una entrega, a `renders/montaje/`.

## Comandos

```powershell
$M = "$HOME\.config\opencode\skills\video-montaje\scripts"

# cortar
node $M\trim.mjs --in renders\final.mp4 --out renders\montaje\corte.mp4 --start 0:05 --end 0:12

# unir (con o sin transición)
node $M\join.mjs --out renders\montaje\unido.mp4 --in a.mp4 --in b.mp4 --transition fade --duration 0.4

# reencuadrar (crop centrado o con fondo desenfocado)
node $M\reframe.mjs --in renders\final.mp4 --out renders\montaje\cuadrado.mp4 --aspect 1:1
node $M\reframe.mjs --in renders\final.mp4 --out renders\montaje\vertical.mp4 --aspect 9:16 --mode blur

# audio: reemplazar o sumar
node $M\audio.mjs --in renders\final.mp4 --out renders\montaje\v2.mp4 --replace voz.wav --normalize -16
node $M\audio.mjs --in renders\final.mp4 --out renders\montaje\v3.mp4 --mix musica.mp3 --gain -14

# timeline editable
node $M\timeline.mjs --project video-projects\<slug> --format fcpxml
node $M\timeline.mjs --project video-projects\<slug> --format otio
node $M\timeline.mjs --project video-projects\<slug> --format edl
```

## Qué exporta la timeline

| Pista | Contenido |
|---|---|
| V1 | `renders/final.mp4` completo |
| A1 | voz por línea del `cue-sheet` (si los wav existen) |
| A2 | música de `audio/tracks.json` (si existe) |

Así se puede abrir en DaVinci o Premiere, silenciar V1 y rehacer el audio sin
recomponer el video. Si la persona solo tiene el MP4, la timeline igual sirve
como punto de partida.

## Reglas

- **Verificá antes de entregar:** duración, tamaño y que el audio exista
  (`ffprobe`). Un clip sin pista de audio es un error frecuente al reemplazar.
- **No reescales dos veces.** Si hay que reencuadrar, hacelo una sola vez desde
  el render final, no sobre un archivo ya reencuadrado.
- **Cortes con re-encode** (`libx264 crf 18`): buscando calidad y corte exacto.
  Para copias rápidas sin cambios se puede usar `-c copy` a mano, pero no es el
  default porque corta en keyframes.
- **Música con licencia:** si se reemplaza el audio, la nueva pista debe tener
  licencia declarada (`video-audio`).
- **Entrega:** si el destino es una plataforma, usar `video-entrega` después;
  no dupliques los presets acá.

## Cuándo no usarla

- Para hacer un video nuevo desde un guion: `video-studio`.
- Para mezclar voz y música de un proyecto: `video-audio`.
- Para subtitular: `video-subtitulos`.
