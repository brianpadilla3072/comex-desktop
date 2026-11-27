# Funcionalidad — Visor/editor de documentos tipo Claude Docs

**Título sugerido:** `[Feature] Artefacto Docs: documento vivo con citas, comentarios y exportación`
**Labels sugeridas:** `feature`, `ux`, `comex`, `artifact`, `needs-design-review`
**Depende de:** `00-epico-artefactos-oficina`
**Estimación sugerida:** 2–3 semanas

> **Estado real (2026-11-24): CONTROL COMPLETO DEL VISOR MARKDOWN/MDX; EDITOR RICO PENDIENTE.**
>
> **Implementado**
> - `DocView` nativo para Markdown/MDX, sin iframe, `eval` ni red.
> - Modo editar/vista previa, búsqueda, índice, zoom, ajuste de líneas, tema, pantalla completa y
>   restablecer vista; estado persistido en `metadata.viewer`.
> - 15 herramientas `specialist_doc_*`: list/create/read/write/blocks/format/find/import/rename/
>   delete/comments/citations/export/versions/view. Las 15 sobreviven el filtro de schemas de
>   proveedores y quedan registradas en el plugin real.
> - Bloques Markdown: listar, insertar, actualizar, mover, duplicar y eliminar; formato de
>   selección (negrita, cursiva, tachado, código, enlace y limpiar).
> - Importación desde archivo del proyecto, URL https pública o salida del mini-Studio.
> - Renombre, archivo y borrado definitivo con confirmación; versiones y reversión.
> - Comentarios anclados a cita/bloque, resueltos y editables; panel lateral en el visor.
> - Fuentes asociadas, auditoría de anclas e inserción de `[fuente:id#n]` verificada.
> - Exportación Markdown, MDX, HTML, Word (.docx) y PDF. El header descarga archivos reales; las
>   tools también pueden guardarlos en el proyecto.
> - Evidencia visual: `../doc-tools-controls.png` y `../doc-tools-comments.png`.
>
> **Pendiente**
> - Editor rico tipo Lexical/BlockNote, con selección visual y anclas de comentario estables tras
>   reordenar bloques.
> - Citas clickeables que abran directamente `specialist_source_read`.
> - Fecha/tipo de salida en el header, Google Docs y apertura integral desde todas las salidas.
> - Pasar la suite completa `test:comex` y la revisión final de diseño.

---

## Contexto (qué hace Claude Docs)

Fuente: `../investigacion-web-funcionalidades.md` §2 y capturas `docs-*.jpg`.

- Es un **documento vivo** (artifact) que se abre junto al chat, con rich-text, encabezados, tablas y "pestañas de documento".
- Claude **redacta en pantalla**, hace preguntas aclaratorias y deja **comentarios explicando sus decisiones**.
- Tres vías de edición sobre el mismo objeto: **editar directo** (clic y escribir, guardado automático), **pedir en el chat** y **comentar con `@Claude`** ("Edit with Claude" sobre el texto seleccionado).
- Varias personas con acceso de edición trabajan a la vez; Claude actúa con los permisos de quien pide.
- Gráficos/diagramas se insertan desde apps conectadas, pero son **snapshot**: no se actualizan solos.
- Compartir con niveles `View / Comment / Edit`; dueño renombra o borra (borrado permanente, sin papelera).
- Exportar a **Word (.docx), PDF, Markdown y Google Docs**; también se puede convertir en Slides.
- UI observada: split ~42/58, scroll con fade, chips de metadatos, barra de formato flotante, comentarios en margen, popover `Compartir | Exportación`.

## Problema en Comex hoy

- Las salidas del mini-Studio (informes, resúmenes, flashcards, quiz, tablas) se leen en cajas de ~320 px dentro de `library-dialog.tsx:783`.
- La auditoría de citas existe pero aparece como párrafo al final; no es un chip de estado visible.
- No hay exportación de salidas, ni edición in-place, ni persistencia como objeto independiente del diálogo.

## Objetivo

Crear el primer artefacto reutilizable: un documento con shell propio, metadatos, citas verificables, exportación y edición híbrida (directa + asistida), reutilizando lo que ya tiene Comex.

## Alcance

### Incluye (MVP)
- Tipo de artefacto `doc` con esquema: `id`, `title`, `blocks[]`, `metadata`, `citations[]`, `status`, `updatedAt`.
- Render de bloques (heading, párrafo, lista, tabla, cita, código, imagen) con el renderer actual de Comex.
- Shell común del épico: header con título/estado, acciones `Compartir | Exportación`, cuerpo scrollable.
- Exportación a **Markdown** y **HTML/PDF** (Word/Docs en una fase posterior si hay librería/server).
- Chip de auditoría de citas siempre visible con el resultado de `specialist_output_generate` (anclas que resuelven / rotas).
- Entrada desde salidas existentes del mini-Studio (botón "Abrir como documento").

### Incluye (fase 2)
- Edición directa de bloques con Lexical (ya instalado) o migración evaluada a BlockNote/Tiptap.
- Comentarios anclados y `@Claude` para cambio localizado.
- Export a `.docx` / Google Docs.
- Versiones y restauración.

### No incluye
- Colaboración multiusuario en tiempo real (Yjs/Hocuspocus) en el MVP.
- Generación desde cero con prompt dentro del documento (se genera desde el mini-Studio).

## Criterios de aceptación

- [ ] Al generar una salida, aparece la acción "Abrir como documento" y se abre un panel con ≥ 2/3 del ancho disponible.
- [ ] El documento muestra título, fecha, tipo de salida y un **chip de estado de citas** con el número de anclas válidas/rotas.
- [ ] Las citas del contenido son clickeables y abren el pasaje de la fuente (`specialist_source_read`).
- [x] El botón `Exportar` ofrece Markdown y PDF/HTML y descarga un archivo válido.
- [x] El documento se puede cerrar y reabrir desde la pestaña de artefactos sin perder contenido.
- [x] El comportamiento está detrás del flag global existente `comexArtifacts`.
- [x] Existen tests headless que abren el artefacto, verifican las citas y la exportación.
- [x] Se adjuntan screenshots; la revisión final de reglas `DESIGN.md` queda pendiente.

## Notas técnicas

- El visor actual usa Markdown/MDX nativo y `marked`/Shiki; la edición rica sigue pendiente.
- La exportación server-side usa `marked`, `docx`, `pdfkit` y `turndown`; `docx-preview` sigue
  siendo solo un lector.
- Las citas reutilizan `extractCitations` y `readCitation`; el agente debe leer el pasaje antes de
  insertarlo.
- Esquema sugerido:

```json
{
  "id": "doc_...",
  "type": "doc",
  "title": "...",
  "status": "draft",
  "blocks": [{ "type": "heading", "level": 2, "text": "..." }],
  "citations": [{ "sourceId": "src_...", "chunk": 3, "resolved": true }],
  "metadata": { "generatedBy": "output_id", "createdAt": "..." }
}
```

- Seguir `AGENTS.md`: feature flag, tests (`pnpm test:comex`, `pnpm typecheck`), verificación headless.

## Dependencias

- Épico `00` (shell y modelo de artefacto).
- `specialist_output_generate` devuelve la auditoría de citas; usarla como fuente del chip.

## Referencias

- `../investigacion.md` §4.1, §7 (inventario Comex), §8 (brechas), §10 Fase 1.
- Capturas: `docs-editor.jpg`, `docs-editar-con-claude.jpg`, `docs-formato-tablas.jpg`, `docs-compartir-exportar.jpg`.
- Fuente web: https://support.claude.com/en/articles/16923645-get-started-with-claude-docs

## Definition of Done

- [ ] Criterios de aceptación completos.
- [ ] Typecheck + tests `test:comex` en verde.
- [ ] Screenshots adjuntos al PR y reglas de `DESIGN.md` citadas.
- [ ] Documentación de uso actualizada en `README.md` de la carpeta de investigación.
