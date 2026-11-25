---
name: video-inspiracion
description: "Analizar videos de referencia para extraer su estilo y su gramática de atención: cortes por minuto, duración de plano, paleta, tipografía, ritmo, SFX, música y pattern interrupts. Usar SIEMPRE que se pida 'analizá estas referencias', 'copiá este estilo', 'por qué engancha este video', 'sacá el estilo de estos videos' o antes de armar un video con video-studio. No copia el contenido: mide la forma."
---

# Video Inspiración

Convierte referencias en un `style.json` medido + `style.md` con el porqué.
El objetivo no es imitar el tema, sino la **gramática**: ritmo, contraste,
movimiento, sonido y cadencia de atención.

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
