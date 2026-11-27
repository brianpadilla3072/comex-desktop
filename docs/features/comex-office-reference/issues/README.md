# Issues — Suite tipo Office para Comex

Cada archivo es el cuerpo completo de un issue de GitHub. Incluye contexto, problema, objetivo,
alcance, criterios de aceptación, notas técnicas, dependencias y Definition of Done.

> **Actualización 2026-11-24:** las especificaciones se conservan como contrato, pero cada issue
> tiene ahora un bloque de estado real. Editar estos archivos no actualiza GitHub automáticamente;
> para sincronizarlos se usa `gh issue edit <n> --body-file <archivo>`.

## Orden y dependencias

| Archivo | GitHub | Título | Depende de | Estado |
|---|---|---|---|---|
| `00-epico-artefactos-oficina.md` | [#1](https://github.com/brianpadilla3072/comex-desktop/issues/1) | Épico: visor/editor de artefactos | — | Base implementada; cierre pendiente |
| `01-docs.md` | [#2](https://github.com/brianpadilla3072/comex-desktop/issues/2) | Docs | #1 | Parcial |
| `02-slides.md` | [#3](https://github.com/brianpadilla3072/comex-desktop/issues/3) | Slides | #1, #2, #7 | Renderer básico |
| `03-sheets.md` | [#4](https://github.com/brianpadilla3072/comex-desktop/issues/4) | Sheets | #1 | Implementación avanzada; criterios pendientes |
| `04-whiteboard.md` | [#5](https://github.com/brianpadilla3072/comex-desktop/issues/5) | Whiteboard | #1, #7 | Renderer mínimo |
| `05-data.md` | [#6](https://github.com/brianpadilla3072/comex-desktop/issues/6) | Data | #1, #7 | Parcial |
| `06-temas.md` | [#7](https://github.com/brianpadilla3072/comex-desktop/issues/7) | Temas/estilos | #1 | Parcial |
| `07-seguimiento-p1-p4.md` | [#8](https://github.com/brianpadilla3072/comex-desktop/issues/8) | Completar y verificar P1–P4 + E2E | #1 | Seguimiento; cuerpo actualizado |

Orden sugerido original: **#7 → #2 → #6 → #5 → #4 → #3**. El épico #1 es el paraguas; el issue
#8 se creó después para integrar P1–P4 y ejecutar la verificación E2E.

## Estado real por issue

### #1 — Épico

Implementado: esquema Zod, persistencia y versiones, shell común, pestaña `studio`, split/foco,
apertura desde Resultados y visor Data. `comexArtifacts` está activo por defecto en self-hosted.
Pendiente: cerrar todos los criterios del épico, evidencia visual/E2E y los sub-issues.

### #2 — Docs

Implementado: visor nativo MD/MDX y 15 herramientas `specialist_doc_*` registradas. Cubre
crear/leer/escribir, bloques, formato, búsqueda, importación, renombre, archivo/borrado,
comentarios, fuentes/citas, exportación Markdown/HTML/Word/PDF, versiones y control de vista
(modo, búsqueda, pantalla completa, tema, zoom, índice). Pendiente: editor rico tipo Lexical/
BlockNote, citas clickeables a `specialist_source_read`, Google Docs y apertura integral desde
todas las salidas.

### #3 — Slides

Implementado: schema y renderer mínimo con filmstrip, títulos, bloques, notas y marcado de
omitidas. Pendiente: creación de decks, edición, modo presentar, exportación y barra contextual.

### #4 — Sheets

Implementado: Jspreadsheet CE, barra `fx`, pestañas, crecimiento sin techo artificial, guardado
persistente, menús, CSV/JSON, fórmulas y 14 herramientas `specialist_sheet_*`. Las salidas
`table` nuevas se abren solas como hoja. Pendiente: licencia/paridad, XLSX, formato condicional,
dock contextual, resaltado de celdas del agente y cierre de aceptación.

### #5 — Whiteboard

Implementado: schema y visor mínimo de nodos/conectores. La decisión de usar Excalidraw MIT y su
spike están cerrados. Pendiente: integrar el canvas, herramientas de dibujo, persistencia de
escena, exportación, Ask Claude y conversión a documento.

### #6 — Data

Implementado: `DataView` resuelve specs de panel contra el snapshot más reciente, reutiliza los
renderers existentes y muestra narrativa/fuente viva. Pendiente: KPI editorial completo, traza
por gráfico con snapshot/fecha, foco de series, edición local, formatos y panel Design.

### #7 — Temas

Implementado: `comexDefaultTheme`, migración inicial de colores y tema claro/oscuro del visor
Docs. Pendiente: `ThemeProvider`, tema alternativo, panel Design, aplicación en caliente a los
cinco artefactos y eliminación de hex hardcodeados restantes.

### #8 — Seguimiento P1–P4 + E2E

El cuerpo original decía que solo P0 estaba integrado; el comentario posterior registró P0–P4.
La implementación avanzó además en Sheets, Docs y Resultados. Pendiente: E2E completo con flag
activo, capturas, revisión `DESIGN.md` y cierre de issues.

## Decisiones de librería

- **Sheets:** la decisión original fue Univer core + complementos OSS. La implementación vigente
  usa **Jspreadsheet CE** y un evaluador propio para herramientas. Esta desviación debe
  revalidarse antes de cerrar #4; ver `../matriz-decisiones.md`.
- **Whiteboard:** **Excalidraw MIT**, decidido y validado en spike; todavía no integrado.
- **Temas:** tokens propios + tipografía del sistema; implementación parcial.

## Publicación y sincronización

Los issues #1–#7 se publicaron el 2026-11-17; #8 se creó como seguimiento. Las URLs están en
[`created-issues.txt`](created-issues.txt).

Para volver a publicar en otro repo:

```bash
gh auth login -h github.com
DRY_RUN=1 bash docs/features/comex-office-reference/issues/publish.sh
bash docs/features/comex-office-reference/issues/publish.sh
```

Para actualizar un issue existente sin duplicarlo:

```bash
gh issue edit 4 --repo brianpadilla3072/comex-desktop \
  --body-file docs/features/comex-office-reference/issues/03-sheets.md
```

## Verificación

- [x] Los issues #1–#8 existen y están enlazados desde este README.
- [x] Las especificaciones locales reflejan la implementación vigente y sus pendientes.
- [x] Las URLs quedaron registradas en `created-issues.txt`.
- [x] Verificación focalizada del 2026-11-24: 42 tests de app + 49 de server en verde.
- [ ] E2E completo de la suite con evidencia adjunta.
- [ ] Cierre de cada issue solo cuando todos sus criterios estén verificados.
