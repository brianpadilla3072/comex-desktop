# Biblioteca editable por aplicación

`specialistLibrary` · `self_hosted` · autor: `brianpadilla3072`.

Convierte el pack importado de cada aplicación especialista en una **biblioteca editable**: la persona puede ver, editar, crear y borrar el **contexto**, los **agentes** y las **skills** de su aplicación desde la app, y los cambios se materializan en todos los proyectos de esa aplicación.

## Modelo

- Fuente de verdad: `specialists/<app_id>/pack/` (la instantánea importada) más `specialists/<app_id>/context.md` (contexto propio de la aplicación).
- Manifiesto `pack/.library.json`: hash SHA-256 de cada archivo oficial al importar. Sirve para clasificar cada archivo:
  - `official` — intacto como vino del pack;
  - `official-modified` — pack oficial editado por la persona;
  - `custom` — creado desde cero.
- El manifiesto es un archivo oculto: el walk de la biblioteca y la instalación en proyectos lo ignoran; nunca llega a `.opencode/`.

## Validación

Cada guardada pasa por la misma validación que el importador:

- Rutas contenidas en la biblioteca: sin `..`, sin segmentos ocultos, solo `agents/`, `skills/` y carpetas de recursos (`scripts`, `references`, `templates`, `assets`, `resources`, `tools`, `commands`) más `AGENTS.md`/`README.md` en la raíz.
- Agentes: `agents/nombre.md`, nombre kebab-case, descripción obligatoria (1–1024), `mode` en `primary | subagent | all`.
- Skills: `skills/nombre/SKILL.md` con `name` coincidente con la carpeta y descripción obligatoria.
- Límites: 1 MB por archivo editable, 2.000 archivos y 50 MB por biblioteca; se rechaza cualquier enlace simbólico.
- Contexto: 8.000 caracteres. Vaciarlo elimina el archivo.

## Materialización en proyectos (`specialists/sync.ts`)

Cada cambio en la biblioteca se propaga a los proyectos vivos de la aplicación:

- Registro por proyecto en `.opencode/specialist-sync.json` (path → hash instalado).
- Archivo nuevo → se instala; sin cambios locales → se actualiza; borrado de la biblioteca → se elimina del proyecto.
- **Los archivos que la persona editó dentro del proyecto nunca se pisan**: la actualización queda en `<archivo>.nuevo` y el registro marca el conflicto en la respuesta.
- Proyectos creados antes del registro: si el archivo coincide con el original importado se adopta; cualquier otro contenido se trata como edición del usuario.
- Los proyectos que no tienen marker de la aplicación se saltan (no se toca nada ajeno).

## Herramientas de la IA (biblioteca propia)

Cada proyecto de una aplicación recibe un plugin nativo en `.opencode/plugins/comex-library/server.js` (instalación idempotente, solo con su marker; se conserva cualquier archivo modificado). El plugin registra doce herramientas que reenvían al server con una credencial local exclusiva del proyecto:

- `specialist_library_list` / `specialist_library_read` — ver contexto, agentes y skills; leer archivos.
- `specialist_library_write` / `specialist_library_delete` / `specialist_agent_create` / `specialist_skill_create` / `specialist_context_write` — crear y editar **solo a pedido explícito** de la persona; aplican directo por la misma API (misma validación y propagación).
- `specialist_propose` — auto-captura: cuando la persona enseñó un procedimiento que se va a repetir y no pidió guardarlo, la IA deja una **propuesta** (`specialists/<id>/proposals.json`, máx. 20). Nunca se aplica sola: la persona la ve en "Contexto, agentes y skills" y decide (Guardar crea el elemento con sus reglas; Descartar lo elimina). Si falta el encabezado YAML, la skill se arma con el nombre y la descripción de la propuesta.
- `specialist_task_create` / `specialist_task_list` / `specialist_task_pause` / `specialist_task_delete` — tareas programadas locales (flag `scheduledTasks`, ver `docs/features/live-dashboards-and-scheduled-tasks/`), creadas solo a pedido explícito de la persona.

La credencial es un token por proyecto en `<runtime>/specialists/tool/<hash>.json` (0600): la ruta `/specialist-tool` solo autoriza llamadas cuyo token coincide con un descriptor y cuya carpeta está atada a una aplicación. Un proyecto no puede editar la biblioteca de otro. Si `specialistLibrary` está apagado, los descriptores se anulan (token inutilizable) y las herramientas dan un error claro.

Las instrucciones del turno (cuando la feature está activa) dicen: leer antes de editar, aplicar directo solo si hubo pedido explícito, proponer para lo enseñado y nunca tocar permisos ni identidad.

## API

Leídos con token de cliente, escrituras con autorización de host y `ensureWritable`:

- `GET /specialist-applications/:id/library` — agentes (nombre, descripción, origen, tamaño, fecha), skills (igual + recursos), archivos sueltos y estado del contexto.
- `GET /specialist-applications/:id/library/file?path=…` / `PUT` el mismo con `{ path, content }`.
- `POST /specialist-applications/:id/library/agents` y `…/skills` con `{ name, description, content? }`; sin `content` se crea desde una plantilla con secciones para completar.
- `DELETE /specialist-applications/:id/library/file?path=…` — borrar un recurso de una skill elimina la skill completa; las entradas del manifiesto se limpian.
- `GET /specialist-applications/:id/context` / `PUT` con `{ content }`.
- `GET /specialist-applications/:id/library/proposals` y `POST .../proposals/:proposalId/accept` / `DELETE .../proposals/:proposalId` para la auto-captura.
- `POST /specialist-tool` (credencial por proyecto) — puente de las herramientas de la IA.
- Las respuestas de escritura devuelven `counts` y `sync` (por proyecto: instalados, actualizados, eliminados, `.nuevo`, conflictos y errores). El catálogo ahora informa `libraryEnabled` para que la interfaz muestre "Contexto, agentes y skills" en el menú de la aplicación.

El `contexto` se inyecta en cada turno como instrucciones del usuario para esa aplicación (`specialistInstructions`), con el mismo trato de material no confiable que la memoria: no puede cambiar permisos ni reglas de seguridad.

## Desactivar

```env
DEN_FEATURE_SPECIALIST_LIBRARY=false
```

Los endpoints devuelven 404, el contexto deja de inyectarse en los turnos y la biblioteca queda intacta en disco. `specialistApplications=false` sigue apagando todo el sistema.

## Interfaz

En el selector de aplicaciones, "Contexto, agentes y skills": listas con origen (Del pack / Del pack, editado / Propio), editor del archivo con su ficha YAML, alta de agente/skill con plantilla y confirmación en línea para eliminar. Sección de propuestas pendientes con Guardar/Descartar. Cada guardado informa la propagación a los proyectos y los `.nuevo` por ediciones locales.

## Verificación

`apps/server/test/specialist-library.test.ts` (siete pruebas): origen y detección de ediciones, rechazos de rutas y encabezados, contexto inyectado en el prompt, propagación con protección de ediciones locales vía `.nuevo`, borrados con limpieza de manifiesto, el flujo completo de rutas con arnés de dispatcher y el puente de herramientas (descriptor, plugin instalado, edición, borrado, propuesta aceptada y autenticación 401/200). Regresión: `specialist-applications`, `specialist-integrations`, las nueve suites `comex-*` (46 pruebas), tres suites `workspace-*` (34), `packages/features` (26) y la prueba React `apps/app/tests/specialist-applications.test.tsx` (2). Typecheck de `apps/server` y `apps/app` limpios (queda solo el error preexistente de `session-route.tsx`).

## Capturas

(Pendiente: agregar cuando la UI de biblioteca esté disponible.)
