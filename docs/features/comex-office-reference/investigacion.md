# La suite de oficina de Claude: investigación completa y traducción a Comex

**Qué es este documento.** Un análisis de la suite de productividad que Anthropic mostró
(Docs, Slides, Sheets, Whiteboard, Data y la capa Design) a partir de un video de 21 minutos,
con capturas de cada momento en que se explica una interfaz, y una traducción concreta a las
superficies de Comex.

**Qué no es.** No es una propuesta de copiar Claude. Es un catálogo de decisiones de producto
y de UI que se pueden tomar o descartar, con el costo y el riesgo de cada una.

| | |
|---|---|
| Fuente principal | “Claude lanzó su propio office. ¿Adiós Microsoft?”, EDteam, 21:01 |
| URL | <https://www.youtube.com/watch?v=5w9SS8DMr1Y> |
| Transcripción | [`transcripciones/claude-office-edteam.md`](../../../transcripciones/claude-office-edteam.md) |
| Capturas | `frames/` (23 imágenes, 1920×1080) |
| App analizada | Comex (fork de OpenWork) en `apps/app` |
| Fecha | Noviembre de 2026 |

---

## Índice

1. [Resumen ejecutivo](#1-resumen-ejecutivo)
2. [Metodología](#2-metodología)
3. [El ecosistema que muestra el video](#3-el-ecosistema-que-muestra-el-video)
4. [Anatomía por producto](#4-anatomía-por-producto)
   - [4.1 Docs](#41-docs)
   - [4.2 Slides](#42-slides)
   - [4.3 Sheets](#43-sheets)
   - [4.4 Whiteboard](#44-whiteboard)
   - [4.5 Data](#45-data)
5. [Catorce patrones transversales](#5-catorce-patrones-transversales)
6. [El modelo mental: objeto, superficie, acción](#6-el-modelo-mental-objeto-superficie-acción)
7. [Estado actual de Comex](#7-estado-actual-de-comex)
8. [Análisis de brechas](#8-análisis-de-brechas)
9. [Reglas de traducción a Comex](#9-reglas-de-traducción-a-comex)
10. [Plan por fases](#10-plan-por-fases)
11. [Anti-patrones](#11-anti-patrones)
12. [Métricas de éxito](#12-métricas-de-éxito)
13. [Anexos](#13-anexos)

---

## 1. Resumen ejecutivo

Diez conclusiones que ordenan todo lo demás.

1. **El cambio de fondo no es estético: es de estatus del objeto.** En Claude, un documento,
   una hoja o un tablero no son texto en el chat ni una tarjeta que se expande: son
   **artefactos con shell propio** (header, cuerpo, acciones, barra flotante). El chat queda al
   lado. En Comex, las salidas del mini-Studio viven dentro de un `Dialog` de configuración de
   672 px (`library-dialog.tsx:62`) y se leen en cajas de 320 px
   (`library-dialog.tsx:783`). Ese es el problema más caro de arreglar y el más simple de
   explicar.

2. **El cromo desaparece; las acciones aparecen donde está la selección.** Ni Docs ni Slides
   tienen una cinta fija. Hay un header mínimo, un dock inferior flotante y una barra
   contextual sobre el objeto seleccionado. La toolbar de Sheets **cambia según el estado de la
   celda**: vacía ofrece chips (dropdown, persona, fecha, checkbox); con número ofrece
   decimales, moneda y porcentaje. Una sola barra hace el trabajo de una cinta entera.

3. **La lectura y la conversación conviven, no compiten.** El patrón es split 42/58
   (Docs, Whiteboard) o full-canvas con `Mostrar chat` (Slides, Sheets, Data). El usuario puede
   leer mientras el agente sigue trabajando, y puede volver al chat sin perder el objeto.

4. **La creación es progresiva y visible.** Docs muestra el esqueleto y la primera sección
   mientras Claude todavía busca en la web (`Buscando en la web 34s`). El usuario no espera una
   pantalla en blanco: ve el objeto crecer. Esto conecta con P11 de `DESIGN.md` (continuidad,
   no interludios).

5. **Hay dos vías de edición sobre el mismo objeto:** manipulación directa (escribir, arrastrar
   handles, formatear) y conversación (botón `Chat`, comentario anclado, `Ask Claude`). No hay
   que elegir entre “lo hago yo” y “que lo haga la IA”.

6. **Los datos se presentan con jerarquía editorial, no como una tabla con bordes.** Claude
   Data combina tres piezas en el mismo bloque: grilla de KPIs, párrafo narrativo con las cifras
   en negrita y **nota metodológica al pie** que explica la fórmula. El dashboard de Sheets se
   construye sobre la propia grilla, con líneas ocultas, columna A como margen y tipografía de
   4 niveles.

7. **El foco se gestiona apagando el contexto, no agregando color.** En el scrollytelling, las
   series que no importan pasan a gris (`#525252`) y solo la protagonista conserva color y
   grosor. El patrón `focus + context` es más legible que una leyenda y más barato que un
   filtro.

8. **Lo verificable se muestra en el lugar.** La barra `fx` expone la fórmula real
   (`=SUM(Ventas!$G$2:$G$201)`), el ícono de cilindro abre las fuentes de datos, y el estado
   `Draft` dice quién puede ver el borrador. En Comex ya existe la auditoría de citas: hoy está
   escondida como párrafo al final de una caja; debería ser un chip de estado permanente.

9. **Compartir y exportar son una sola puerta.** Un botón abre un popover con dos pestañas:
   `Compartir | Exportación`. No hay un menú por formato ni acciones dispersas. En Comex no hay
   ninguna exportación de salidas ni de paneles.

10. **La seguridad de edición es un estado, no un modal.** Data usa una segunda barra de
    `Draft` con `Undo`, `Redo`, descartar y `Save`, más historial y fuentes. La edición local no
    pisa lo guardado hasta confirmar.

**La recomendación en una línea:** construir un **visor de artefacto para las salidas del
mini-Studio** (Fase 1) y un **render editorial de paneles** (Fase 2) antes de tocar el split
view o el home. Son los dos cambios con más impacto por línea y menor riesgo.

---

## 2. Metodología

### 2.1 Fuente y muestreo

El video se descargó en 1080p con `yt-dlp` y se extrajeron 29 frames con `ffmpeg` en los
momentos donde la interfaz está en pantalla y se explica una función. La transcripción
automática en español se conserva con timestamps. Los frames no son uniformes: hay capturas de
producto y capturas de cámara del presentador, y varias pantallas se repiten en distintos
estados (por eso sirven para comparar antes/después de una interacción).

### 2.2 Análisis

Cada frame se describió con un modelo de visión, separando cuatro dimensiones:

- **Layout:** zonas, proporciones, qué es fijo y qué flota.
- **Controles:** inventario, posición y estado (activo, hover, deshabilitado).
- **Tipografía y color:** jerarquía, fuentes, tokens observados.
- **Producto:** estados, flujo de uso e idea de producto detrás.

Después se hizo una segunda pasada con otro modelo para confirmar o marcar lo dudoso. Las
especificaciones crudas están en `tmp/ref-claude-office/spec-*.md` (local, no versionado) y este
documento las sintetiza.

### 2.3 Límites, declarados

- La transcripción es automática: hay errores (“Clod” por Claude, “Cloud Docs” por Claude Docs).
  No se usan citas textuales del video como evidencia de producto; se usan las capturas.
- Los valores exactos de color y píxeles son **aproximados**. Se confirmaron las relaciones
  (fondo más oscuro que superficie, superficie más oscura que tarjeta) y los patrones; no los
  hex.
- Algunos detalles de una sola captura (nombres de usuario, cantidad de íconos) pueden estar
  mal contados. Cuando algo no se pudo confirmar, se marca como aproximado en el anexo.
- El video muestra el producto desde la perspectiva de un usuario con cuenta Pro, en escritorio
  y en modo oscuro. No muestra mobile, ni permisos de equipo, ni rendimiento.
- No se probó el producto real de Anthropic: todo lo que se afirma sobre su comportamiento es
  lo que la interfaz **sugiere**, no una verificación funcional.

---

## 3. El ecosistema que muestra el video

El video presenta seis piezas, cinco de producto y una transversal:

| Pieza | Equivalente mental | Qué resuelve | Estado en el video |
|---|---|---|---|
| **Docs** | Word | Documento largo editable, con tablas, enlaces y comentarios | Ya existía; se muestra el ciclo completo |
| **Slides** | PowerPoint | Presentación con diapositivas editables objeto por objeto | Ya existía; se muestra edición contextual |
| **Sheets** | Excel | Grilla con fórmulas reales, formato condicional, dashboard y chips | Lanzamiento |
| **Whiteboard** | Miro / FigJam | Lienzo infinito compartido entre humano y agente | Lanzamiento |
| **Data** | Power BI | Artefacto de datos con narrativa, KPIs y cuatro formatos | Lanzamiento |
| **Design** | Capa de marca | Colores, tipografías, logos y estilos consistentes | Mencionada como capa transversal |

La tesis del video es que la suma de estas piezas convierte a Claude en una suite de
productividad, todavía inferior a Office en profundidad, pero con una ventaja estructural: el
objeto generado nace conectado a la conversación y a la capacidad de investigar.

Para Comex, la lección no es “hacer una suite”. Es que **cada tipo de resultado que el agente
produce merece una superficie propia, adaptada a cómo se lee y se opera ese tipo de resultado**.
Comex ya produce cinco tipos (informe, mapa mental, flashcards, quiz, tabla) y seis bloques de
panel (stat, line, bar, table, markdown, changes). Hoy los trata a todos como texto dentro de
una caja.

---

## 4. Anatomía por producto

### 4.1 Docs

**Capturas:** `frames/docs-editor.jpg`, `docs-editar-con-claude.jpg`,
`docs-formato-tablas.jpg`, `docs-compartir-exportar.jpg`.

#### Layout

- Split horizontal 42 % chat / 58 % documento, separado por una hairline de 1 px.
- **Header del panel** (≈48 px): título con chevron a la izquierda; `Compartir`,
  expandir/contraer y cerrar a la derecha.
- **Lienzo:** columna de lectura centrada, márgenes laterales amplios (60–72 px), scroll
  nativo.
- **Flotantes superiores:** botón circular de índice/esquema arriba a la izquierda; pill
  `Editing v` arriba a la derecha.
- **Dock inferior:** cápsula centrada a ~16 px del borde, sobre el texto.
- **Fade de scroll:** gradiente de ~24 px arriba y abajo para que el texto no corte duro contra
  el header ni contra el dock.

#### Controles

Dock de Docs, de izquierda a derecha: `TT` (estilos de párrafo), tabla, imagen, lista, bloque
desplegable, `...` (más inserciones), comentario y `Chat`.

El detalle importante no es la lista: es que **siete acciones de edición y una de conversación
conviven en una sola cápsula de ~340 px**, sin cinta ni panel lateral de propiedades.

#### Tipografía y color

- Títulos H1/H2 en serif editorial (~30–32 px y ~20–22 px), peso regular/medio, tracking
  compacto.
- Cuerpo en sans (~15–16 px), interlineado ~1.6, con negritas de liderazgo al inicio de cada
  bullet (“**Estado oficial:** …”).
- Chips de metadatos bajo el H1: fecha y autor. Son **estado**, no decoración: dicen cuándo se
  generó y quién lo posee.
- Enlaces en azul sin subrayado; el acento terracota se reserva para la actividad en curso.

#### Estados e interacciones

- **Creación progresiva:** el documento aparece con título, metadatos y primera sección
  mientras el agente sigue buscando. El chat muestra una traza colapsada con temporizador
  (`Usó Claude Docs, buscó en la web y 2 pasos más · 49s`).
- **Edición directa:** cursor I-beam, modo `Editing`, herramientas de Word.
- **Comentarios anclados:** se selecciona un pasaje y se pide un cambio; el documento se
  actualiza sin ensuciar el artefacto con la conversación.
- **Scroll concurrente:** el usuario lee mientras el agente escribe; nadie bloquea a nadie.

#### Flujo

1. Prompt en el chat.
2. Claude crea el artefacto y lo abre al lado con un esqueleto.
3. El usuario lee y hace scroll mientras el agente investiga y completa.
4. Al terminar, el chat da un cierre ejecutivo (qué verificó, qué descartó, cuándo se actualiza
   la fuente) y enlaza al documento.
5. El usuario edita a mano o deja comentarios.
6. `Compartir` → invitar, permisos o exportar a Word/PDF/Markdown/Google Docs/Notion.

#### Idea de producto

**El documento es un ciudadano de primera clase.** El chat es el canal de auditoría editorial;
el documento es el objeto limpio y publicable. La separación estricta entre “artefacto” y
“metaconversación” es lo que evita que el resultado sea un bloque de Markdown con aclaraciones
del modelo adentro.

#### Qué tomar para Comex

- El shell del artefacto y la separación objeto/conversación.
- La columna de lectura sin scroll interno.
- Los chips de estado (fecha, autor/proyecto, auditoría).
- El dock con acciones reales, incluida “pedir cambios”.
- El fade de scroll y el header fijo.

#### Qué no tomar

- El editor de texto rico completo: Comex no edita documentos, edita salidas generadas.
- La tipografía serif como default global (ver §9).
- El modelo de permisos por link: Comex trabaja sobre proyectos locales.

---

### 4.2 Slides

**Capturas:** `frames/slides-editor.jpg`, `slides-propiedades.jpg`, `slides-resultado.jpg`.

#### Layout

- **Modo canvas completo:** el chat se colapsa y el artefacto ocupa el 100 %.
- Header global: título + `Compartir` + `Mostrar chat` (dos flechas convergentes) + cerrar.
- **Filmstrip izquierdo** (~210–220 px): subheader con `+ Add slide` y `View v`; lista vertical
  de miniaturas numeradas, 16:9.
- **Stage central:** fondo oscuro que enmarca una lámina blanca 16:9 centrada.
- **Sub-barra superior derecha:** dos cápsulas: descargar / presentar / tema, y zoom (`40% v`).
- **Dock inferior:** `T`, imagen, tabla, formas, comentario, `Chat`.

#### Estados de selección

- La miniatura activa tiene **anillo azul** y número azul.
- La miniatura en hover muestra un botón `...` en la esquina.
- Al seleccionar un objeto en el lienzo aparece **bounding box con 8 handles** (4 esquinas, 4
  puntos medios) y una **barra contextual flotante** encima: `TT Heading 2 v`, color, `B`
  activo, `I`, `U`, enlace, separador, lista, alineación, comentario y `...`.

#### Idea de producto

**Misma carcasa, distintas primitivas.** El header, el dock y el botón `Chat` son idénticos a
Docs; solo cambian las herramientas de inserción (`T`, formas, tablas, imágenes). Eso reduce el
costo de aprender cada producto y hace que la suite se sienta una sola app.

**Divulgación progresiva real:** no hay panel de propiedades permanente. Las propiedades
aparecen sobre el objeto que el usuario tocó y desaparecen al deseleccionar.

#### Qué tomar para Comex

- El patrón de barra contextual sobre el elemento seleccionado (aplicable a un bloque de panel
  o a una tarjeta de salida).
- El estado de selección claro (anillo, handles cuando aplica).
- La idea de que un mismo shell sirve para tipos distintos.

#### Qué no tomar

- El editor de presentaciones y el modelo de objetos: fuera de alcance.
- El zoom y el presentador: no hay canvas en Comex.

---

### 4.3 Sheets

**Capturas:** `frames/sheets-creacion.jpg`, `sheets-formula.jpg`, `sheets-formato.jpg`,
`sheets-formato-condicional.jpg`, `sheets-dashboard.jpg`.

#### Layout

Cuatro zonas fijas y una capa flotante:

1. **Header** (~44–48 px): título, `Compartir`, `Mostrar chat`, cerrar.
2. **Barra `fx`** (~36–40 px): fórmula de la celda activa; a la derecha zoom e historial.
3. **Grilla:** headers de columna y fila, fila 1 congelada, selección con borde azul de 2 px y
   fill handle.
4. **Barra de pestañas** (~36 px): `+`, lista de hojas, pestañas (`Dashboard`, `Ventas`,
   `Cálculos`).
5. **Dock flotante** centrado sobre la grilla.

#### La barra adaptativa (el hallazgo)

El mismo dock cambia según el estado de la celda:

| Estado de la celda | Controles que muestra |
|---|---|
| Vacía | `B I U`, alineación, color texto/fill, bordes, combinar, gráfico, formato numérico, **dropdown, persona, fecha, checkbox**, `...`, `Chat` |
| Numérica / fórmula | `B I U`, alineación, colores, bordes, combinar, gráfico, `123 ⌄`, reducir/aumentar decimales, `$`, `%`, `...`, `Chat` |
| Moneda | El selector cambia de `123 ⌄` a `$ ⌄`; `B` aparece activo si la celda es bold |

No hay una cinta con 60 botones: hay **una barra que muestra solo lo que aplica**. Es el mejor
ejemplo del video de cómo reducir cromo sin perder potencia.

#### El dashboard sobre la grilla

`sheets-dashboard.jpg` muestra una hoja llamada Dashboard que no parece una hoja:

- Líneas de grilla ocultas.
- Columna A angosta, usada como margen.
- Título de 20–22 px bold y subtítulo de 12–13 px gris.
- Tres KPIs: label chico gris arriba, número grande bold abajo, alineado a la derecha.
- Tablas con bordes solo donde importan, headers en negrita y cifras alineadas a la derecha.
- Todo sigue siendo una grilla: se puede seleccionar una celda, ver su fórmula y cambiarla.

`sheets-formula.jpg` muestra el KPI de ingreso neto seleccionado y la fórmula
`=SUM(Ventas!$G$2:$G$201)`. Es decir: **el dashboard no es una captura, es una hoja viva con
fórmulas cross-sheet**. La arquitectura de tres hojas (datos crudos / cálculos / presentación)
es explícita.

#### Otros detalles

- **Formato condicional** con fondo borgoña y texto pastel en modo oscuro, no rojo saturado.
- **Smart chips** vía `@`: persona, fecha, dropdown.
- **Números tabulares** para que los decimales alineen en vertical.
- **Freeze pane** en la fila de headers.

#### Idea de producto

**Transparencia verificable.** La IA no pega números muertos: escribe fórmulas reales que el
usuario puede auditar con un clic. Y la grilla puede ser un lienzo de diseño sin dejar de ser
una grilla.

#### Qué tomar para Comex

- La barra que cambia según el estado (aplicable a un panel: si el bloque es tabla vs. KPI vs.
  gráfico).
- La jerarquía tipográfica de 4 niveles para KPIs.
- El principio de que un panel es **datos vivos**, no una imagen: Comex ya lo cumple con
  `refetchInterval`, pero no lo comunica.
- La idea de separar datos crudos, cálculos y presentación (aplicable a paneles multi-bloque).

#### Qué no tomar

- La grilla editable y las fórmulas: el motor de Comex no es una hoja de cálculo.
- El formato condicional configurable: si se necesita, se resuelve en el spec del panel, no en
  la UI.

---

### 4.4 Whiteboard

**Capturas:** `frames/wb-canvas.jpg`, `wb-zoom.jpg`, `wb-diagrama.jpg`,
`wb-postits-conectores.jpg`, `wb-lapiz.jpg`, `wb-compartir.jpg`.

#### Layout

- Canvas infinito con grilla ortogonal de 1 px, fondo casi negro.
- Header igual al resto: título, `Compartir`, `Mostrar chat` / maximizar, cerrar.
- **Zoom pill** arriba a la derecha (`27%` a `104%`, valores no redondos = zoom continuo).
- **Dock inferior** con 9 herramientas + `Ask Claude`: selección, mano, texto, sección (`#`),
  post-it, lápiz, formas, emoji, conector.
- **Sub-barras contextuales:** al elegir lápiz aparece una barra con trazo/flecha y 5 colores
  pastel; al seleccionar un post-it aparece una barra de formato (estilo, B, I, link, lista,
  alineación, color, forma, `...`).

#### Interacciones específicas

- **Conectores ortogonales** con codos redondeados y 4 puntos de anclaje por objeto.
- **Secciones/frames** con etiqueta (`Funciones`) que agrupan contenido.
- **Prompt inline** `Describe a change` que aparece encima del dock al pulsar `Ask Claude`, con
  micrófono y enviar. Es el tercer canal: chat lateral, comentario anclado y prompt inline.
- **Conciencia espacial:** el log del agente dice “Mapping free space around the existing…”, es
  decir, lee el canvas antes de dibujar para no pisar lo que hizo el humano.

#### Idea de producto

**Co-creación espacial.** El humano y el agente comparten la misma superficie editable; el
agente no entrega un diagrama inmutable, dibuja en el mismo lienzo donde el humano pega post-its.

#### Qué tomar para Comex

- El patrón de **prompt inline sobre la superficie** (una caja chica “pedir un cambio” sin abrir
  el chat), aplicable a una salida o a un panel.
- La idea de que el agente debe **leer el estado actual antes de escribir** (Comex ya lo hace al
  resolver paneles; se puede hacer explícito en la UI).
- El lenguaje de conectores y secciones, si algún día se agrega un mapa mental interactivo.

#### Qué no tomar

- El canvas infinito completo: es otro producto, no una mejora de Comex.
- La estética hand-drawn: no encaja con la marca ni con el tipo de contenido.

---

### 4.5 Data

**Capturas:** `frames/data-dashboard.jpg`, `data-fuentes-query.jpg`, `data-estilos.jpg`,
`data-scrollytelling.jpg`, `data-scroll-stats.jpg`.

#### Layout y ciclo de vida

- Entrada desde el chat: CSV adjunto + prompt → pasos colapsables → tarjeta de artefacto
  (`Data · Solo tú`).
- **Pantalla completa** con dos barras superiores:
  1. Header: título, `Compartir`, `Mostrar chat`, cerrar.
  2. **Barra de Draft:** estado (“Draft. Only people who can edit can see it until you save”),
     `Undo`, `Redo`, descartar, `Save`; a la derecha, paleta (Design), reloj (historial) y
     cilindro (fuentes de datos).
- **Dock inferior:** cursor de selección, lápiz de edición y un input `Chat`.
- **Panel Design** (~300 px): `Page color`, `Font`, `Corners` (8), `Text size`, y **Format** con
  cuatro tarjetas: `Dashboard`, `Scrollyteller`, `Visual short`, `Visual analysis`.
- Los tokens cosméticos se bloquean mientras hay un draft sin guardar (“Finish with the draft to
  change the style”).

#### Scrollytelling

- Dos columnas: tarjetas narrativas a la izquierda (~35 %), gráfico sticky a la derecha (~65 %).
- Al hacer scroll, el gráfico no se mueve; cambia de estado: las series de contexto pasan a gris
  (`#525252`) y solo la protagonista conserva color, grosor y etiqueta.
- El pie del gráfico cambia con la tarjeta (`Preguntas por año de seis lenguajes` → `El lenguaje
  que más creció`).
- Las cifras dentro del texto van en **blanco negrita** sobre gris: el ojo encuentra el número
  sin leer todo.

#### Bloque de KPIs

- Grilla 3×2 dentro de un contenedor `#1A1A1A`; tarjetas `#111111` con borde `#262626`.
- Etiqueta arriba en gris de 12–13 px; número de 24–26 px en sans con cifras tabulares.
- Unidades en el mismo tamaño (`USD 55.67`, `13.3 %`).
- **Nota metodológica al pie:** “Ingreso neto = precio con descuento menos la comisión de la
  pasarela…”. La fórmula es parte del artefacto, no un tooltip escondido.
- Párrafo narrativo a la izquierda que traduce los tres primeros KPIs a una oración.

#### Idea de producto

**Desacoplar datos de presentación.** El mismo dataset se puede contar como dashboard,
scrollyteller, video corto o análisis visual. Cambiar de formato crea un draft nuevo, no
sobrescribe lo guardado. Y la transparencia metodológica es un requisito de diseño, no un anexo.

#### Qué tomar para Comex

- La jerarquía KPI + narrativa + nota metodológica.
- El concepto de formatos de presentación sobre los mismos datos (Dashboard / Compacto / Tabla).
- La barra de estado de borrador (si Comex agrega edición local de salidas).
- El foco por atenuación (aplicable a gráficos de panel con muchas series).
- El chip/botón de fuentes de datos que abre la procedencia.

#### Qué no tomar

- Los cuatro formatos completos y el editor de estilo: Comex necesita dos o tres layouts, no un
  constructor de revistas.
- El scrollytelling como default: es caro de implementar y de mantener; sirve para narraciones
  largas, no para un panel operativo.

---

## 5. Catorce patrones transversales

Cada patrón tiene: qué es, dónde se ve, qué problema resuelve y cómo se traduce a Comex.

### Patrón 1 · Artefacto con shell propio

- **Qué:** todo resultado generado tiene header, cuerpo y acciones propias; no vive dentro del
  chat ni de un diálogo de ajustes.
- **Evidencia:** Docs, Slides, Sheets, Whiteboard y Data comparten la misma estructura.
- **Problema que resuelve:** el resultado deja de ser un mensaje y pasa a ser un objeto que se
  puede leer, operar, exportar y volver a abrir.
- **Comex:** las salidas del mini-Studio necesitan un `StudioArtifact` con header, cuerpo y dock.

### Patrón 2 · Split ↔ canvas completo

- **Qué:** el objeto puede convivir con el chat (42/58) o quedarse solo (100 %), y el botón
  cambia de significado: `Mostrar chat` cuando está solo, `Maximizar` cuando está acompañado.
- **Evidencia:** Docs/Whiteboard en split; Slides/Sheets/Data en full con `Mostrar chat`.
- **Problema que resuelve:** una sola superficie sirve para leer con contexto y para trabajar
  concentrado sin duplicar rutas.
- **Comex:** el panel lateral ya tiene tabs; la salida puede ser una tab más y alternar split.

### Patrón 3 · Canvas sin cromo + dock flotante

- **Qué:** no hay cinta; hay un dock inferior con 6–10 acciones y nada más.
- **Evidencia:** el mismo dock en Docs, Slides, Sheets, Whiteboard y Data (con variantes).
- **Problema que resuelve:** el contenido ocupa el foco; las acciones están al alcance pero no
  compiten.
- **Comex:** reemplazar la fila de botones `Ver` / `Eliminar` por un dock contextual en el visor.

### Patrón 4 · Barra contextual sobre la selección

- **Qué:** al seleccionar un objeto, aparece una barra flotante encima con sus propiedades.
- **Evidencia:** `slides-propiedades.jpg` (11 controles), `wb-postits-conectores.jpg` (9).
- **Problema que resuelve:** no hay panel de propiedades permanente ni controles deshabilitados.
- **Comex:** al seleccionar un bloque de panel, ofrecer acciones del bloque (ordenar, cambiar
  formato, exportar) en una barra sobre él.

### Patrón 5 · Barra adaptativa por estado

- **Qué:** los controles cambian según el tipo/estado del objeto seleccionado.
- **Evidencia:** Sheets (celda vacía vs. numérica vs. moneda), Slides (texto vs. imagen).
- **Problema que resuelve:** una barra chica hace el trabajo de una cinta grande.
- **Comex:** si el bloque es `stat`, mostrar formato (número/moneda/porcentaje); si es `table`,
  columnas y orden; si es `line`, series y período.

### Patrón 6 · Doble vía: manipulación directa + conversación

- **Qué:** se edita a mano y se le pide al agente, sin cambiar de modo.
- **Evidencia:** `Chat` en todos los docks; comentarios anclados en Docs y Slides; `Ask Claude`
  inline en Whiteboard.
- **Problema que resuelve:** el usuario no tiene que elegir entre control y ayuda.
- **Comex:** el dock del visor debe incluir “Pedir un cambio” que inserte el prompt con el
  contexto de la salida.

### Patrón 7 · Creación progresiva (esqueleto primero)

- **Qué:** el objeto aparece con estructura y primera sección antes de estar completo.
- **Evidencia:** Docs mientras busca; Data con `Paso 2 de 3`.
- **Problema que resuelve:** el usuario ve progreso real y puede empezar a leer; no espera una
  pantalla vacía.
- **Comex:** al generar una salida, abrir el visor con el título y un esqueleto por bloque, y
  llenar a medida que llegan los datos. Requiere que el server emita progreso; si no, al menos
  no bloquear con un spinner de pantalla completa.

### Patrón 8 · Foco por atenuación (focus + context)

- **Qué:** las series que no importan se apagan en gris; la protagonista conserva color.
- **Evidencia:** `data-scrollytelling.jpg`.
- **Problema que resuelve:** se compara sin perder el contexto y sin filtros.
- **Comex:** en paneles con 3+ series, atenuar las no seleccionadas; en tablas, resaltar la
  columna ordenada.

### Patrón 9 · Jerarquía editorial de datos

- **Qué:** KPI grande, etiqueta chica, narrativa al lado, nota metodológica al pie.
- **Evidencia:** `data-scroll-stats.jpg`, `sheets-dashboard.jpg`.
- **Problema que resuelve:** el número que importa se lee de un vistazo y su cálculo es
  verificable.
- **Comex:** el bloque `stat` y la tabla deben dejar de ser tarjetas mudas.

### Patrón 10 · Etiquetado directo, no leyenda

- **Qué:** el nombre de la serie va al final de su línea, en su color.
- **Evidencia:** Data (seis lenguajes).
- **Problema que resuelve:** menos saltos oculares; la leyenda deja de ser un mapa.
- **Comex:** los gráficos de línea/barra de panel pueden etiquetar la última serie en el extremo.

### Patrón 11 · Internos verificables a la vista

- **Qué:** la fórmula, la fuente y el estado se muestran en el lugar, no en un modal.
- **Evidencia:** barra `fx`, cilindro de datos, `Draft`, chips de metadatos.
- **Problema que resuelve:** confianza. El usuario puede auditar sin pedir permiso.
- **Comex:** la auditoría de citas ya existe (`audit.valid/invalid/total`); debe ser un chip
  permanente en el header del visor, no un párrafo al final.

### Patrón 12 · Borrador y versiones

- **Qué:** editar no pisa lo guardado; hay `Undo`, `Redo`, descartar, guardar e historial.
- **Evidencia:** barra de Draft de Data.
- **Problema que resuelve:** libertad para probar sin miedo.
- **Comex:** si se agrega edición local de salidas (título, formato, orden de bloques), el estado
  debe ser explícito y reversible.

### Patrón 13 · Compartir + exportar en una puerta

- **Qué:** un botón, dos pestañas, permisos y formatos en el mismo lugar.
- **Evidencia:** Docs, Whiteboard.
- **Problema que resuelve:** no hay que buscar la función ni duplicar menús.
- **Comex:** un `Compartir` que ofrezca copiar Markdown, exportar `.md`/`.json`/`.csv` y copiar
  un enlace al proyecto.

### Patrón 14 · Chips de estado, no decoración

- **Qué:** fecha, autor, privacidad, tipo y estado de auditoría son chips legibles.
- **Evidencia:** Docs (fecha + autor), Data (`Data · Solo tú`), Sheets (formato de celda).
- **Problema que resuelve:** P1 de `DESIGN.md`: mostrar estado en vez de explicar la interfaz.
- **Comex:** `Informe · Proyecto · hace 2 h · 12/12 citas` reemplaza tres párrafos.

---

## 6. El modelo mental: objeto, superficie, acción

Los catorce patrones se pueden reducir a tres capas. Es la forma más útil de pensar el rediseño.

### Capa 1 · El objeto

Un objeto es lo que el agente produce y el usuario conserva: un informe, un panel, un dataset,
una fuente, un conjunto de flashcards. Tiene identidad (id, tipo, proyecto), estado (borrador,
guardado, auditado) y contenido.

**Regla:** si el objeto se puede nombrar, se puede abrir. Si se puede abrir, tiene shell.

### Capa 2 · La superficie

Es donde el objeto se lee y se opera. Hay tres formas válidas:

| Superficie | Cuándo | Ejemplo en Claude |
|---|---|---|
| Inline en el chat | Vistazo rápido, ≤ 1 scroll, ≤ 2 acciones | Tarjeta de artefacto, preview de CSV |
| Panel lateral | Iteración, comparación, lectura larga | Docs, Whiteboard en split |
| Pantalla completa | Trabajo concentrado, canvas, presentación | Slides, Sheets, Data |

**Regla (S4 de `DESIGN.md`):** un widget inline que necesita scroll interno o más de dos
acciones es un error de superficie. Se escala al panel.

### Capa 3 · La acción

Toda acción pertenece a uno de cuatro lugares:

1. **Header:** global y estable (compartir, exportar, cerrar).
2. **Dock:** las 4–6 acciones frecuentes del objeto.
3. **Barra contextual:** las acciones del elemento seleccionado.
4. **Chat:** pedir un cambio en lenguaje natural.

**Regla:** una acción, un lugar. Si aparece en dos, sobra una.

### La matriz de decisión

| Pregunta | Si la respuesta es sí | Superficie |
|---|---|---|
| ¿Se lee en menos de un scroll? | sí | Inline |
| ¿Necesita comparar o iterar? | sí | Panel lateral |
| ¿Necesita foco total o canvas? | sí | Pantalla completa |
| ¿La acción depende de una selección? | sí | Barra contextual |
| ¿La acción es global al objeto? | sí | Header |

---

## 7. Estado actual de Comex

### 7.1 Arquitectura relevante

- **Shell de sesión:** chat + panel lateral con tabs. Tipos de tab actuales:
  `artifact`, `browser`, `app`, `mcp-app`, `remote-thread`
  (`apps/app/src/react-app/domains/session/panel/panel-tab-store.ts:10`).
- **Panel lateral:** `side-panel.tsx` compone tabs, visor de artefactos, browser, apps y
  threads; tiene estados de vacío, arrastre y presentación.
- **Artefactos:** `artifact-panel.tsx` muestra previews (Markdown, HTML, imagen, PDF, docx) y
  editores (texto, planilla, código) según el target.
- **Especialistas:** `domains/specialists/library-dialog.tsx` (1065 líneas) contiene el home,
  el editor de contexto, agentes/skills, datasets, fuentes, tareas, paneles y salidas.
- **Datos:** el server expone `specialist_outputs`, `specialist_panels`, `specialist_datasets`,
  `specialist_sources` con rutas y tests propios (`apps/server/src/specialists/routes.ts`).
- **Reglas:** `DESIGN.md` (P1–P11, S1–S7, V1–V4, C1–C7) y `.opencode/skills/add-a-feature`.

### 7.2 Inventario de la UI de salidas y paneles

| Superficie | Qué hace hoy | Problema |
|---|---|---|
| Diálogo “Contexto, agentes y skills” | `DialogContent` con `max-h-[90dvh]` y `lg:max-w-2xl` (672 px) | Es un panel de ajustes, no un lugar de lectura |
| Home | Seis secciones apiladas, cada una con “Gestionar” | No hay jerarquía ni estado; todo pesa lo mismo |
| Salidas (`OutputsView`) | Filas con `Ver` / `Eliminar`; el detalle se expande inline | Acciones como texto; el objeto no tiene shell |
| `OutputDetail` | `OutputBody` + auditoría como párrafo | La auditoría es un estado, no un texto |
| `OutputBody` | Markdown en `max-h-80`; tabla en `max-h-64`; JSON crudo como fallback | Scroll dentro de scroll; el contenido nunca respira |
| Flashcards | Tarjetas con blur y toggle | Funciona, pero está comprimido |
| Quiz | Opciones y feedback | Funciona, pero sin progreso ni contexto |
| Paneles (`PanelCanvas`) | Bloques apilados, `stat` en tarjeta `bg-muted/40` con `text-lg`, tabla cruda, SVG de 80 px | No hay jerarquía editorial; los gráficos usan hex hardcodeados (`#2563eb`, `#dc2626`, `#059669`, `#d97706`) |
| Datasets | Lista con preview del último snapshot en `max-h-64` | El dataset no se puede explorar |
| Fuentes | Lista con chunks expandibles | Bien resuelto; es el modelo a seguir |
| Tareas | CRUD con schedule | Fuera del alcance de esta investigación |

### 7.3 Lo que ya está bien (y no hay que romper)

- **Auditoría de citas:** `audit.valid`, `audit.invalid`, `audit.total`; el mensaje de “sin
  anclas” es honesto y visible. Es exactamente el patrón 11, solo que mal ubicado.
- **Paneles que fallan en voz alta:** si no hay datos numéricos, el gráfico lo dice; si el panel
  no resuelve, muestra el error. Coherente con C6.
- **Truncación explícita:** la tabla dice “Mostrando 20 de 200 filas”.
- **Tests de usuario reales:** `specialist-panels-ui.test.tsx`, `specialist-datasets-ui.test.tsx`
  montan la app con fetch mockeado. Cualquier cambio de UI se puede probar igual.
- **Tokens y primitivas:** `@/components/ui` ya tiene Button, Dialog, Popover, Tabs, Badge,
  Skeleton. No hace falta inventar controles.

---

## 8. Análisis de brechas

| # | Dimensión | Claude | Comex hoy | Brecha | Impacto |
|---|---|---|---|---|---|
| 1 | Superficie del resultado | Artefacto con shell | Diálogo de ajustes + caja | Alta | Muy alto |
| 2 | Lectura | Columna sin scroll interno | `max-h-80` con scroll | Alta | Muy alto |
| 3 | Estado del objeto | Chips (fecha, autor, draft, auditoría) | Párrafos y badges sueltos | Media | Alto |
| 4 | Acciones | Dock + header + contextual | Botones de texto en fila | Alta | Alto |
| 5 | Exportar/compartir | Popover único | No existe | Alta | Alto |
| 6 | Datos | KPI + narrativa + nota | Tarjeta chica + tabla cruda | Alta | Alto |
| 7 | Gráficos | Ejes, etiquetas directas, foco | SVG sin ejes, 4 colores hex | Media | Medio |
| 8 | Split con chat | Sí, en todos | No para salidas | Media | Medio |
| 9 | Edición local | Directa + comentarios | Solo pedir al agente | Media | Medio |
| 10 | Progreso de generación | Esqueleto visible | Spinner / skeleton | Media | Medio |
| 11 | Formatos de presentación | 4 layouts | 1 layout fijo | Baja | Bajo |
| 12 | Canvas infinito | Sí | No aplica | — | — |

**Lectura:** las brechas 1–5 son de **superficie y estado**, no de datos. Se pueden cerrar sin
tocar el server. Las brechas 6–7 son de **render**. Las 8–10 son de **arquitectura de shell**.
Las 11–12 son opcionales.

---

## 9. Reglas de traducción a Comex

Estas reglas combinan lo aprendido con `DESIGN.md`. Sirven como criterio de aceptación para
cualquier cambio futuro.

### R1 · Todo objeto generado tiene shell

Título, tipo, proyecto, estado y acciones globales. No se lee dentro de una caja con scroll
interno. Si el contenido excede un viewport, el scroll es del panel.

### R2 · Una sola cosa focal por pantalla

En el visor, el foco es el contenido. En un panel, el foco es el primer KPI. Todo lo demás se
subordina por peso y opacidad, no por tamaño (V1).

### R3 · Tokens, nunca hex

Los gráficos usan variables semánticas (`--chart-1..4` o equivalentes). Los cuatro hex actuales
de `PanelResolutionBlocks` son deuda técnica visible.

### R4 · Números tabulares y una unidad

`font-variant-numeric: tabular-nums` en KPIs y tablas. La unidad va con la cifra, no en el label.
El formato (número/moneda/porcentaje) se decide por el spec del panel, no por el usuario cada
vez.

### R5 · La procedencia se muestra, no se explica

Un chip `12/12 citas` que abre el detalle es mejor que un párrafo que dice “✓ 12/12 citas
resuelven a pasajes reales del proyecto”. El chip es estado; el párrafo es explicación (P1).

### R6 · Nunca abrir sola una superficie

Una salida generada ofrece “Abrir en el panel” en su tarjeta inline; no secuestra el foco ni
abre un panel por su cuenta (S5).

### R7 · Un lugar para compartir y exportar

`Compartir` en el header del visor, con copiar Markdown, exportar `.md`/`.json`/`.csv` según el
tipo, y copiar enlace al proyecto. Sin menús paralelos.

### R8 · El borrador es explícito si hay edición

Si en el futuro se permite editar el título, reordenar bloques o cambiar formato, el estado debe
ser `Borrador` con `Guardar` / `Descartar` y deshacer. Nunca auto-guardar cambios del usuario
sobre el archivo generado sin decirlo.

### R9 · La barra cambia con el contexto

En el visor: si es un informe, acciones de lectura (índice, exportar); si es una tabla, acciones
de tabla (columnas, orden, exportar); si es un quiz, progreso y reinicio. No una barra idéntica
para todos.

### R10 · Nada de canvas infinito ni suite

Comex no compite con Office. Compite por ser el mejor lugar para **leer, verificar y entregar**
lo que un agente de comercio exterior produce.

### R11 · Respetar la tipografía del sistema

`DESIGN.md` V1 fija system stack. Se puede lograr el aire editorial de Claude con tamaño,
tracking y peso, sin importar una serif. Si se quiere una serif para títulos de lectura, debe ser
una excepción documentada y limitada al canvas del visor.

### R12 · La accesibilidad no se negocia

Todo control flotante debe ser alcanzable por teclado, tener nombre accesible, cerrar con `Esc`
y devolver el foco. Los `Popover`/`DropdownMenu` de `@/components/ui` ya resuelven esto (S7). No
se posiciona a mano.

---

## 10. Plan por fases

### Fase 1 · Studio: el visor de salidas

**Objetivo:** que un informe de 20 KB se pueda leer completo, con estado y acciones, sin salir
del flujo.

**Por qué primero:** es el cambio con más impacto por línea, no toca el server y se puede probar
con los tests existentes.

**Alcance**

1. **Componente `StudioArtifact`** (nuevo, en `domains/specialists/` o
   `domains/session/artifacts/`):
   - Props: `output`, `workspace`, `onClose`, `onRequestChange`.
   - Header: título, badge de tipo, chips de estado, `Compartir`, `Exportar`, abrir en panel,
     cerrar.
   - Cuerpo: columna de lectura `max-w-[68ch]`, scroll del contenedor, sin `max-h`.
   - Dock inferior: copiar, exportar, pedir cambio, eliminar (con confirmación).
2. **Render por tipo**, reutilizando `OutputBody`:
   - `report` / `mindmap`: Markdown con jerarquía, sin caja.
   - `flashcards`: tarjetas más grandes, contador y “ver todas”.
   - `quiz`: progreso, una pregunta a la vez o lista, feedback claro.
   - `table`: header sticky, columnas, truncación explícita.
3. **Estado de auditoría como chip** en el header, con detalle en popover.
4. **Exportación client-side:** `.md` para report/mindmap; `.json` para flashcards/quiz/table;
   `.csv` para table. Sin endpoint nuevo.
5. **Abrir desde la lista de salidas** sin diálogo de ajustes: la lista vive en el home, el
   visor es otra superficie.

**Estados a diseñar:** cargando (skeleton con la forma del contenido), vacío, error, sin
auditoría, auditoría con citas rotas, exportando, exportado.

**Aceptación**

- Un informe de 20 KB se lee con un solo scroll del panel.
- El header queda fijo y el dock no tapa texto (fade inferior).
- La auditoría se ve sin abrir nada y el detalle está a un clic.
- Exportar produce un archivo con el contenido completo.
- Funciona con teclado y con lector de pantalla.
- Test de usuario en `apps/app/tests/specialist-outputs-ui.test.tsx` (nuevo o existente).

**Riesgo:** bajo.

### Fase 2 · Paneles como dashboard

**Objetivo:** que un panel se lea como un tablero, no como una lista de tarjetas.

**Alcance**

1. **Bloque `stat` → KPI:** grid de 2–4 columnas, label 12–13 px, valor 24–30 px con
   `tabular-nums`, delta opcional, nota al pie.
2. **Bloque `line`/`bar` → gráfico editorial:** eje Y con 3–5 ticks, labels de X, punto final
   con valor, etiqueta directa por serie, serie de contexto atenuada. Sin caja de leyenda si hay
   una sola serie.
3. **Bloque `markdown` → narrativa:** tamaño de lectura, no `text-xs muted`.
4. **Bloque `table`:** header sticky, alineación por tipo, cifras tabulares, truncación visible.
5. **Selector de formato:** `Dashboard` / `Compacto` / `Tabla`, persistido por panel en
   `localStorage`. No es un editor de diseño: son tres layouts reales.
6. **Tokens de gráfico:** reemplazar hex por `--chart-*`.
7. **Chip de fuente y refresco:** “dataset X · actualizado hace 3 min · se redibuja solo”.

**Aceptación**

- El panel de ejemplo (“Soja — cierre”) se lee en un viewport de panel lateral.
- El formato elegido persiste entre sesiones.
- No queda ningún hex en el archivo.
- Con 3+ series, el foco se puede cambiar sin filtros.
- Tests de paneles existentes siguen pasando; se agrega uno de formato persistido.

**Riesgo:** medio (regresión visual). Mitigación: screenshot antes/después y revisión con
`DESIGN.md`.

### Fase 3 · Split view Studio ↔ chat

**Objetivo:** leer una salida sin perder la conversación.

**Alcance**

1. Nuevo tipo de tab `studio` en `panel-tab-store.ts`:
   `{ kind: "studio", outputId, workspaceId }`.
2. `side-panel.tsx` renderiza `StudioArtifact` como tab.
3. Botón `Mostrar chat` / `Pantalla completa` en el header.
4. La tarjeta inline de una salida ofrece “Abrir en el panel” (nunca automático).
5. Persistencia de tabs y restauración al recargar.

**Aceptación**

- Abrir una salida desde el chat no pierde el hilo ni el scroll.
- Alternar split/canvas mantiene la selección.
- En mobile, el panel se comporta como hoja completa (no split).
- Cerrar la tab vuelve al estado anterior sin perder la conversación.

**Riesgo:** medio-alto (tabs, persistencia, mobile). Va después de 1 y 2.

### Fase 4 · Home como hub

**Objetivo:** que el diálogo de gestión deje de ser una lista de secciones y pase a ser un
tablero de estado.

**Alcance**

1. Tarjetas de estado para Salidas, Paneles, Datos y Fuentes: count, última actualización, una
   acción primaria.
2. Agentes y Skills como filas compactas de 40–48 px (S2), no tarjetas con borde.
3. Propuestas como tarjeta de aprobación con `Aceptar` / `Descartar` y el diff visible (P9).
4. Contexto como fila con estado (“Definido · 1.240 caracteres”) y acción “Editar”.

**Aceptación**

- Se ve el estado de la aplicación en un viewport.
- Cada sección tiene una sola acción primaria.
- Las propuestas se resuelven sin abrir otra pantalla.

**Riesgo:** bajo.

### Orden y dependencias

```
Fase 1 (Studio)  ──►  Fase 3 (split)  ──►  Fase 4 (hub)
       │
       └──►  Fase 2 (paneles)
```

Fase 1 y 2 son independientes entre sí. Fase 3 depende de 1. Fase 4 es cosmética y puede ir en
cualquier momento después de 1.

---

## 11. Anti-patrones

Copiar estas cosas sería un error, aunque estén en el video.

1. **Copiar la paleta oscura cálida.** Comex tiene tokens Radix y `--dls-*`. El modo oscuro de
   Claude es parte de su marca, no de su arquitectura. Lo que se copia es la jerarquía, no el
   hex.

2. **Construir una suite de oficina.** Docs, Slides, Sheets y Whiteboard son productos
   completos. Comex no necesita editar documentos ni presentaciones: necesita presentar y
   entregar resultados.

3. **Copiar el canvas infinito.** Es un producto distinto, con su propio modelo de datos,
   colaboración y persistencia. No es una mejora incremental.

4. **Copiar el panel de Design.** `Page color`, `Font`, `Corners`, `Text size` son libertad
   cosmética que Comex no puede sostener (ni necesita): tres layouts bien elegidos valen más que
   infinitas combinaciones.

5. **Copiar los cuatro formatos de Data.** `Dashboard`, `Scrollyteller`, `Visual short`,
   `Visual analysis` requieren generación distinta por parte del agente. Comex puede empezar con
   `Dashboard` y `Compacto`.

6. **Copiar el editor de texto rico.** Tablas, imágenes, comentarios anclados, control de
   cambios: es un producto en sí mismo. El valor está en leer y verificar, no en maquetar.

7. **Copiar el sistema de permisos por link.** Comex es local y por proyecto. Un `Copiar enlace`
   sin backend de permisos sería una promesa falsa.

8. **Agregar una barra flotante sin acciones reales.** Si el dock tiene botones decorativos o
   deshabilitados, es peor que no tener dock. Cada acción debe funcionar o no estar (P4 aplica a
   permisos, no a placeholders).

9. **Auto-abrir el artefacto.** El video lo hace porque el usuario acaba de pedirlo; en Comex,
   S5 prohíbe robar foco. La tarjeta inline ofrece abrir.

10. **Convertir todo en dashboard.** Un informe no es un dashboard. Un panel no es una
    presentación. El formato se elige por el tipo de contenido, no por moda.

---

## 12. Métricas de éxito

No hay telemetría de producto en el repo, así que las métricas son criterios de revisión y, si
existe instrumentación, señales a observar.

### De experiencia

- **Tiempo hasta leer el primer párrafo** de una salida: debería bajar de “abrir diálogo →
  buscar → expandir” a un clic.
- **Scroll interno:** cero contenedores con scroll dentro de otro en el visor.
- **Acciones por objeto:** 2–5 visibles, todas funcionales.
- **Pasos para exportar:** uno (abrir `Compartir` → elegir formato).

### De calidad

- **Cobertura de estados:** cargando, vacío, error, sin auditoría, auditoría rota, exportando.
- **Tokens:** cero hex en componentes de datos.
- **Accesibilidad:** navegación por teclado en header, dock y popovers; foco devuelto.
- **Tests:** un test de usuario por superficie nueva; los existentes siguen verdes.

### De producto (si se mide)

- Salidas abiertas por sesión.
- Exportaciones por salida.
- Paneles vistos vs. paneles creados.
- Tiempo entre generación y primera lectura.

---

## 13. Anexos

### 13.1 Mapa de timestamps del video

| Momento | Qué se muestra |
|---|---|
| 00:04–00:46 | Anuncio de Whiteboard, Sheets, Data; Docs y Slides ya existían; Design como capa |
| 00:11–00:14 | Mención de Excel con tarjeta gráfica superpuesta (sin UI de Claude) |
| 01:31–02:19 | Creación de un documento en Docs, edición directa y pedido de resumen |
| 02:23–02:51 | Documento terminado; `Compartir` y exportación a Word, PDF, Markdown, Google Docs, Notion |
| 03:02–04:17 | Caso de uso: chat largo vs. documento; exportación |
| 05:17–06:23 | Slides: creación de una presentación de cinco diapositivas |
| 07:18–07:23 | Slides: controles de texto, tipo de texto y color |
| 07:36–09:19 | Sheets: versión de hoja de cálculo y exportación |
| 10:55–11:49 | Creación de un dashboard con Claude Data |
| 11:59–14:52 | Whiteboard: pizarra infinita, dibujo, conectores |
| 15:02–15:45 | Exportación del whiteboard (Miro, Lucidchart, vectorial) |
| 15:54–17:23 | Data: dashboards vivos, CSV, actualización |
| 18:12–18:23 | Data: el dashboard es el formato default |

Los tiempos son aproximados: provienen de la transcripción automática.

### 13.2 Índice de capturas

| Archivo | Producto | Qué muestra |
|---|---|---|
| `docs-editor.jpg` | Docs | Split 42/58, dock inferior, chips de metadatos, `Editing` |
| `docs-editar-con-claude.jpg` | Docs | Scroll con fade, progreso del agente |
| `docs-formato-tablas.jpg` | Docs | Documento terminado, enlaces, lista de vulnerables |
| `docs-compartir-exportar.jpg` | Docs | Popover `Compartir` / `Exportación`, permisos |
| `slides-editor.jpg` | Slides | Full width, filmstrip, selección, dock |
| `slides-propiedades.jpg` | Slides | Bounding box, 8 handles, barra contextual |
| `slides-controles-texto.jpg` | Slides | Barra de texto: `Heading 2`, color, `B/I/U`, listas |
| `slides-resultado.jpg` | — | Toma de cámara (sin UI) |
| `sheets-mencion-excel.jpg` | — | Presentador + tarjeta `MICROSOFT EXCEL` (mención, sin UI) |
| `sheets-creacion.jpg` | — | Toma de cámara (sin UI) |
| `sheets-grilla-creacion.jpg` | Sheets | Split chat/hoja, columnas A–E, tarjeta de artefacto |
| `sheets-formato.jpg` | Sheets | Grilla, `fx` con `=D2*(1-E2/100)-F2`, dock numérico |
| `sheets-formula-fila.jpg` | Sheets | `fx` con `=D3-F3`, chat explicando el cálculo |
| `sheets-formato-condicional.jpg` | Sheets | Formato condicional, header congelado |
| `sheets-dashboard.jpg` | Sheets | Dashboard sobre grilla, KPIs, dock de celda vacía |
| `sheets-formula.jpg` | Sheets | `=SUM(Ventas!$G$2:$G$201)`, formato moneda |
| `wb-canvas.jpg` | Whiteboard | Canvas, dock, zoom 60 %, infografía |
| `wb-zoom.jpg` | Whiteboard | Zoom 104 %, sección/frame |
| `wb-diagrama.jpg` | Whiteboard | `Ask Claude`, prompt inline, zoom 47 % |
| `wb-conectores-flujo.jpg` | Whiteboard | Diagrama cliente-servidor, conectores 1–5 |
| `wb-postits-conectores.jpg` | Whiteboard | Split, post-it, barra contextual, conectores |
| `wb-seleccion-handles.jpg` | Whiteboard | Figura seleccionada, 4 handles, barra extendida |
| `wb-lapiz.jpg` | Whiteboard | Sub-barra de lápiz, colores, conectores ortogonales |
| `wb-compartir.jpg` | Whiteboard | Popover compartir/exportar |
| `data-dashboard.jpg` | Data | Chat + tarjeta de artefacto, `Paso 2 de 3` |
| `data-fuentes-query.jpg` | Data | Draft, barra de estado, gráfico, dock |
| `data-estilos.jpg` | Data | Panel Design, 4 formatos |
| `data-scrollytelling.jpg` | Data | Foco + contexto, tarjetas narrativas |
| `data-scroll-stats.jpg` | Data | KPIs 3×2, narrativa, nota metodológica |

### 13.3 Qué está confirmado y qué no

**Confirmado por las capturas**

- Estructura de header, dock inferior y barras contextuales.
- Split 42/58 y modo full con `Mostrar chat`.
- Existencia de `fx`, `Draft`, `Undo/Redo/Save`, panel `Design` y cuatro formatos.
- KPIs 3×2 con nota metodológica y párrafo narrativo.
- Scrollytelling con series atenuadas y pie dinámico.
- Barra de Sheets que cambia entre celda vacía y celda numérica.
- Fórmulas reales de fila (`=D3-F3`) y entre hojas (`=SUM(Ventas!$G$2:$G$201)`).
- Formato condicional aplicado sobre una columna.
- Diagrama de flujo en Whiteboard con conectores numerados y handles de redimensión.
- Popover `Compartir | Exportación` en Docs y Whiteboard.

**Aproximado o no confirmado**

- Valores hex exactos y medidas en píxeles (son estimaciones sobre el frame).
- Nombres propios (`@Alvaro Felipe`, `alvaro@ed.team`): aparecen en la captura, pero son datos
  del autor del video, no del producto.
- Inventario exacto de íconos de algunas barras (puede faltar o sobrar uno).
- Comportamiento real de permisos, colaboración y exportación: no se probó el producto.
- Que el “Design” del video sea exactamente la misma capa que se menciona al inicio.

**No visible en el video**

- Mobile y tablet.
- Modo claro.
- Rendimiento con datasets grandes.
- Manejo de errores y estados vacíos.
- Accesibilidad.

### 13.4 Cobertura de tres momentos puntuales

Estos tres pedidos se verificaron frame por frame sobre el video completo.

**a) Hoja de cálculo / Excel**

| Archivo | Qué cubre |
|---|---|
| `sheets-mencion-excel.jpg` | El momento literal en que se menciona Excel (`[00:11]`). Muestra al presentador con una tarjeta `MICROSOFT EXCEL`: **no hay UI de Claude en ese frame**. |
| `sheets-grilla-creacion.jpg` | Creación desde cero (`[08:58]–[09:00]`): split chat/hoja, columnas A–E, tarjeta verde del artefacto. |
| `sheets-formula-fila.jpg` | Fórmula escrita en la barra `fx` (`=D3-F3`) mientras el chat explica el cálculo (`[09:40]`). |
| `sheets-formato.jpg` | Fórmula completa de ingreso neto (`=D2*(1-E2/100)-F2`) y dock numérico. |
| `sheets-formato-condicional.jpg` | Formato condicional real sobre `Descuento (%)`. |
| `sheets-dashboard.jpg` | Dashboard dentro de la hoja, con KPIs y tres pestañas. |
| `sheets-formula.jpg` | Fórmula entre hojas (`=SUM(Ventas!$G$2:$G$201)`): la prueba de que es una hoja de cálculo real. |

**b) “Sliders”**

En el video **no aparece ningún slider real** (control deslizable con perilla). Lo que sí aparece:

| Archivo | Qué hay en realidad |
|---|---|
| `data-estilos.jpg` | Panel `Design` de Data (`[17:36]`): `Page color`, `Font` y `Text size` son **dropdowns**; `Corners` es un **campo numérico**; debajo hay 4 tarjetas de formato. No hay perillas. |
| `slides-controles-texto.jpg` | Barra de texto de Slides (`[07:20]`): `Heading 2` y color son **dropdowns**; `B/I/U`, listas y alineación son botones. |
| `wb-canvas.jpg`, `wb-zoom.jpg` | El zoom del Whiteboard es un **dropdown** (`60 %`, `104 %`), no un slider. |

Si por “sliders” se entendía el panel de estilos, la captura correcta es `data-estilos.jpg`; si se
entendía el control de zoom, es un desplegable y está en las capturas del Whiteboard.

**c) Pizarra tipo Figma**

| Archivo | Qué cubre |
|---|---|
| `wb-canvas.jpg` | Lienzo infinito con cuadrícula, dock y zoom 60 %. |
| `wb-zoom.jpg` | Zoom al 104 % sobre una sección enmarcada (`Funciones`). |
| `wb-diagrama.jpg` | Prompt inline `Describe a change` sobre el lienzo. |
| `wb-conectores-flujo.jpg` | Diagrama cliente-servidor con conectores numerados 1–5. |
| `wb-postits-conectores.jpg` | Post-it naranja, nodos de conexión y barra contextual. |
| `wb-seleccion-handles.jpg` | Figura seleccionada con 4 handles de redimensión y barra extendida. |
| `wb-lapiz.jpg` | Lápiz a mano alzada, paleta de 5 colores y trazo libre. |
| `wb-compartir.jpg` | Exportación a PNG y compartición. |

### 13.5 Fuentes

- Video: EDteam, “Claude lanzó su propio office. ¿Adiós Microsoft?”, 21:01,
  <https://www.youtube.com/watch?v=5w9SS8DMr1Y>.
- Transcripción automática en español: `transcripciones/claude-office-edteam.md`.
- Capturas: `frames/` (29 frames extraídos con `ffmpeg`).
- Especificaciones crudas por producto: `tmp/ref-claude-office/spec-*.md` (local, no versionado).
- Reglas de UI de Comex: `DESIGN.md`.
- Convenciones del repo: `AGENTS.md`, `.opencode/skills/add-a-feature`.
- Código analizado: `apps/app/src/react-app/domains/specialists/library-dialog.tsx`,
  `apps/app/src/react-app/domains/session/panel/side-panel.tsx`,
  `apps/app/src/react-app/domains/session/panel/panel-tab-store.ts`,
  `apps/app/src/react-app/domains/session/artifacts/artifact-panel.tsx`,
  `apps/server/src/specialists/routes.ts`.

---

*Documento de investigación. No se modificó código de la aplicación.*
