# Guía: approval gate nativo de OpenWork (para el ecosistema de agentes)

## Punto clave

**No existe un approval gate propio del ecosistema de agentes.** OpenWork ya tiene
uno robusto y probado en el producto. El ecosistema **lo reutiliza**; no crea un
segundo sistema de permisos que competiría con el nativo.

Este documento reemplaza el spec original de "approval gate nuevo" (que proponía
un archivo `aprobaciones.json` y una API propia) por el mapeo al sistema existente.

## Qué existe en el producto (verificado en el código)

| Pieza | Ubicación | Función |
|---|---|---|
| Decisiones de permiso | `packages/types/src/den/agent-permissions.ts` | `AGENT_PERMISSION_DECISIONS = ["allow", "ask", "deny"]`. Decisión por defecto: `allow`; `browserUploads` = `ask`. |
| Estado reportado | `agent-context-diagnostics.ts`, `apps/server/src/agent-context-diagnostics.ts` | `ask` → `"approval-required"` en el diagnóstico de contexto del agente. |
| Acciones gobernadas | `AGENT_PERMISSION_ACTIONS` | `shell`, `edit`, `webfetch`, `websearch`, `skill`, `mcp`, `external_directory`, `computer`, `computer_files`, `computer_clipboard`, `script`, `browser_upload`. |
| RPC que espera la respuesta | `apps/server/src/opencode-plugins/approval-loopback-fetch.ts` | `approvalLoopbackFetch`: loopback a `127.0.0.1`/`localhost`, sin headersTimeout ni bodyTimeout, para que la espera humana (600 s) no se corte. |
| Respuestas humanas | `packages/types/src/desktop-companion.ts`, `opencode-v2-context-bridge.ts` | El companion envía `{ kind: "permission", requestId, reply: "once" \| "reject" }`. El bridge acepta `once` / `always` y trata el decline como rechazo. |
| Memoria de aprobaciones por thread | `apps/server/src/thread-approvals.ts` | Guarda los reply `always` por (workspace, session). Cuando el engine vuelve a preguntar lo mismo en el mismo thread, responde `always` automáticamente. El engine sigue siendo el único adjudicador. |
| Modos de permisos por workspace | `apps/server/src/comex/permission-mode-routes.ts` | Perfiles `allow`/`ask`/`deny`, con hash y revisión; rutas `GET/POST /workspace/:id/permission-modes`. |
| Endpoint del engine | `apps/server/src/engine-pool.ts` | `/permission/:id/reply`, `/question/:id/reply` (y variantes `/api/session/:id/...`). |

## Cómo lo usa el ecosistema

### Principio

Un worker (subagente) que quiere hacer una acción externa —enviar email, publicar,
subir un archivo, ejecutar un script— **no la ejecuta directamente**. La acción pasa
por el permission system de OpenWork, que dispara un `ask`. El usuario responde
`once` / `always` / `reject` desde la UI (o el companion). Si responde `always`,
`thread-approvals` recuerda la decisión para no repetir la pregunta en ese thread.

### Mapeo del diseño del MVP al sistema nativo

| Concepto del MVP | Equivalente nativo |
|---|---|
| `approval.propose(...)` | El worker intenta la acción; el engine evalúa el permiso → `ask` |
| propuesta `pending` | Petición de permiso en espera de respuesta (SSE vía `approvalLoopbackFetch`) |
| `approval.decide("approve")` | reply `once` o `always` |
| `approval.decide("reject")` | reply `reject` (decline) |
| "no ejecutar sin aprobación" | El engine bloquea la acción hasta el reply; `approval-required` en el diagnóstico |
| "recordar la aprobación" | `thread-approvals` (reply `always` por workspace+session) |
| perfiles de permisos | `permission-mode-routes` (modos por workspace) |

### Flujo real

1. El worker decide enviar un email (o publicar, o subir un archivo).
2. El motor consulta el permiso correspondiente: `ask`.
3. Se emite una petición de permiso con `id`, `title`, `detail`, `busy` (ver `desktop-companion.ts`).
4. El usuario responde desde la UI: **Una vez** (`once`), **Siempre** (`always`) o **Rechazar** (`reject`).
5. Si aprueba, la acción se ejecuta. Si rechaza, no.
6. Si fue `always`, `thread-approvals` guarda el grant y responde automáticamente
   en futuras peticiones del mismo thread que coincidan con el patrón.

### Qué NO hacer

- No crear `proyecto/aprobaciones.json` como sistema de aprobación. (El archivo que
  quedó del test del MVP es un artefacto de prueba, no parte del diseño.)
- No implementar `POST /approvals`, `approval.decide`, ni un endpoint propio.
- No simular aprobaciones con un flag en el board. Eso crearía dos sistemas de
  permisos y el approval gate nativo quedaría rodeado.
- No extender permisos ni autorizaciones: el ecosistema **usa** el sistema existente,
  no lo modifica.

## Cómo configurar el ecosistema para que use el gate nativo

1. **Elegir el modo de permisos** del workspace con `GET/POST /workspace/:id/permission-modes`.
   - Modo estricto: acciones externalizables en `ask` → el usuario aprueba cada una.
   - Modo laxo: `allow` para acciones de bajo riesgo, `ask` para `browserUploads` y `script`.
2. **Los workers son subagentes**: heredan las decisiones del workspace/session.
3. **El coordinador no aprueba**: solo presenta el resumen de done signals al usuario.
   La aprobación siempre la hace el humano (o un reply `always` previamente granted).
4. **Para labels/entregables**: el board registra `approval_state` como *información*
   (qué fue aprobado), no como mecanismo de aprobación. El mecanismo es el permission system.

## Criterios de aceptación (del MVP, ya satisfechos por el producto)

- [x] El worker no ejecuta la acción externa sin aprobación (engine bloquea en `ask`).
- [x] El usuario puede aprobar `once`, aprobar `always`, o rechazar.
- [x] La aprobación se recuerda por thread (thread-approvals), sin re-preguntar.
- [x] Hay diagnóstico visible del estado (`approval-required`).
- [x] La espera humana no se corta por timeout de HTTP (`approvalLoopbackFetch`).

## Relación con las otras features del ecosistema

- **need-bus**: un need resuelto que implica una acción externa debe pasar por el
  permission system nativo, no por un flag propio.
- **cross-project-index**: el índice puede mostrar `approval_state` a modo informativo.
- **board de entregables**: `approval_state` = metadata del entregable, no mecanismo.
- **coordinador-proyectos**: decide continuar/detener/revisar, pero **no aprueba**.
  La aprobación es del usuario vía permission system.

## Estado del MVP

El test real (Nov 2026) mostró un worker (`drafter`) proponer `send_email` y la
acción quedar `pending` sin ejecutarse — comportamiento que ya provee el sistema
nativo. Los documentos y skills del ecosistema ahora apuntan a ese sistema.
