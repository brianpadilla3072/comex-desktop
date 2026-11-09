# HIVE-FULLUI-TEST — Sesión completa como persona real, con todos los flujos de ESCRITURA

**Estado: trabas U-1 y U-2 CORREGIDAS** (orquestador: confirmación inline para
borrar tareas/paneles/salidas; botón Actualizar visible para datasets
`openapi` con la negativa honesta del server). F-1 verificada CORREGIDA en
sesión (el resultado por pieza sobrevive aunque era la última propuesta).
C-1 y C-2 también se ven corregidas en el código. Test de usuario
`specialist-full-ui-session.test.tsx` (**1 test, 87 asserts, en verde**,
`cd apps/app && bun test tests/specialist-full-ui-session.test.tsx`, timeout del test
60 s porque la sesión completa tarda ~7 s).

Rol: *front tester* de la sesión FULL-UI. Un solo render, una sola apertura del diálogo desde el
menú ("Contexto, agentes y skills"), todo en orden y con el mismo estado mutable del server
emulado: home con las seis secciones → tareas (crear/pausar/correr/ensayar/historial) → datasets
(vista previa, Actualizar 422, eliminar) → fuentes (registro local OK + 422, abrir pasajes) →
paneles (bloques + error por proyecto) → salidas (auditoría en 3 estados, eliminar) → propuestas
al final (el accept las retira del inbox). Catálogo con todas las flags en `true` (biblioteca,
tareas, `taskDryRunEnabled`, datasets, fuentes, `sourcesLocalFilesEnabled`, paneles, salidas).
No modifiqué código de producción. No commiteé nada. No edité ningún archivo de producción
(lo único creado además de este informe es el test).

- Test escrito: `apps/app/tests/specialist-full-ui-session.test.tsx` — **1 test, 87 asserts,
  en verde**. Harness idéntico a `specialist-dryrun-ui.test.tsx` (mock de
  `openwork-connection`, `SpecialistApplicationsProvider` + `SpecialistApplicationSwitcher` vía
  `MemoryRouter`, diálogo desde el menú) y fetch mockeado con las formas JSON reales de
  `apps/server/src/specialists/routes.ts` (`{ task, tasks, budget }`, `{ started, detail, tasks }`,
  `{ started, sessionId, workspaceId, detail, note }`, `{ runs }`, `{ dataset, snapshots, latest }`,
  `{ source }` 201 / 422 `invalid_source`, `{ spec, resolutions }`, `{ output, content, truncated }`,
  `{ audit }`, `{ accepted, applied }`). El estado emulado es mutable entre pasos (tasks, runsByTask,
  datasets, sources, outputs, proposals) y cada escritura POST/PUT/DELETE se aserta por cuerpo y
  por efecto visible, no solo por el aviso.

## Qué funciona (verificado en la sesión)

- **Paso 1 — título y home honestos:** el título lista las seis secciones ("Contexto, agentes y
  skills · Tareas · Datos · Fuentes · Paneles · Salidas de Taller") y cada resumen del home
  muestra su fila real (tarea, dataset, panel, fuente, salida, agentes/skills con conteo,
  "Propuestas pendientes (2)"). Nada inventado ni oculto.
- **Paso 2 — tareas (escritura completa):** "Nueva tarea" + nombre `vigilar aranceles` + prompt →
  línea viva "Costo estimado: ≈ 72 corridas/día · …" antes de crear (F4 vivo); POST
  `/tasks` con body exacto `{ name, prompt, schedule: { kind: "interval", everyMinutes: 20 } }`
  → notice "Tarea creada y activada." y fila nueva "Cada 20 min". "Pausar" → PUT
  `{ enabled: false }` → badge "Pausada" + "Reanudar". "Correr ahora" sobre la pausada → POST
  `run-now` → notice "Corrida iniciada…" (es el comportamiento del server: `trigger` manual no
  chequea `enabled`, sólo el scheduler programado lo hace — `scheduler.ts:77`). "Ensayar" → POST
  `dry-run` → notice "Ensayo lanzado: corre en una sesión aparte y no guarda nada…". "Corridas" →
  expande el historial con la corrida manual recién creada ("corriendo" + "a pedido"), i.e. el
  round-trip completo crear → correr → ver el historial funciona.
- **Paso 3 — datasets (escritura):** expandir `search-aranceles-soja-1a2b3c4d` ("Ver snapshots…")
  → "2 snapshots en el proyecto:" + preview con "China". "Actualizar" con 422 del provider →
  el mensaje accionable ("Conectá Tavily desde Herramientas y fuentes para investigar.") en
  `role="alert"`, sin notice de éxito. Eliminar con confirmación (`alertdialog`) → notice
  "Se eliminó search-precios-borrable-1111aaaa." y la fila desaparece de la lista (asertado por
  ausencia del `div.rounded-md`, porque el propio notice nombra al dataset y `hasText` solo no
  distingue — ver notas).
- **Paso 4 — fuentes (escritura):** "Registrar archivo" → `datos/informe.md` → POST
  `/sources/local` con `{ path }` tal cual → 201 → notice "Fuente registrada: informe.md. Ya se
  puede citar como [fuente:src_local_9f8a7b6c#n]." + fila nueva; "Ver pasajes" → anclas
  `[fuente:src_local_9f8a7b6c#0]`/`#1` con el texto de cada pasaje. Segundo intento con
  `datos/roto.pdf` → 422 → mensaje del server en `role="alert"`, formulario **sigue abierto**,
  sin aviso de éxito (no hay cierre silencioso).
- **Paso 5 — paneles:** "Ver" → stat 491, línea SVG, tabla ordenada desc (primera fila
  2026-11-09), bloque "+1 nuevo", segundo proyecto `proyecto-anexo` ruidoso ("Este panel no se
  puede dibujar acá: El dataset … no existe en este proyecto." + `role="alert"`), bloque sin
  números identificado en voz alta. Sin pantalla blanca.
- **Paso 6 — salidas (escritura):** "Ver" cada una: contenido + auditoría válida ("✓ 1/1 citas
  resuelven…"), sin anclas ("Sin anclas: …") y rota ("1 cita no resuelve: [fuente:src_rota#3]…")
  se distinguen en voz alta. Eliminar "Tabla borrable" → DELETE y la fila desaparece (ver U-1
  sobre cómo se borra).
- **Paso 7 — propuestas al final:** el plan muestra badge "Plan" + "Al aceptar se aplican: skill +
  dataset + panel + tarea pausada". Se descarta la otra propuesta (`otra-skill`) → su card
  desaparece. Aceptar el plan **siendo la última** (`prop_plan`) → el panel "Resultado de la
  propuesta aceptada" queda visible con las cuatro piezas, incluida la fallida con detalle
  ("✗ panel — La spec del panel no valida: faltan bloques."), y "Propuestas pendientes" ya no
  existe. **F-1 queda cerrada por la guarda de regresión.**

## Bugs UI encontrados (documentados, no arreglados)

- **U-1 `library-dialog.tsx:687-691 + 707` (OutputsView), `:509` (PanelsView),
  `:895` (TasksView) — tres botones destructivos sin confirmación y sin notice.** En Salidas,
  el icono `Eliminar salida Tabla borrable` ejecuta `remove()` al instante: DELETE y fuera. En
  Paneles y en Tareas pasa igual. En Datasets (y en la biblioteca del home) el mismo gesto pide
  confirmación en `alertdialog` y deja notice ("Se eliminó X."). Repro: abrir Salidas → Eliminar
  salida → click → la fila ya no está, sin preguntar ni avisar. Esperado: un confirm como en
  Datasets (o al menos un aviso), porque borrar es irreversible en la UI. Actual: un clic borra
  en silencio. Lo aserté así (fila desaparece) pero eso no lo hace correcto.
- **U-2 `library-dialog.tsx:346` — un dataset con `provider: "openapi"` nunca tiene botón
  "Actualizar" (render faltante).** La fila sólo muestra el botón si `provider === "tavily"`. El
  plan OpenAPI (`specialist_openapi_propose`, `library-tool-api.ts:280`) crear un dataset con
  `provider: "openapi", operation: "fetch"` y se anuncia "re-ejecutable", pero en "Datos de
  investigación" ese dataset no ofrece ninguna forma de re-ejecutarlo desde la UI (el texto de
  la vista, `:329`, dice que "Actualizar" re-ejecuta con Tavily — honesto para Tavily, pero el
  dataset openapi queda sin salida). Repro: aceptar un plan OpenAPI → abrir Datos → la fila del
  dataset openapi no tiene "Actualizar" ni ningún botón equivalente. Esperado: botón (o nota
  accionable que diga cómo re-ejecutarlo). Actual: ausencia silenciosa del botón.

## Mejoras puntuales pedidas (sin bloquear)

1. **U-1:** añadir confirmación (o undo) a las tres eliminaciones instantáneas, espejo del
   `alertdialog` de Datasets. Cubrir con un assert "sin click, no hay DELETE".
2. **U-2:** decidir y mostrar cómo re-ejecutar un dataset `openapi` (botón "Actualizar" también
   para `provider: "openapi"`, o nota explicativa en la fila). Hoy el F5 crea datasets que la UI
   ya no puede re-correr.

## F-1 / C-1 / C-2 (verificadas, no re-abiertas)

- **F-1 corregida:** `ProposalsSection` (`library-dialog.tsx:761-770`) renderiza el `notice` del
  accept aunque el inbox quede en 0. La guarda de regresión vive en el paso 7 del test (accept
  como última propuesta, con pieza fallida).
- **C-1 corregida:** `DatasetsView` (`library-dialog.tsx:356`) dice "El dataset todavía no tuvo
  una corrida…" cuando `latest` es null (no vuelca `null`).
- **C-2 corregida:** `SourceRow` (`library-dialog.tsx:465`) usa `detail.data?.chunks?.length`,
  así que una fuente con 0 pasajes muestra "Sin pasajes: …" en el detalle (no un cuadro vacío).

## Notas del test (aclaraciones honestas)

- Una sola sesión = un solo test con sub-pasos en orden. Los `flush` son de 60–150 ms (lo mismo
  que los tests hermanos); el timeout del test es 60 s porque los 7 pasos con refetch tardan ~7 s.
- El orden del paso 7 es descarte-antes-que-accept a propósito: con 2 propuestas, aceptar primero
  deja 1 y **no** prueba F-1; descartar primero deja al plan como último y el accept final prueba
  la guarda. Ambas cosas (card descartada desaparece; resultado del último accept visible) quedan
  asertadas.
- El mock de `PUT /tasks/:id` refleja `{ enabled }` en el estado mutable, el de `run-now` añade la
  corrida manual, el de `sources/local` añade la fuente con 2 pasajes; el `chunks: 2` de la fuente
  local es emulación (el server construye los chunks perezosamente en `ensureChunks`), el punto
  verificado es UI: anclas + texto se renderizan.
- **Deliberadamente no probé acá** (cubiertos por tests hermanos o porque exceden la sesión):
  gating con cada flag apagada (sigue en los `specialist-*-ui.test.tsx`); errores 500 por familia
  (HIVE-C paso 8); crear/editar contexto, agentes o skills; editar/eliminar tareas (eliminar
  tareas sí se ejerce a mano en U-1 pero el flujo de borrado de tarea no está en la sesión);
  "Correr ahora" con `started:false` sin scheduler (HIVE-A); estimación `daily`/`weekly` (HIVE-F);
  refrescar un dataset con éxito (visible vía invalidación; mi Actualizar es el 422 pedido).
