---
name: video-subtitulos
description: "Transcribir audio o video a subtítulos .srt con whisper.cpp y, si hace falta, quemarlos en el video. Usar SIEMPRE que se pida 'subtitulá este video', 'sacá el texto del audio', 'transcribí la entrevista', 'generá los subtítulos', 'quemá los subtítulos' o cuando video-studio necesite el texto hablado para captions o accesibilidad."
---

# Video Subtítulos

Transcripción local con **whisper.cpp**. Nada de nube. El `.srt` se revisa y se
usa como capa de Remotion; quemarlo es solo para la entrega final.

## Requisitos

- `ffmpeg`/`ffprobe`.
- `whisper-cli` (zip `whisper-bin-x64` de whisper.cpp) con sus `.dll`.
- Un modelo `.bin` (`ggml-base.bin`, `ggml-small.bin` o `ggml-medium.bin`) en la
  misma carpeta que el `.exe` o con ruta explícita.

Verificá con `video-studio/scripts/check_env.mjs`.

## Transcribir

```bash
python .opencode/skills/video-subtitulos/scripts/subtitles.py transcribe \
  --input renders/final.mp4 \
  --out assets/final.srt \
  --lang es \
  --model "C:\tools\whisper\ggml-medium.bin"
```

- `--whisper` si `whisper-cli` no está en el PATH.
- `--lang es` (o `en`, `pt`, etc.).
- Extrae audio 16 kHz mono, transcribe y escribe el `.srt`.
- Verifica que los timecodes crezcan y que no haya líneas vacías.

## Quemar subtítulos

```bash
python .opencode/skills/video-subtitulos/scripts/subtitles.py burn \
  --video renders/final.mp4 \
  --srt assets/final.srt \
  --out renders/final-subs.mp4
```

- Re-encodea video (H.264) y copia el audio.
- Para un video con estilo propio, preferí montar los captions en Remotion
  (`video-studio`); quemar pierde control de tipografía y animación.

## Reglas

- No inventar texto: si una parte no se entiende, se marca `[ilegible]` o se
  deja fuera; no se completa de memoria.
- Revisar 3 momentos al azar contra el audio.
- Si hay música fuerte, separar voz antes; whisper no adivina.
- Subtítulos sincronizados: si el texto va 0,5 s adelantado, se corrige el `.srt`.

## Encadenamiento

- `video-studio` → captions en Remotion o burn final.
- `documento-docx` → transcripción como anexo.
- `investigacion-con-fuentes` → citar una entrevista con timecodes.

## Problemas típicos

| Síntoma | Causa y salida |
|---|---|
| `whisper-cli` no arranca | Falta el modelo `.bin` o el `.dll` junto al `.exe` |
| Texto cortado | Modelo chico o audio con ruido: probar `ggml-medium.bin` |
| `.srt` vacío | Audio silencioso o formato no soportado: revisar con `ffprobe` |
| Burn falla en Windows | El script usa ruta relativa al `.srt`; no cambies el cwd a mano |
