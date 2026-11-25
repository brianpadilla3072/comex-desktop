---
name: video-assets
description: "Preparar assets 2D para un video: recortar el fondo de una foto, vectorizar un PNG a SVG, rasterizar un SVG a PNG 2x y registrar cada archivo con su licencia. Usar SIEMPRE que se pida 'recortá el fondo', 'fondo transparente', 'vectorizá', 'pasá a SVG', 'rasterizá', 'exportá a 2x', 'prepará los assets del video' o cuando video-studio necesite imágenes limpias para la composición."
---

# Video Assets

Assets 2D locales y verificables. Todo queda en `assets/` del proyecto y entra
en `assets/manifest.json` con origen, licencia y hash.

## Requisitos

- `rembg` (con `-m u2net`). Si Chatterbox comparte el Python, instalalo en un
  venv aparte porque sube `numpy`:
  `python -m venv %LOCALAPPDATA%\openwork-tts\rembg-venv` +
  `...\Scripts\python -m pip install "rembg[cpu,cli]"`. Override: `OPENWORK_REMBG`.
- `vtracer`: `pip install vtracer`.
- `resvg`: `cargo install resvg --locked` (queda en `%USERPROFILE%\.cargo\bin`).
  Override: `OPENWORK_RESVG`.
- `npm`/Node no hacen falta para esta skill.

Verificá con `video-studio/scripts/check_env.mjs`; si falta algo, se dice.

## Comandos

```bash
# Fondo transparente (u2net, no bria)
python .opencode/skills/video-assets/scripts/assets.py cutout \
  --in assets/2d/foto.png --out assets/2d/foto-recorte.png

# PNG -> SVG
python .opencode/skills/video-assets/scripts/assets.py vectorize \
  --in assets/2d/foto-recorte.png --out assets/2d/personaje.svg --preset poster

# SVG -> PNG 2x
python .opencode/skills/video-assets/scripts/assets.py rasterize \
  --in assets/2d/personaje.svg --out assets/2d/personaje-2x.png --zoom 2

# Registrar en el manifiesto
python .opencode/skills/video-assets/scripts/assets.py add \
  --project video-projects/<slug> \
  --path assets/2d/personaje.svg \
  --source "propio" --license "MIT"
```

## Reglas

- `rembg` con `-m u2net`; el modelo por defecto (`bria-rmbg`) pide licencia paga.
- Un personaje recurrente se guarda como **capas SVG al mismo lienzo**; no se
  redibuja por episodio.
- Nada entra a la composición sin licencia en el manifiesto.
- `resvg` usa las fuentes instaladas en Windows; no soporta fuentes embebidas.
- El texto **nunca** va dentro de una imagen: es capa de Remotion.

## Encadenamiento

- `video-studio` → consume `assets/manifest.json` y los archivos.
- `planilla-xlsx` / `documento-docx` → si el asset es una tabla o un informe.
- `captura-y-documenta` → capturas de pantalla, no assets de video.

## Problemas típicos

| Síntoma | Causa y salida |
|---|---|
| `rembg` cambia el resultado | Está usando `bria-rmbg`: fijar `-m u2net` |
| `vtracer` no existe | `pip install vtracer` |
| `resvg` no encuentra fuentes | Instalar las fuentes en Windows |
| El SVG pesa demasiado | Bajar `--preset` (poster → bw) o simplificar trazos |
