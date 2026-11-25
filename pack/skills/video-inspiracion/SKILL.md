---
name: video-inspiracion
description: "Analizar videos de referencia para extraer su estilo y su gramática de atención: cortes por minuto, duración de plano, paleta, tipografía, ritmo, SFX, música y pattern interrupts. Usar SIEMPRE que se pida 'analizá estas referencias', 'copiá este estilo', 'por qué engancha este video', 'sacá el estilo de estos videos' o antes de armar un video con video-studio. No copia el contenido: mide la forma."
---

# Video Inspiración

Convierte referencias en un `style.json` medido + `style.md` con el porqué.
El objetivo no es imitar el tema, sino la **gramática**: ritmo, contraste,
movimiento, sonido y cadencia de atención.

## Traer las referencias

Primero se elige un **set de la biblioteca global**:

```powershell
node .opencode/skills/video-studio/scripts/refs.mjs list
node .opencode/skills/video-studio/scripts/refs.mjs use --set comex-serie --project video-projects/mi-video
```

Eso deja los videos enlazados en `inspiracion/refs/` y el `fuentes.md` escrito.
Si ningún set encaja con el pedido, se agregan referencias propias al proyecto:

El analizador lee **archivos**, no links. Van en
`video-projects/<slug>/inspiracion/refs/`, numerados para que el orden sea el
mismo para todos.

**Archivo local:**

```powershell
Copy-Item "D:\refs\video.mp4" "video-projects\mi-video\inspiracion\refs\ref-01.mp4"
```

**Link (YouTube, TikTok, Instagram):** se baja con `yt-dlp` (`descargar-video-youtube`).

```powershell
yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" `
  -o "video-projects\mi-video\inspiracion\refs\ref-01-%(id)s.%(ext)s" "URL"
```

- Un link **no se puede analizar**: hacen falta los cuadros, así que se baja.
- Si el video tiene restricción de edad o región: `--cookies-from-browser firefox`.
- Para audio solo (música o voz de referencia): `yt-dlp -x --audio-format mp3`.
- Los videos descargados **no se versionan** (peso y derechos de terceros).

**Procedencia:** anotá cada link en `inspiracion/fuentes.md` con la plantilla
`templates/fuentes.md`. Ese archivo sí se comitea: permite rehacer el análisis
sin guardar material ajeno.

```powershell
Copy-Item .opencode/skills/video-inspiracion/templates/fuentes.md `
  video-projects/mi-video/inspiracion/fuentes.md
```

## Flujo

1. Poné las referencias en `inspiracion/refs/` del proyecto.
2. Corré el analizador (necesita `ffmpeg`/`ffprobe`):

   ```bash
   python .opencode/skills/video-inspiracion/scripts/analyze_refs.py --project video-projects/<slug>
   ```

3. Leé `inspiracion/metrics.json` y mirá los frames de `inspiracion/frames/`
   con visión (la herramienta `read`).
4. Escribí `style.json` con el esquema de `video-studio/templates/style.schema.json`.
5. Escribí `style.md` explicando qué se copia y qué no.
6. Validá el proyecto con `video-studio/scripts/validate-project.mjs`.

## Con varias referencias

Cuando hay 2 o más videos, no los analices de a uno en este hilo: usá el
agente **`analista-de-referencias`**. Mide la carpeta una vez con el script y
lanza un subagente por video con
`video-inspiracion/references/prompt-analisis-referencias.md` (adaptado del
prompt de Blinsky Tech, con la fuente citada). Después consolida el
comparativo y el `style.json` del conjunto.

El prompt exige declarar el método real: si el análisis es detección de cortes
+ keyframes con visión, se escribe así. Un muestreo no se presenta como
“cuadro por cuadro”.

## Qué medir

| Dimensión | Cómo |
|---|---|
| Ritmo | Cortes por minuto, duración media de plano, hook |
| Movimiento | Zoom/push, parallax, shake, transiciones |
| Tipografía | Familia, peso, tamaño relativo, entrada de texto |
| Color | Paleta dominante, contraste, fondos |
| Sonido | BPM, energía, densidad de SFX, voz |
| Atención | Cada cuántos segundos hay un pattern interrupt |

El script mide lo determinístico (duración, fps, cortes, paleta aproximada,
frames). La tipografía, el movimiento y el “porqué” los completa el modelo
mirando los frames.

## Reglas

- **No copiar contenido ni marcas**: se copia la estructura, no el guion ni el logo.
- Una referencia no alcanza para generalizar; usá 2–3 y buscá lo común.
- Si dos referencias se contradicen, elegí una como principal y anotá la tensión
  en `style.md`.
- `style.json` es la fuente de verdad para `video-studio`; si cambia una
  referencia, se regenera y se avisa qué cambió.
- Los cortes se detectan con umbral 0.3; si el video es muy estático, bajalo a
  0.2 y anotalo en `style.md`.

## Entregables

- `inspiracion/metrics.json`: métricas por referencia y agregado.
- `inspiracion/frames/*.png`: keyframes en los cortes.
- `style.json`: tokens que consume Remotion.
- `style.md`: decisiones, qué se copia, qué no y por qué.
