# Spike — Univer core (issue #4, Sheets)

> **Nota histórica (2026-11-24):** este spike validó Univer core, pero la implementación vigente
> del artefacto `sheet` usa Jspreadsheet CE. El documento conserva evidencia de la evaluación
> original; no describe el stack actual. Ver `../matriz-decisiones.md`.

> **Fecha:** 2026-11-17. **Estado:** ✅ validado con código real en navegador headless.
> **Proyecto descartable:** `/tmp/opencode/univer-spike` (Vite + React + TS, pnpm). No se tocó `package.json`, lockfiles ni ningún otro archivo del repo de Comex. Sin commit.

## 1. Resultado en una línea

El core open-source de Univer **funciona** para la columna vertebral del artefacto Sheets (grilla, fórmulas con recálculo, snapshot JSON y formato condicional Apache-2.0), **compila con React 19.2.8 y hace build limpio**; el costo es un bundle grande (~6,6 MB / ~1,65 MB gzip) y que charts/pivots/XLSX/print/colab quedan fuera del core (caen en la capa comercial o se implementan aparte, según la decisión del issue).

---

## 2. Versiones exactas instaladas

| Paquete | Versión | Licencia | Observación |
|---|---|---|---|
| `@univerjs/presets` | **1.5.2** | Apache-2.0 | `createUniver` |
| `@univerjs/preset-sheets-core` | **1.5.2** | Apache-2.0 | preset usado en el spike |
| todos los `@univerjs/*` coordinados (22 paquetes: `core`, `sheets`, `sheets-ui`, `engine-formula`, `engine-render`, `docs`, `docs-ui`, `ui`, `design`, `rpc`, `network`, `drawing`, `sheets-formula`, `sheets-formula-ui`, `sheets-numfmt`, `sheets-numfmt-ui`, `themes`, `protocol`, `telemetry`, …) | **1.5.2** | Apache-2.0 | mismos `1.5.2` exactos → sin riesgo de desincronización |
| `@univerjs/icons` | **1.47.0** | Apache-2.0 | se versiona independientemente (documentado) |
| `@univerjs/sheets-conditional-formatting` | **1.5.2** | **Apache-2.0** | plugin OOS de formato condicional |
| `@univerjs/sheets-conditional-formatting-ui` | **1.5.2** | **Apache-2.0** | UI del plugin de CF |
| `rxjs` (peer) | 7.8.2 | Apache-2.0 | peer `>=7.0.0`, resuelto automáticamente |
| `react` / `react-dom` | **19.2.8 / 19.2.8** | MIT | igual que Comex (catalog `react`, no el `react18`) |
| `@types/react` / `@types/react-dom` | 19.2.8 / 19.2.7 | MIT | `@types/react-dom@19.2.8` **no existe**; máximo en 19.2.x es 19.2.7 |
| `vite` | 8.3.8 (rango `^8.3.6`) | MIT | scaffold |
| `typescript` | 7.0.2 (rango `~7.0.2`) | Apache-2.0 | compilador nativo; `skipLibCheck` del scaffold |
| pnpm (entorno spike) | 12.4.1 | — | el repo de Comex declara `pnpm@11.4.0` |

Fuentes: `pnpm list --depth 0`, `pnpm view … version license peerDependencies`, metadata de npm consultada el 2026-11-17 ([npm: preset-sheets-core](https://www.npmjs.com/package/@univerjs/preset-sheets-core), [npm: sheets-conditional-formatting](https://www.npmjs.com/package/@univerjs/sheets-conditional-formatting)).

---

## 3. Comandos ejecutados (todos en `/tmp/opencode/univer-spike`)

```bash
pnpm create vite@latest univer-spike -- --template react-ts   # create-vite 9.3.4
pnpm install
pnpm add react@19.2.8 react-dom@19.2.8
pnpm add -D @types/react@19.2.8 @types/react-dom@19.2.7
pnpm add @univerjs/presets @univerjs/preset-sheets-core
pnpm add @univerjs/sheets-conditional-formatting@1.5.2 @univerjs/sheets-conditional-formatting-ui@1.5.2
pnpm build                                                   # ✅ PASS
pnpm preview --host 127.0.0.1 --port 4173                    # servidor para validar en headless
node drive.mjs                                               # Playwright: datos reales de ejecución
```

### Observaciones del setup (no bloqueantes)

- **`create-vite@9.3.4 --template react-ts` generó un proyecto TS *vanilla*** (`main.ts`, `counter.ts`, sin React ni `jsx` en `tsconfig`). Hubo que agregar React a mano y `"jsx": "react-jsx"`. Es una particularidad del scaffold actual, **no de Univer**.
- **`ERR_PNPM_IGNORED_BUILDS`**: pnpm omitió el script de build de `protobufjs@7.6.6` (dependencia transitiva, probablemente vía `@univerjs/rpc`). La instalación y el build funcionaron igual. En el repo de Comex conviene revisar `onlyBuiltDependencies` antes de incorporar el paquete.
- **Warnings de Rolldown** `[MODULE_LEVEL_DIRECTIVE]` por `"use client"` en paquetes Radix UI transitivos. No afectan el resultado.
- **Sin errores de peer deps**: el peer de Univer acepta `react ^16.9 || ^17 || ^18 || ^19 || ^19-rc` y `rxjs >=7.0.0`; React 19.2.8 y rxjs 7.8.2 satisfacen.

---

## 4. Snippet mínimo que funciona (validado)

```ts
import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets'
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core'
import UniverPresetSheetsCoreEnUS from '@univerjs/preset-sheets-core/locales/en-US'
import { UniverSheetsConditionalFormattingPlugin } from '@univerjs/sheets-conditional-formatting'
import { UniverSheetsConditionalFormattingUIPlugin } from '@univerjs/sheets-conditional-formatting-ui'
import ConditionalFormattingEnUS from '@univerjs/sheets-conditional-formatting/locale/en-US'
import '@univerjs/sheets-conditional-formatting/facade' // registra los mixins del Facade
import '@univerjs/preset-sheets-core/lib/index.css'
import '@univerjs/sheets-conditional-formatting-ui/lib/index.css'

const { univer, univerAPI } = createUniver({
  locale: LocaleType.EN_US,
  locales: { [LocaleType.EN_US]: mergeLocales(UniverPresetSheetsCoreEnUS, ConditionalFormattingEnUS) },
  presets: [UniverSheetsCorePreset({ container: 'app' })],
  plugins: [UniverSheetsConditionalFormattingPlugin, UniverSheetsConditionalFormattingUIPlugin],
})

// ⚠️ GOTCHA: crear el workbook ANTES de esperar Steady. El lifecycle no pasa de
// Starting(0) hasta que existe un unit (createUnit -> Ready). Esperar Steady primero
// deadlockea. En un componente real: guardar `univer` y llamar `univer.dispose()` al desmontar.
const workbook = univerAPI.createWorkbook({})
const sheet = workbook.getActiveSheet()

// Esperar a que el motor de fórmulas esté listo (el evento Steady llega solo ~2-4 s después).
await new Promise<void>((resolve) => {
  if (univerAPI.getCurrentLifecycleStage() >= univerAPI.Enum.LifecycleStages.Steady) return resolve()
  const l = univerAPI.addEvent(univerAPI.Event.LifeCycleChanged, ({ stage }) => {
    if (stage === univerAPI.Enum.LifecycleStages.Steady) { l.dispose(); resolve() }
  })
  setTimeout(() => { l.dispose(); resolve() }, 10000) // fallback
})

sheet.getRange('A1:D4').setValues([
  ['Item', 'Quantity', 'Unit price', 'Amount'],
  ['Seats', 2, 25, '=B2*C2'],
  ['Support', 1, 100, '=B3*C3'],
  ['Total', '', '', '=SUM(D2:D3)'],
])
await univerAPI.getFormula().onCalculationResultApplied()
console.log(sheet.getRange('D4').getValue()) // 150

sheet.getRange('B2').setValue(4)
await univerAPI.getFormula().onCalculationResultApplied()
console.log(sheet.getRange('D4').getValue()) // 200 (recalculó)

// Formato condicional — sin clave de licencia comercial.
const rule = sheet.newConditionalFormattingRule()
  .whenCellNotEmpty().setBackground('#FFF2CC')
  .setRanges([sheet.getRange('D2:D4').getRange()]).build()
sheet.addConditionalFormattingRule(rule)

// Snapshot JSON y restauración.
const snapshot = workbook.save()                       // IWorkbookData
univerAPI.disposeUnit(workbook.getId())
const restored = univerAPI.createWorkbook(snapshot)
```

El container puede ser `string` o `HTMLElement` (`UniverSheetsCorePreset({ container: 'app' })`).

---

## 5. Validación con código real (salida del navegador headless)

Probado con Playwright + Chromium contra `pnpm preview`. Resultado: **6/6 pasos OK**, sin errores de consola.

| Paso | Resultado | Evidencia |
|---|---|---|
| `create-workbook` | ✅ | `id=_k0E6r`, hoja `Sheet1` |
| `lifecycle-steady` | ✅ | etapa `3` (`Steady`); `0 → 1 → 2 → 3` en ~4 s **después** de crear el workbook |
| `write-formulas` | ✅ | `D2=50`, `D3=100`, `D4=150` (fórmulas `=B2*C2`, `=B3*C3`, `=SUM(D2:D3)`) |
| `recalc-on-edit` | ✅ | `B2=4` → `D4=200` vía `onCalculationResultApplied()` |
| `conditional-formatting-oss` | ✅ | 1 regla activa en la hoja; **ninguna clave de licencia** passed a `createUniver` |
| `save-restore` | ✅ | `D2=100`, `D4=200` y 1 regla de CF **después** de `disposeUnit` + `createWorkbook(snapshot)`; snapshot ≈ **1.934 bytes** |

Notas:
- `workbook.save()` devuelve `IWorkbookData` (`id`, `name`, `appVersion`, `locale`, `styles`, `sheetOrder`, `sheets[id].cellData` con las fórmulas, `resources` para datos de plugins). Es JSON puro → persisting en `localStorage`, archivo local o el esquema `sheet` del issue #4 es directo.
- La recarga/restauración **conserva las reglas de formato condicional** en `resources` (verificado: `rules=1` luego de restaurar).
- `getValue()` devuelve el **valor calculado** (número), no la fórmula; la fórmula queda en el modelo (barra `fx` del UI). Para el criterio de aceptación "barra fx muestra la fórmula real", esto es suficiente con el preset de UI.

---

## 6. Qué funciona en OSS core vs. qué cae en capa comercial

Fuente: [Univer — open source vs commercial](https://univer.ai/about/) y [feature comparison](https://docs.univer.ai/overview/features/sheets) (datos oficiales verificados 2026-11-14/17).

| Necesidad del issue #4 | Estado | Cómo se resuelve |
|---|---|---|
| Grilla, filas/columnas, pestañas, selección de rango | ✅ OSS core | `UniverSheetsCorePreset` (incluye UI) |
| Fórmulas visibles y trazables (`=B2*C2`, `=SUM`, refs entre pestañas) | ✅ OSS core | motor de fórmulas incluido (más lento que el Pro) |
| Formato condicional simple | ✅ **OSS, Apache-2.0** | `@univerjs/sheets-conditional-formatting` + `-ui` (validado acá, sin licencia) |
| Ordenar / filtrar / tablas / formato de celdas | ✅ OSS core | incluido en el core |
| Comentarios y notas de celda | ✅ OSS (según tabla oficial) | — |
| Snapshot JSON / persistencia | ✅ OSS core | `workbook.save()` + `createWorkbook(snapshot)` |
| Import/export **CSV** | ⚠️(parcial) | el core persiste JSON; CSV propio (o el plugin de conversión, ver abajo) |
| Export/import **XLSX** | ❌ capa comercial | conversión de archivos es parte del SDK comercial → **SheetJS CE / exceljs** según la decisión del issue |
| Charts (barra/línea/circular) y sparklines | ❌ capa comercial | gráficos propios con Recharts/Nivo sobre datos del Facade (decisión del issue) |
| Pivots / PivotCharts | ❌ capa comercial | fuera del MVP |
| Print / PDF | ❌ capa comercial | fuera del MVP |
| Colaboración en vivo / historial / Server/AI SDK | ❌ capa comercial | diferida (Yjs/Hocuspocus si se necesita) |

**Conclusión de cobertura:** de los criterios de aceptación del MVP del issue #4, **la mayoría cae dentro del OSS core** (grilla, fórmulas, fx, pestañas, formato condicional, resaltado,atasets→sheet). Lo que cae fuera —XLSX y gráficos— **ya estaba previsto resolverlo con librerías propias** en la decisión del 2026-11-17. El spike no reveló un bloqueante de licencia.

### Formato condicional sin licencia comercial — verificación concreta

- `pnpm view @univerjs/sheets-conditional-formatting@1.5.2 license` → `Apache-2.0` (igual el `-ui` y el preset `@univerjs/preset-sheets-conditional-formatting`).
- Inspección del paquete instalado: las únicas coincidencias de "license" son los headers `Licensed under the Apache License, Version 2.0` al inicio de cada archivo. **No hay `licenseKey`, `checkLicense`, `UNIVER_LICENSE` ni ningún gate en runtime.**
- Prueba funcional: se registraron los plugins y se aplicó una regla **sin pasar ninguna clave** a `createUniver` → la regla se aplicó y sobrevivió al save/restore.

---

## 7. Restricciones para Electron

| Tema | Hallazgo | Impacto / acción |
|---|---|---|
| **Node-only APIs** | No hay `import … from 'fs'/'path'/'os'/'buffer'`, `require('fs')`, `process.env` ni `__dirname` en el source ESM de `@univerjs/*` ni en el bundle final. Los `node:`/`Buffer.` que aparece el grep son falsos positivos de minificación (`nodeType`, `parentNode`, `t.buffer`). | ✅ Seguro en renderer de Electron. No hace falta `nodeIntegration`. |
| **`Intl.Segmenter`** | Usado por `@univerjs/core` y `@univerjs/engine-render` (grapemas, palabras, posiciones del cursor). Hay **4 usos en el bundle**; algunos sin guarda y **evaluados al cargar el módulo** (p. ej. `new Intl.Segmenter(undefined, {granularity:'grapheme'})` a nivel top-level); un caso sí tiene fallback `typeof Intl.Segmenter === 'function'`. | Electron 43 trae Chromium ≥129 → `Intl.Segmenter` disponible (Chrome 87+). ✅ Para versiones viejas de Electron/Chromium o entornos raros, agregar polyfill (`Intl.Segmenter` vía `@formatjs/intl-segmenter`) **antes** de importar Univer. Referencia: `engine-render/.../doc-skeleton-*.js`. |
| **React 18/19** | Peer de Univer: `^16.9 || ^17 || ^18 || ^19 || ^19-rc`. Compilado y ejecutado con React **19.2.8** (el que usa Comex). | ✅ Sin incompatibilidad. En un componente real, conservar `univer` y llamar `univer.dispose()` en el cleanup del `useEffect`. |
| **Worker de fórmulas** | El preset expone `workerURL` (RPC) para correr cálculo en Web Worker; el spike funcionó **sin configurarlo** (cálculo en main thread). | En Electron es recomendable el worker para grillas grandes; el core lo soporta sin license. |
| **Tamaño del bundle** | Chunk principal **6,6 MB sin comprimir / ~1,65 MB gzip**; CSS ~124 KB; `dist` total **~12 MB** por decenas de chunks de locale de fórmulas. Warnings `"use client"` de Radix (transitivo). | Pesarlo contra el bundle de Comex. Mitigaciones: importar solo locales necesarios, `React.lazy`/dynamic import del artefacto Sheets para no cargarlo en el arranque, y verificar tree-shaking con el bundler real de Comex (acá se usó Vite 8/Rolldown, no el de la app). |

---

## 8. Riesgos

1. **Bundle pesado**: ~1,65 MB gzip solo para el core + CF. Si Comex ya tiene un bundle grande, el artefacto debe cargarse diferido (lazy) y medirse en el bundler real.
2. **`Intl.Segmenter` sin guarda en init**: un runtime sin esa API rompe al importar, no al usar. Electron 43 está a salvo; documentar polyfill si se soportan versiones antiguas.
3. **Sincronización de versiones**: los `@univerjs/*` deben estar **todos en la misma versión** (1.5.2 acá); mezclarlos produce conflictos de plugins. El lockfile de Comex debe fijarlos.
4. **Ciclo de vida: crear workbook antes de esperar `Steady`**: el patrón de la doc ("wait for Steady, then createWorkbook") deadlockea en el escenario de arranque en blanco. Documentado en el snippet.
5. **Build scripts ignorados** (`protobufjs`) y warnings de Radix/Rolldown: ruido de instalación/bundle que conviene revisar con el `pnpm`/bundler de Comex.
6. **XLSX y charts requieren trabajo propio**: el core no los da; la estimación del issue #4 debe incluir explícitamente SheetJS CE/exceljs y Recharts/Nivo (ya previsto en la decisión).
7. **Fusionar con el preset de CF**: el plugin se registró vía `plugins: [...]` del `createUniver`. Si se usa `@univerjs/preset-sheets-conditional-formatting` en su lugar, **no** registrar los plugins por separado (la doc advierte sobre doble registro).

---

## 9. Recomendación para el issue #4

**Seguir con Univer core (Apache-2.0) + SheetJS CE/exceljs + gráficos propios.** El spike confirma que el núcleo verificable del artefacto —fórmulas visibles, recálculo, pestañas, formato condicional OOS y snapshot JSON— funciona de punta a punta sin licencia comercial y con el React 19 de Comex. No hay que pagar Business para el MVP.

Acciones concretas antes de estimar en firme:
1. Repetir `pnpm build` **dentro del workspace de Comex** (pnpm 11.4.0 + bundler real) para medir el impacto real del bundle y los build scripts de `protobufjs`.
2. Cargar el Sheets artifact con `React.lazy` y fijar todas las versiones `@univerjs/*` a `1.5.2` en el lockfile.
3. Confirmar `Intl.Segmenter` en el Chromium embebido; agregar polyfill solo si se soportan Electron < 11.
4. Configurar `workerURL` (RPC worker) si se esperan grillas grandes, y medir.
5. Mantener el plan B (FortuneSheet) solo como respaldo; el spike no mostró señales de abandono del core de Univer.

---

## 10. Fuentes

- Quick start oficial: https://docs.univer.ai/guides/sheets/getting-started/installation
- `createUniver` / preset core: https://docs.univer.ai/reference/packages/presets/univerjs/preset-sheets-core
- Formato condicional: https://docs.univer.ai/guides/sheets/features/conditional-formatting
- Feature comparison Sheets: https://docs.univer.ai/overview/features/sheets
- Licencias/ediciones: https://univer.ai/about/ y https://univer.ai/pricing/
- Decisión previa del repo: `../matriz-decisiones.md` §1 e `../issues/03-sheets.md`
