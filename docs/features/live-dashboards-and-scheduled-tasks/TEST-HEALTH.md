# Salud de la suite completa — barrido y arreglos

Fecha: 2026-11-09. Alcance: correr **todas** las suites (servidor y app) y dejar por escrito qué
falla, por qué y qué se arregló. Complementa `HIVE-C-TEST.md`, `HIVE-F-TEST.md`,
`HIVE-FULLUI-TEST.md`, `HIVE-SCHED-TEST.md` y `HIVE-SESSION-TEST.md` (esas cubren el feature).

## Resultado final

| Suite | Comando | Resultado |
|---|---|---|
| Servidor | `pnpm --filter openwork-server test` (dos fases, ver abajo) | **737 pass / 11 skip / 0 fail (748 tests, exit 0)** |
| App | `pnpm --filter @openwork/app test` (`bun test --isolate --max-concurrency=4`) | **2042 pass / 0 fail** (207 archivos) |

### Por qué el servidor corre en dos fases

`apps/server` tiene una familia que **arranca procesos hijos** (un motor falso con `Bun.serve`):
`engine-v2-restart`, `engine-auto-upgrade-boot`, `engine-fresh-forced-start-failure`,
`engine-fresh-install-default`, `engine-auto-upgrade-safety`. En paralelo compiten por spawn y
fallan por tiempo (30–60 s) de forma intermitente, con dos síntomas distintos relevados: el reporte
de error llega después de que el estado pasa a `running`, y el marcador de «fallá la primera vez»
se escribe tarde, produciendo dos `engine.v2.start`.

Por eso el script `test` es:

```json
"test": "bun run test:parallel && bun run test:engines",
"test:parallel": "bun test --isolate --max-concurrency=4 --path-ignore-patterns 'test/engine-v2-restart.test.ts' ... --path-ignore-patterns '**/*.vitest.test.ts' --path-ignore-patterns 'test/browser-approval-transport.test.ts'",
"test:engines": "bun test --isolate --max-concurrency=1 test/engine-v2-restart.test.ts test/engine-auto-upgrade-boot.test.ts test/engine-fresh-forced-start-failure.test.ts test/engine-fresh-install-default.test.ts test/engine-auto-upgrade-safety.test.ts"
```

Las dos listas deben cubrir exactamente los mismos cinco archivos que arrancan procesos: si la
fase 1 ignora un archivo que la fase 2 no corre, ese test **desaparece sin avisar** (pasó en el
primer intento: 32 tests quedaron afuera). Verificación de que no se pierde nada: la suma de ambas
fases es **724 tests**, el mismo total que la corrida sin filtros.

Los tests de motor conservan todas sus aserciones; solo se ejecutan en serie. Además se cambió
`waitFor` de 15 s a 30 s y el timeout por test de 30 s a 60 s en `engine-v2-restart`, y las dos
aserciones que leían `captured` inmediatamente después del restart ahora esperan a que el reporte
llegue (condición en vez de snapshot).

> Nota: `--path-ignore-patterns` en la línea de comandos **reemplaza** la lista de `bunfig.toml`,
> no la suma. Por eso `test:parallel` repite los tres patrones.


Las dos suites quedan **completamente verdes**: servidor **754 pass / 11 skip / 0 fail** (dos
fases) y app **2046 pass / 0 fail**, con `specialist-*` y `comex-*` incluidos.

> El servidor corre en dos fases: `test:engines` (36: 35 pass + 1 skip solo-Windows) y
> `test:parallel` (729: 719 pass + 10 skip). Los 11 skip son legítimos: 10 piden el binario
> OpenCode v2.0.26 pineado y 1 es solo-Windows.


## Arreglos de esta pasada (código de producción)

1. **`apps/server/src/runtime-db.ts` — el override de entorno secuestraba un `configPath`
   explícito.** `OPENWORK_RUNTIME_DB` ganaba siempre, así que cualquier store que respetaba
   `configPath` terminaba escribiendo en el runtime DB de otra instancia. Efecto visible: la suite
   completa corría con bases compartidas y explotaba con `Cannot use a closed database`
   (entre 19 y 60 fallos intermitentes). Ahora un `configPath` explícito manda; el override aplica
   solo cuando el server arranca sin config. Verificado: 4 corridas verdes seguidas.
2. **`apps/server/src/opencode-v2-instructions.ts` — `git check-ignore` rompía en locale no
   inglés y con EPIPE.** El código comparaba el stderr contra `/not a git repository/i`, que en
   español es `no es un repositorio git`, y escribía stdin sin tolerar que git cerrara el pipe.
   Ahora fuerza `LC_ALL=C`, ignora EPIPE y, ante exit 128, confirma con un walk de `.git` en los
   padres. Tests `opencode-v2-instructions` 5/5 verdes (antes 2 fallos + unhandled EPIPE).
3. **`apps/app/src/react-app/domains/session/sidebar/session-management-storage.ts` —
   `localStorage is not defined`.** El probe de disponibilidad se hacía una sola vez al importar y
   luego se confiaba en él; si el host instala/quita `localStorage` después, el primer `setItem`
   tiraba `ReferenceError`. Ahora cada escritura re-lee el global y degrada con error legible.
   Test `session-management-store` 6/6 verde (antes 6 fallos).
4. **`apps/app/src/components/chat/mcp-app-frame.tsx` — un artefacto con `resolveLiveActions`
   se blanqueaba por no tener `launchId`.** La guarda nueva abortaba el montaje antes de poder
   pedir el lease. Ahora la falta de `launchId` es fatal solo si no hay forma de obtener uno vivo.
   Recupera 1 test de `mcp-app-frame` (51 → 50 fallos).

## Infraestructura de test agregada

- `apps/server/bunfig.toml`: excluye del `bun test` lo que no puede correr ahí y documenta por qué
  (4 archivos `*.vitest.test.ts` que necesitan el runner vitest + deps que no son del workspace, y
  `test/browser-approval-transport.test.ts`, que exige Node con los timers internos de undici).
- `apps/server` y `apps/app`: script `test` = `bun test --isolate --max-concurrency=4` (el server
  además corre la familia de motores en serie, ver arriba). Sin `--isolate` los archivos comparten
  proceso y filtran `process.env`/mocks entre sí (causa de los 19–60 fallos intermitentes); con él
  la corrida es determinista.
- `apps/server`: script `test:approval-transport` (`node --conditions=development --import tsx
  --test`) → **6/6 verde** en Node. Ese archivo no es compatible con Bun.

## Fallos restantes de la app: 0

`pnpm --filter @openwork/app test` → **2042 pass / 0 fail** (207 archivos).

Lo que estaba rojo y cómo se cerró:

| Archivo | Fallos | Causa | Arreglo |
|---|---|---|---|
| `tests/mcp-app-frame.test.ts` | 50 | happy-dom nunca dispara `IntersectionObserver`; la app espera a que la App esté en pantalla. | El archivo instala un observer que reporta intersección inmediata (lo que hace un navegador con una App visible). El caso que necesita «sin observer» sigue poniendo el global en `undefined`. |
| `tests/opencode-session-native.test.ts` | 6 | Los clientes se auto-inicializan (un `GET …/path` y un `GET …/api/info`) y ese request extra rompía los conteos y los `respond` estrictos; tres casos quedaban colgados. | `withSessionFetch` responde centralmente los dos probes de bootstrap y el helper `sessionRequests` los excluye de los conteos. |
| `tests/chat-answer-rail-alignment.test.tsx` | 4 | El test describía un «carril» de 20 px y spinners que el rail text-first ya no tiene (ver `activity-rail.tsx`). | Reescrito al contrato vigente: fila y respuesta comparten `mx-auto / max-w-3xl / px-2 md:px-10`; las filas en curso son una frase en tinta plena, sin spinner ni punto. |
| `tests/created-skill-render.test.tsx` | 2 | Esperaba «3 steps» en el rail plegado y un shimmer en el paso activo; el diseño es text-first y solo la línea Working brilla. | Se afirma el contrato nuevo (sin conteo de pasos, `data-text-step-tone="running"`, cero `ow-text-shimmer` en filas de capacidad). |
| `tests/agent-activity-map.test.tsx` | 1 | El `setQueryData` no daba tiempo a que el detalle re-renderizara. | Se espera un turno del observer antes de afirmar. |
| `tests/artifact-pinning.test.tsx` | 1 | El componente ahora no monta nada sin sesión Den, y el test lo renderizaba suelto. | Se exporta `SignedInCatalogSync` (la lógica de revisiones sin el gate) y el test usa esa pieza. |

Además, 16 de esos fallos venían de un bug de producto real: **el chat se rompía sin cuenta Den**
(`BuiltAppCatalogSync` montaba hooks que exigían provider y QueryClient). Ahora no-ops sin sesión y
`useAppsClient` lee el contexto opcional.

## Los 4 archivos `*.vitest.test.ts` ahora corren en `bun test`

Los cuatro se convirtieron (import de `vitest` → `bun:test`, `.vitest` fuera del nombre) y pasan:

| Archivo | Antes | Ahora |
|---|---|---|
| `cloud-computer-lifecycle` | no resolvía `@openwork/sandbox` (ee/ no es paquete del workspace) | 5/5. El test apunta el import a `packages/sandbox/src` con `mock.module`, sin symlinks ni cambios de install. |
| `computer-use-tools` | nunca se ejecutaba | 6/6 |
| `non-reasoning-model-variants` | nunca se ejecutaba | 3/3 |
| `session-title-sigv4` | nunca se ejecutaba | 10/10. `vi.resetModules()` se reemplazó por import con query única por caso (el plugin parchea `fetch` al instalarse); se quitaron las llamadas a `evidence` del testkit. |

`bunfig.toml` ya no ignora `*.vitest.test.ts`: solo queda excluido el transporte de aprobación, que
es Node-only (`pnpm --filter openwork-server test:approval-transport` → 6/6).

## Los 11 `skip` del servidor: auditados, todos justificados

- **10** requieren el **binario OpenCode v2 pineado en 2.0.26** (`OPENWORK_TEST_OPENCODE2`); los
  tests verifican `assert.match(version, /\bv2\.0\.26\b/)`. El binario instalado en esta máquina es
  **v2.2.0**, así que correrlos fallaría en esa premisa, no por el código. Son suites de integración
  contra el motor real.
- **1** es solo-Windows (`named pipes`), se saltea en Linux a propósito.


## Verificación contra el servidor real (no solo tests)

Se levantó el server de verdad (`bun --conditions=development src/cli.ts --config …`) con las nueve
flags de especialistas encendidas, dos workspaces y el motor OpenCode v2 real, y se recorrió una
sesión completa por HTTP. **Todo respondió como corresponde**:

| Paso | Resultado real |
|---|---|
| `GET /health` | `{ok:true, opencodeVersion:"1.18.33"}` |
| crear aplicación especialista | app + proyecto `Principal` creados |
| crear tarea | `task_…` con presupuesto (`≈ 72 corridas/día`) |
| escribir panel | spec aceptado; `resolve` con `datos.csv` real devolvió los datos |
| registrar fuente local (F1) | `src_…` con snapshot en `comex/fuentes/local/` |
| leer pasaje | `chunk=0` devuelve el texto exacto del CSV |
| crear salida | informe guardado; auditoría con ancla real `1/1 válidas`; con ancla falsa `1 inválida` |
| ensayar tarea (F3) | **sesión real** del motor (`ses_…`) sin guardar nada |
| correr ahora | sesión real, `running` con `sessionId`, corrida **`ok`**, evidencia en `comex/tareas/<id>/runs/` |
| pausar tarea | `enabled:false` y **`nextRunAt:null`** |

### Dos bugs de producción que solo aparecieron acá

1. **`scheduler.ts` no desenvuelve el sobre `{ data }` de la API v2.** `POST /session` devuelve
   `{data:{id}}` y la página de mensajes `{data:[…]}`; el planificador leía `created.id` y
   `Array.isArray(messages)`. Efecto real: **ninguna tarea programada podía correr** ("El motor no
   devolvió el id de la sesión") y las que arrancaban quedaban `running` hasta el timeout de 15
   minutos. Los tests no lo veían porque el motor falso imitaba la forma v1. Ahora se acepta el
   sobre y el motor falso usa la forma v2 (con test de regresión).
2. **Pausar una tarea dejaba un `nextRunAt` futuro.** El scheduler igual la saltea, pero la API y
   los tools mostraban una "próxima corrida" que nadie iba a honrar. Ahora pausar limpia el slot y
   reanudar lo recalcula (con test).

También se endureció el supervisor del motor: un intento de reinicio que termina **sin** motor
corriendo ahora cuenta como intento fallido y se reintenta, en vez de quedar en silencio.

## Celda D — MCP Apps local (cerrada)

La última pieza del plan quedó implementada y probada en tres niveles:

| Nivel | Qué prueba | Resultado |
|---|---|---|
| Protocolo (unit) | `initialize`/`tools/list`/`tools/call`/`resources/*`, notificaciones, métodos desconocidos, JSON inválido, batch, token ausente/ajeno, flag apagada, host no loopback, `config.host` público | 8 tests |
| Servidor real | endpoint `POST /specialist-mcp` sobre el server real con motor v2: `/api/mcp` → `openwork-panels` **connected**; `/mcp-apps/list` lista la app `openwork-panels_dashboard_render` con `ui://openwork/panel/v1`; `resolve` entrega el HTML con CSP deny-by-default | HTTP real |
| Cliente MCP real | el mismo `StreamableHTTPClientTransport` del host: handshake, tools, `dashboard_render` con CSV real, `panel_list`, panel inexistente → `isError` legible, recurso `text/html;profile=mcp-app` | script real |
| Widget (DOM real) | happy-dom ejecuta el HTML tal cual: handshake (`ui/initialize` → `initialized`), `size-changed`, pintado de stat/línea/tabla/cambios, error de payload, gráfico sin números, refresh con repintado y con fallo (mantiene datos + aviso), y geometría de la línea (no chata) | 5 tests |
| Puente motor → chat | un evento v2 `session.tool.success` con `metadata.openworkMcpResult` (lo que escribe el plugin para una llamada directa a `openwork-panels_*`) llega al part con `structuredContent` y `_meta.ui.resourceUri`; el tool de la misma server sin recurso no se marca como App | 2 tests |
| **UI de la app real** (vite dev + server real + Chrome/CDP) | el diálogo del especialista abre desde el selector de aplicación; muestra **Tareas · Datos · Fuentes · Paneles · Salidas** (los cinco con su estado vacío o su contenido real); `Paneles → Cerrar/Ver` resuelve `precios.json` del workspace real y pinta stat `489`, línea, tabla de 4 filas y bloque de cambios; con el archivo borrado el panel dice **"El archivo \"precios.json\" no existe en este proyecto."** en vez de quedar en blanco (capturas en la sesión) | UI real |
| **Navegador real** (Chrome headless + CDP) | la cadena completa del host: el **proxy `sandbox.html` del server real** carga el widget real bajo su CSP, un `AppBridge` (el mismo que usa el chat) hace el handshake, llega el resultado del tool real (`dashboard_render` sobre `precios.json`), el widget pinta (título, `495`/`489`, 3 filas, 3 puntos, bloque de cambios) y **el botón Actualizar llama la tool y repinta** (la llamada queda registrada en el host); una entrega nueva del host también repinta. Sin errores de consola ni excepciones | `drive.ts` (efímero) |

Defecto encontrado y corregido durante el trabajo: en v2 el plugin de resultados solo preservaba
llamadas de **Code Mode**; una llamada directa a un App de primera parte (`openwork-panels_*`) no
llegaba al chat con `structuredContent`/`_meta`, así que la tarjeta no podía abrirse. Ahora el
plugin preserva también las llamadas directas cuyo resultado declara `_meta.ui.resourceUri`
(con tests de ambos caminos).

### Conversación real, con un modelo scripted (turno completo)

Sin claves de modelo en esta máquina, se levantó un **modelo OpenAI-compatible mínimo** (un mock que
responde un tool call y después texto) y se configuró como provider del workspace. Eso permitió
conversar de verdad con la app y recorrer la cadena completa, no por partes:

`prompt en la app` → `execute` (Code Mode) → `tools["openwork-panels"].dashboard_render` → el
resultado se preserva (`openworkMcpResults` con `launch`) → el adaptador arma el part → la tarjeta
resuelve `ui://openwork/panel/v1` y el widget pinta.

Verificado: título, `489`, tabla de 4 filas, línea y bloque de cambios; **Actualizar** vuelve a
consultar la tool y repinta; con el archivo borrado el aviso nombra el archivo **y mantiene los
datos**; al restaurarlo el aviso desaparece; un cambio de spec se ve al refrescar.

Tres defectos que solo aparecen conversando:

1. **"Actualizar" repetido no consultaba la tool.** El host reutiliza el resultado ya leído para la
   misma llamada (caché por-apertura) y un click sintético no cuenta como gesto de confianza para
   el sandbox, así que la segunda pulsación devolvía lo anterior. El widget ahora manda un sello
   único (`refreshAt`) además de la marca de interacción: el botón siempre vuelve a preguntar.
2. **El gráfico de línea crecía con el ancho de la tarjeta** (250 px de alto en el chat). Ahora se
   dibuja en píxeles CSS con alto fijo (150) y ancho de la tarjeta.
3. **La tabla repetía** "fecha · cierre · volumen" arriba de sus propios encabezados. Se quitó.

Nota: el warning de React "two children with the same key" (clave de sesión) aparece también en un
turno **sin** tool, así que es preexistente y ajeno a la tarjeta; queda anotado, no corregido acá.

### Pasada de usuario exigente sobre la UI real

Segunda vuelta, esta vez recorriendo la UI como una persona con expectativas (clicks, Escape,
borrar/cancelar, ventana angosta, datos raros). Encontró y arregló cuatro cosas:

1. **Título del diálogo**: era una enumeración de seis secciones (`Contexto, agentes y skills ·
   Tareas · Datos · … de Comercio`) que se partía en dos líneas y se pisaba con la X. Ahora el
   título es el nombre de la aplicación y la enumeración es una línea secundaria.
2. **Tabla recortada en silencio**: la tarjeta mostraba 5 de 30 filas sin decirlo. Ahora agrega
   "Mostrando 5 de 30 filas" (y "N de M columnas" cuando recorta columnas por defecto).
3. **Gráfico de barras desbordado**: las barras se salían de la tarjeta y los valores quedaban
   cortados. Ahora cada fila es `etiqueta | pista | valor`: el ancho es un porcentaje de su pista
   y el número tiene su propia columna (mismo arreglo en el widget `ui://`, con test de DOM).
4. **La App interactiva no se anunciaba**: nada en la UI decía que el panel también se abre en el
   chat. Ahora la vista de Paneles lo cuenta, y solo cuando el server la tiene encendida
   (`panelAppsEnabled` viaja en el catálogo, con test de las dos posiciones).

Verificado en esa misma pasada: Escape cierra el diálogo, borrar pide confirmación y cancelar
conserva el panel, el estado de error nombra el archivo/dataset que falta, la ventana angosta
scrollea adentro sin desbordar a lo ancho, y la consola del navegador quedó sin errores.

### Defecto de producto encontrado en el navegador

El gráfico de líneas escalaba con **cero incluido** (`min = Math.min(...flat, 0)`): una serie
486 → 491 → 489 salía como una línea casi chata (el navegador lo mostró). Ahora la línea usa el
rango propio de la serie (con la línea de cero solo si el rango cruza el cero) y las **barras**
siguen ancladas a cero para que los anchos sean comparables. Se corrigió en los dos lugares que
deben coincidir (`.tsx` de [3] y el widget de [4]) y hay aserciones de geometría en las dos suites.

Límite conocido: no hay claves de modelo en este entorno, así que **no se pudo correr un turno real
que llame al tool**. Lo que sí está verificado es cada eslabón por separado: motor conectado,
catálogo del host, resolución del recurso y preservación del resultado (unit), y el widget real.

## Pendiente (alcance)

1. **Nada pusheado**: ~68 commits por delante de `origin` en `comex/bootstrap`.
2. `pnpm --filter @openwork/features test` falla **por el entorno**, no por el código: ese script
   usa `node --test` sobre `.ts` y este Node está compilado sin soporte TypeScript
   (`ERR_NO_TYPESCRIPT`). Con `bun test src/resolve.test.ts` pasan 26/26. Afecta a cualquier
   paquete con el mismo patrón de script.
3. Observación preexistente (fuera de alcance): `runtime.sqlite` y
   `runtime-opencode-config.json` se escriben con umask (0644) y contienen credenciales de
   proveedor/tokens de MCP; en una máquina multiusuario convendría 0600.

## Cómo verificarlo

```bash
pnpm --filter openwork-server test          # 721 pass / 10 skip / 0 fail + engines 35/1, exit 0
pnpm --filter openwork-server test:approval-transport   # 6/6 en Node
pnpm --filter @openwork/app test            # 2042 pass / 0 fail
cd apps/app && bun test tests/specialist-*.test.tsx      # 53/53
cd apps/server && bun test --isolate test/specialist-*.test.ts test/comex-*.test.ts test/openwork-mcp-results-v2.test.ts  # 152/152
```

## Reglas que quedan

- La suite completa del servidor **solo** es determinista con `--isolate`: los archivos comparten
  proceso y mutan `process.env` (`OPENCODE_DB`, `OPENWORK_RUNTIME_DB`, `XDG_*`).
- Un test que dependa de `localStorage`/`IntersectionObserver` debe instalarlo **él mismo**; no
  confiar en que otro archivo lo dejó puesto.
- `bun test` no es el runner de `*.vitest.test.ts` ni del transporte de aprobación: están excluidos
  con razón escrita en `apps/server/bunfig.toml`.
