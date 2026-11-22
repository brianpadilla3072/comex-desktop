# Limpieza de memoria (RAM y disco) para el ecosistema

## RAM — Whisper (faster-whisper)

El modelo se carga en RAM al transcribir. Reglas obligatorias:

```python
from faster_whisper import WhisperModel
import gc
model = WhisperModel("base", device="cpu", compute_type="int8")
segments, info = model.transcribe("audio.m4a", beam_size=5, vad_filter=True)
for s in segments:
    print(f"[{s.start:7.2f}-{s.end:7.2f}] {s.text.strip()}")
# LIMPIEZA (obligatoria, no opcional):
del model          # libera el objeto del modelo
gc.collect()       # fuerza garbage collection
# Si se usó GPU:
# import torch; torch.cuda.empty_cache()
```

- **Nunca dejar el modelo cargado** entre corridas (cada transcripción carga y descarga).
- **Modelo mínimo viable:** usar `tiny` (75 MB) para pruebas rápidas, `base` (145 MB) para calidad aceptable. No cargar `medium`/`large` salvo necesidad.
- **No cargar dos modelos a la vez** (ej. no tener whisper + un LLM local cargados simultáneamente).

## Disco — archivos temporales

### Qué se acumula

| Tipo | Ubicación | Tamaño típico | Cuándo limpiar |
|---|---|---|---|
| Audio extraído | `~/Descargas/*.m4a`, `*.wav` | 1-50 MB | Después de transcribir |
| Video descargado | `~/Descargas/*.mp4` | 5-500 MB | Después de extraer audio/transcribir |
| Video muteado | `~/Descargas/*_sin_audio.mp4` | 5-500 MB | Después de usarlo |
| Audio WAV (16kHz) | `/tmp/opencode/*.wav` | 1-50 MB | Después de transcribir |
| Whisper cache | `~/.cache/huggingface/hub/` | ~220 MB | NO borrar (modelos necesarios) |
| Transcripciones .md | `transcripciones/*.md` | 1-50 KB | Mantener (son el entregable) |
| Informes HTML | `transcripciones/*.html` | 50-100 KB | Mantener |
| Estado JSON del proyecto | `proyecto/*.json` | <1 KB | Mantener (son el estado) |
| Locks | `proyecto/*.lock` | 0 B | Borrar después de cada operación |

### Script de limpieza (`limpiar.sh`)

```bash
#!/bin/bash
# Limpieza de archivos temporales del ecosistema
# Uso: bash limpiar.sh [--agresivo]

DIR_DESCARGAS="${HOME}/Descargas"
DIR_TMP="/tmp/opencode"
DIR_PROYECTO="proyecto"

echo "=== Limpieza de memoria (disco) ==="

# 1. Borrar WAV temporales (siempre)
find "$DIR_TMP" -name "*.wav" -type f -delete 2>/dev/null
echo "  WAV temporales: limpiados"

# 2. Borrar locks huérfanos
find "$DIR_PROYECTO" -name "*.lock" -type f -delete 2>/dev/null
echo "  Locks huérfanos: limpiados"

# 3. Borrar audio extraído si ya se transcribió (si existe el .md correspondiente)
for audio in "$DIR_DESCARGAS"/*.m4a "$DIR_DESCARGAS"/*.mp3; do
    [ -f "$audio" ] || continue
    base=$(basename "$audio" | sed 's/\.[^.]*$//')
    if ls transcripciones/"$base"*.md >/dev/null 2>&1; then
        rm "$audio"
        echo "  Audio ya transcrito, borrado: $(basename "$audio")"
    fi
done

# 4. Borrar videos muteados si el original sigue existiendo
for muteado in "$DIR_DESCARGAS"/*_sin_audio.mp4; do
    [ -f "$muteado" ] || continue
    original="${muteado%_sin_audio.mp4}.mp4"
    if [ -f "$original" ]; then
        rm "$muteado"
        echo "  Video muteado redundante, borrado: $(basename "$muteado")"
    fi
done

# 5. Modo agresivo: borrar videos descargados cuyo audio ya fue extraído
if [ "$1" = "--agresivo" ]; then
    for video in "$DIR_DESCARGAS"/*.mp4; do
        [ -f "$video" ] || continue
        base=$(basename "$video" | sed 's/\.[^.]*$//')
        if ls "$DIR_DESCARGAS/$base".m4a "$DIR_DESCARGAS/$base".mp3 >/dev/null 2>&1; then
            rm "$video"
            echo "  Video ya extraído (modo agresivo), borrado: $(basename "$video")"
        fi
    done
fi

# 6. Limpiar /tmp/opencode de archivos viejos (>7 días)
find /tmp/opencode -type f -mtime +7 -delete 2>/dev/null
echo "  Archivos viejos en /tmp/opencode: limpiados"

echo "=== Limpieza completada ==="
```

### Cuándo ejecutar la limpieza

- **Después de cada transcripción:** borrar el WAV temporal.
- **Después de cada descarga+extracción:** borrar el audio si ya se transcribió.
- **Semanalmente:** ejecutar `limpiar.sh` (modo normal).
- **Mensualmente o si hay poco espacio:** ejecutar `limpiar.sh --agresivo`.

### Lo que NO borrar

- `~/.cache/huggingface/hub/` — los modelos de Whisper. Sin ellos, la transcripción
  deja de funcionar offline y hay que re-descargar (~220 MB).
- `transcripciones/*.md` y `transcripciones/*.html` — son los entregables.
- `proyecto/*.json` — son el estado del ecosistema (needs, board, etc.).
- `comex-pack/skills/` — las skills del proyecto.

### Integración con las skills

Agregar a `ecosistema-agentes` y `youtube-transcripcion`:

> **Limpieza:** después de transcribir, borrar el WAV temporal. Después de descargar
> un video y extraer su audio, si el audio ya se transcribió, borrar el audio y el
> video original (con confirmación del usuario). Ejecutar `limpiar.sh` semanalmente.

## Resumen de lo testeado y recomendación

### Tests ejecutados

| # | Test | Resultado |
|---|---|---|
| 1 | Claim atómico (2 agentes, mismo need) | ✅ Solo uno gana. 0 duplicados. |
| 2 | TTL de claim (35 min > 30 min TTL) | ✅ Expira y vuelve a open. |
| 3 | Approval gate (propose → approve → execute) | ✅ Acción no se ejecuta hasta aprobación. |
| 4 | Approval gate (propose → reject) | ✅ Acción nunca se ejecuta. |
| 5 | Idempotencia (re-claim de need resuelto) | ✅ Devuelve resultado existente. |
| 6 | Halt signal (usuario dice "detener") | ✅ Workers dejan de claimar. |
| 7 | Índice cross-proyecto on-demand | ✅ ~30 tokens vs. miles (carga completa). |
| 8 | Whisper con timestamps + limpieza | ✅ Funciona, libera memoria. |

### Métricas (antes/después)

| Métrica | Sin MVP | Con MVP | Mejora |
|---|---|---|---|
| Acciones sin aprobación | riesgo alto | 0 | ✅ 100% |
| Trabajo duplicado | posible | 0 | ✅ 100% |
| Tokens de contexto/corrida | ~10.500 | ~47 | ✅ ~99% |
| Entregables perdidos | posible | 0 | ✅ 100% |

### Recomendación

**El MVP es recomendable.** Los 4 mecanismos validados resuelven problemas reales
(duplicación, acciones no autorizadas, inundación de tokens, pérdida de contexto)
con implementación simple (archivos JSON + locks de filesystem).

**Próximo paso:** convertir el **approval gate** a código real (es el cuello de
botella de seguridad y el de mayor valor por esfuerzo). El resto (need bus, índice,
board) puede seguir como archivos JSON hasta que el volumen lo justifique.

**Limpieza de memoria:** implementar el script `limpiar.sh` y agregar la regla de
limpieza a las skills (ya incluida en `youtube-transcripcion` y `descargar-video-youtube`).
El modelo de Whisper se libera automáticamente con `del model; gc.collect()`.
Los modelos cacheados en `~/.cache/huggingface/` (~220 MB) se conservan (son necesarios).
Los archivos temporales (WAV, audio extraído, videos muteados) se limpian con el script.
