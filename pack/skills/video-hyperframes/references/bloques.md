# Bloques y generador

Con `hf_generate.mjs` el video no se escribe a mano: se describe en un
`beats.json` y el motor arma la composición con piezas ya resueltas.

```powershell
node .opencode/skills/video-hyperframes/scripts/hf_generate.mjs `
  --beats video-projects/<slug>/beats.json `
  --dir   video-projects/<slug> `
  --style video-projects/<slug>/style.json
```

- `--style` aporta paleta y tipografía: los bloques usan variables
  (`--primary`, `--accent`, `--paper`, `--yellow`, `--caption-size`), así que un
  `style.json` medido cambia el look sin tocar los bloques.
- `--force` reemplaza un `index.html` existente.
- Después, siempre: `hf_check.mjs` y `hf_render.mjs`.

## Contrato de `beats.json`

```json
{
  "meta": { "duration": 19, "width": 1080, "height": 1920, "fps": 30 },
  "scenes": [
    {
      "id": "s1",
      "start": 0.2,
      "duration": 2.4,
      "blocks": [
        { "block": "caption-top", "options": { "text": "UN MOTOR", "accent": "OCHO PIEZAS" } },
        { "block": "data-bars", "options": { "title": "Por plataforma", "items": [{ "label": "Twitch", "value": 82 }] } }
      ]
    }
  ]
}
```

- `block` acepta un bloque; `blocks` acepta varios en la misma placa (caption +
  contenido es el caso normal).
- Los tiempos son absolutos y no se solapan: el motor no los recalcula.
- Las listas se expanden con `<!-- each:items --> … <!-- /each:items -->` y
  `{{@index}}` da la posición.

## Campos de escena

Además de `blocks`, una escena acepta `focus` (zoom hacia un punto),
`transition` (cut/fade/wipe/slide/zoom) y `sfx` (acentos sueltos). `focus` es
una lista de `{ at, x, y, scale }` con `at` relativo al inicio de la escena.

## Catálogo

| Bloque | Para qué | Campos |
|---|---|---|
| `caption-top` | Título grande arriba con una palabra en acento | `text`, `accent`, `kicker` |
| `lower-third` | Nombre y función abajo a la izquierda | `name`, `role`, `color` |
| `data-bars` | Barras horizontales con etiqueta y valor | `title`, `unit`, `items[{label,value}]` |
| `counter` | Número grande que cuenta | `label`, `value`, `prefix`, `suffix` |
| `chat-card` | Chat con mensajes por plataforma | `title`, `messages[{tag,user,text}]` |
| `app-window` | Ventana de app con filas | `title`, `menu`, `rows[{name,value,state}]` |
| `alert` | Tarjeta de alerta (seguidor, sub, donación) | `kicker`, `name`, `color` |
| `character` | Personaje 2D con rig y poses por ángulos | `poses` |
| `fighter` | Guerrero original con pelo en punta y aura | `poses`, `aura` |
| `cta` | Cierre con chip, texto y subtítulo | `chip`, `text`, `accent`, `sub` |
| `quote` | Cita con comillas grandes, autor y línea de acento | `text`, `author`, `role` |
| `endcard-ab` | Placa final A/B con CTA | `kicker`, `optionA`, `optionB`, `cta` |
| `character-stand` | Personaje de pie, de espaldas, con dos bolsas | `state`: walk/arrive/idle · `dir`: right/left · `walkIn` |
| `hud-serie` | Chip de día, reloj que avanza y barra con porcentaje | `day`, `total`, `tag`, `label`, `fromHour`, `toHour`, `percentFrom`, `percentTo` |
| `character-seated` | Personaje de espaldas sentado al escritorio | `state`: typing/sleep/idle |
| `desk-front` | Frente del set: escritorio, silla y props (tapa al personaje) | — |
| `room-desk` | Fondo del set: pared, piso, ventana y monitor. `time`: night/dawn/day | `time`, `monitor` |

`poses` en `character` es una secuencia `pose:segundo:mood` separada por comas,
por ejemplo `"idle:0,talk:0.7:open,point:2.2:smile"`. Poses: `idle`, `talk`,
`point`, `cheer`, `shrug`; en `fighter`: `power`, `punch`, `guard`, `fly`. Detalle del rig y cómo poner tu propio personaje en
`references/personaje-2d.md`.

`tag` en `chat-card` es `tw`, `kk`, `tt` o `yt`: pinta la barra y el usuario con
el color de la plataforma.

## Cómo agregar un bloque

1. Carpeta `blocks/<id>/` con `block.html`, `block.css`, `block.js` y
   `block.json` (`{ id, description, defaults }`).
2. En el HTML, el contenido va dentro de la sección que envuelve el generador;
   usá `{{campo}}` para los valores y `class="clip"` solo si el bloque necesita
   su propio recorte temporal (normalmente no).
3. En el CSS, posición y estilo propios; animá con `transform`/`opacity`.
4. En el JS, animaciones con `tl.fromTo(...)` y `{{start}}` como tiempo base.
5. Registralo en `blocks/index.json` (o volvé a correr el generador de bloques).

## Límites conocidos

- Un bloque por capa temporal: si dos bloques se pisan en la misma zona, se
  superponen (no hay layout automático).
- El generador no calcula tiempos desde la voz: eso lo hace
  `durations-to-cue.mjs` en `video-studio`; acá los `start`/`duration` llegan
  resueltos.
- El audio no lo arma el generador: usá `hf_mix_audio.mjs` con el `cue-sheet`.
