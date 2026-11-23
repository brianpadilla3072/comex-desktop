# Selector de elementos del navegador integrado

Un botón de puntero en el navegador integrado, estilo Cursor/Windsurf. No tiene
flag: está siempre visible y se usa solo si se quiere.

## Qué hace

1. El botón **Seleccionar elemento de la página** está en la barra del
   navegador, justo después de «Volver a cargar».
2. Al activarlo, al mover el mouse se dibuja un **contorno azul** alrededor del
   elemento bajo el cursor, con una etiqueta con su etiqueta HTML, id o clase.
3. Al hacer clic se captura ese elemento (no se sigue el enlace ni se dispara su
   acción) y se abre un cuadro de comentario junto a él.
4. Escribir un comentario y presionar Enter envía el elemento a la conversación
   como un *chip* de texto en el borrador: URL, texto visible, selector CSS y el
   comentario. Ahí se puede seguir escribiendo o borrar el chip antes de enviar.
5. **Foto opcional del nodo:** el cuadro de comentario tiene un checkbox
   *Adjuntar captura del elemento*, desmarcado por defecto. Solo si la persona
   lo tilda, el host recorta la región exacta del elemento (en coordenadas del
   documento) y la adjunta al borrador como `elemento-<etiqueta>-<fecha>.png`,
   junto al chip de texto. Sin tildar, no se toma ninguna captura.
6. Se pueden seleccionar varios elementos seguidos; el modo sigue activo hasta
   que se vuelve a apretar el botón o se presiona **Esc** (Esc en el cuadro
   cancela solo ese comentario). El modo también se apaga automáticamente
   cuando el agente toma el control de la pestaña.

## Seguridad

- El resaltado, el cuadro de comentario y la captura viven en el **mundo aislado**
  del preload del contenido (`browser-content-preload.cjs`). El JavaScript de la
  página no puede leer el comentario, falsificar una selección ni desactivar el
  modo: el canal IPC solo lo expone el preload, y el host exige que el mensaje
  venga de una pestaña con el selector activo.
- El host recorta los campos (texto 300, selector 600, comentario 2000) y el
  selector se calcula con hasta 8 niveles. No se inyecta código en la página ni
  se guarda preferencia alguna en ella.
- La captura es best-effort y explícita: se toma solo si se tildó el checkbox,
  se valida el rect (coordenadas finitas, ancho y alto positivos, tope de
  8192 px por lado) y se oculta el contorno y el cuadro antes de leer los
  píxeles, para que no aparezcan en la foto. Si `capturePage` falla, el chip de
  texto y el comentario llegan igual al chat.
- Solo una pestaña puede tener el selector activo a la vez.

## Límites

- El resaltado sigue al elemento bajo el cursor. El preload corre en cada frame,
  así que se puede pick dentro de iframes; el límite es lo que el navegador
  expone al mouse sobre ese frame.
- El selector CSS es una pista legible para la conversación, no una garantía de
  que el elemento siga existiendo si la página cambia.
- La captura usa coordenadas del frame principal. Si el elemento está dentro de
  un iframe con desplazamiento propio, el recorte puede no alinearse; en ese
  caso conviene seleccionar el iframe o usar el texto del elemento.
- Verificación hecha: test del flujo (resaltado → clic → comentario → IPC →
  Escape), más el caso con y sin captura; typechecks y chequeo del puente
  Electron. Falta la comprobación visual en la app tras el próximo reinicio.
