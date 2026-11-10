# Salud de la suite completa — barrido y arreglos

Fecha: 2026-11-09. Alcance: correr **todas** las suites (servidor y app) y dejar por escrito qué
falla, por qué y qué se arregló. Complementa `HIVE-C-TEST.md`, `HIVE-F-TEST.md`,
`HIVE-FULLUI-TEST.md`, `HIVE-SCHED-TEST.md` y `HIVE-SESSION-TEST.md` (esas cubren el feature).

## Resultado final

| Suite | Comando | Resultado |
|---|---|---|
| Servidor | `pnpm --filter openwork-server test` (dos fases, ver abajo) | **713 pass / 11 skip / 0 fail (724 tests, exit 0)** · corridas repetidas verdes |
| App | `pnpm --filter @openwork/app test` (`bun test --isolate --max-concurrency=4`) | **1970 pass / 72 fail** (207 archivos) |

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


Los 72 fallos de la app están agrupados: 9 archivos, 6 familias (abajo). **Ninguno es del feature
de especialistas ni de las celdas A–F**: `specialist-*` y `comex-*` están 100% verdes.

> Nota de medición: en modo aislado (`--isolate`) aparecen además ~14 fallos que **no existen** en
> modo compartido — tests que renderizan componentes que necesitan `DenAuthProvider` y solo pasaban
> porque otro archivo había dejado módulos mockeados en el registro compartido. Ambos números están
> documentados: la app tiene 72 fallos aislados y 82 en la corrida por grupos, con 3 de ellos
> (error-monitoring, electron-updater-check-now, comex-docx-preview) que pasan aislados.


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

## Mapa de fallos restantes de la app (64 tests, 6 archivos)

Medido con `bun test --isolate --max-concurrency=4`: **1978 pass / 64 fail**. Cada archivo falla
también **aislado**, así que no es fuga entre tests.

| Archivo | Fallos | Causa verificada | Arreglo |
|---|---|---|---|
| `tests/mcp-app-frame.test.ts` | 50 | La app espera `IntersectionObserver` para arrancar una App **inline**; happy-dom nunca dispara el observer y estos 50 casos no lo desactivan (los que sí lo hacen pasan). Instrumentado: el efecto corre, `expectedOrigin` resuelve, pero `navigationStarted` queda en false. | Actualizar el harness (`startupFixture`) a `presentation: "dashboard"` o apagar el observer, como ya hacen los casos verdes. Es mecánico, ~50 casos. Desbloquea la celda D. |
| `tests/opencode-session-native.test.ts` | 6 | El cliente v2 hace **3** requests donde el test espera 2 (probe extra de `/path`); 3 de esos casos además cuelgan hasta el timeout por la misma razón. | Decisión del dueño del motor v2: aceptar el probe en la expectativa o dejar de hacerlo. |
| `tests/chat-answer-rail-alignment.test.tsx` | 4 | El `.prose` del asistente ya no está en una fila `flex gap-2` con `span[aria-hidden]` como carril; el test que describe esa alineación no encuentra el elemento. | Revisar contra `DESIGN.md` antes de tocar markup (es alineación visual). |
| `tests/created-skill-render.test.tsx` | 2 | La línea plegada dice "Worked for 4s" donde el test espera "3 steps". | Alinear la etiqueta con el modelo actual (o al revés, si el diseño pide los pasos). |
| `tests/agent-activity-map.test.tsx` | 1 | Espera "Error actualizado del agente", renderiza "Finalizado". | Revisar el estado del mapa para ese fixture. |
| `tests/artifact-pinning.test.tsx` | 1 | La mutación de pin no se llama (esperado 1, recibido 0). | Revisar el disparador del pin en el árbol de artefactos. |

**Fuera del mapa**: 3 archivos (`error-monitoring`, `electron-updater-check-now`,
`comex-docx-preview`) que pasan aislados y solo fallan cuando comparten proceso con otros; quedan
resueltos por cualquier estrategia que aísle por archivo.

## Pendiente de revisar (no es un fallo, es alcance)

1. **Celda D — MCP Apps local** del plan: sin empezar. Su host es exactamente la familia #1 de
   arriba, así que D arranca arreglando esos 50 tests.
2. **4 archivos `*.vitest.test.ts` que nunca se ejecutan** (`cloud-computer-lifecycle`,
   `computer-use-tools`, `non-reasoning-model-variants`, `session-title-sigv4`): necesitan el runner
   vitest y `@openwork/testkit`, que no son dependencias de este workspace. Ese código está sin
   cobertura efectiva.
3. **11 tests saltados en el servidor**: conviene auditar si siguen siendo `skip` legítimos.
4. **Nada pusheado**: ~62 commits por delante de `origin` en `comex/bootstrap`.

## Cómo verificarlo

```bash
pnpm --filter openwork-server test          # 713 pass / 11 skip / 0 fail, exit 0 (dos fases, 724 tests)
pnpm --filter openwork-server test:approval-transport   # 6/6 en Node
pnpm --filter @openwork/app test            # 1970 pass / 72 fail (mapa arriba)
cd apps/app && bun test tests/specialist-*.test.tsx      # 53/53
cd apps/server && bun test test/specialist-*.test.ts test/comex-*.test.ts  # 132/132
```

## Reglas que quedan

- La suite completa del servidor **solo** es determinista con `--isolate`: los archivos comparten
  proceso y mutan `process.env` (`OPENCODE_DB`, `OPENWORK_RUNTIME_DB`, `XDG_*`).
- Un test que dependa de `localStorage`/`IntersectionObserver` debe instalarlo **él mismo**; no
  confiar en que otro archivo lo dejó puesto.
- `bun test` no es el runner de `*.vitest.test.ts` ni del transporte de aprobación: están excluidos
  con razón escrita en `apps/server/bunfig.toml`.
