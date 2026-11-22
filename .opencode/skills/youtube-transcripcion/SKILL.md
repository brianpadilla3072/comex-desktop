---
name: youtube-transcripcion
description: "Descargar la transcripción (subtítulos) de un video de YouTube y guardarla como .md en el proyecto. Prioriza pistas manuales en el idioma del usuario; si no hay, usa pistas auto-generadas; si no hay ninguna, baja el audio y transcribe con Whisper (local). Usar SIEMPRE que se pida 'bajar la transcripción', 'obtener los subtítulos', 'transcribir un video de YouTube', o cuando se necesite el texto hablado de un video para analizarlo (fact-check, resumen, estudio)."
---

# Transcripción de videos de YouTube

Obtiene el texto hablado de un video de YouTube y lo guarda como `.md` en el
proyecto (`transcripciones/<slug>.md`). Nunca resumir de memoria: siempre bajar el
transcript real primero.

## Flujo principal

### 1. Identificar el video

Aceptar cualquier formato de URL:
- `https://youtu.be/<id>`
- `https://www.youtube.com/watch?v=<id>`
- `https://www.youtube.com/shorts/<id>`
- `https://www.youtube.com/live/<id>`
- ID suelto (11 caracteres).

### 2. Intentar subtítulos (gratis, rápido)

Usar el script del pack:

```bash
python3 /home/brian/.config/opencode/skills/youtube-resumen/scripts/yt_transcript.py "URL" --langs es,en --timestamps
```

- `--langs` pone primero el idioma del usuario (español → `es,en`; inglés → `en,es`).
- `--timestamps` agrega `[MM:SS]` — imprescindible para citar minutos en fact-checks.
- `--list` muestra las pistas disponibles si el idioma pedido no existe.
- `--json` da salida estructurada para procesamiento posterior.

El script prueba en orden: pistas manuales primero, luego auto-generadas, y usa
cualquier pista manual como último recurso.

### 3. Si no hay subtítulos → bajar audio y transcribir

Si el script falla con `ERROR transcript` o `Sin transcript para idiomas...`:

1. Probar `--list` y otros códigos de idioma (el video puede estar en alemán,
   portugués, etc.); muchas pistas son *translatable*:
   ```python
   YouTubeTranscriptApi().list(vid).find_transcript(["en"]).translate("es").fetch()
   ```
   (cuidado: el endpoint de traducción es el primero que YouTube limita).
2. Si nada funciona, bajar el audio:
   ```bash
   yt-dlp -x --audio-format m4a -o "/home/brian/Descargas/%(id)s.%(ext)s" "URL"
   ```
3. Transcribir con **faster-whisper** (instalado, con timestamps por segmento):
   ```python
   from faster_whisper import WhisperModel
   import gc
   model = WhisperModel("base", device="cpu", compute_type="int8")
   segments, info = model.transcribe("audio.m4a", beam_size=5, vad_filter=True)
   for s in segments:
       print(f"[{s.start:7.2f}-{s.end:7.2f}] {s.text.strip()}")
   # LIMPIEZA DE MEMORIA (obligatoria):
   del model
   gc.collect()
   ```
   - Modelo: `tiny` (rápido) / `base` (balance) / `small` o `medium` (mejor calidad).
     En GPU: `device="cuda"`.
   - `beam_size=5` mejora precisión; `vad_filter=True` salta silencios.
   - **Siempre liberar la memoria al terminar** (`del model; gc.collect()` y, si se
     usó GPU, `torch.cuda.empty_cache()`). No dejar el modelo cargado entre corridas.
   - Avisar que tarda y es aproximado; la calidad depende del modelo y del audio.

### 4. Guardar como .md

Crear `transcripciones/<slug>.md` con este encabezado:

```markdown
# <Título> — <canal> (<duración>)
URL: https://www.youtube.com/watch?v=<id>
Transcript: <idioma> (<manual|auto>)
Duración: <mm:ss>

[00:00] ...
[00:04] ...
```

- `<slug>`: kebab-case del título, sin acentos, max 60 caracteres.
- Incluir timestamps si se usó `--timestamps`.
- Si se transcribió con Whisper, indicarlo en el encabezado y agregar una nota
  de que es aproximado.

### 5. Verificar calidad

- Leer las primeras 30 líneas del .md y confirmar que el texto tiene sentido.
- Si hay segmentos con `[inaudible]` o texto basura (auto-subs malos), anotarlo
  en el encabezado como "calidad: media/baja".
- Si la transcripción es muy larga (>30 min), verificar que no se cortó.

## Reglas

- **Nunca resumir de memoria**: primero bajar el transcript real.
- **Siempre guardar en `transcripciones/`** con nombre descriptivo.
- **Siempre incluir el minuto** cuando se va a citar en un informe (fact-check).
- **No inventar** texto que no esté en el transcript.
- Si el script falla por `IpBlocked`/`RequestBlocked`: es rate limiting temporal;
  esperar unos minutos o usar `yt-dlp --write-auto-subs --skip-download`.

## Dependencias

- `youtube-transcript-api` y `yt-dlp` (ya instalados con
  `python3 -m pip install --user --break-system-packages youtube-transcript-api yt-dlp`).
- `faster-whisper` (instalado, fallback de audio con timestamps por segmento).
- Limpieza de memoria: tras transcribir, `del model; gc.collect()` (y
  `torch.cuda.empty_cache()` si se usó GPU). No dejar el modelo cargado.

## Output esperado

Al terminar, entregar:
- Path del archivo `.md` guardado.
- Duración y idioma de la pista usada.
- Si fue fallback de audio, indicarlo y la calidad estimada.
- Para fact-checks: recordar que el .md es la base para citar minutos exactos.
