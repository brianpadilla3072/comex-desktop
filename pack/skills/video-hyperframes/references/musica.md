# Música: qué se puede usar

La regla es simple: **a un entregable solo entra música cuya licencia esté
declarada**. “No Copyright” en el nombre del archivo no es una licencia.

## Cómo se declara

```powershell
node "$hf/hf_mix_audio.mjs" --dir <proyecto> `
  --music "J:\Masica De Fondo Para Videos\mixkit-driving-ambition-32.mp3" `
  --musicLicense "Mixkit Stock Music Free License" `
  --musicSource "https://mixkit.co/license/"
```

El mezclador escribe `assets/audio/music.json`:

```json
{
  "file": "mixkit-driving-ambition-32.mp3",
  "license": "Mixkit Stock Music Free License",
  "source": "https://mixkit.co/license/",
  "status": "declarada",
  "gainDb": -27,
  "recordedAt": "2026-11-21"
}
```

Sin `--musicLicense` la mezcla sale igual, pero `status` queda en
`sin-verificar` y el script avisa por stderr. **Ese video no se entrega.**

## Catálogo de la biblioteca local (21/11/2026)

Carpeta revisada: `J:\Masica De Fondo Para Videos`.

| Archivo | Estado | Motivo |
|---|---|---|
| `mixkit-*.mp3` (6 pistas) | **Licencia identificada** | Mixkit publica “Stock Music Free License” |
| `C418 - Sweden - Minecraft Volume Alpha.mp3` | **No usar** | Música comercial con derechos |
| `Y2meta.app - COPYRIGHTED, DO NOT USE IT!` | **No usar** | El propio nombre lo declara |
| `Y2meta.app - … (No Copyright)` (5 pistas) | **Sin verificar** | El título no es una licencia ni una fuente |
| `corporacion inspiracion / motivacional`, `drama epico`, `emocional esperanza`, `Faithful Mission` | **Sin verificar** | Origen desconocido |

Los `whoosh` de `J:\Transiciones` también están **sin verificar**: sirven para
probar, no para entregar.

## Mixkit

Verificado el 21/11/2026: `https://mixkit.co/license/` lista **Stock Music →
Free License**. Los términos completos se abren en el modal “View License” de
esa página y no quedaron archivados acá; antes de un uso comercial hay que
leerlos y guardar una captura junto al proyecto. No afirmar “libre para todo”
sin ese paso.

## SFX del pack

Los 5 SFX de `assets/sfx/` (whoosh, impact, pop, riser, glitch) fueron
**generados con ffmpeg**: son propios y no dependen de una licencia externa.

## Antes de publicar

1. Abrí `assets/audio/music.json`.
2. Si `status` no es `declarada`, la música no va.
3. Guardá la fuente y la fecha en el mismo proyecto.
4. Si la pista es de un tercero, no la subas a la biblioteca del estudio:
   enlazala con su licencia.
