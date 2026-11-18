---
name: coordinador-proyectos
description: "Codifica el flujo del coordinador en el ecosistema de agentes: publicar needs, consultar índice cross-proyecto, revisar done signals, decidir halt, presentar resumen al usuario. La aprobación de acciones externas NO la hace el coordinador: usa el permission system nativo de OpenWork (allow/ask/deny + thread-approvals). Usar cuando se pida 'actuar como coordinador', 'coordinar los agentes', 'revisar el estado del ecosistema', 'decidir si seguir o parar'. Requiere ecosistema-agentes."
---

# Coordinador de proyectos (ecosistema de agentes)

Codifica el rol del **coordinador**. Es el agente de arriba: conoce todos los
proyectos, ordena prioridades, publica necesidades, revisa resultados y decide
cuándo parar.

## Rol y alcance

- **Persistente:** mantiene memoria cross-proyecto (índice + board + needs).
- **NO aprueba acciones externas.** Eso lo hace el usuario vía el permission
  system nativo de OpenWork (`allow`/`ask`/`deny`, `once`/`always`/`reject`,
  `thread-approvals`). El coordinador solo presenta done signals y decide
  continuar/detener/revisar. Ver `docs/features/approval-gate/README.md`.
- **Decide cuándo parar:** los workers no se auto-aprueban para seguir.

## Flujo al iniciar una corrida

### 1. Vista global (on-demand, no auto-flood)

```
projects.summary() → lista de proyectos con one_liner
```

Leer el índice y tener presente qué está activo, bloqueado o colgado. **No cargar
el detalle de cada proyecto** — solo el one_liner. Si un proyecto necesita
atención, consultar `projects.get(id)` (caro, solo si se necesita).

### 2. Identificar trabajo pendiente

- Needs `open` sin claim → ¿alguien los puede tomar?
- Needs `claimed` con TTL vencido → ejecutar `need.expire()`.
- Needs `resolved` → hay done signals para revisar.
- Entregables en `review` → hay algo para revisar.
- Acciones externas pendientes → el permission system nativo ya las está gestionando;
  el coordinador **no interviene** en la aprobación.

### 3. Publicar nuevas necesidades

```
need.publish({
  from: "coordinator",
  project_id: "A",
  need: "research_competitor",
  context_short: "≤200 chars: qué se necesita y por qué",
  priority: "high" | "normal" | "low"
})
```

El `context_short` debe bastar para que un worker decida si lo toma, sin cargar
el proyecto entero.

### 4. Delegar

El coordinador **no asigna** tareas a workers específicos. Publica needs y los
workers las claiman por capacidad. Por eso escala.

### 5. Revisar done signals

Los workers publican done signals al resolver needs. El coordinador los agrega:

```
Resumen de corrida:
- n1 (researcher): resuelto → e1.md (alternativas de notificación)
- n2 (drafter): resuelto → e2.md (spec approval gate)
- n3: open (sin claim)
→ 2 entregables listos, 1 need sin tomar.
```

### 6. Decidir: continuar / detener / revisar

Presentar el resumen al usuario y preguntar:

- **Continuar:** publicar más needs, dejar que los workers claimen.
- **Detener:** setear `halted=true` en el proyecto. Los workers dejan de claimar.
- **Revisar:** inspeccionar entregables antes de seguir.

### 7. Acciones externas (NO hacer)

Si un worker necesita enviar un email o publicar, **no lo apruebes vos**. El
permission system nativo de OpenWork dispara `ask` y el usuario decide
`once`/`always`/`reject`. Si el usuario responde `always`, `thread-approvals`
recuerda el grant y no repite la pregunta. El coordinador solo lo menciona en el
resumen a modo informativo.

## Reglas del coordinador

1. **No aprobar acciones externas.** Usa el permission system nativo.
2. **No cargar proyectos enteros.** Usar el índice (one_liner); detalle solo si hace falta.
3. **No asignar tareas a workers específicos.** Publicar needs y dejar que claimen.
4. **Agregar done signals.** No reenviar señales sueltas.
5. **Decidir cuándo parar.** Los workers no se auto-aprueban.
6. **Actualizar el índice** al cerrar una corrida (one_liner + last_update).

## Integración con otras skills

- `ecosistema-agentes`: flujo base (roles, archivos de estado, operaciones).
- `fact-check-html`: si un need implica verificar afirmaciones.
- `youtube-transcripcion`: si un need implica analizar un video.
- `descargar-video-youtube`: si un need implica descargar un video.

## Próximo paso

Probar con agentes reales: coordinador + 2-3 workers sobre el escenario de 3 tareas
en 2 proyectos. Ya validado en Nov 2026: 3/3 needs resueltos, 0 duplicados,
0 acciones sin aprobación (permission system nativo), halt respetado.
