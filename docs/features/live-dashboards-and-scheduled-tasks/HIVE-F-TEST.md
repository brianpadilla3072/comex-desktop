# HIVE-F-TEST — Probando las celdas F (F1 fuentes locales, F3 dry-run, F4 presupuesto, F5 OpenAPI) como persona real

**Estado: traba F-1 CORREGIDA** (orquestador: la caja "Resultado de la propuesta
aceptada" se renderiza aunque el inbox quede en 0 tras aceptar la última).
Test de usuario `specialist-live-f-user.test.tsx` (**9 tests, 56 asserts, todos
en verde**, `cd apps/app && bun test tests/specialist-live-f-user.test.tsx`).

Rol: *front tester* de la celda F. Recorridos F1/F3/F4/F5 pasando por el menú real
("Contexto, agentes y skills") con fetch mockeado con las formas JSON reales de
`apps/server/src/specialists/routes.ts` y `library-tool-api.ts` (catálogo con
`sourcesLocalFilesEnabled`/`taskDryRunEnabled`, `{ source }` 201 y 422 `invalid_source`,
dry-run `{ started, sessionId, workspaceId, detail, note }`, `{ proposals }` y accept
`{ accepted, applied }`, y el plan OpenAPI de `specialist_openapi_propose`: skill + dataset
`provider:"openapi"` re-ejecutable + panel de tabla, sin credenciales). No modifiqué código
de producción. No commiteé nada.

- Test escrito: `apps/app/tests/specialist-live-f-user.test.tsx` — **9 tests, 56 asserts, todos
  en verde**. No cambié ni una línea de componentes para que pasen.
- El mock del plan OpenAPI replica verbatim la forma que arma `specialist_openapi_propose`
  (skill `consultar-*`, dataset `name` + `query.provider:"openapi"/operation:"fetch"/input.url`,
  panel `*-panel` con bloque `table`); el plan **no** trae `task`, por eso el resumen esperado
  es exactamente "skill + dataset + panel" y no "… + tarea pausada".

## Qué funciona

- **F1 (local sources):** con `sourcesLocalFilesEnabled=true`, la vista Fuentes muestra
  "Archivo local" + botón "Registrar archivo". Al abrirlo aparece el campo
  `source-local-path` con label "Ruta en el proyecto (texto, CSV, Markdown o HTML)". Escribir
  `datos/informe.md` y pulsar "Registrar como fuente" POSTea
  `/specialist-applications/app_test/sources/local` con `{ path: "datos/informe.md" }` tal
  cual se tipeó, y ante el 201 la app muestra "Fuente registrada: informe.md. Ya se puede
  citar como [fuente:src_local_9f8a7b6c#n]." y la fila nueva (`file`) aparece en la lista.
  Con un 422 (formato `.pdf`), el mensaje del server ("El formato .pdf todavía no se puede
  indexar como fuente (PDF/XLSX pendientes de extractor).") se ve en `role="alert"`, el
  formulario **sigue abierto** (input y botón presentes) y no hay notice de éxito: no hay
  cierre silencioso. Con la flag en `false` ni "Archivo local" ni la Serlab: el form no
  existe y no sale ningún POST.
- **F3 (dry-run):** con `taskDryRunEnabled=true`, cada fila de tarea muestra "Ensayar". Al
  pulsar, el POST a `/tasks/task_1/dry-run` sale una vez y aparece "Ensayo lanzado: corre en
  una sesión aparte y no guarda nada. Mirá el chat nuevo." — el aviso es el `note` del
  server, no un texto inventado. Con la flag en `false` el botón no existe y no sale ningún
  dry-run (ya cubierto también por el test hermano `specialist-dryrun-ui.test.tsx`, que no
  toqué).
- **F4 (presupuesto vivo):** "Nueva tarea" + nombre + prompt con el intervalo por defecto
  (20 min) muestra en vivo "Costo estimado: ≈ 72 corridas/día · ≈ …k tokens/día · ≈ … MB/día
  de snapshots en el proyecto." (espejo de `estimateTaskBudget` en `tasks.ts`). Con intervalo
  `0` la línea de costo **desaparece** y en su lugar se ve `role="alert"` "Indicá cada
  cuántos minutos: un entero entre 1 y 43200."; al volver a un valor válido (60) el costo
  reaparece ("24 corridas/día"). Con kind "Una vez" el costo es "Una sola corrida: sin costo
  recurrente." (y ya **no** dice "corridas/día"), con el campo de fecha visible y obligatorio
  para crear — la estimación no miente sobre lo que falta.
- **F5 (OpenAPI):** el plan del inbox (OpenAPI) renderiza badge "Plan", su descripción
  ("Pack de consulta para la API de api-soja (2 GET).") y el resumen "Al aceptar se aplican:
  skill + dataset + panel" (sin "tarea pausada", porque el pack OpenAPI no trae tarea). Al
  aceptar, el POST es al `prop_*` correcto y el panel "Resultado de la propuesta aceptada"
  lista "✓ skill", "✓ dataset", "✓ panel" — siempre que haya otra propuesta en el inbox (ver
  traba F-1).

## Dónde me trabo

1. **Paso:** inbox con **exactamente una** propuesta (el plan OpenAPI) → "Aceptar" →
   resultado por pieza. **Qué pasa:** el POST llega y `acceptCalls` es correcto, pero el panel
   "Resultado de la propuesta aceptada" **nunca se ve**: tras el `await query.refetch()` la
   lista vuelve vacía y la sección hace `return null`, descartando el `notice` que se acaba
   de setear. La persona ve el diálogo sin propuestas y sin saber si se aplicó algo o qué
   falló. **Qué faltaría:** que el `notice` (y el `error`) se rendericen aunque
   `proposals.length === 0`, o que el `return null` se salte cuando hay `notice` (traba F-1).

## Bugs UI encontrados (documentados, no arreglados)

- **F-1 `library-dialog.tsx` ProposalsSection (~757-761) — el resultado por pieza desaparece
  si era la última propuesta del inbox.** `act("accept")` hace `setNotice(result.applied)` y a
  continuación `await query.refetch()`; si el inbox queda en `[]`, el early return
  `if (!proposals.length) return null` se ejecuta **antes** de renderizar el `notice`, así que
  la respuesta `{ applied }` del server (`routes.ts:197-248`, cada pieza con su propio gate) se
  pierde en silencio. Es la versión aguda del bug ya documentado en HIVE-C para planes: con
  2+ propuestas sí se ven los `✓/✗` (por eso el test verde agrega una propuesta de relleno,
  `prop_skill_retry`, para no endosar el bug), pero con **una sola** el usuario acepta a ciegas.
  Repro: inbox con 1 plan OpenAPI (`prop_openapi`) → menú → "Contexto, agentes y skills" →
  Aceptar → esperar >100 ms → buscar "Resultado de la propuesta aceptada": no está; el inbox
  quedó vacío sin aviso. El fix esperado es renderizar el `notice` del accept también con
  inbox vacío (y cubrirlo con un assert con 1 sola propuesta).

## Mejoras puntuales pedidas a Celda F (o a quien toque)

1. **F-1:** en `ProposalsSection`, mover el `return null` de inbox vacío debajo del `notice`/`error`
   (o hacer `if (!proposals.length && !notice && !error) return null`). Cubrir con un test de
   1 sola propuesta que afirme "✓ skill" tras aceptar (hoy deliberadamente no aserto ese
   camino con 1 propuesta para no asertar el bug; el test actual usa 2 propuestas y documenta
   el comentario `// Dos propuestas (F-1)` en el fixture).

## Notas del test (aclaraciones honestas)

- Cada test re-renderiza desde el menú con la misma app (`Taller`, `ws_test`) y el mismo
  `flush` de 60–150 ms que los tests hermanos; el `edit` usa el setter nativo de
  `HTMLInputElement`/`HTMLTextAreaElement` + evento `input` (mismo helper que
  `specialist-tasks-ui.test.tsx`).
- Los mocks de `sources/local` y `dry-run` y los `applied` del accept emulan las respuestas
  reales de `routes.ts` (códigos `invalid_source`/`task_dry_run_disabled`/`sources_local_files_disabled`
  y sus mensajes) y la forma del plan de `library-tool-api.ts` (`provider:"openapi"`); el
  texto exacto del `note` del dry-run es el que devuelve el server, no el que inventa la UI.
- **Deliberadamente no probé acá** (cubiertos por tests hermanos o porque exceden el recorrido
  honesto F): crear/editar/eliminar tareas o paneles/salidas (ya en `specialist-*-ui.test.tsx`),
  gating con cada flag apagada salvo las dos de esta celda, el reintento tras un 500 de
  fuentes/tareas (ya verificado en HIVE-C paso 8), "Correr ahora sobre tarea pausada", la
  estimación con kind `daily`/`weekly` día a día (solo afirmo intervalo y `once`, que son los
  caminos pedidos, y que el valor inválido oculta el costo), y un 422 por ruta inexistente
  (`"Ese archivo no existe en este proyecto."`) además del de formato — el camino del form
  error es el mismo y ya está afirmado con el PDF.
