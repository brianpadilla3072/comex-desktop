---
name: video-audio
description: "Mezclar el audio de un video con ffmpeg, sin depender del motor: voz por línea, música con ducking automático, SFX en los cortes y normalización a −16 LUFS. Usar SIEMPRE que haya que 'mezclar la voz con la música', 'bajar la música cuando habla', 'agregar SFX', 'normalizar el audio', 'dejar el audio a −16 LUFS', 'rehacer la mezcla', o cuando un proyecto de video-studio, video-hyperframes o Remotion necesite assets/audio/mix.wav."
---

# Video Audio

Una sola mezcla para cualquier motor. El contrato es `audio/tracks.json`; la
salida es `assets/audio/mix.wav`, que HyperFrames y Remotion consumen igual.

## Flujo

```powershell
# 1. copiar el contrato
Copy-Item "$HOME\.config\opencode\skills\video-audio\templates\tracks.json" `
  video-projects/<slug>/audio/tracks.json

# 2. completar líneas (at = segundo donde arranca cada frase), música y SFX
# 3. mezclar
node "$HOME\.config\opencode\skills\video-audio\scripts\mix.mjs" `
  --project video-projects/<slug> --keep-stems

# 4. verificar
node "$HOME\.config\opencode\skills\video-audio\scripts\check.mjs" `
  --file video-projects/<slug>/assets/audio/mix.wav
```

`--keep-stems` deja `assets/audio/stems/{voice,music,sfx}.wav` para medir o
retocar sin rehacer todo.

## Qué hace

| Paso | Detalle |
|---|---|
| Voz | cada línea se recorta (silencio de entrada y cola) y se ubica en su `at` |
| Música | loop hasta la duración, ganancia propia y **ducking** con `sidechaincompress` contra la voz |
| SFX | cada evento con su retardo y ganancia |
| Mezcla | `amix` sin normalizar + `loudnorm I=-16 TP=-1.5 LRA=11` |

El ducking baja la música ~8:1 mientras hay voz y la devuelve en 400 ms. Si el
video es solo música, se apaga con `music.duck.enabled: false`.

## Reglas

- **Una fuente por sonido.** Voz, música y SFX entran como archivos separados;
  nunca se usa un `mix.wav` ajeno como fuente.
- **Música con licencia declarada** en `music.license` y en `inspiracion/fuentes.md`.
- **Objetivo de loudness:** −16 LUFS para voz; −14 solo si la plataforma lo pide.
  El true peak no supera −1.5 dBFS.
- **Los tiempos de voz son los del `cue-sheet.json`.** Si cambia una línea,
  primero se rearma el cue-sheet (`durations-to-cue.mjs`) y después se mezcla.
- Si falta un archivo, el script falla con la ruta exacta: no mezcla a medias.

## Reporte

`mix.mjs` escribe `qa/audio-report.json` con duración, tamaño, objetivo y
cantidad de fuentes. `check.mjs` devuelve `ok: false` si el LUFS o el peak se
salen del objetivo.

## Relación con las otras skills

- `video-studio`: produce voz y cue-sheet; esta skill arma la mezcla.
- `video-hyperframes` y Remotion: ambos leen `assets/audio/mix.wav`.
- `video-montaje`: puede reemplazar o mezclar audio de un video ya renderizado
  (`audio.mjs`), útil cuando la mezcla original no sirve.
