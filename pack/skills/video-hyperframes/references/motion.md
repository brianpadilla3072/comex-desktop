# Movimiento en 2D y 2.5D

## Reglas que se sienten

- **Entrada con pop, salida con corte.** El texto entra en 0,18–0,30 s con
  `power4.out`; no se va con fade, se va con el corte del clip.
- **Un movimiento por elemento.** Si un título entra con scale, y, rotación y
  blur, se lee como error. Dos propiedades como máximo.
- **El parallax es profundidad, no zoom.** Capas lejanas recorren más distancia
  y más lento en pantalla. Si todas se mueven igual, es una imagen que se
  desplaza.
- **La cámara no tiembla.** Sin shake salvo que el estilo medido lo pida.
- **Stagger corto.** 0,06–0,10 s entre elementos de una misma familia; más que
  eso se lee como lista que carga.
- **Nada de `ease: "none"` en texto.** El lineal se reserva para barras de
  progreso, contadores y parallax.

## Gramática de referencia (la que usa el pack)

Medida sobre las referencias de `comex dylandev/video-projects/prueba-video`:

| Rasgo | Valor |
|---|---|
| Display | Archivo Black, mayúsculas, contorno 10–12 px |
| Acento | una palabra en amarillo `#FCD03D` |
| Caption | arriba, 2–5 palabras, centrado |
| Corte | duro, cada ~2,3 s |
| HUD | chip arriba a la izquierda + barra de progreso abajo |
| Fondo | casi negro con glow de marca, no plano |

La forma se copia; el contenido, el personaje y la paleta de la serie no.

## 2.5D en CSS

```css
.camera { perspective: 1200px; perspective-origin: 50% 46%; }
.world  { transform-style: preserve-3d; }
.layer-a { transform: translateZ(-520px); }
.card-a  { transform: translateZ(20px); }
```

Y en la línea:

```js
tl.fromTo(".world", { rotateY: -3, z: -40 }, { rotateY: 3, z: 70, duration: 6, ease: "none" }, 0);
tl.fromTo(".layer-a", { x: -70 }, { x: 70, duration: 6, ease: "none" }, 0);
```

Buenas prácticas:

- Tres planos alcanzan: fondo (−500 px), medio (−150 px), frente (0–40 px).
- El `blur` alto en las capas de fondo vende la profundidad sin costo.
- `will-change: transform` solo en `.world`, no en cada capa.
- No anides `perspective` en más de un nivel: el texto se deforma.

## Cuándo no usar este motor

- Necesitás geometría real, luces o materiales → three (`video-studio`).
- Necesitás un personaje que cambie de pose con continuidad → `video-studio`.
- Necesitás cámara orbital sobre un producto → plantilla 3D, no CSS.
