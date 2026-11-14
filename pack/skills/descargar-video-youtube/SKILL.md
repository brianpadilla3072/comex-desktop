---
name: descargar-video-youtube
description: "Descargar videos de YouTube (y otros sitios soportados por yt-dlp), extraer el audio a un archivo aparte, y eliminar el audio del video (versión silenciosa/muteada) o limpiar los archivos intermedios. Usar SIEMPRE que se pida 'bajar un video de YouTube', 'descargar el video', 'extraer el audio de un video', 'quitar el sonido', 'mutear un video', 'dejar solo el audio', o cuando se necesite el video o su audio para análisis, transcripción o edición. También soporta Instagram, TikTok y otros sitios que yt-dlp maneja."
---

# Descargar video de YouTube, extraer audio y eliminarlo

Descarga videos de YouTube (y otros sitios soportados por yt-dlp), extrae el audio a
un archivo independiente, y genera una versión del video sin audio (muteada) o limpia
los archivos intermedios. Todo queda en `~/Descargas/` (o en la carpeta indicada).

## Dependencias

- `yt-dlp` (instalado en `~/.local/bin/yt-dlp`).
- `ffmpeg` (instalado en `/usr/bin/ffmpeg`).
- Opcional: `faster-whisper` (si se va a transcribir el audio extraído) — con
  timestamps por segmento `[start-end]` y limpieza de memoria al terminar.

## Flujo estándar

### 1. Descargar el video

```bash
yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" \
  -o "~/Descargas/%(title)s [%(id)s].%(ext)s" "URL"
```

- Si solo se quiere audio: `yt-dlp -x --audio-format mp3 -o "~/Descargas/%(title)s [%(id)s].%(ext)s" "URL"`.
- Si el video tiene restricción de edad o región, agregar `--cookies-from-browser firefox` (o chrome).
- Para Instagram/TikTok/otros: la misma sintaxis funciona (yt-dlp detecta el sitio).

### 2. Extraer el audio (sin re-encodear si es posible)

```bash
ffmpeg -i "video.mp4" -vn -acodec copy "audio.m4a"
```

- `-vn`: sin video.
- `-acodec copy`: copia el stream de audio sin re-encodear (rápido, sin pérdida).
- Si el contenedor no soporta copy (ej. audio en opus dentro de webm), re-encodear:
  `ffmpeg -i "video.mp4" -vn -c:a libmp3lame -q:a 2 "audio.mp3"`.

### 3. Eliminar el audio del video (versión muteada)

```bash
ffmpeg -i "video.mp4" -an -c:v copy "video_sin_audio.mp4"
```

- `-an`: sin audio.
- `-c:v copy`: copia el stream de video sin re-encodear (rápido, sin pérdida).

### 4. Limpiar intermedios (opcional)

Si el usuario pidió "extraer el audio y eliminarlo" (dejar solo el audio), borrar el
video original después de extraer:

```bash
rm "video.mp4"   # solo si el usuario confirmó que ya no lo necesita
```

Si pidió "mutear el video", conservar `video_sin_audio.mp4` y borrar el original
solo a pedido.

## Casos de uso típicos

| Pedido del usuario | Comandos |
|---|---|
| "bajá el video" | solo paso 1 |
| "extraé el audio" | pasos 1 + 2 |
| "mutear el video / quitar el sonido" | pasos 1 + 3 |
| "extraer el audio y eliminarlo" | pasos 1 + 2 + 4 (borrar video) |
| "dejar solo el audio" | `yt-dlp -x --audio-format mp3` (paso 1 variante) |
| "bajar y transcribir" | pasos 1 + 2, luego Whisper |

## Reglas

- **Nunca borrar el original sin confirmación** del usuario si el archivo es el
  único. Siempre preguntar o dejar el original y el muteado lado a lado.
- **Verificar que el archivo resultante existe y tiene tamaño > 0** antes de borrar
  el original.
- **No re-encodear si no es necesario**: preferir `-c:v copy` / `-acodec copy` para
  no perder calidad ni tiempo.
- **Nombrar los archivos con el título + id** para evitar colisiones:
  `%(title)s [%(id)s].%(ext)s`.
- Si el video tiene audio en varios idiomas (doblajes), yt-dlp baja el default;
  para elegir: `yt-dlp -F URL` lista los formatos y luego `-f <format_id>`.

## Transcripción con Whisper (si se pidió "bajar y transcribir")

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

## Salida esperada

Al terminar, reportar:
- Path del video descargado (y su tamaño).
- Path del audio extraído (si aplica) y su duración.
- Path del video muteado (si aplica).
- Si se borró algún archivo intermedio, indicarlo.
- Si se va a transcribir, indicar el path del audio para Whisper.

## Integración con otras skills

- `youtube-transcripcion`: si después de bajar el video se necesita la transcripción,
  usar el audio extraído con Whisper (con timestamps por segmento y limpieza de
  memoria al terminar).
- `fact-check-html`: el video muteado o el audio sirven como evidencia para citar
  minutos exactos.