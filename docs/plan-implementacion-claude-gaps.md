# Plan de implementación: gaps de Claude en OpenWork

Documento de investigación completo. Cada punto incluye estado actual, archivos relevantes, pasos de implementación, esfuerzo y riesgo.

## Leyenda
- **Estado**: ✅ ya implementado · 🟡 parcial · ❌ falta
- **Esfuerzo**: B (bajo) / M (medio) / A (alto)
- **Riesgo**: B/M/A

---

## A. Artefactos

### A1. Edición in-place en panel — 🟡 → ❌ (falta modo editar)
- **Archivos**: `app-artifact.tsx`, `artifact-text-editor.tsx`, `artifact-code-view.tsx`, `artifact-panel.tsx`.
- **Estado actual**: editores existen pero no se usan en el panel de artefacto guardado.
- **Implementación**:
  1. Agregar estado `editing` en `AppArtifact`.
  2. Botón "Editar" en header → toggle a `artifact-code-view`/`artifact-text-editor`.
  3. Al guardar → `client.saveApp(orgId, appId, { revisionId, ... })` (ya existe mutation `save`).
  4. Invalidar queries `app-preview`.
- **Esfuerzo**: M. **Riesgo**: B.

### A2. Selector de versiones — 🟡 (backend listo, falta UI)
- **Archivos**: `app-artifact.tsx` (header), `live-generated-app-model.ts`.
- **Estado actual**: `app.view.revisions` disponible; `loadSavedAppForDisplay` acepta `revisionId`.
- **Implementación**:
  1. Dropdown en header con `app.view.revisions` (id + fecha).
  2. Al seleccionar → setear `revisionId` en estado → refetch query.
  3. Indicador "versión actual" vs. seleccionada.
- **Esfuerzo**: B. **Riesgo**: B.

### A3. Compartir/publicar por link — ❌
- **Archivos**: `AppActionsMenu`, `app-artifact.tsx`.
- **Implementación**:
  1. Verificar endpoint de share en backend (`client.shareApp`?).
  2. Botón "Compartir" → generar link → copiar al clipboard.
  3. UI de confirmación "Link copiado".
- **Esfuerzo**: M. **Riesgo**: M (requiere backend).

### A4. Descargar/copiar artefacto — ❌
- **Archivos**: `app-artifact.tsx` header.
- **Implementación**:
  1. Botón "Descargar" → `new Blob([html], {type})` → `URL.createObjectURL` → click download.
  2. Botón "Copiar" → `navigator.clipboard.writeText(html)`.
- **Esfuerzo**: B. **Riesgo**: B.

### A5. Templates (Docs, Slides, Design) — ❌
- **Archivos**: dashboard, `AppChatArtifact`, `use-apps`.
- **Implementación**:
  1. Botón "Nuevo desde plantilla" en dashboard.
  2. `client.createApp(orgId, { template: "docs" })`.
  3. Plantillas base como HTML skeleton.
- **Esfuerzo**: M. **Riesgo**: B.

### A6. Artefactos que usan Claude — ❌
- **Archivos**: `mcp-app-frame.tsx`, `app-chat-artifact.tsx`.
- **Implementación**:
  1. Permitir que el HTML del app llame a endpoint proxy de Claude.
  2. Pasar `appId` + token al iframe.
  3. Consentimiento del usuario la primera vez.
- **Esfuerzo**: A. **Riesgo**: A (seguridad, costos).

### A7. Almacenar datos en artefacto — 🟡
- **Archivos**: `live-generated-app-model.ts`, `GeneratedAppPreview`.
- **Implementación**:
  1. Usar IndexedDB/localStorage dentro del iframe.
  2. O endpoint de storage por appId.
- **Esfuerzo**: M. **Riesgo**: M.

### A8. Conectar apps a artefacto (live data) — 🟡
- **Archivos**: `DashboardConnectionCard`, `connectionOutput`.
- **Implementación**: extender conexión existente a más fuentes.

### A9. Generative UI (Imagine) — ❌
- **Esfuerzo**: A. **Recomendación**: no priorizar.

---

## B. Memoria y chats

### B10. Memoria global entre conversaciones — 🟡
- **Archivos**: `ui-state-store.ts`, `consolidate-memory-store.ts`.
- **Implementación**:
  1. Store Zustand global de facts del usuario.
  2. Inyectar en system prompt de cada chat.
  3. Persistir en localStorage/DB.
  4. UI de review/edit (como Claude).
- **Esfuerzo**: M. **Riesgo**: B.

### B11. Chats incógnito — ❌
- **Archivos**: session store, `useSessionManagementStore`.
- **Implementación**:
  1. Flag `incognito` en sesión.
  2. No persistir en historial ni memoria.
  3. Borrar al cerrar.
- **Esfuerzo**: B. **Riesgo**: B.

### B12. Búsqueda en chats pasados — ❌
- **Archivos**: sidebar search, backend.
- **Implementación**:
  1. Endpoint de search en server.
  2. UI con input + resultados en sidebar.
- **Esfuerzo**: M. **Riesgo**: B (requiere backend).

### B13. Exportar/compartir chat por link — ❌
- **Archivos**: session page.
- **Implementación**:
  1. Generar snapshot (HTML/MD).
  2. Subir o copiar; compartir link.
- **Esfuerzo**: M. **Riesgo**: M.

---

## C. Proyectos

### C14. Adjuntar archivos de conocimiento (uploads + RAG) — ✅ (ya implementado)
- **Archivos**: `ProjectContextDialog`, `project-page.tsx`.
- **Implementación**:
  1. Upload a storage.
  2. Endpoint de search/RAG.
  3. Inyectar en prompt del proyecto.
- **Esfuerzo**: A. **Riesgo**: A.

### C15. Asociar artefactos a proyecto — ❌
- **Archivos**: `project-page.tsx`, `AppChatArtifact`.
- **Implementación**:
  1. Al crear artefacto en chat de proyecto, guardar `projectId` en metadata.
  2. Listar artefactos en página de proyecto.
- **Esfuerzo**: M. **Riesgo**: B.

### C16. Compartir proyecto (view/edit) — ❌
- **Archivos**: project page.
- **Implementación**: permisos por usuario + UI de invitación.
- **Esfuerzo**: A. **Riesgo**: A.

---

## D. Conocimiento y búsqueda

### D17. Research mode — 🟡
- **Archivos**: composer, agent `investigador-mercados`.
- **Implementación**: modo que fuerza 5+ tool calls y genera reporte con citas.
- **Esfuerzo**: M. **Riesgo**: B.

### D18. Web search con citas — 🟡
- **Archivos**: chat.
- **Implementación**: integrar tool `websearch` en flujo de chat.
- **Esfuerzo**: B. **Riesgo**: B.

### D19. Extended Thinking toggle — 🟡
- **Archivos**: composer.
- **Implementación**: toggle que activa variant "thinking"/"high".
- **Esfuerzo**: B. **Riesgo**: B.

---

## E. Código y agentes

### E20. Claude Code / Cowork — 🟡 (OpenCode ya cubre)
- **Esfuerzo**: A. **Recomendación**: no priorizar.

### E21. Claude in Chrome — 🟡 (browser tools existen)
- **Esfuerzo**: M. UI/automación más rica.

### E22. @Claude en Slack — ❌
- **Esfuerzo**: A. No priorizar.

---

## F. UX y voz

### F23. Modo de voz hands-free — 🟡
- **Archivos**: `native-dictation-control.tsx`.
- **Implementación**: micrófono continuo + TTS de respuesta.
- **Esfuerzo**: M. **Riesgo**: M.

### F24. Modo incógnito — = B11.

### F25. Atajos visibles — 🟡
- **Archivos**: composer, sidebar.
- **Implementación**: mostrar kbd en botones (ya en "Nuevo chat").
- **Esfuerzo**: B. **Riesgo**: B.

### F26. Selector de modelo en composer — ❌
- **Archivos**: composer.
- **Implementación**: dropdown de modelo + variant.
- **Esfuerzo**: B. **Riesgo**: B.

### F27. Modo de permiso en composer — ✅ (ya implementado)
- `permission-mode-menu.tsx`.

---

## G. Plugins/Conectores

### G28. Connectors UI dedicada — 🟡
- **Archivos**: extensions page.
- **Implementación**: sección de conectores con estado + auth flow.
- **Esfuerzo**: M. **Riesgo**: M.

### G29. Skills ZIP upload — ❌
- **Archivos**: skills management.
- **Implementación**: upload ZIP → extraer → registrar skill.
- **Esfuerzo**: M. **Riesgo**: M.

---

## Prioridad recomendada (quick wins)

1. **A2 Selector de versiones** (B) → `app-artifact.tsx`.
2. **A4 Descargar/copiar artefacto** (B) → `app-artifact.tsx`.
3. **F25 Atajos visibles** (B) → composer/sidebar.
4. **F26 Selector de modelo** (B) → composer.
5. **D19 Extended Thinking toggle** (B) → composer.
6. **B11 Incógnito** (B) → session store.
7. **B10 Memoria global** (M) → ui-state-store.
8. **A1 Edición in-place** (M) → app-artifact.tsx.
9. **A3 Compartir artefacto** (M) → AppActionsMenu.
10. **A5 Templates** (M) → dashboard.

## Notas de implementación general
- Siempre reutilizar componentes existentes (editores, dropdowns, mutations).
- Mantener compatibilidad con MCP Apps (lease/live binding).
- Correr typecheck + tests tras cada cambio.
- No romper artifacts retenidos (retained-artifact-surface).
---

## Hallazgos de código (investigación)

### B10 Memoria global
- No existe store global de facts del usuario (`grep userMemory/globalMemory` → sin resultados).
- Existe `consolidate-memory-store.ts` (Zustand) pero solo controla apertura de dialog.
- `project-memory-dialog.tsx` muestra patrón de memoria por proyecto con revisiones (conflict retry).
- **Implementación**: crear `user-memory-store.ts` (Zustand) con facts + persistencia localStorage; inyectar en system prompt del chat. UI de review/edit en settings.
- **Esfuerzo**: M. **Riesgo**: B.

### B11 Incógnito
- No existe concepto de incógnito en el codebase (`grep incognito` → sin resultados).
- Sesiones persisten en `session-management-store` y backend.
- **Implementación**: flag `incognito` en sesión; al crear, no persistir en historial ni memoria; borrar al cerrar. Requiere cambios en backend (no guardar) + frontend (no mostrar en recientes, no inyectar memoria).
- **Esfuerzo**: M-A. **Riesgo**: M.

### A5 Templates de artefactos
- `AppChatArtifact` renderiza artefacto con "Abrir preview". No hay "Nuevo desde plantilla".
- Dashboard tiene `createApp` (ver `use-apps`).
- **Implementación**: botón en dashboard → `client.createApp(orgId, { template })` con HTML skeleton base. Plantillas: Docs, Slides, Design.
- **Esfuerzo**: M. **Riesgo**: B.

### B15 Asociar artefactos a proyecto
- `AppChatArtifact` recibe `sessionId` → `panelSessionId`. No hay `projectId`.
- `project-page.tsx` lista sesiones recientes del proyecto.
- **Implementación**: al crear artefacto en chat de proyecto, guardar `projectId` en metadata del app; listar artefactos en página de proyecto (nueva sección).
- **Esfuerzo**: M. **Riesgo**: B.

### G28 Connectors UI
- Existe `use-org-mcp-connections`, `composer-connections`, `DashboardConnectionCard`.
- No hay página dedicada de conectores con estado conectado/desconectado.
- **Implementación**: nueva sección en extensions page con lista de conectores (nombre, estado, botón conectar/desconectar) + auth flow.
- **Esfuerzo**: M. **Riesgo**: M.

### G29 Skills ZIP upload
- Skills se gestionan via `specialist_skill_create` y archivos en biblioteca.
- No hay upload de ZIP.
- **Implementación**: endpoint de upload + extracción + registro de skill. Frontend: input file + progress.
- **Esfuerzo**: M. **Riesgo**: M (seguridad: validar contenido del ZIP).

### Resumen de hallazgos
- Varios gaps "ya implementados" (permisos, dictado, model select, thinking toggle, web search tool).
- Los que requieren backend: incógnito (persistencia), búsqueda en chats, RAG uploads, compartir proyecto.
- Los pure-frontend: templates, memoria global (localStorage), asociar artefactos a proyecto, connectors UI, skills ZIP upload (requiere endpoint).

---

## Descubrimientos adicionales (investigación de código)

- **C14 (RAG uploads)**: YA implementado. `ProjectContextDialog` soporta upload, browse folders, search, delete, create folders. `ProjectPageClient` incluye `uploadProjectContextFile`, `listProjectContext`, `deleteProjectContextEntry`, `createProjectContextFolder`. → marcar como ✅.
- **G28 (Connectors UI)**: parcial. Existe `use-org-mcp-connections`, `DashboardConnectionCard`, `composer-connections`, `add-mcp-modal`. Falta página/sección dedicada de conectores con estado conectado/desconectado. → esfuerzo M, frontend.
- **B15 (Asociar artefactos a proyecto)**: `ProjectPageClient` no tiene endpoint de artefactos. `AppChatArtifact` recibe `sessionId` → `panelSessionId`. Falta guardar `projectId` en metadata del app (backend) y listar en project-page.
- **B11 (Incógnito)**: no existe concepto. Requiere flag en sesión + backend (no persistir) + frontend (no mostrar en recientes, no inyectar memoria).
- **B12 (Búsqueda en chats)**: no existe endpoint de search. Requiere backend + UI.
- **A5 (Templates)**: no hay `createApp` en frontend; apps se crean via agente (`save_artifact_view`). Requiere botón + template base HTML.
- **B10 (Memoria global)**: implementado frontend (store + dialog + menú). Falta inyección en prompt (backend).
- **G29 (Skills ZIP)**: no hay upload de ZIP. Requiere endpoint + validación de seguridad.

### Gaps realmente pendientes (post-investigación)
1. B11 Incógnito (M-A, requiere backend).
2. B12 Búsqueda en chats (M, requiere backend).
3. A5 Templates (M, requiere endpoint).
4. B15 Asociar artefactos a proyecto (M, requiere backend).
5. G28 Connectors UI dedicada (M, frontend).
6. G29 Skills ZIP upload (M, requiere endpoint + seguridad).
7. C16 Compartir proyecto (A, requiere backend).
8. B10 inyección en prompt (M, requiere backend).EOF
echo done


---

## Descubrimientos adicionales (investigacion de codigo)

- **C14 (RAG uploads)**: YA implementado. `ProjectContextDialog` soporta upload, browse folders, search, delete, create folders. `ProjectPageClient` incluye `uploadProjectContextFile`, `listProjectContext`, `deleteProjectContextEntry`, `createProjectContextFolder`. -> marcar como implementado.
- **G28 (Connectors UI)**: parcial. Existe `use-org-mcp-connections`, `DashboardConnectionCard`, `composer-connections`, `add-mcp-modal`. Falta pagina/seccion dedicada de conectores con estado conectado/desconectado.
- **B15 (Asociar artefactos a proyecto)**: `ProjectPageClient` no tiene endpoint de artefactos. `AppChatArtifact` recibe `sessionId` -> `panelSessionId`. Falta guardar `projectId` en metadata del app (backend) y listar en project-page.
- **B11 (Incognito)**: no existe concepto. Requiere flag en sesion + backend (no persistir) + frontend (no mostrar en recientes, no inyectar memoria).
- **B12 (Busqueda en chats)**: no existe endpoint de search. Requiere backend + UI.
- **A5 (Templates)**: no hay `createApp` en frontend; apps se crean via agente (`save_artifact_view`). Requiere boton + template base HTML.
- **B10 (Memoria global)**: implementado frontend (store + dialog + menu). Falta inyeccion en prompt (backend).
- **G29 (Skills ZIP)**: no hay upload de ZIP. Requiere endpoint + validacion de seguridad.

### Gaps realmente pendientes (post-investigacion)
1. B11 Incognito (M-A, requiere backend).
2. B12 Busqueda en chats (M, requiere backend).
3. A5 Templates (M, requiere endpoint).
4. B15 Asociar artefactos a proyecto (M, requiere backend).
5. G28 Connectors UI dedicada (M, frontend).
6. G29 Skills ZIP upload (M, requiere endpoint + seguridad).
7. C16 Compartir proyecto (A, requiere backend).
8. B10 inyeccion en prompt (M, requiere backend).
