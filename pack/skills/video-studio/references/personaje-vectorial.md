# Personaje vectorial recurrente

Leé esto cuando el video sea una serie con un personaje fijo (el caso más
común: reel de "DÍA n/N" con un host que reacciona).

## Por qué un contrato de personaje

La referencia se siente serie porque el personaje **no cambia de escala ni de
encuadre** entre beats: lo que cambia es el fondo, el texto y los stickers. Si
cada escena dibuja al personaje distinto, el corte se lee como otro video.

## Contrato (ejemplo probado)

- **Un solo lienzo**: `viewBox="0 0 420 640"`. Todas las poses se dibujan ahí.
  Cambiar de pose no cambia el tamaño en pantalla.
- **Un solo componente**: `Character` recibe una pose por props, no seis
  versiones del archivo.

```ts
type Pose = {
  view?: "front" | "back";
  eyes?: "tired" | "wide" | "closed" | "none";
  arms?: "controller" | "desk" | "bags" | "down" | "none";
  mouth?: "line" | "open" | "smile" | "none";
  headTilt?: number;
  slump?: number;
  cap?: boolean;
  seated?: boolean;
};
```

- **Paleta del `style.json`**, no colores nuevos: piel, ink, papel, acento. El
  personaje tiene que pertenecer a la misma placa.
- **Sentado corta en la cintura.** Cuando el personaje va detrás de un
  escritorio o un sillón, no dibujes piernas: quedan flotando. `seated: true`
  las omite y el asiento/escritorio se dibuja **después** del personaje.
- **El texto no va adentro del SVG del personaje.** Ni un número de camiseta
  con texto editable: si hace falta, es capa aparte.

## Poses mínimas para un reel de 30 s

| Beat | Pose |
|---|---|
| Hook | espaldas, glow del monitor, cap |
| Derrumbado | ojos cerrados, `slump` alto, brazos en la mesa |
| Reacción | ojos abiertos, boca abierta, `headTilt` |
| Acción | brazos con bolsas, piernas (no sentado) |
| Cierre | ojos cerrados, respiración lenta, sillón |

Con esas cinco se cubre el 90 % de los guiones. Cada pose extra se agrega como
valor de prop, no como archivo nuevo.

## Movimiento barato que se nota

- Respiración: `scaleY` de 0,6 % con `sin(frame/fps * 2)`. Es casi invisible y
  hace que el personaje esté vivo.
- Parpadeo: ojos cerrados durante 2 frames cada 3-4 s.
- Inclinación de cabeza con `rotate` sobre el grupo de la cabeza, no del
  cuerpo.
- Nada de shake de cámara si la referencia es placa fija.

## Reutilizar entre proyectos

1. Copiá `Character.tsx` a `assets/2d/character/` del proyecto nuevo.
2. Ajustá la paleta al `style.json` nuevo (no el personaje al revés).
3. Registralo en `assets/manifest.json` como `propio`, con el hash.
4. Si el personaje cambia de identidad (otro pelo, otra ropa), es otro
   personaje: no mezcles poses de dos.

## Lo que no se hace

- Trazar o copiar el personaje de la referencia. Se copia la gramática, no el
  diseño.
- Usar arte generado sin licencia clara o con marca de agua.
- Poner el personaje en un encuadre distinto en cada beat "para variar": eso
  rompe la serie.
