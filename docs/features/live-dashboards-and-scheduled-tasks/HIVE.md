# HIVE — estado de la colmena (live dashboards & scheduled tasks)

Protocolo por celda: implementar → agente revisor (mantenibilidad/escalabilidad) → arreglar lo
marcado → probar desde el front como usuario real → lista de trabas → siguiente celda.
Orquestador: sesión principal. Cada hito se commitea separado.

| Celda | Pieza | Estado | Commits | Pendientes |
|---|---|---|---|---|
| A | [1] Scheduler tareas | ✅ impl ✅ revisor ✅ fixes ✅ test-front ✅ fixes de las 5 trabas aplicados | `f850096` `ca474c2` `fd3c2dbe` | — (celda cerrada) |
| B | [2] Datasets + captura | ✅ store ✅ wiring ✅ revisor ✅ fixes (`e60a3b1`) · 🔬 test-front EN VUELO | `ca474c2` `01b6ccb` `fd3c2dbe` `e60a3b1` | aplicar HIVE-B-TEST.md |
| B2 | [6] Fuentes y citas | ✅ core + 3/3 | `c144aff` | wiring tras tester B (mismos archivos) |
| C1 | [3] Paneles declarativos | ✅ core ✅ revisor ✅ fixes 8/8 | `7d8ee72` `cd38ddee` | wiring + test-front |
| C2 | [5] Captura ampliada | ✅ core: kinds task/plan con validación at-rest + tests | `094028b` | wiring: enum propose, accept route (task nace PAUSADA), UI kinds |
| C3 | [7] Salidas mini-Studio | ✅ core: validación por tipo + auditoría de citas | `ffd07a7` | wiring |
| F2 | Diff de snapshot | ✅ diffs.ts puro (filas por identidad, escalar, shape honesto) | `4d3387c` | wiring: runner lo llama tras cada refresh; bloque de panel "cambios" |
| D | [4] MCP Apps local | ⬜ | | |
| F1–F5 | Backlog alineado | ⬜ | | |

## Agentes desplegados

- **Test-front A: COMPLETO.** 4/4 tests UI nuevos (`specialist-tasks-ui.test.tsx`) + server real por
  HTTP OK. Hallazgos para arreglar (cola Celda A-fix2, en `HIVE-A-TEST.md`): (1) error de lectura de
  tareas se muestra como "Sin tareas" (mint); (2) 500 de biblioteca secuestra el diálogo entero;
  (3) propuestas piden 404 cuando library off + invisibles; (4) menú/título mentiroso con solo
  tareas; (5) validación de formulario (minutos vacío/0/decimal → 422 genérico; semanal sin días
  cae en lunes silencioso). ⚠️ los fixes tocan library-dialog/provider → ESPERAR al agente B.
- Revisor C1 (panels.ts core): EN VUELO (read-only sobre panels.ts/tests; sin solapamiento con B).
- Revisor A (ses_e3fb899…): COMPLETO. 2 blockers (enum de tools sin names de tareas → casos
  muertos en producción; read-modify-write de tasks.json sin serializar → perder claims/pauses),
  5 importantes (finalize sobre el mensaje ASISTENTE MÁS VIEJO por order=desc; readJson se tragaba
  errores y vaciaba la lista; UI inalcanzable con library=off; evidencia de corridas fuera del
  workspace; sin refetch → estados viejos). **Todos aplicados** en `ca474c2` + tests de regresión
  (ruta-level tools, newest-first, skipped_overlap, evidencia comex/tareas/). El revisor recomendó
  enmendar el spec (estado en JSON por aplicación, no KV) — hecho en el doc [1].
- Wiring B (ses_e3f9db9…): EN VUELO — rutas datasets por aplicación (agregadas por workspace),
  4 tools de motor (list/read/refresh/derive), gating de descriptor con las 3 flags, UI "Datos de
  investigación", tests de rutas + puente + React.

## Reglas del enjambre (autoimpuestas)

- No editar archivos que un agente activo está leyendo/escribiendo (se anotan arriba).
- Cada celda: tsc server + tsc app + suites specialist-*/comex-* verdes antes de commitear.
- Flags nuevas: default on self_hosted (como specialistLibrary); las que despachan prompts
  muestran el prompt completo en la UI antes de activar.
- Evidencia SIEMPRE en el workspace del proyecto (auditable, git), estado en specialists/<app>/.
- nothing-forever: si un agente falla o no notifica, el orquestador re-depliega con su informe.
