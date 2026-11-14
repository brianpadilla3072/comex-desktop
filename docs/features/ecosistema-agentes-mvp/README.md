# MVP: Ecosistema de agentes escalable

## Objetivo

Validar empíricamente si el patrón "coordinador + agentes de volumen + approval gate + need bus + índice cross-proyecto" mejora la experiencia real de OpenWork, midiendo antes/después en tareas multi-proyecto.

## Hipótesis

1. **Approval gate** reduce acciones no deseadas (publicaciones, contactos) a 0 sin frenar el trabajo.
2. **Need bus con claim atómico** elimina trabajo duplicado cuando 2+ agentes corren en paralelo.
3. **Índice cross-proyecto on-demand** reduce tokens de contexto en ≥40 % vs. cargar todos los proyectos.
4. **Board de entregables** evita pérdida de contexto entre sesiones.

## MVP scope (v0) — lo mínimo testeable

### Componente 1: Approval Gate (primitivo)

**Estado:** `pending` → `approved` | `rejected` | `modified`

**Flujo:**
1. Un agente (o el coordinador) propone una acción externa: `approval.propose({action, reason, payload})`.
2. Se crea un registro en estado `pending`.
3. El agente **no ejecuta** la acción. Continúa con otras tareas o se detiene.
4. El usuario ve la propuesta (en UI o chat) y decide: aprobar, rechazar, o modificar.
5. Si aprueba → la acción se ejecuta. Si rechaza → se descarta. Si modifica → se re-propone.

**Almacenamiento v0:** archivo JSON en el proyecto (`proyecto/aprobaciones.json`).
**Métrica:** # de acciones externas ejecutadas sin aprobación (debe ser 0).

### Componente 2: Need Bus (claim atómico)

**Estado:** `open` → `claimed` → `resolved` | `failed` | `expired`

**Flujo:**
1. `need.publish({from, project, need, context_short, priority})` → estado `open`.
2. Agente consulta `need.list({status: "open", capabilities: [...]})`.
3. `need.claim(id)` → atómico (`UPDATE ... WHERE claimed_by IS NULL`). Si ya claimed → error `ALREADY_CLAIMED`.
4. Agente trabaja → `need.resolve(id, result_ref)`.
5. Si el agente muere → TTL (30 min) → vuelve a `open`.

**Almacenamiento v0:** mismo JSON (`proyecto/needs.json`), con lock de archivo (`flock`).
**Métrica:** # de needs duplicados (debe ser 0).

### Componente 3: Índice cross-proyecto

**Estructura:** `{project_id, session_id, agent_id, title, status, last_update, one_liner (≤120 chars)}`

**Flujo:**
1. Al cerrar un entregable, el agente actualiza su entrada en el índice.
2. `projects.summary({project_id?})` devuelve el índice (o un proyecto específico).
3. Los agentes consultan on-demand (no auto-inyectado).

**Almacenamiento v0:** `proyecto/indice-proyectos.json`.
**Métrica:** tokens de contexto consumidos por corrida (medir antes/después).

### Componente 4: Board de entregables

**Estructura:** `{id, project_id, owner_agent, title, status, draft_path, comments[], approval_state}`

**Flujo:**
1. `board.create({project_id, title, owner_agent})` → entregable en estado `draft`.
2. El dueño edita el draft. Otros comentan (`board.comment(id, text)`).
3. Al cerrar → `board.close(id)` → actualiza el índice cross-proyecto.

**Almacenamiento v0:** `proyecto/board.json`.
**Métrica:** # de entregables perdidos entre sesiones (debe ser 0).

## Test plan

### Escenario de prueba (real, no sintético)

Usar el propio proyecto OpenWork con 3 tareas en 2 "proyectos" simulados:

| Tarea | Proyecto | Agente | Tipo |
|---|---|---|---|
| Investigar alternativas de notificación | A | researcher | volumen |
| Redactar spec de approval gate | A | drafter | volumen |
| Revisar spec de approval gate | B | reviewer | volumen |

**Medir (antes = sin MVP, después = con MVP):**

| Métrica | Sin MVP | Con MVP | Meta |
|---|---|---|---|
| Acciones externas sin aprobación | ? | 0 | 0 |
| Trabajo duplicado (needs repetidos) | ? | 0 | 0 |
| Tokens de contexto por corrida | baseline | -40% | -40% |
| Entregables perdidos entre sesiones | ? | 0 | 0 |
| Tiempo total del escenario | baseline | medir | reducir |

### Cómo ejecutar el test

1. **Baseline (sin MVP):** correr las 3 tareas con el flujo actual (subagentes síncronos, sin approval gate, sin need bus). Registrar métricas.
2. **Con MVP:** correr las mismas 3 tareas con el flujo nuevo (need bus, approval gate, índice on-demand). Registrar métricas.
3. **Comparar** y decidir si vale la pena implementar en código.

## Implementación v0 (sin código nuevo)

Todo se implementa con:
- Archivos JSON en `proyecto/` (aprobaciones.json, needs.json, indice-proyectos.json, board.json).
- Locks de archivo con `flock` (Linux) o `mkdir` (portable).
- Skills que codifican el flujo (coordinador + workers).
- Automations para los relojes (cada 30 min, 2×/día, semanal).

No se toca el código de la app. Si el MVP valida, se convierte en código real.

## Criterios de éxito

- 0 acciones externas sin aprobación.
- 0 trabajo duplicado.
- Reducción ≥40 % en tokens de contexto por corrida.
- 0 entregables perdidos entre sesiones.
- El usuario dice "esto es mejor que antes" (validación cualitativa).

## Lo que NO incluye el MVP

- Runner cloud (sigue dependiendo del desktop).
- Notion (solo archivos locales).
- Observabilidad (dashboard) — solo logs en archivos.
- Roles formales (usa convención de nombres en las skills).
- Multi-tenant (un solo usuario).

## Próximo paso

Crear la skill `ecosistema-agentes` que codifica el flujo del MVP y ejecutar el
escenario de prueba. Si las métricas se cumplen, convertir a código (empezando
por el approval gate, que es el cuello de botella).
