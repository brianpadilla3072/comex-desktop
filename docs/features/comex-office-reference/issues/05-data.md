# Funcionalidad — Paneles de datos con narrativa y trazabilidad tipo Claude Data

**Título sugerido:** `[Feature] Artefacto Data: KPIs, narrativa y nota metodológica sobre datasets de Comex`
**Labels sugeridas:** `feature`, `ux`, `comex`, `artifact`, `panels`, `needs-design-review`
**Depende de:** `00-epico-artefactos-oficina`, `06-temas`
**Estimación sugerida:** 2 semanas

> **Estado real (2026-11-24): PARCIAL.**
>
> **Implementado**
> - `DataView` dentro del shell común.
> - Resolución de la spec mediante `GET /artifacts/:id/resolve` y el motor existente de paneles.
> - Lectura del snapshot más reciente con refetch cada 15 segundos.
> - Narrativa Markdown y etiqueta de fuente viva.
> - Reutilización de `PanelResolutionBlocks`, sin duplicar lógica de datos.
>
> **Pendiente**
> - KPI editorial completo, nota metodológica y traza por gráfico con snapshot/fecha.
> - Modo foco de series, edición local de títulos/etiquetas y formatos.
> - Panel Design, pruebas con dataset de ejemplo y capturas.

---

## Contexto (qué hace Claude Data)

Fuente: `../investigacion-web-funcionalidades.md` §6, capturas `data-*.jpg`.

- Convierte preguntas en lenguaje natural en **dashboards, scrollytellers, visual shorts y visual analysis**.
- Conecta warehouses/apps; Claude escribe **una consulta SQL por gráfico**, la ejecuta y muestra **la query detrás de cada número** y cuándo se actualizó. La consulta se puede abrir y corregir.
- Formatos: Dashboard (exploración rápida), Scrollyteller, Visual short, Visual analysis.
- Refresco **al abrir cuando corresponde** (no calendario fijo), con `Refresh data` y cadencia/caché configurable.
- Gobernanza: **consultas certificadas** con badge (definiciones reutilizables, incluso desde dbt/Looker/Cube vía MCP), **live sharing** (el espectador ve resultados con el acceso del creador, solo queries necesarias), historial con restore.
- UI observada: KPIs en grilla 3×2, párrafo narrativo con cifras en negrita, **nota metodológica al pie**; scrollytelling con foco en una serie y el resto atenuado; barra de `Draft` con `Undo/Redo/Cancel/Save`, íconos de historial y fuentes; panel `Design/estilos` con formatos y ajustes (dropdowns/campo numérico, **no sliders**).

## Problema en Comex hoy

- Los paneles declarativos existen (`specialist_panel_*`) y son deterministas sobre datasets, pero el render es funcional, no editorial.
- La auditoría/cita de datos no se muestra junto a cada número.

## Objetivo

Elevar los paneles a una presentación editorial y verificable: KPIs + narrativa + metodología + fuente/query por gráfico, usando los datasets ya guardados en Comex.

## Alcance

### Incluye (MVP)
- Tipo de artefacto `data` que envuelve un dataset (`specialist_dataset_read`) y una spec de visualización.
- Render editorial: título, bloque narrativo con cifras destacadas, grilla de KPIs, gráficos (barra/línea) y **nota metodológica** al pie.
- **Traza por gráfico**: siempre visible el nombre del dataset, el id del snapshot, la fecha y el pasaje de fuente citado (si aplica). Equivalente Comex de "query + last refreshed".
- Modo **foco + contexto** en series (atenuar lo que no importa) para scrollytelling básico.
- Barra de estado tipo `Draft` con `Undo/Redo/Descartar/Guardar` para edición local de títulos/etiquetas.
- Panel lateral `Design` con selección de formato (`Dashboard`, `Scrollyteller`, `Visual analysis`) y ajustes simples.
- Flag `comex.artifacts.data`.

### Incluye (fase 2)
- Visual short (video narrado), consultas certificadas/badge, live sharing, historial con restore.
- Conectores reales a warehouses (equivalente a SQL de Claude) y caché/cadencia de refresco.

### No incluye
- Incrustar Superset/Metabase completos en el MVP (ver `../analisis-repos-tecnologias.md` §3.5).
- Prometer "datos en vivo" sin conector.

## Criterios de aceptación

- [ ] Al abrir un dataset existe "Ver como panel editorial" y se muestra KPIs + narrativa + nota metodológica.
- [ ] Cada gráfico muestra su fuente (dataset + snapshot + fecha) y es clickeable para ver el pasaje/consulta.
- [ ] Las cifras en el texto coinciden con las del dataset (test con dataset de ejemplo).
- [ ] El modo foco atenúa las series no seleccionadas y mantiene legible la protagonista.
- [ ] La edición local de título/etiqueta no pisa el guardado hasta confirmar (`Save`).
- [ ] El panel `Design` cambia entre formatos sin perder los datos subyacentes.
- [ ] Flag, tests headless, screenshots y reglas de `DESIGN.md` citadas.

## Notas técnicas

- Reutilizar `specialist_panel_*` como fuente de verdad y envolverlo con el render editorial; no duplicar lógica de datos.
- Componentes de chart: evaluar **Recharts/Nivo/ECharts/Vega-Lite** según bundle y licencia (OSS). Ver `../analisis-repos-tecnologias.md` §3.5.
- "Query" en Comex = `dataset.query` + `source_read` + id de snapshot; documentar esta traducción en la UI (no inventar SQL).
- Auditoría de citas de `specialist_output_generate` reutilizable para el chip de estado.
- Tipografía del sistema y tokens propios; no copiar la paleta oscura cálida de Claude.

## Dependencias

- Épico `00`, tema `06`.
- Datasets y paneles existentes (`specialist_dataset_list/read`, `specialist_panel_list/read`).

## Referencias

- `../investigacion.md` §4.5, §5 patrones (jerarquía editorial, foco+contexto, verificabilidad).
- Capturas: `data-dashboard.jpg`, `data-fuentes-query.jpg`, `data-estilos.jpg`, `data-scrollytelling.jpg`, `data-scroll-stats.jpg`.
- Fuente web: https://support.claude.com/en/articles/17454700-get-started-with-claude-data

## Definition of Done

- [ ] Criterios de aceptación + tests con dataset de ejemplo.
- [ ] Screenshots del panel editorial y del modo foco.
- [ ] Typecheck y `test:comex` en verde.
