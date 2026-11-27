# Funcionalidad — Hoja de cálculo verificable tipo Claude Sheets

**Título sugerido:** `[Feature] Artefacto Sheets: grilla con fórmulas visibles, formato condicional y export`
**Labels sugeridas:** `feature`, `ux`, `comex`, `artifact`, `needs-design-review`
**Depende de:** `00-epico-artefactos-oficina`
**Estimación sugerida:** 3–4 semanas (MVP)

> **Decisión histórica (2026-11-17):** se eligió **Univer core (Apache-2.0)** + complementos OSS
> para XLSX/CSV y gráficos, con FortuneSheet como plan B. El spike de Univer quedó documentado.
>
> **Implementación vigente (2026-11-23/24):** el artefacto `sheet` usa **Jspreadsheet CE** y una
> barra `fx` propia. Las herramientas del agente usan además un evaluador propio, sin `eval`.
> Esta desviación no estaba en la decisión original y debe revalidarse —licencia, paridad de
> fórmulas y alcance— antes de cerrar el issue. Ver `../matriz-decisiones.md`.

> **Estado real (2026-11-24): IMPLEMENTACIÓN AVANZADA, ISSUE ABIERTO.**
>
> **Implementado**
> - Salidas `table` nuevas → `SheetArtifact` y apertura automática en el panel lateral.
> - Grilla Jspreadsheet CE con barra `fx`, selección, pestañas fijas y creación de hojas.
> - Crecimiento bajo demanda sin techo artificial; dimensiones persistidas.
> - Fórmulas entre celdas, referencias por clic, Enter/Escape y persistencia de la fórmula cruda.
> - Menús Archivo/Editar/Ver/Insertar/Formato/Datos/Herramientas con acciones reales.
> - Export/import CSV, descarga JSON y 14 herramientas `specialist_sheet_*`.
> - Versiones inmutables, orden, formato, inserción/borrado y referencias entre hojas en el evaluador del agente.
>
> **Pendiente**
> - Revalidar licencia y paridad de la implementación Jspreadsheet CE.
> - Export/import XLSX y formato condicional visible.
> - Dock contextual según tipo de celda y resaltado de celdas modificadas por el agente.
> - Abrir datasets directamente como hoja y completar el E2E del issue.

---

## Contexto (qué hace Claude Sheets)

Fuente: `../investigacion-web-funcionalidades.md` §4, capturas `sheets-*.jpg`.

- Hoja de cálculo real como artifact: **grilla con filas/columnas, pestañas, fórmulas que quedan en la celda** y se pueden verificar (Claude: 144 funciones, fórmulas entre pestañas).
- Claude y el usuario editan **las mismas celdas**; cada edición del agente se **resalta al aplicarse**.
- Formato condicional, dropdowns, checkboxes, gráficos (barra/línea/circular y otros).
- Importar CSV / Google Sheets / Excel; exportar `.xlsx` y CSV; "Send to" partners.
- Edición por chat ("agrega columna X", "resalta lo vencido"), preguntas sobre rangos seleccionados, comentarios en celdas, historial de versiones.
- Dashboard construido **sobre la propia grilla**, con pestañas (`Dashboard`, `Ventas`, `Calculos`), KPIs y tablas resumen.
- UI observada: barra `fx` con la fórmula (`=D3-F3`, `=SUM(Ventas!$G$2:$G$201)`), dock inferior **que cambia según el estado de la celda** (vacía → chips dropdown/persona/fecha/checkbox; numérica → decimales/moneda/%), barra inferior de pestañas y `Sum ...`, zoom dropdown, split chat/hoja y modo a ancho completo.
- Límites actuales del producto de Claude (no copiar como promesa): 100.000 celdas, sin pivots, rangos protegidos, buscar/reemplazar, orden multi-columna, vistas de filtro, multi-select, export PDF, sin macros/VBA/Power Query/DAX, sin datos en vivo.

## Problema en Comex hoy

- Los datos tabulados de estudios se muestran en tablas Markdown/HTML dentro del diálogo, sin cálculo verificable.
- Hay datasets guardados (`specialist_dataset_*`) pero no una superficie para explorarlos/calcularlos con fórmulas.

## Objetivo

Dar a Comex una superficie tipo hoja de cálculo donde los datos de un estudio se puedan inspeccionar, calcular y exportar, con **fórmulas visibles y trazables** como patrón central (más importante que paridad con Excel).

## Alcance

### Incluye (MVP)
- Esquema `sheet`: `{ id, title, tabs:[{ name, cells, formulas, formats, charts }], imports, meta }`.
- Grilla virtualizada con encabezados de fila/columna, selección de celda/rango y **barra `fx`** que muestra valor o fórmula.
- Pestañas múltiples y referencia entre pestañas (`=SUM(Ventas!B2:B10)`) en el motor que se elija.
- Fórmulas básicas (SUM, AVERAGE, IF, porcentaje, moneda) + formato condicional simple.
- Importar **CSV** desde datasets de Comex; exportar **CSV/XLSX**.
- Dock contextual con dos estados (celda vacía / con valor numérico) según el patrón observado.
- Carga de datos desde `specialist_dataset_read` y `specialist_dataset_derive`.
- Resaltado visual de celdas modificadas por el agente.

### Incluye (fase 2)
- Gráficos embebidos y dashboard sobre la grilla.
- Dropdowns/checkboxes, comentarios por celda, historial/versiones.
- Import directo XLSX/Google Sheets, export PDF.

### No incluye
- Macros/VBA/Power Query/DAX, pivots avanzados, datos en vivo desde conectores.
- Prometer compatibilidad total con Excel.

## Criterios de aceptación

- [ ] Al derivar un dataset se puede abrir como `SheetArtifact`.
- [x] La barra `fx` muestra la fórmula real de la celda seleccionada y se puede editar.
- [ ] Existen al menos 2 pestañas y una fórmula referencia otra pestaña.
- [ ] El formato condicional aplica a una columna y es visible sin ayuda.
- [ ] El dock cambia entre estado "celda vacía" y "celda con número" con acciones distintas.
- [ ] Se puede exportar CSV/XLSX y reimportar el CSV generado sin perder datos.
- [ ] Las celdas tocadas por el agente quedan resaltadas hasta confirmar/guardar.
- [ ] Flag `comex.artifacts.sheets`, tests headless, screenshots y reglas de `DESIGN.md` citadas.

## Notas técnicas (decisión de licencia — bloqueante)

Ver `../analisis-repos-tecnologias.md` §3.2:

| Opción | Licencia | Trade-off |
|---|---|---|
| **Univer Sheets** | Core Apache-2.0; colaboración, import/export XLSX, print, charts, pivot, sparklines y motor rápido suelen ser **Pro/comerciales** | Evaluado en spike; no es la dependencia actual |
| **FortuneSheet** | MIT | Plan B histórico; no implementado |
| **Jspreadsheet CE** | Dependencia vigente en `apps/app/package.json`; revisar licencia y alcance antes de cerrar | Implementado con barra `fx` propia y evaluador separado para herramientas |
| **AG Grid/Handsontable** | Community/Commercial | Excelente grid, no es spreadsheet completo |

**Acción requerida:** revalidar la implementación Jspreadsheet CE —licencia, fórmulas, XLSX,
formato condicional y compatibilidad— y actualizar la decisión del issue. Univer queda como
evaluación histórica, no como stack vigente.

- Stack: React/TS; integrar como artefacto embebido con API facade.
- Persistir celdas/fórmulas en JSON canónico, exportar a CSV/XLSX con librería elegida.
- Evitar Luckysheet (repositorio archivado).

## Dependencias

- Épico `00`.
- Decisión de licencia (bloqueante).
- Datasets del especialista (`specialist_dataset_list/read/derive`).

## Referencias

- `../investigacion.md` §4.3, §13.4 (cobertura Excel/fórmulas).
- Capturas: `sheets-grilla-creacion.jpg`, `sheets-formula-fila.jpg`, `sheets-formato.jpg`, `sheets-formato-condicional.jpg`, `sheets-dashboard.jpg`, `sheets-formula.jpg`.
- Fuente web: https://support.claude.com/en/articles/18324300-get-started-with-claude-sheets

## Definition of Done

- [ ] Decisión de librería/licencia documentada arriba.
- [ ] Criterios de aceptación verificables + tests headless.
- [ ] Screenshots y citas de `DESIGN.md` en el PR.
