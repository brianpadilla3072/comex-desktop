# HIVE-B-TEST — Probando "Datos de investigación" (datasets) como persona real

Rol: *front tester* de la celda B. Dos rondas: (1) UI real manejada como la manejaría un usuario
(`apps/app/tests/specialist-datasets-user.test.tsx`, fetch mockeado con las formas JSON verificadas
luego contra el server), y (2) server real headless por HTTP con curl, seedeo de datasets escritos a
mano en el proyecto y todas las rutas. No modifiqué código del server ni de componentes. No commiteé
nada.

- Tests escritos: **5 tests, 37 asserts, todos en verde** (`cd apps/app && bun test
  tests/specialist-datasets-user.test.tsx`). Suites hermanas siguen verdes: 13/13 en los 3 archivos
  specialist-*.test.tsx.
- Verificación honesta del test hermano (`specialist-datasets-ui.test.tsx`, agente B de wiring): sus
  asserts son verdaderos contra los componentes reales — pasa tal cual. Pero **no cubría** cuatro
  cosas del story de usuario: el query param `?workspace=` del POST refresh, que un error de refresh
  se muestre en pantalla, que el detalle vuelva a pedirse tras un refresh exitoso (el fix
  `e60a3b1b`), y que `datasetsEnabled=false` no dispare requests. Eso es lo que agregué acá.
- ⚠️ `bun run typecheck` en apps/app da un error **preexistente** ajeno a esta celda
  (`session-route.tsx:555`, último toque en `50b6c2c`, anterior a los commits de datasets).

## Qué funciona

- **Recorrido de menú completo sin manual**: ítem del switcher → "Contexto, agentes y skills" →
  sección "Datos de investigación" con resumen → "Gestionar" → filas con nombre, pregunta,
  `provider/operación`, conteo de snapshots y "actualizado …". Con dos proyectos bindeados cada fila
  nombra su proyecto (`workspaceName`). Lo probé contra los componentes reales.
- **El fix `e60a3b1b` de verdad se ve desde el front**: con el detalle de un dataset abierto, al
  apretar "Actualizar" y tener éxito, el `GET …/datasets/:id` **vuelve a salir** a la red
  (`library-dialog.tsx:286` invalida la clave `["specialist-datasets", base, app]` de la que
  "detalle" es prefijo). Afirmado con conteo de requests antes/después en el test 1.
- **Refresh manda el workspace correcto**: `POST …/refresh?workspace=ws_test` sale con el id del
  proyecto de ESA fila (mismo para `GET` detalle y `DELETE`). El POST tiene timeout de 11 minutos
  (`openwork-server.ts:2530`), coherente con una corrida de Tavily larga.
- **Botón ocupado**: mientras corre el refresh ningún botón de la vista se puede apretar dos veces
  (`busy`), y la UI vuelve a ser usable tanto en éxito como en error.
- **tooLarge es honesto**: snapshot de 5 MB real en disco → el detalle responde
  `latest: { "tooLarge": true }` y la UI dice "El último snapshot supera los 200 KB y no se
  previsualiza acá. Está en el proyecto, en comex/datasets." (verificado por HTTP y por test).
- **Eliminar con confirmación inline**: Cancelar no manda DELETE; confirmar manda
  `DELETE …?workspace=` al proyecto correcto, muestra "Se eliminó X." y la fila desaparece con el
  refetch. El derivado **no** tiene botón "Actualizar" (correcto: no hay consulta que repetir).
- **Fix queryHash verificado en server real**: `GET` lista tres veces seguidas → 200 200 200. Con
  una entrada basura en `index.json` (objeto con `name: 42` y campos inventados) la lista sigue:
  la entrada podrida se descarta silenciosamente y los válidos salen completos
  (`datasets.ts:readIndex`, parse por entrada). DELETE además limpia el `index.json` corrupto al
  reescribirlo.
- **Flags**: `datasetsEnabled` es `default: true` en self_hosted (`registry.ts:250-258`) — un usuario
  local normal ve la sección sin configurar nada. Con `DEN_FEATURE_SPECIALIST_DATASETS=false`:
  catálogo `datasetsEnabled:false`, `GET` lista 404 `specialist_datasets_disabled`, tool 409, y la
  UI **no dispara ni un request** de datasets (test 4). Con biblioteca apagada y datasets prendidos
  el diálogo abre igual (etiqueta dinámica "Datos").
- **Escritura protegida**: refresh/delete sin `X-OpenWork-Host-Token` → 401 claro. Id con traversal
  (`..%2F..%2Findex`) → 404 "Ese dataset no existe", sin filtrar rutas.
- **Herramientas del motor por `/specialist-tool`** (con descriptor minted a mano como fixture, ver
  traba 2): `specialist_dataset_list`, `specialist_dataset_read` (snapshots + latest) y
  `specialist_dataset_derive` funcionan; el derivado sale con linaje `derivedFrom` y aparece en la
  lista de la UI; fuente inexistente → 404 honesto.
- **Formas JSON reales vs. mis mocks**: calzan 1:1 (lista agregada
  `{datasets:[{…meta, workspaceId, workspaceName}]}`, detalle `{dataset, snapshots[], latest}`,
  refresh `{dataset}`, delete `{deleted}`). Copié las formas desde `routes.ts:282-316` y verifiqué
  con curl.

## Dónde me trabo

1. **Paso:** aprieto "Actualizar" y no tengo Tavily conectado (el caso del usuario nuevo que aún no
   pasó por "Herramientas y fuentes"). **Qué pasa:** la UI muestra **"Unexpected server error"** —
   un 500 del server. El mensaje accionable sí existe en el código ("La herramienta de Tavily no
   está disponible. Preparala desde Herramientas y fuentes.") pero se pierde en el camino. **Qué
   faltaría:** que el error del provider llegue burbujeado como 4xx/5xx con su texto (Bug B-2).
   Con la red cortada el usuario ve literalmente la misma frase genérica y no puede distinguir
   "no conecté Tavily" de "se cayó el server".
2. **Paso:** quiero probar la promesa del README "[2]: el asistente registra consultas como
   datasets" en un server headless sin motor. **Qué pasa:** el descriptor de `/specialist-tool`
   (`specialists/tool/<sha256>.json` con el token del proyecto) **no se materializa al crear la
   aplicación ni al bindear el workspace**; solo lo escribe `syncLibraryToolPlugin` cuando la carpeta
   se usa a través del proxy del motor. Tuve que forjar el descriptor a mano (fixture de test) para
   probar las 4 tools. Es la traba 4 de HIVE-A-TEST, **sigue sin resolver** para datasets.
   **Qué faltaría:** materializar descriptor+plugin en el bind/`applyLibraryChange`, o documentarlo.
3. **Paso:** el server está caído (o las flags del catálogo quedaron desincronizadas) y abro el
   diálogo. **Qué pasa:** donde debería verse un error, leo **"Sin datasets todavía. Cada
   investigación que responde el asistente deja su consulta guardada acá…"** — la app me dice que no
   tengo datos cuando en realidad no los pudo leer. La vista "Gestionar" sí tiene rama de error con
   reintento; el resumen del home no. **Qué faltaría:** Bug B-1 abajo. (Misma clase de mentira que
   la celda A corrigió para tareas — el fix no se replicó en datasets.)
4. **Paso:** le aprieto "Actualizar" a una consulta lenta y me quedo mirando. **Qué pasa:** el botón
   se deshabilita pero **no cambia de texto** ni hay spinner: el refresh puede tardar hasta 11
   minutos (timeout del cliente) y la única pista de que algo corre es que los botones están grises.
   **Qué faltaría:** "Actualizando…" en el botón mientras `busy` (el formulario de tareas ya usa el
   patrón "Creando…").
5. **Paso (menor, docs):** repetir Round 2 aislado. **Qué pasa:** el aislamiento funciona con
   `--config <dir>/server.json` (todo el estado —runtime.sqlite, specialists/, opencode-v2— cae en el
   directorio del archivo, verificado), pero la ayuda no lo dice y seguís needing saberlo de la
   traba 2 de HIVE-A-TEST. **Qué faltaría:** una línea en `--help`.
6. **Paso (menor, inconsistencia):** con la flag de datasets apagada, la ruta HTTP lista da 404
   (`specialist_datasets_disabled`) pero la tool da 409. Ninguno es incorrecto, pero documentar el
   contrato en el README de la feature evita que el próximo tester lo tome como bug.

## Bugs encontrados (file:line) — documentados, no arreglados

- **B-1 `library-dialog.tsx:252-256` — `DatasetsSummary` miente en silencio ante error de lectura.**
  Sin rama `query.isError` (a diferencia de `DatasetsView:293` y `TasksSummary:369`): un GET que
  falla muestra "Sin datasets todavía". Afirmado a propósito en el test 5 de
  `specialist-datasets-user.test.tsx` (comentario en el archivo: invertir el assert cuando se
  arregle).
- **B-2 error del provider de refresh se traga en un 500 genérico.** Cadena verificada en server
  real: `routes.ts:308` → `datasets-refresh.ts:24` (`executeTavily`) →
  `integrations/research-factory.ts:44` / `integrations/tavily.ts:38` tiran `Error` llano (no
  `ApiError`) → `server.ts:1038` lo mapea a `{code:"internal_error", message:"Unexpected server
  error"} HTTP 500`. Idem por `/specialist-tool` (`library-tool-api.ts:166`): la respuesta real del
  server fue `{"code":"internal_error","message":"Unexpected server error"}` [500], y la UI muestra
  esa frase. El stack trace (inofensivo, sin rutas) quedó en el log del server.
- **B-3 (fricción heredada, no regression)** — descriptor de `/specialist-tool` solo se emite con
  acceso de motor (traba 2); `library-tool-api.ts:42-64`. Mismo hallazgo que HIVE-A-TEST traba 4,
  ahora también bloquea probar la captura automática de datasets por el motor.

## Mejoras pedidas a Celda B

1. **Burbujear el error del provider**: en `datasets-refresh.ts` (o en la ruta) capturar los `Error`
   de `executeTavily`/`runTavilyCommand` y re-lanzarlos como `ApiError(422…/"4xx", code claro, mismo
   mensaje)`. El usuario tiene que leer "Preparala desde Herramientas y fuentes", no "Unexpected
   server error".
2. **Rama `isError` en `DatasetsSummary`**: "No se pudieron leer los datasets" + Volver a intentar,
   espejo de `DatasetsView:293`/`TasksSummary:369`. Invertir el assert del test 5 con el fix.
3. **Feedback de refresh largo**: botón "Actualizando…" (o spinner inline) mientras `busy`, dado que
   el POST puede correr minutos.
4. **Materializar el descriptor en bind/apply** (arrastre de la celda A, ahora también para el
   story "guardá estos datos como dataset" del README [2]).
5. Opcional: si la lista ya tenía datos y un refetch falla, hoy se muestran los datos viejos sin
   marca; un badge "datos de hace X min (no se pudo refrescar)" sería el upgrade natural.

## Receta de reproducción (Round 2)

```bash
# 1) Server aislado (2 puertos probados; 4621 con flags on, 4622 con datasets off)
mkdir -p /tmp/opencode/hive-b/config /tmp/opencode/hive-b/proyecto-soja /tmp/opencode/hive-b/proyecto-flete
cd apps/server
DEN_FEATURE_SPECIALIST_APPLICATIONS=true DEN_FEATURE_SPECIALIST_LIBRARY=true DEN_FEATURE_SPECIALIST_DATASETS=true \
  bun src/cli.ts --config /tmp/opencode/hive-b/config/server.json --port 4621 \
  --token tok-b-client --host-token tok-b-host \
  --workspace /tmp/opencode/hive-b/proyecto-soja --workspace /tmp/opencode/hive-b/proyecto-flete &
# (sin motor: OPENWORK_MANAGE_OPENCODE no se setea; todo el estado queda en el dir de server.json)

# 2) Crear aplicación comex (auto-bindea los 2 workspaces locales)
curl -s -X POST http://127.0.0.1:4621/specialist-applications \
  -H "Authorization: Bearer tok-b-client" -H "X-OpenWork-Host-Token: tok-b-host" -H "Content-Type: application/json" \
  -d '{"userName":"Brian Prueba","name":"Taller Hive B","specialty":"Soja y fletes","template":"comex"}'  # → 201

# 3) Seed de datasets: escribir los archivos del store directo en el proyecto
#    (script completo en /tmp/opencode/hive-b/seed.ts; formas copiadas de datasets.ts)
#    comex/datasets/index.json                      → array de metas (datasetMetaSchema)
#    comex/datasets/<id>/dataset.json               → la misma meta
#    comex/datasets/<id>/query.json                 → {provider:"tavily",operation:"search",input:{query,max_results}}
#    comex/datasets/<id>/snapshots/<ts>.json        → el payload del snapshot
#    comex/datasets/<id>/LATEST                     → ARCHIVO TEXTO puntero: "<ts>.json\n" (no symlink)
#    queryHash = sha256("tavily|search|<canonicalJson(input)>") — claves ordenadas recursivamente

# 4) Rutas
APP=app_58401b46-9c98-4f5d-8f88-ba3af5711bb2
curl -s -H "Authorization: Bearer tok-b-client" "http://127.0.0.1:4621/specialist-applications/$APP/datasets"            # 200 agregado, con workspaceName
curl -s -H "Authorization: Bearer tok-b-client" "http://127.0.0.1:4621/specialist-applications/$APP/datasets/ds-search-aranceles-soja-1a2b3c4d"  # 200 {dataset,snapshots,latest}
curl -s -X POST -H "Authorization: Bearer tok-b-client" -H "X-OpenWork-Host-Token: tok-b-host" -H "Content-Type: application/json" -d '{}' \
  "http://127.0.0.1:4621/specialist-applications/$APP/datasets/ds-search-aranceles-soja-1a2b3c4d/refresh?workspace=ws_d3e394ef56bf"  # → 500 "Unexpected server error" (BUG B-2)
curl -s -X DELETE -H "Authorization: Bearer tok-b-client" -H "X-OpenWork-Host-Token: tok-b-host" \
  "http://127.0.0.1:4621/specialist-applications/$APP/datasets/ds-precios-limpios-9f8e7d6c"   # → 200 {deleted}, borra dir + entrada del index

# 5) Corrupción: append de {"id":"ds-basura","name":42,"pregunta":"…"} a index.json → GET lista sigue 200, basura descartada

# 6) /specialist-tool: descriptor minted a mano (config/specialists/tool/<sha256(dir)>.json con token≥16) →
#    dataset_list/read/derive 200; dataset_refresh sin Tavily → el MISMO 500 de B-2.

# 7) Cleanup: kill de los dos servers (puertos 4621/4622 sin escucha verificado) y
#    ~/.config/openwork real sin contaminación: 0 referencias a "hive-b"/app_58401b46 en
#    runtime.sqlite y specialists/profiles.sqlite; los mtimes recientes de esa carpeta
#    pertenecen al OpenWork desktop del usuario (AppImage corriendo desde 10:21), no a mis servers.
```

## Notas del test (aclaraciones honestas)

- Los mocks de fetch del Round 1 se corrigieron a las formas del Round 2 (p. ej. mi primer intento de
  422 devolvía sin querer `status: undefined` → 200; el test ahora usa el mensaje real del provider
  y el status explícito — el server de hoy mandaría el genérico de B-2, por eso el mock emula el
  error *deseado*, y el test 5 usa el `"Unexpected server error"` que el server manda *hoy*).
- El seed manual de `comex/datasets` es exactamente lo que produce `recordDatasetRun` (LATEST como
  puntero de texto, permisos 0600); verifiqué que las rutas lo leen sin quejas, o sea el formato del
  store es round-trip seguro.
- Round 2 usó `--config` aislado de arranque (lección de la traba 2 de HIVE-A-TEST aplicada antes de
  tocar nada): no hubo que limpiar el store del usuario esta vez.
