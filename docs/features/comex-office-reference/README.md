# Referencia de UI: la suite de oficina de Claude aplicada a Comex

> **Estado actual (2026-11-24):** la investigación está cerrada y la base de artefactos ya está
> implementada en `dev`. El épico y los sub-issues siguen abiertos porque la suite no está
> completa: Sheets es el más avanzado, Docs y Data están parciales, y Slides/Whiteboard/Temas
> todavía tienen alcance pendiente. Este README reemplaza la afirmación anterior de “sin cambios
> de código”.

## Documentos

| Documento | Qué contiene |
|---|---|
| **[investigacion.md](investigacion.md)** | Informe completo: anatomía de los productos, patrones, brechas, reglas y plan original |
| **[investigacion-web-funcionalidades.md](investigacion-web-funcionalidades.md)** | Funcionalidades y UI por producto con fuentes oficiales y guía de replicación |
| **[analisis-repos-tecnologias.md](analisis-repos-tecnologias.md)** | Repos/librerías evaluadas y roadmap; la recomendación histórica de Sheets quedó superada por la implementación vigente |
| **[matriz-decisiones.md](matriz-decisiones.md)** | Decisiones de licencia y la desviación posterior de Sheets a Jspreadsheet CE |
| **[diseno-artefactos.md](diseno-artefactos.md)** | Diseño técnico P0–P5, contrastado con la implementación actual |
| **[spikes/](spikes/)** | Validaciones históricas de Univer core y Excalidraw; no describen toda la implementación final |
| **[issues/](issues/README.md)** | Especificaciones y estado de los issues #1–#8 |
| `frames/` | Capturas de referencia del video |
| [`transcripciones/claude-office-edteam.md`](../../../transcripciones/claude-office-edteam.md) | Transcripción completa con timestamps |

## Fuente

- Video: “Claude lanzó su propio office. ¿Adiós Microsoft?”, EDteam, 21:01.
- <https://www.youtube.com/watch?v=5w9SS8DMr1Y>
- 1080p descargado con `yt-dlp`; frames extraídos con `ffmpeg`; transcripción automática en español.

## Cómo funciona el backlog

Los archivos `issues/00-*.md` son el cuerpo local de cada issue publicado. El número local y el
número de GitHub no coinciden:

| Archivo local | GitHub | Estado |
|---|---|---|
| `00-epico-artefactos-oficina.md` | [#1](https://github.com/brianpadilla3072/comex-desktop/issues/1) | Base P0–P4 implementada; cierre pendiente |
| `01-docs.md` | [#2](https://github.com/brianpadilla3072/comex-desktop/issues/2) | 15 tools, visor, comentarios/citas y exportación; editor rico pendiente |
| `02-slides.md` | [#3](https://github.com/brianpadilla3072/comex-desktop/issues/3) | Renderer básico |
| `03-sheets.md` | [#4](https://github.com/brianpadilla3072/comex-desktop/issues/4) | Implementación más avanzada; alcance parcial |
| `04-whiteboard.md` | [#5](https://github.com/brianpadilla3072/comex-desktop/issues/5) | Renderer mínimo; canvas pendiente |
| `05-data.md` | [#6](https://github.com/brianpadilla3072/comex-desktop/issues/6) | Resolución viva de paneles; editorial pendiente |
| `06-temas.md` | [#7](https://github.com/brianpadilla3072/comex-desktop/issues/7) | Tokens y tema de Docs parciales |
| `07-seguimiento-p1-p4.md` | [#8](https://github.com/brianpadilla3072/comex-desktop/issues/8) | Seguimiento de integración y E2E |

El orden original era **#7 → #2 → #6 → #5 → #4 → #3**. La implementación real priorizó la base,
Data y Sheets; el estado vigente de cada issue está en su propio archivo.

## Arquitectura implementada

- `comexArtifacts` controla la experiencia completa. Está **activo por defecto en self-hosted**,
  sigue apagado en cloud y el operador puede bloquearlo con `DEN_FEATURE_COMEX_ARTIFACTS=false`.
- El servidor guarda artefactos versionados en `proyecto/artefactos/`, con contenido inmutable por
  versión, reversión y deduplicación de guardados idénticos.
- El shell vive en una pestaña `studio` del panel de sesión y permite maximizar/restaurar el chat.
- Las salidas `table` nuevas se convierten en artefactos `sheet` y **se abren solas** en el panel
  lateral. Esta decisión del usuario reemplaza el botón manual “Abrir en el panel” del diseño
  original.
- Docs usa un visor nativo MD/MDX, sin iframe ni red, con 15 herramientas `specialist_doc_*`:
  crear/listar/leer/escribir, bloques, formato, búsqueda, importación, renombre, borrado/archivo,
  comentarios, fuentes/citas, exportación, versiones y control del visor. Exporta Markdown, HTML,
  Word y PDF; los archivos binarios se descargan directamente desde el header.
- Sheets usa Jspreadsheet CE, barra `fx`, pestañas, crecimiento bajo demanda, menús, CSV/JSON y
  herramientas del agente.
- Data reutiliza el resolver determinista de paneles y el snapshot más reciente del dataset.
- Slides y Whiteboard tienen renderers mínimos, no editores completos.

## Decisiones y desviaciones

- **Sheets:** la investigación y el spike eligieron Univer core. La implementación vigente usa
  **Jspreadsheet CE** y un evaluador propio para las herramientas del agente. Antes de cerrar el
  issue #4 hay que revisar licencia, paridad de fórmulas, XLSX, formato condicional y el resto de
  los criterios; no se debe presentar Univer como el stack actual.
- **Whiteboard:** Excalidraw sigue siendo la librería elegida, pero todavía no está integrada.
- **Temas:** existen tokens iniciales y tema claro/oscuro en Docs; falta un tema transversal y el
  panel Design.
- **Apertura:** la regla original “nunca abrir sola una superficie” quedó sustituida por decisión
  explícita del usuario para las salidas `table` nuevas.

## Lo que no se copia

La paleta oscura cálida, la tipografía de Claude, la colaboración multiusuario, los permisos por
link, macros/pivots avanzados ni la paridad 1:1 con Office. El razonamiento está en
[investigacion.md §11](investigacion.md#11-anti-patrones).

## Verificación y pendientes

La evidencia de implementación y pruebas en vivo está registrada en `proyecto/estado.md` y en los
issues. La ampliación de Docs pasó 23 tests de server y 17 de app, typechecks de app/server y la
build del servidor. En una sesión Electron aislada se verificaron visor, edición, búsqueda,
pantalla completa, comentarios, fuentes/citas y descargas reales de PDF y Word.

Evidencia visual:

- [`doc-tools-controls.png`](doc-tools-controls.png) — visor y controles principales.
- [`doc-tools-comments.png`](doc-tools-comments.png) — comentarios anclados.

Ningún issue debe cerrarse solo por existencia de código: faltan completar criterios de
aceptación, revisión de diseño y una pasada E2E de punta a punta.

`pnpm features:check` sigue rojo por `packaging/helm/openwork-ee/values.yaml` desactualizado. Un
control limpio en `HEAD` reproduce el mismo fallo; es una deuda preexistente, no un efecto de esta
actualización documental.

Próximos pasos:

1. Cerrar la brecha de licencia/paridad de Sheets y agregar XLSX, formato condicional y resaltado
   de cambios del agente.
2. Completar Docs: editor rico por bloques, citas clickeables a `specialist_source_read` y
   comentarios con anclas estables después de reordenar contenido.
3. Convertir Slides y Whiteboard de renderers mínimos en superficies editables.
4. Completar el tema transversal y el panel Design.
5. Ejecutar la guía E2E con `comexArtifacts` activo y adjuntar evidencia a los issues.
