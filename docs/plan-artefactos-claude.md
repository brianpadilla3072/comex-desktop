# Plan: replicar UX de Artefactos/Proyectos/Plugins de Claude en OpenWork

## Contexto actual de OpenWork
- Artefactos ya existen como MCP Apps (panel derecho con tabs, preview, editores).
- Proyectos: existe `projectsExperience` con `/projects` y sidebar de proyectos.
- Plugins/Extensiones: existe `onOpenExtensions` (biblioteca de skills/herramientas).

## Objetivo
Adaptar la UX de Claude (artefactos en panel lateral, proyectos con contexto compartido, plugins) a OpenWork, sin romper lo existente.

## Fase 1 — Artefactos (prioridad)
1. Apertura automática del panel derecho al generar un artefacto.
   - En `AppChatArtifact` / `mcp-app-tool-change`, al crear, llamar `setSidePanelState(panelSessionId, "panel")` y `openTab`.
   - Reutilizar `retained-artifact-surface` para mantener el artefacto vivo al navegar.
2. Historial de versiones.
   - El store de apps ya guarda revisiones; exponer lista de revisiones en `artifact-header` con selector.
   - Acción "restaurar versión" → `update_app` con revisionId anterior.
3. Edición in-place.
   - Reutilizar `artifact-text-editor` / `artifact-code-view` en el panel; guardar con `update_app`.
4. Preview en vivo para HTML/React/SVG (ya parcialmente).

## Fase 2 — Proyectos
1. Proyecto = carpeta de chats + archivos/instrucciones compartidas.
   - Reutilizar `/projects` y `PinnedProjectsGroup`.
   - Agregar "instrucciones del proyecto" (contexto) editable.
   - Asociar chats a proyecto al crearlos desde el proyecto.

## Fase 3 — Plugins
1. Unificar "extensiones" con conectores (apps MCP) en una vista de plugins.
2. Instalación/desinstalación con confirmación y estado.

## Riesgos
- No romper MCP Apps existentes (mantener lease/live binding).
- Mantener compatibilidad con artifacts retenidos.

## Primer paso sugerido
Implementar Fase 1.1 (apertura automática del panel) — cambio pequeño y visible.
