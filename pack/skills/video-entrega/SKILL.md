---
name: video-entrega
description: "Preparar la entrega de un video por plataforma: variantes 9:16, 4:5, 1:1 y 16:9, portada por formato, subtítulos al lado y manifiesto con lo que se sube. Usar SIEMPRE que se pida 'prepará la entrega', 'sacá la versión cuadrada', 'adaptalo a feed', 'necesito la portada', 'versión para Reels y para YouTube', 'dejalo listo para subir' o cuando un proyecto de video-studio tenga el render final y falte empaquetarlo."
---

# Video Entrega

Del render final a los archivos que se suben. No compone ni edita: adapta,
portada y ordena.

## Flujo

```powershell
node "$HOME\.config\opencode\skills\video-entrega\scripts\deliver.mjs" `
  --project video-projects/<slug>
```

Salida en `renders/delivery/`:

```
<slug>-reels.mp4         1080×1920
<slug>-feed.mp4          1080×1350
<slug>-square.mp4        1080×1080
<slug>-wide.mp4          1920×1080
<slug>-<preset>-cover.jpg
manifest.json
README.md
```

- La variante con el mismo aspecto que el render se **copia** (sin recodificar).
- Las demás se reencuadran al centro; si el encuadre importa, se ajusta antes con
  `video-montaje/scripts/reframe.mjs --focus` y se vuelve a entregar.
- La portada sale de `qa/still.png`; si no existe, se toma un cuadro a 1,5 s.
- Los `.srt` del proyecto se listan en el manifiesto y se copian al lado.

## Reglas

- **Una sola fuente:** siempre se parte de `renders/final.mp4`.
- **No entregar sin audio:** el manifiesto marca `audio: false` si alguna
  variante quedó muda; el script sale con código 1.
- **Duración:** cada variante debe durar lo mismo que el render (±0,2 s).
- **Loudness:** se informa el del QA (`qa/report.json`). Si falta, correr
  `video-studio/scripts/render_qa.mjs` primero.
- **Nombres:** `<slug>-<preset>`, sin espacios, para que se puedan subir sin
  renombrar.
- **Licencias:** si el video usa música o voces, la entrega no cambia eso; el
  registro va en `inspiracion/fuentes.md` y en `assets/audio/tracks.json`.

## Presets

| Preset | Tamaño | Uso |
|---|---|---|
| `reels`, `tiktok`, `shorts` | 1080×1920 | Vertical |
| `feed` | 1080×1350 | Feed de Instagram |
| `square` | 1080×1080 | Publicaciones cuadradas |
| `wide` | 1920×1080 | Horizontal / web |

Se pueden pedir varios: `--platforms reels,feed,wide`.

## Qué no hace

- No publica: subir a cada red requiere credenciales y aprobación de la persona.
- No subtitula: eso es `video-subtitulos`.
- No cambia el contenido: si hay que recortar o rehacer el audio, va antes con
  `video-montaje` o `video-audio`.
