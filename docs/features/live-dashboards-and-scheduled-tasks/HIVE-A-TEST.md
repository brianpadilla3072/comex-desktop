# HIVE-A-TEST — Probando "Tareas programadas + Propuestas" como persona real

Rol: *front tester* del hive. Probé la UI nueva dos ways: (1) un test React que hace exactamente
lo que haría un usuario (menú → diálogo → Guardar propuesta → Gestionar → crear tarea → Correr
ahora → Pausar → Corridas), y (2) el server real self-hosted levantado headless y todos los
endpoints con curl, con las flags encendidas y apagadas. Nada de código del server fue modificado.
Nada fue commiteado.

- Test escrito: `apps/app/tests/specialist-tasks-ui.test.tsx` — **4 tests, 36 asserts, todos en
  verde**. No cambié ni una línea de código de componentes para que pasen.
- Validado contra el server real (bun, puerto 4571, token cliente + host token por header): las
  formas JSON que emulé en el mock son idénticas a las respuestas reales de
  `apps/server/src/specialists/routes.ts` (GET/POST tasks 200 con `{task, tasks}`, PUT
  `{enabled:false}` → tarea pausada conservando `nextRunAt`, run-now 200 con
  `{started:false, detail}` sin motor, DELETE 200, runs 200, proposals 404 con la flag de
  biblioteca apagada, `/specialist-tool` 401 con token falso).
- El cuerpo del POST de creación coincide con `taskInputSchema` (`apps/server/src/specialists/tasks.ts:65-69`):
  `{name:"actualizar precios", prompt:"…", schedule:{kind:"interval", everyMinutes:20}}` — parsea
  y el server lo aceptó de verdad (HTTP 200, tarea creada con `nextRunAt = +20min`).

## Qué funciona

- El recorrido de usuario es navegable sin manual: menú de la aplicación → "Contexto, agentes y
  skills" → se ve "Propuestas pendientes (1)" con Guardar/Descartar, y abajo "Tareas programadas"
  con "Gestionar". Al Guardar una propuesta, la sección desaparece y la biblioteca se refresca —
  comportamiento correcto.
- "Gestionar" abre la vista de tareas con botón "Nueva tarea"; el formulario viene con default
  útil ("Cada X tiempo", 20 minutos) y placeholders en castellano claro ("Consultá las fuentes de
  costo de flete…"). Crear tarea muestra "Tarea creada y activada." y la fila aparece con "Cada
  20 min · próxima …".
- "Pausar" manda `PUT {enabled:false}` y la fila cambia a badge "Pausada" + botón "Reanudar".
- "Corridas" despliega historial legible: fecha/hora, "ok" / "falló", "a pedido" / "programada",
  "2 perdidas" cuando hay consolidación.
- En el server real el flujo completo funciona por HTTP con la misma autenticación que usa la UI
  (`Authorization: Bearer <cliente>` + `X-OpenWork-Host-Token`): crear aplicación → el primer
  template `comex` **ateó solo el workspace local existente** (`workspaceIds` con proyecto real),
  crear/pausar/correr/borrar tareas, y la corrida manual sin motor quedó registrada de forma
  honesta: run `failed` con detalle, `runs: 1`, `lastStatus: "failed"`, y archivo de evidencia en
  `comex/tareas/<taskId>/runs/<ts>.json` del proyecto. La UI muestra ese detalle tal cual (lo
  probé con la forma real de la respuesta).
- Flags: con `DEN_FEATURE_SCHEDULED_TASKS=false` el catálogo reporta `scheduledTasksEnabled:false`
  y `GET …/tasks` da 404 con mensaje claro; la UI esconde la sección de tareas y el menú sigue
  serviendo la biblioteca. Con `libraryEnabled=false` y tareas activas el diálogo abre sobre
  tareas **sin** el error "No se pudo leer la biblioteca" (el guard de `Home` funciona).
- `/specialist-tool` rechaza credenciales ajenas con 401 y mensaje claro.

## Dónde me trabo

1. **Paso:** el brief dice "levantá el server con `bun src/cli.ts serve --help`". **Qué pasa:**
   `serve` no existe; el argumento se ignora en silencio y aparece la ayuda de `web`. Perdí un
   ciclo entero buscando un subcomando que no está. **Qué faltaría:** docs correctas, o que un
   comando desconocido dé error en vez de tragárselo.
2. **Paso:** quiero un server de prueba "aislado". **Qué pasa:** no hay flag `--data`; sin
   `--config` el server escribe en `~/.config/openwork` **de verdad** — mi primera aplicación de
   prueba se creó en el store real del usuario (tuve que limpiar a mano sqlite + carpeta; quedó
   verificado vacío). El `--config <ruta>` sí aísla (el directorio del archivo es el data dir),
   pero nada en la ayuda lo dice. **Qué faltaría:** un `--data-dir` explícito o una línea en
   `--help` advirtiendo dónde cae el estado.
3. **Paso:** aprieto "Correr ahora" sin motor configurado. **Qué pasa:** el diálogo muestra
   "El motor no devolvió el id de la sesión creada." — el usuario no sabe qué es "el motor", ni
   que tiene que conectar un modelo, ni dónde. **Qué faltaría:** una frase de persona + un link
   ("Conectá un modelo desde el chat → Ajustes").
4. **Paso:** quiero que la IA cree la tarea vía `POST /specialist-tool` como dice el README de la
   biblioteca. **Qué pasa:** el descriptor de proyecto (`specialists/tool/<hash>.json`) y el
   plugin `.opencode/plugins/comex-library/server.js` **no se materializan al crear la aplicación
   ni al bindear el workspace**; solo se sincronizan cuando la carpeta se usa a través del proxy
   del motor (`src/server.ts:1069,1084`). Con server headless sin motor no hay descriptor posible,
   y la puerta se prueba sola con 401. Tardé en darme cuenta; no está documentado. **Qué
   faltaría:** materializar descriptor+plugin en `applyLibraryChange`/bind, o decirlo en el README.
5. **Paso:** escribo 20 minutos, borro el campo por error y doy "Crear tarea". **Qué pasa:** el
   botón sigue habilitado, el server responde 422 con "Revisá el nombre, el prompt y el horario"
   y no sé qué campo está mal. Lo mismo con `0` o `1.5`. **Qué faltaría:** validación en el campo
   y mensaje por campo.
6. **Paso:** tengo `scheduledTasks=true` y `specialistLibrary=false` (un operador puede querer
   solo tareas). **Qué pasa:** el menú dice "Contexto, agentes y skills" y el título del diálogo
   repite "Contexto, agentes y skills de X", pero no hay contexto ni agentes ni skills — solo
   tareas. Creo que la feature está rota. **Qué faltaría:** etiqueta dinámica.
7. **Paso:** en esa misma combinación quiero ver mis **propuestas** pendientes. **Qué pasa:**
   desaparecieron: `GET …/library/proposals` está detrás de `requireLibrary()`
   (`routes.ts:177-182`) y la UI lo traga en silencio. Las propuestas existen en disco pero son
   invisibles, y además la UI las pide igual (siempre 404). **Qué faltaría:** deciding: o las
   propuestas dependen solo de `scheduledTasks` en lectura, o un aviso "las propuestas requieren
   la biblioteca activa".

## Bugs UI encontrados

- **`library-dialog.tsx:80` — un error de biblioteca secuestra todo el diálogo.** Si `GET …/library`
  falla, el `return` del error reemplaza la home entera: Propuestas pendientes y Tareas
  programadas desaparecen aunque funcionen perfecto. Un 500 de biblioteca deja a la persona sin
  acceso a sus tareas.
- **`library-dialog.tsx:226` — `ProposalsSection` pide propuestas sin la flag de biblioteca.** El
  `useQuery` no tiene `enabled: library`; con biblioteca apagada dispara un request que siempre
  es 404 y muestra nada, sin explicar por qué. (Verificado en el test: el request ocurre.)
- **`library-dialog.tsx:257-266` y `:302/346` — resumen y lista de tareas mienten en silencio.**
  Ni `TasksSummary` ni `TasksView` tienen rama de `isError`: si `GET …/tasks` falla (404 por
  flags desincronizadas, corte de red), el usuario lee "Sin tareas programadas." / "Todavía no hay
  tareas." — parece que no tiene tareas cuando en realidad no se pudieron leer. Debería decir "No
  se pudo leer el listado" con reintento, como hace la biblioteca.
- **`library-dialog.tsx:315/319` — "Crear tarea" habilitado con minutos inválidos.** El input
  "Cada cuántos minutos" no es `required` y el botón solo mira nombre/prompt; vacío/0/decimal →
  422 con mensaje que no nombra el campo (traba 5).
- **`library-dialog.tsx:295` — "Semanal" sin días cae en lunes silenciosamente.** Si deselecciono
  todos los días, `days.length ? days : [1]` reprograma para el lunes y la fila muestra "Lun" como
  si lo hubiera pedido. Debería bloquear el submit o avisar.
- **`provider.tsx:205` + `library-dialog.tsx:52` — menú/título mentiroso con solo tareas activas**
  (traba 6). El ítem se muestra con `libraryEnabled || scheduledTasksEnabled` pero se llama
  "Contexto, agentes y skills".
- **Menor, semántica:** "Correr ahora" de una tarea **pausada** corre de verdad y consume un run
  (`runs+1`, badge "Última: falló" visto en el server real). Si es intencional ("probala una vez",
  backlog B3 del plan), la UI no lo dice; si no, no debería estar habilitado en pausadas.

## Mejoras puntuales pedidas a Celda A

1. **Error de lectura de tareas a la vista:** rama `isError` con "No se pudo leer el listado de
   tareas" + botón Volver a intentar, en `TasksSummary` y `TasksView` (patrón que ya usa la
   biblioteca en `library-dialog.tsx:80` pero sin secuestrar las otras secciones).
2. **Compartimentar errores en `Home`:** el error de biblioteca debe reemplazar solo las secciones
   de biblioteca (contexto/agentes/skills), nunca Propuestas ni Tareas.
3. **Validación de campos antes de enviar** en el formulario de tarea: minutos entero 1–43200
   obligatorio, y para "Semanal" al menos un día (mostrar "Elegí al menos un día" en vez de
   fallback a lunes). Mensaje junto al campo, no el 422 genérico del server.
4. **Etiqueta del ítem de menú y del título del diálogo según flags** ("Tareas y propuestas"
   cuando `libraryEnabled=false`), y desactivar la query de propuestas cuando la biblioteca está
   apagada (`enabled: library`) o mostrar por qué no hay propuestas.
5. **Detalle de corrida sin motor accionable:** cuando `run-now` devuelve started:false con un
   detalle que menciona el motor, sumar un link "Conectá un modelo" en vez de solo el texto.
6. **Docs/README:** corregir `serve --help` (no existe), documentar el aislamiento vía `--config`,
   y que el descriptor del plugin `/specialist-tool` recién aparece cuando la carpeta se usa por
   primera vez a través del motor.

## Notas del test (aclaraciones honestas)

- Los mock de fetch emulan las respuestas reales verificadas con curl contra el server en marcha
  (todas listadas arriba); las formas calzan 1:1.
- `taskInputSchema` está **replicado literal** desde `apps/server/src/specialists/tasks.ts:15-22,65-69`
  en el test porque importar el módulo del server desde la app arrastra `bun:database` y el config
  store. La réplica se verificó contra el server real: el mismo body que valida el schema local
  fue aceptado por el server con 200.
- Acomodos del test (no cambiaron comportamiento de la UI): stubs de `ResizeObserver`/
  `IntersectionObserver` para Base UI en happy-dom, y el buscador de elementos acepta
  `[role="menuitem"]` además de `button` (los ítems del menú de Base UI no son `<button>`).
- Round 2 terminó con el server asesinado y **la contaminación del `~/.config/openwork` real
  revertida** (filas de `profiles.sqlite` borradas — quedaron 0 en las 4 tablas; carpeta
  `specialists/app_8f5e…` eliminada). El store de especialistas del usuario estaba vacío antes de
  mi corrida y volvió a estar vacío.
