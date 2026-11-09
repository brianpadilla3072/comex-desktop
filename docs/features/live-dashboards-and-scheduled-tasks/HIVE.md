# HIVE — estado de la colmena (live dashboards & scheduled tasks)

Protocolo por celda: implementar → agente revisor (mantenibilidad/escalabilidad) → arreglar lo
marcado → probar desde el front como usuario real → lista de trabas → siguiente celda.
Orquestador: sesión principal. Cada hito se commitea separado.

| Celda | Pieza | Estado | Commits | Pendientes |
|---|---|---|---|---|
| A | [1] Scheduler tareas | ✅ impl ✅ revisor ✅ fixes ✅ test-front ✅ fixes de las 5 trabas aplicados | `f850096` `ca474c2` `fd3c2dbe` | — (celda cerrada) |
| B | [2] Datasets + captura | ✅ store ✅ wiring ✅ revisor ✅ fixes (`e60a3b1`) ✅ test-front ✅ fixes B-1/B-2 | `ca474c2` `01b6ccb` `fd3c2dbe` `e60a3b1` `1ea7aa9` | — (celda cerrada; ver `HIVE-B-TEST.md`) |
| B2 | [6] Fuentes y citas | ✅ core + wiring: registro automático en research, ruta /sources, tool source_read, UI lector de pasajes · ✅ server 56/56 ✅ UI 21/21 | `0ef3fd8` | ✅ revisor ✅ front-test (C) |
| C1 | [3] Paneles declarativos | ✅ core ✅ revisor ✅ fixes ✅ wiring: rutas/tools + renderer SVG determinista, multi-proyecto con fallo local · ✅ server 104/104 · ✅ UI 24/24 | `4da9b06` | ✅ front-test (C) |
| C2 | [5] Captura ampliada | ✅ core + wiring: enum propose task/plan, accept por pieza (task nace PAUSADA), UI kinds · ✅ server 43/43 ✅ UI 18/18 | `fcad758` | ✅ front-test (C) |
| C3 | [7] Salidas mini-Studio | ✅ core + wiring: rutas/tools, generate devuelve auditoría de citas, UI lector con estado de anclas · ✅ server 106/106 · ✅ UI 26/26 | `e46e0a5` | ✅ front-test (C) |
| F2 | Diff de snapshot | ✅ core + wiring: el runner difunde antes/después de cada refresh (`comex/datasets/<id>/diffs/`), bloque "cambios" del panel | `4da9b06` | ✅ front-test (C) |
| REV | Revisor server (ses_e3ebb3ff) | ✅ 6 blockers + 8 importantes + 5 menores → aplicados (`specialist-reviewer-fixes.test.ts`, 10) | `1ee8323` | — |
| REV-ui | Revisor UI (ses_e3eb290d) | ✅ blockers 1-4 + imp 6,7,9-11,19 aplicados · diferidos: #5 shells, #12, #15, #17 (#13 no aplica: paths relativos) | `1ee8323` | — |
| TEST-C | Front-test recorrido completo | ✅ 15/15 (`specialist-live-user.test.tsx`) + trabas C-1/C-2 corregidas | `1ee8323` | — |
| F1 | Sources locales | ✅ wiring: `registerLocalSource` (snapshot en comex/fuentes/local/, containment+symlink), ruta/tool `source_add`, UI "Registrar archivo" · ✅ server 122/122 | `F1FIX` | — |
| D | [4] MCP Apps local | ⬜ | | |
| F3 | Ensayo de tareas | ✅ wiring: `dryRun` en scheduler (sin claim/cola/evidencia), ruta + botón "Ensayar" con flag taskDryRun · ✅ server + UI | `0358d8f` | — |
| F4 | Presupuesto de corrida | ✅ wiring: `estimateTaskBudget` (tiempo/espacio local) en create/update + estimado en vivo en el form | a53117cb8a | — |

## Agentes desplegados

- **Test-front A: COMPLETO.** 4/4 tests UI nuevos (`specialist-tasks-ui.test.tsx`) + server real por
  HTTP OK. Hallazgos para arreglar (cola Celda A-fix2, en `HIVE-A-TEST.md`): (1) error de lectura de
  tareas se muestra como "Sin tareas" (mint); (2) 500 de biblioteca secuestra el diálogo entero;
  (3) propuestas piden 404 cuando library off + invisibles; (4) menú/título mentiroso con solo
  tareas; (5) validación de formulario (minutos vacío/0/decimal → 422 genérico; semanal sin días
  cae en lunes silencioso). ⚠️ los fixes tocan library-dialog/provider → ESPERAR al agente B.
- **Test-front B: COMPLETO.** `specialist-datasets-user.test.tsx` (5 tests / 38 asserts) contra el
  server real + UI headless: (B-1) el resumen de home mostraba "Sin datasets todavía" cuando el GET
  fallaba → ahora rama `isError` con "No se pudieron leer los datasets" + "Volver a intentar";
  (B-2) un fallo del proveedor al refrescar salía como 500 "Unexpected server error" → ahora
  `ApiError(502, "dataset_refresh_provider", mensaje legible)`. Ambos con test de regresión.
- Revisor C1 (panels.ts core): COMPLETO. 3 blockers (JSON.parse lanzaba en vez de `ok:false`;
  prefijo de rutas Windows) + importantes (serialización del índice, esquema estricto, symlink
  intermedio, agregado compartido). Aplicados en `cd38ddee` con 8/8 tests.
- Revisor A (ses_e3fb899…): COMPLETO. 2 blockers (enum de tools sin names de tareas → casos
  muertos en producción; read-modify-write de tasks.json sin serializar → perder claims/pauses),
  5 importantes (finalize sobre el mensaje ASISTENTE MÁS VIEJO por order=desc; readJson se tragaba
  errores y vaciaba la lista; UI inalcanzable con library=off; evidencia de corridas fuera del
  workspace; sin refetch → estados viejos). **Todos aplicados** en `ca474c2` + tests de regresión
  (ruta-level tools, newest-first, skipped_overlap, evidencia comex/tareas/). El revisor recomendó
  enmendar el spec (estado en JSON por aplicación, no KV) — hecho en el doc [1].
- Wiring B (ses_e3f9db9…): COMPLETO — rutas datasets por aplicación (agregadas por workspace),
  4 tools de motor (list/read/refresh/derive), gating de descriptor con las 3 flags, UI "Datos de
  investigación", tests de rutas + puente + React.

## Próxima ola (wiring sobre archivos ya libres)

| Celda | Qué falta cablear |
|---|---|
| C2 | `specialist_propose` con kinds `task`/`plan`; ruta `accept` que crea la tarea **pausada**; UI de propuestas con el kind |
| B2 | la captura de research registra `sources`; ruta `/sources`; tool `specialist_source_read`; chips de cita en el panel |
| C1 | rutas `specialist_panel_*` + tools + renderer (agregado compartido con `panelAggregate`) |
| C3 | tools/UI de salidas (mindmap/report/flashcards/quiz/table) con auditoría de citas |
| F2 | el runner llama `diff` tras cada refresh; bloque "cambios" del panel |

## Reglas del enjambre (autoimpuestas)

- No editar archivos que un agente activo está leyendo/escribiendo (se anotan arriba).
- Cada celda: tsc server + tsc app + suites specialist-*/comex-* verdes antes de commitear.
- Flags nuevas: default on self_hosted (como specialistLibrary); las que despachan prompts
  muestran el prompt completo en la UI antes de activar.
- Evidencia SIEMPRE en el workspace del proyecto (auditable, git), estado en specialists/<app>/.
- nothing-forever: si un agente falla o no notifica, el orquestador re-depliega con su informe.
