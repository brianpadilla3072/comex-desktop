---
name: ecosistema-agentes
description: "MVP de ecosistema de agentes escalable: coordinador + agentes de volumen con approval gate (propuesta→aprobación→ejecución), need bus con claim atómico (anti-duplicación), índice cross-proyecto on-demand y board de entregables. Usar SIEMPRE que se pida 'montar un ecosistema', 'correr varios proyectos en paralelo', 'coordinar agentes', 'que los agentes se repartan trabajo sin duplicar', o cuando se quiera probar si la orquestación mejora la experiencia. Estado en archivos JSON del proyecto (no DB)."
---

# Ecosistema de agentes (MVP v0)

Implementa el patrón del video de Instagram (coordinador + agentes de volumen +
approval gate + need bus + índice cross-proyecto) usando **solo archivos JSON del
proyecto** (sin DB, sin código nuevo). Sirve para testear si mejora la experiencia
antes de convertirlo a código real.

## Archivos de estado (en `proyecto/`)

| Archivo | Propósito |
|---|---|
| `proyecto/aprobaciones.json` | Approval gate: propuestas pendientes/aprobadas/rechazadas |
| `proyecto/needs.json` | Need bus: necesidades abiertas/claimed/resueltas |
| `proyecto/indice-proyectos.json` | Índice cross-proyecto (resúmenes ≤120 chars) |
| `proyecto/board.json` | Board de entregables (dueño, estado, comentarios) |

## Roles

- **coordinator**: publica needs, consulta índice, aprueba/rechaza propuestas, decide cuándo parar.
- **worker** (researcher, drafter, reviewer, monitor): claim needs, trabaja, resuelve, propone aprobaciones.

## Flujo del coordinador

1. Al iniciar: `projects.summary()` → vista global de todos los proyectos.
2. Identificar trabajo pendiente → `need.publish({from, project, need, context_short, priority})`.
3. Delegar: los workers claiman y resuelven.
4. Revisar done signals → decidir: continuar / detener / revisar.
5. Si "detener": setear `halted=true` en el proyecto.

## Flujo del worker

1. Al iniciar: `need.list({status: "open", capabilities: [mis_caps]})`.
2. Si hay needs abiertos: `need.claim(id)` (atómico). Si `ALREADY_CLAIMED`, pasar al siguiente.
3. Trabajar en el entregable → `board.create(...)` o editar draft existente.
4. Al terminar: `need.resolve(id, result_ref)` + publicar done signal.
5. Si necesita aprobación para acción externa: `approval.propose(...)` y **no ejecutar**.
6. Si `halted=true` en el proyecto: terminar lo que tiene en curso y detenerse.

## Operaciones (implementar con archivos JSON + flock)

### Need Bus

```bash
# Publicar necesidad
echo '{"id":"n1","from":"coordinator","project":"A","need":"research_competitor","context_short":"Investigar alternativas de notificación para el board","priority":"high","status":"open","claimed_by":null,"claimed_at":null,"result_ref":null,"created_at":"2026-11-14T10:00:00Z"}' >> proyecto/needs.json

# Claim atómico (primer writer gana)
# Usar flock o mkdir como lock:
(
  flock -x 200
  # verificar que claimed_by es null, si sí → actualizar
) 200>proyecto/needs.lock

# Resolver
# Actualizar status="resolved", result_ref="path/al/entregable.md"
```

### Approval Gate

```json
{"id":"a1","action":"send_email","reason":"Enviar minuta a cliente X","payload":{...},"status":"pending","proposed_by":"drafter","proposed_at":"...","decided_by":null,"decided_at":null}
```

Estados: `pending` → `approved` | `rejected` | `modified`.
**Regla:** el agente NUNCA ejecuta la acción. Solo propone. El usuario decide.

### Índice cross-proyecto

```json
{"project_id":"A","session_id":"s1","agent_id":"coordinator","title":"Proyecto A","status":"active","last_update":"2026-11-14T10:00:00Z","one_liner":"Investigando alternativas de notificación y redactando spec"}
```

Consultar con: `cat proyecto/indice-proyectos.json | jq '.[] | select(.project_id=="B")'`

### Board de entregables

```json
{"id":"e1","project_id":"A","owner_agent":"researcher","title":"Alternativas de notificación","status":"draft","draft_path":"proyecto/entregables/e1.md","comments":[],"approval_state":"none","created_at":"...","updated_at":"..."}
```

Estados de entregable: `draft` → `review` → `approved` → `done`.

## Reglas anti-duplicación

1. **Un need `open` solo se puede claim una vez.** La segunda claim falla con `ALREADY_CLAIMED`.
2. **TTL de claim:** 30 min. Si el agente no resuelve en ese tiempo, el claim expira y vuelve a `open`.
3. **Idempotencia:** si un agente ya resolvió un need y vuelve a claimarlo, devuelve el resultado existente.
4. **Done signals agregados:** el coordinador presenta resumen, no señales sueltas.

## Métricas a medir (antes/después)

| Métrica | Sin MVP | Con MVP | Meta |
|---|---|---|---|
| Acciones externas sin aprobación | ? | 0 | 0 |
| Trabajo duplicado (needs repetidos) | ? | 0 | 0 |
| Tokens de contexto por corrida | baseline | medir | -40% |
| Entregables perdidos entre sesiones | ? | 0 | 0 |
| Tiempo total del escenario | baseline | medir | reducir |

## Escenario de prueba

3 tareas en 2 "proyectos" simulados:

| Tarea | Proyecto | Agente | Tipo |
|---|---|---|---|
| Investigar alternativas de notificación | A | researcher | volumen |
| Redactar spec de approval gate | A | drafter | volumen |
| Revisar spec de approval gate | B | reviewer | volumen |

**Baseline (sin MVP):** correr las 3 tareas con flujo actual (subagentes síncronos, sin approval gate, sin need bus). Registrar métricas.

**Con MVP:** correr las mismas 3 tareas con el flujo nuevo. Registrar métricas.

**Comparar** y decidir si vale la pena implementar en código.

## Lo que NO incluye el MVP

- Runner cloud (sigue dependiendo del desktop).
- Notion (solo archivos locales).
- Observabilidad (dashboard) — solo logs en archivos.
- Roles formales (usa convención de nombres en las skills).
- Multi-tenant (un solo usuario).

## Próximo paso

Ejecutar el escenario de prueba. Si las métricas se cumplen, convertir a código
(empezando por el approval gate, que es el cuello de botella).

## Limpieza de memoria (RAM y disco)

- **RAM (Whisper):** tras transcribir, siempre `del model; gc.collect()` (y
  `torch.cuda.empty_cache()` si se usó GPU). No dejar el modelo cargado entre
  corridas. Usar el modelo mínimo viable (`tiny` para pruebas, `base` para
  calidad aceptable).
- **Disco (temporales):** borrar WAV temporales después de transcribir. Borrar
  audio extraído si ya se transcribió (con confirmación). Borrar videos muteados
  si el original sigue existiendo. Ejecutar `limpiar.sh` semanalmente.
- **No borrar:** `~/.cache/huggingface/` (modelos Whisper, ~220 MB, necesarios),
  `transcripciones/*.md` y `*.html` (entregables), `proyecto/*.json` (estado).
- **Ver detalle completo:** `docs/features/ecosistema-agentes-mvp/limpieza-memoria.md`.
