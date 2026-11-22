# MVP: Ecosistema de agentes escalable

## Objetivo

Validar empíricamente si el patrón "coordinador + agentes de volumen + need bus + índice cross-proyecto" mejora la experiencia real de OpenWork, midiendo antes/después en tareas multi-proyecto. La aprobación de acciones externas usa el permission system nativo de OpenWork (no se construye una propia).

## Hipótesis

1. **Permission system nativo de OpenWork** (`allow`/`ask`/`deny` + `thread-approvals`) bloquea acciones externas no aprobadas sin frenar el trabajo. No se construye un approval gate propio.
2. **Need bus con claim atómico** elimina trabajo duplicado cuando 2+ agentes corren en paralelo.
3. **Índice cross-proyecto on-demand** reduce tokens de contexto en ≥40 % vs. cargar todos los proyectos.
4. **Board de entregables** evita pérdida de contexto entre sesiones.

## MVP scope (v0) — lo mínimo testeable

### Componente 1: Approval Gate → usa el permission system NATIVO de OpenWork

**No se construye un approval gate propio.** OpenWork ya tiene uno robusto y probado:
decisiones `allow`/`ask`/`deny` (`AGENT_PERMISSION_DECISIONS`), estado `approval-required`
en el diagnóstico, `approvalLoopbackFetch` (espera la respuesta humana sin timeout), y
`thread-approvals.ts` (recuerda `always` por thread).

**Flujo real:**
1. Un worker intenta una acción externa (enviar email, publicar, subir archivo).
2. El motor evalúa el permiso → `ask`. La acción queda en espera del reply.
3. El usuario decide `once` / `always` / `reject`.
4. Si aprueba → se ejecuta. Si rechaza → no. Si `always` → se recuerda por thread.
5. El worker no ejecuta ni simula la aprobación por su cuenta.

**Detalle:** `docs/features/approval-gate/README.md`.
**Métrica:** # de acciones externas ejecutadas sin aprobación (debe ser 0). Ya lo garantiza el producto.

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
- Archivos JSON en `proyecto/` (needs.json, indice-proyectos.json, board.json).
- Locks de archivo con `flock` (Linux) o `mkdir` (portable).
- Skills que codifican el flujo (coordinador + workers).
- Automations para los relojes (cada 30 min, 2×/día, semanal).
- Aprobación de acciones externas: permission system nativo de OpenWork (no propio).

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

## Estado (validado Nov 2026)

La skill `ecosistema-agentes` ya existe y el escenario se ejecutó con agentes reales:
3/3 needs resueltos, 0 duplicados, 0 acciones sin aprobación (permission system nativo),
halt respetado. Ver `docs/features/approval-gate/README.md` para el mapeo al gate nativo.

## Próximo paso

Convertir el need bus / índice / board a código real (SQLite + API) si el volumen lo
justifica. El approval gate **no** se convierte: ya existe en el producto.

## Verificación (issue #9)

Comandos de validación para otra sesión:

```bash
cd "/home/brian/Proyectos/build agents and skils/comex-desktop"
pnpm --filter openwork-server typecheck
pnpm --filter @openwork/app typecheck
DEN_FEATURE_AGENT_ECOSYSTEM=true bun test --isolate \
  apps/server/test/agent-ecosystem-routes.test.ts \
  apps/server/test/agent-ecosystem-tools.test.ts \
  apps/server/test/agent-ecosystem-e2e.test.ts
bun test packages/features/src/resolve.test.ts
```

Estado esperado: typecheck limpio, 6 tests del ecosistema (7 tools expuestos, incluyendo `ecosystem_halt`) + 26 de features, 0 fallos.

### Tool `ecosystem_halt`

El coordinador puede detener/reanudar el ecosistema desde un tool (no solo desde la UI):
`ecosystem_halt({ workspaceId, halted: true|false, by })` → `POST /workspace/:id/agent-ecosystem/halt`.
