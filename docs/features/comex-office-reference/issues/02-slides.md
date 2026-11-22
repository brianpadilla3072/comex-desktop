# Funcionalidad — Presentaciones tipo Claude Slides

**Título sugerido:** `[Feature] Artefacto Slides: presentación estructurada, modo presentar y exportación`
**Labels sugeridas:** `feature`, `ux`, `comex`, `artifact`, `needs-design-review`
**Depende de:** `01-docs` (reutiliza bloques y export), `06-temas` (opcional para marca)
**Estimación sugerida:** 2–3 semanas (MVP) + 2 semanas (editor visual)

---

## Contexto (qué hace Claude Slides)

Fuente: `../investigacion-web-funcionalidades.md` §3, capturas `slides-*.jpg`.

- Presentación que se abre junto al chat; **se edita slide por slide** y se presenta sin salir de la app.
- Se genera desde notas/reportes/conversación; puede usar sistema de diseño o imitar un deck de marca.
- **Edición directa**: clic para seleccionar, doble clic para texto, arrastrar/redimensionar, toolbar para texto/imágenes/tablas/formas, panel `Properties`.
- **Filmstrip** de miniaturas: agregar, reordenar, duplicar y **Skip slide** (omitir sin borrar).
- **Notas del orador** (Claude las redacta o se escriben a mano); modo `Present with speaker notes` con reloj y vista actual/siguiente.
- Comentarios con "Send to Claude" para cambios puntuales; acceso `View/Comment/Edit`.
- Exportar: **PPTX, PDF**, también HTML, PNG de slide actual y envío a Google Slides. En PPTX, gráficos/iconos/formas pueden rasterizarse y se omiten transiciones y slides saltadas.
- UI observada: canvas a ancho completo con `Mostrar chat`, bounding box con 8 handles, barra contextual flotante, dock inferior, barra superior con `+ Add slide`, vista/zoom/presentar/compartir.

## Problema en Comex hoy

- No existe representación de "presentación" ni forma de presentar/exportar el contenido de un estudio.
- Las salidas son texto/tablas sueltas dentro del diálogo.

## Objetivo

Permitir convertir el contenido de un informe o dataset de Comex en una presentación navegable, presentable y exportable, con el mismo shell de artefacto.

## Alcance

### Incluye (MVP)
- Esquema `slides`: `{ id, title, slides:[{ id, layout, blocks[], notes, skipped }], theme }`.
- Generación desde un `doc` o desde `specialist_output_generate` (kind `report`).
- Renderer de slides + modo **Presentar** (teclado: flechas/espacio, Escape).
- Filmstrip con miniaturas y acciones agregar/duplicar/reordenar/omitir.
- Notas del orador por slide y vista de presentación con notas.
- Exportación a **Markdown** y **HTML/PDF** (PPTX en fase 2 según librería disponible).
- Selector de tema del issue `06`.

### Incluye (fase 2)
- Edición visual directa: selección con handles y barra contextual (evaluar canvas propio o librería).
- Export a `.pptx` y envío a Google Slides.
- Comentarios por slide con "Send to Claude".

### No incluye
- Editor WYSIWYG completo tipo PowerPoint en el MVP.
- Transiciones/animated explainers.

## Criterios de aceptación

- [ ] Desde un documento/artefacto existe "Crear presentación" y se genera un deck con ≥ 5 slides.
- [ ] El deck usa el shell común y el botón `Mostrar chat` para ocultar/mostrar la conversación.
- [ ] El filmstrip permite navegar, duplicar, reordenar y marcar `Skip slide`.
- [ ] El modo Presentar ocupa pantalla completa, responde a teclado y muestra notas (opcional).
- [ ] La exportación HTML/PDF produce un archivo navegable y consistente con el tema.
- [ ] Cada slide seleccionado muestra barra contextual con las acciones disponibles (MVP: al menos estilo de texto).
- [ ] Flag `comex.artifacts.slides`; tests headless; screenshots y reglas de `DESIGN.md` citadas.

## Notas técnicas

- Representación estructurada primero (bloques + layout), renderer después. No construir un motor de slides desde cero en el MVP.
- Evaluar **Reveal.js** o **Spectacle** (OSS/React) como renderer/presentador; ver `../analisis-repos-tecnologias.md` §3.3.
- Para PPTX: evaluar generación en servidor (librería de pptx o conversión) y documentar qué elementos se rasterizan.
- Reutilizar esquema de bloques del issue `01`; el slide es un contenedor de bloques con `layout` y `notes`.
- Navegación por áreas y atajos tipo `F6/Shift+F6`, Return/Escape, coherente con la accesibilidad documentada.

## Dependencias

- `01-docs` (bloques, export Markdown/HTML).
- `06-temas` para consistencia visual (puede implementarse con tokens por defecto si aún no está).

## Referencias

- `../investigacion.md` §4.2 y capturas `slides-editor.jpg`, `slides-propiedades.jpg`, `slides-controles-texto.jpg`.
- Fuente web: https://academy.claude.com/tutorials/using-claude-design-for-presentations-and-slide-decks
- https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them

## Definition of Done

- [ ] MVP completo con criterios verificables.
- [ ] `pnpm typecheck` y `pnpm test:comex` en verde.
- [ ] Screenshots del editor y del modo presentar adjuntos al PR.
