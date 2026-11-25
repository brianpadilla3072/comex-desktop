# Personaje 2D con poses

El problema no es “dibujar un personaje”: es tener **el mismo personaje** en
varias poses, sin generar una imagen por pose y sin que cambie de cara entre
tomas. La solución del pack es un **rig vectorial**: un SVG con partes
articuladas y poses definidas como ángulos.

## Cómo funciona

```
blocks/character/
├── block.html   SVG con grupos con nombre (arm-l, arm-r, head, eyes, mouth)
├── block.css    colores por variables + tamaño
├── block.js     poses por ángulos y tiempos
└── block.json   { poses: "idle:0,talk:1.2:open,point:3.4" }
```

La pose no es una imagen: es un conjunto de rotaciones aplicadas a grupos.

```js
tl.set("#s1 #arm-r", { rotation: -104, transformOrigin: "50% 2%" }, 2.5);
tl.set("#s1 #head", { rotation: -3, transformOrigin: "50% 100%" }, 2.5);
```

- `transformOrigin` en el **hombro** (arriba del brazo) y en el **cuello**
  (abajo de la cabeza), no en el centro.
- Cambiar de pose es un `set` en un tiempo: corte duro, como la animación 2D
  limitada. No hay interpolación, así que no se “deforma”.
- El parpadeo se hace con pares de `set` (0,09 s). Un tween con `repeat` impar
  terminaba con los ojos cerrados.

## Poses disponibles

| Pose | Qué hace | Cuándo |
|---|---|---|
| `idle` | brazos al costado, respiración | base de cualquier placa |
| `talk` | brazos algo abiertos, boca abierta | mientras habla |
| `point` | brazo derecho extendido | señalar algo de la placa |
| `cheer` | los dos brazos arriba | logro, cierre, celebración |
| `shrug` | brazos abiertos, cabeza baja | duda, “no sé” |

`poses` es una secuencia `pose:segundo:mood`, separada por comas. El segundo es
relativo al inicio de la escena.

```
poses: "idle:0,talk:0.7:open,point:2.2:smile"
```

`mood` es `smile`, `open` o `wow`; si se omite, queda la boca anterior.

## Hacer que sea *tu* personaje

El rig es el esqueleto; el dibujo es reemplazable.

1. Dibujá el personaje en Figma, Inkscape o Illustrator en un lienzo de
   **420 × 640**, con las partes separadas: cabeza, pelo, torso, brazo
   izquierdo, brazo derecho, piernas, boca.
2. Exportá a SVG y pegá cada parte en el grupo que le corresponde
   (`#head`, `#arm-l`, `#arm-r`, `#body`).
3. Respetá los orígenes: el brazo empieza en el hombro, la cabeza en el cuello.
4. Si partís de una ilustración rasterizada, `video-assets` la vectoriza:
   `vtracer --input personaje.png --output personaje.svg --preset poster`.

Con eso, el mismo `block.js` mueve tu personaje sin tocar una línea de código.

## Re-skinear sin dibujar

Todo el color sale de variables CSS:

```css
.blk-char {
  --skin: #f2c6a0;
  --hoodie: var(--primary);
  --hair: #241a2e;
  --pants: #1b1b2a;
}
```

Cambiando esas cuatro, el personaje pasa de un streamer a otro sin cambiar la
forma. Se puede sobrescribir por escena con `style="--hoodie: #e63249"` en el
bloque.

## Límites

- **No hay interpolación de poses.** Es corte, no animación fluida. Para un
  plano con movimiento continuo hace falta un rig con huesos (Spine, Rive) o 3D.
- **Una sola vista (frontal).** Perfil y espalda requieren un segundo set de
  partes.
- **Manos y dedos son una esfera.** Para gestos finos hay que modelar la mano.
- **El dibujo base es simple.** El rig está probado; la calidad visual depende
  del SVG que se ponga adentro.

## Personajes con derechos

El rig sirve para **personajes propios**. Un personaje de una serie, juego o
película (Goku, Mario, un mascota de marca ajena) no se replica: su diseño está
protegido y el pack tiene la regla de no copiar personajes de las referencias.

Lo que sí se puede tomar es la **gramática**: pelo en punta, aura, ropa de
combate, posturas. Eso es lo que hace locks/fighter: un guerrero original con
esa estética, no un personaje existente.

Si el personaje es de la persona o de su marca, alcanza con reemplazar el SVG
como se explica arriba.
## Lipsync

El personaje puede mover la boca con la voz, sin IA:

```powershell
node ..\scripts\hf_lipsync.mjs --wav voz.wav --fps 30 --out mouth.json
```

Devuelve `{ fps, frames: [0|1|2|3] }`: cerrada, media, abierta, ancha. Se calcula
el RMS por cuadro, se normaliza contra el percentil 95 y se aplica una mediana
móvil para que el ruido no haga parpadear la boca.

En el beats:

```json
{ "block": "character", "options": { "poses": "talk:0", "mouth": "@mouth.json" } }
```

`mouthStart` corre el inicio si la voz no arranca con la escena.

**Qué no hace:** no distingue vocales ni consonantes. Es amplitud, no fonética.
Para sincronía exacta de fonemas hace falta un alineador (Montreal Forced
Aligner, WhisperX); no está instalado ni es parte del pack.