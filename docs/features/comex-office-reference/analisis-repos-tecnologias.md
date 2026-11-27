# Análisis: repos y tecnologías para implementar la suite tipo Claude Office en Comex

> **Fecha:** 2026-11-16  
> **Objetivo:** identificar repos/tecnologías integrables para acercar Comex a las funcionalidades y diseño investigados (Docs, Slides, Sheets, Whiteboard, Data) con el menor tiempo posible, y definir cómo darle a Comex la capacidad de usarlos.  
> **Base:** `investigacion-web-funcionalidades.md`, `investigacion.md`, stack actual de Comex.
>
> **Nota de implementación (2026-11-24):** este análisis es histórico. La recomendación de
> Univer para Sheets no es el stack vigente: el código usa Jspreadsheet CE y un evaluador propio
> para herramientas del agente. Ver `matriz-decisiones.md` y `issues/03-sheets.md` antes de tomar
> una decisión nueva.

## 1. Contexto y restricciones de Comex (stack actual)

- **Monorepo pnpm** (`@openwork/app`, server, packages). App web/desktop en **React + TypeScript + Vite** (`apps/app`).
- UI/estado/deps relevantes ya presentes: **Tailwind + shadcn/base-ui**, **CodeMirror** (`@codemirror/*`), **Lexical** (`lexical`, `@lexical/react`), **Marked/MDX/KaTeX/Mermaid/Shiki**, `react-resizable-panels`, TanStack Query/Virtual, `docx-preview`, `@pierre/diffs`, MCP/ext-apps (`@modelcontextprotocol/sdk`, `@modelcontextprotocol/ext-apps`), dominios `specialists`, `session`, `apps`, `workspace`.
- **Implicación:** priorizar soluciones **React/TS embebibles** o servicios con integración clara (iframe/MCP/sidecar). Evitar stacks que obliguen a reescribir la app. Aprovechar Lexical/CodeMirror ya instalados para Docs cuando alcance.

## 2. Resumen ejecutivo (qué conviene integrar ya)

| Funcionalidad | Opción rápida recomendada | Licencia / costo | Esfuerzo | Por qué |
|---|---|---|---|---|
| **Docs (editor rico + colaboración)** | **BlockNote** (React, bloques tipo Notion) o **Tiptap** (ProseMirror) + **Yjs/Hocuspocus** para collab; reutilizar **Lexical** existente para casos simples | BlockNote core MPL-2.0 (XL/GPL o comercial); Tiptap core MIT (algunas features cloud/pagas); Yjs/Hocuspocus MIT | Medio | Cubre rápido editor tipo doc, bloques, slash, comentarios/colab con ecosistema maduro |
| **Sheets (hoja tipo Excel)** | **Univer Sheets** | Core Apache-2.0; **colaboración, import/export xlsx, print, charts, pivot, sparklines y motor rápido son comerciales/Pro** según comparativas/docs | Medio–Alto (alto si se necesitan features Pro sin pagar) | La opción más completa embebible (fórmulas, formato condicional, canvas, React). Alternativas MIT más limitadas: **FortuneSheet** |
| **Slides** | **MVP rápido:** Markdown→slides con **Reveal.js**/**Spectacle** o editor propio sobre canvas; **producto visual WYSIWYG:** **tldraw** (canvas) o evaluar **Polotno SDK** (comercial) | Reveal/Spectacle OSS; tldraw licencia propia (watermark/dev, prod con licencia); Polotno comercial | Medio | No hay “Google Slides OSS” completo y maduro; conviene empezar por export/presentación estructurada |
| **Whiteboard (canvas infinito)** | **tldraw SDK** o **Excalidraw** (`@excalidraw/excalidraw`) | tldraw: gratis en dev/watermark, **licencia requerida en producción**; Excalidraw: **MIT** | Bajo–Medio | Integración React directa, herramientas maduras, colaboración posible (tldraw sync / Yjs para Excalidraw) |
| **Data (dashboards/SQL/viz)** | **Componentes embebidos**: Recharts/Nivo/ECharts/Vega-Lite + tablas; **BI embebible/self-host**: **Evidence** (MIT, code-first), **Metabase/Superset** (embeds) según necesidad | Varía (Evidence MIT; Superset Apache-2.0; Metabase OSS+comercial) | Bajo (charts) a Alto (BI completo) | Copiar patrón Claude Data (KPIs+narrativa+query visible) es más rápido con componentes propios que incrustar un BI entero |
| **Design/capa de marca** | Sistema de temas/tokens propio + presets (no integrar repo externo específico) | N/A | Bajo–Medio | Es transversal; implementar como tokens/temas aplicables a artefactos |

> **Criterio “rápido”:** 1) librería React embebible con API clara, 2) licencia compatible/entendible, 3) evita construir motor desde cero, 4) integrable con el modelo de artefactos/paneles de Comex.

## 3. Análisis por funcionalidad

### 3.1 Docs (documento vivo, edición híbrida, export)

| Opción | Qué aporta | Licencia | Pros | Contras / riesgos | Integración en Comex |
|---|---|---|---|---|---|
| **Lexical (ya instalado)** | Editor extensible, React-first, buen control de modelo | MIT | Sin nueva dependencia mayor; base para editor propio | Hay que construir UI/bloques/comentarios/export | Evolucionar `components/markdown`/editores hacia artifact-doc |
| **Tiptap** | ProseMirror productivo, extensiones, menús, collab (Yjs/Hocuspocus) | Core MIT; algunos productos/extensiones pagos | Ecosistema grande, muy usado | Complejidad de esquema; features avanzadas pueden requerir pago/cloud | Editor de documento como panel/artefacto con toolbar contextual |
| **BlockNote** | Bloques tipo Notion (slash, drag, side menu), sobre ProseMirror/Tiptap | Core MPL-2.0; XL (AI/export/cols) GPL/comercial | “Notion-like” rápido | React-only UI; paquetes XL con restricciones | Buen fit para docs estructurados y salidas del mini-Studio |
| **Plate** | Framework sobre Slate, componentes shadcn-style | MIT core (+ Plate Plus pago opcional) | Alineado a shadcn/Tailwind; plugins | Modelo Slate y nesting por indentación; curva de composición | Encaja visualmente con stack actual |
| **Solo export/render** (`docx-preview` ya existe, PDF/MD) | Visualizar/exportar | según lib | Rápido para entrega | No es edición colaborativa completa | Complemento, no reemplazo del editor |

**Recomendación:** corto plazo, mejorar visor/editor de salidas con Lexical/CodeMirror existentes + export sólido; mediano plazo, evaluar **BlockNote** o **Tiptap** si se necesita experiencia “doc vivo” rica (bloques, comentarios, collab) sin construir todo.

### 3.2 Sheets (grilla, fórmulas, formato condicional, import/export)

| Opción | Qué aporta | Licencia | Pros | Contras / riesgos | Integración en Comex |
|---|---|---|---|---|---|
| **Univer Sheets** | Motor completo (fórmulas ~500+, formato condicional, validación, canvas, charts/docs/slides en suite, headless) | Core Apache-2.0; **muchas capacidades enterprise (collab, xlsx import/export, print, charts, pivot, sparklines, motor rápido) son Pro/comerciales** | La integración más cercana a “Claude Sheets” real | Riesgo de dependencia de features Pro; verificar matriz de features open-source vs licencia comercial | Embeber como artefacto “sheet” con panel; usar facade API; planificar licenciamiento si se requiere Pro |
| **FortuneSheet** | Reescritura Luckysheet en React/TS, MIT, hooks de colaboración (`onOp/applyOp`) | MIT | Sin lock-in comercial; modelo Luckysheet-compatible | Menos activa/madura que suites comerciales; features avanzadas limitadas | Buena base OSS para grid + fórmulas básicas |
| **AG Grid / Handsontable** | Grids potentes | Community/Commercial | Rendimiento y UX de grid | No son “spreadsheet completo” Excel-like por defecto (fórmulas/modelo) salvo ediciones enterprise | Útiles para tablas de datos/paneles, no para Sheets pleno |
| **Luckysheet** | Históricamente popular | MIT pero **archivado** | — | **No recomendado** para nuevo desarrollo | Evitar |

**Recomendación:** si se busca paridad alta y velocidad de producto, **prototipo con Univer** y validar temprano qué queda en core vs Pro; si la prioridad es OSS sin costo de licencia, **FortuneSheet** para un subconjunto (grilla, fórmulas básicas, formato) y extender.

### 3.3 Slides (presentaciones)

| Opción | Qué aporta | Licencia | Pros | Contras / riesgos | Integración en Comex |
|---|---|---|---|---|---|
| **Reveal.js / Spectacle** | Presentaciones web (HTML/React) de alta calidad | OSS (MIT típicamente) | Rápido para presentar/exportar desde contenido estructurado | Más “slides como código/estructura” que editor WYSIWYG tipo PowerPoint | Generar deck desde doc/datos (pipeline) + vista presentación |
| **Slidev** | Slides desde Markdown (orientado dev) | OSS | Excelente para contenido técnico | Menos WYSIWYG general | Útil para export técnico, no como editor principal de usuario final |
| **tldraw (canvas)** | Lienzo con formas/texto/multimedia, export imagen | Licencia tldraw (prod requiere licencia) | Flexible para componer diapositivas visuales | No es motor de slides nativo (filmstrip/notas/modos) sin construir capa | Base para editor visual custom de “slides”/storyboards |
| **Polotno SDK** | Editor de diseño/canvas con capacidades visuales | **Comercial** | Producto WYSIWYG maduro | Costo/licencia, dependencia vendor | Evaluar solo si hay presupuesto y encaje |
| **Construcción propia sobre modelo de bloques** | Control total alineado a Comex | N/A | Ajuste exacto al dominio | Mayor tiempo | Recomendado como capa fina: modelo slide = bloques + renderer/presentador

**Recomendación:** **enfoque incremental**: (1) representación estructurada de “deck” (JSON/MD) + renderer/presentación y export (PDF/PPTX si se agrega lib/server), (2) editor visual después (tldraw o propio) solo si es prioritario.

### 3.4 Whiteboard (pizarra infinita, diagramas)

| Opción | Qué aporta | Licencia | Pros | Contras / riesgos | Integración en Comex |
|---|---|---|---|---|---|
| **tldraw SDK** | Canvas infinito React de alto nivel, shapes/herramientas, multiplayer sync (`@tldraw/sync`), extensible, starter kits | **Licencia tldraw**: dev/evaluación ok, **producción requiere licencia** (watermark/licencia; pricing comercial) | Mejor experiencia “producto listo” y extensible; muy rápido para UX tipo Miro/FigJam | Costo/licencia en prod; no aceptar contribuciones externas igual no afecta uso | Embeber `<Tldraw />` como artefacto/panel; integrar persistencia y permisos de Comex |
| **Excalidraw** (`@excalidraw/excalidraw`) | Whiteboard estilo hand-drawn, embebible | **MIT** | Sin costo de licencia, comunidad grande, fácil embed | Colaboración/funciones avanzadas pueden requerir más armado | Excelente opción OSS para MVP sólido |
| **Construir con Konva/Fabric/React Flow** | Primitivas canvas/grafos | OSS (según lib) | Control total | Mucho tiempo (herramientas, selección, undo, export, collab) | Solo si el dominio exige algo muy específico |

**Recomendación:** para **máxima velocidad** con UX premium, tldraw (aceptando licencia); para **evitar costo/licencia**, Excalidraw. Ambos integrables como artefactos.

### 3.5 Data (dashboards, KPIs, narrativa, trazabilidad)

| Opción | Qué aporta | Licencia | Pros | Contras / riesgos | Integración en Comex |
|---|---|---|---|---|---|
| **Componentes propios (Recharts/Nivo/Vega-Lite/ECharts + UI Comex)** | Gráficos, tablas, KPIs, layout narrativo | OSS (según lib) | Control total del diseño (coincidir con investigación), sin BI pesado | Hay que modelar consultas/datos | Mejor para replicar patrón Claude Data (KPIs + texto + nota metodológica + foco) dentro de artefactos |
| **Evidence** | Dashboards code-first (SQL + Markdown), self-host | MIT | Muy alineado a “reporte/datos narrativos” reproducibles | Paradigma code-first; embedding/integración a app existente requiere diseño | Como generador/publicador de reportes o fuente de plantillas; integración vía build/serve |
| **Apache Superset** | BI completo, SQL Lab, charts, embeds | Apache-2.0 | Potente y gobernable | Infra pesada, UX de BI (no “artefacto ligero” nativo) | Embeber dashboards puntuales o usar como backend analítico externo |
| **Metabase / Grafana** | BI/observabilidad | OSS+comercial / AGPL | Rápido para analytics operativos | Menos alineado a “data story” tipo Claude; licencias/embeds | Solo si el caso de uso es métricas operativas estándar |

**Recomendación:** implementar el **patrón Claude Data como artefacto nativo** (componentes de chart + bloque narrativo + metadatos de fuente/query/fecha) alimentado por datasets de Comex; usar BI externo solo para casos analíticos avanzados.

## 4. Capacidades transversales (aceleradores)

- **Colaboración en tiempo real:** **Yjs** (CRDT) + proveedor (**Hocuspocus** self-host, **y-websocket**, o servicios como Liveblocks). Aplicable a Docs/Whiteboard/Sheets según editor.
- **Persistencia y formato:** almacenar documentos como JSON estructurado (modelo del editor) + exportadores (MD/HTML/PDF/DOCX/XLSX/PPTX según caso). `docx-preview` ya existe; evaluar libs de export en cliente/servidor.
- **Comentarios/menciones:** muchos editores lo soportan como plugin; definir modelo de comentarios alineado a artefactos compartidos de Comex.
- **Accesibilidad/teclado:** seguir patrones documentados (F6 áreas, Escape/Return, atajos) desde el diseño, no al final.

## 5. Cómo darle a Comex la capacidad de usarlos

### 5.1 Integración en la UI (rápido y visible)
- **Artefactos/paneles por tipo**: crear superficies `DocArtifact`, `SheetArtifact`, `SlidesArtifact`, `WhiteboardArtifact`, `DataArtifact` dentro del dominio de sesión/apps/panels (aprovechando `react-resizable-panels` para split chat↔artefacto y “Mostrar chat”).
- **Visor primero, editor después**: para cada tipo, empezar con render + export + metadatos/estado (Draft, fuentes, progreso), luego edición rica y colaboración.
- **Shell común**: header (título, estado, compartir/exportar), cuerpo, dock/barra contextual según selección — reutilizable entre artefactos.

### 5.2 Integración como herramientas/capacidades del agente
- **Herramientas internas/MCP**: exponer operaciones `create_doc`, `update_block`, `create_sheet`, `run_query/render_chart`, `create_whiteboard` etc., para que el agente produzca artefactos estructurados (no solo texto).
- **Formato intermedio canónico**: definir esquemas JSON por artefacto (doc blocks, sheet cells/formulas, slides, board scene, data spec) que el modelo genere y la UI renderice/edite.
- **Specialists/skills**: skills específicas por dominio (“redactar informe”, “armar planilla”, “diagramar flujo”, “construir dashboard”) que sepan emitir el esquema correcto.

### 5.3 Integración de servicios externos (cuando convenga)
- **Embeds controlados** (iframe) para BI o herramientas pesadas, con paso de contexto/datos.
- **MCP servers externos** (p. ej. Excalidraw/Miro/draw.io servers ya existentes en el ecosistema) como puente rápido para pizarra/diagramas, si se acepta dependencia externa.
- **Sidecar/self-host** para collab (Hocuspocus) o conversión de formatos.

## 6. Roadmap sugerido (máximo impacto / menor tiempo)

1. **Fase 1 — Fundaciones de artefacto (rápida):** modelo de artefacto + shell común + split chat/artefacto + export básico (MD/PDF/imagen) reutilizando editores/renderers actuales (Lexical/CodeMirror/Markdown/Mermaid). Habilita “capacidad de usar” salidas estructuradas.
2. **Fase 2 — Whiteboard + Docs mejorado:** integrar **Excalidraw** (OSS, rápido) o tldraw (si se acepta licencia) como `WhiteboardArtifact`; mejorar Docs con bloques/toolbar (Lexical/BlockNote/Tiptap según decisión).
3. **Fase 3 — Data nativo:** componentes de KPIs/gráficos + narrativa + cita de fuente/query sobre datasets de Comex (patrón Claude Data sin BI externo).
4. **Fase 4 — Sheets:** prototipo con **Univer** (validar core vs Pro) o **FortuneSheet** (OSS) según restricción de licencia/funcionalidad.
5. **Fase 5 — Slides y colaboración avanzada:** renderer/presentador estructurado y luego editor visual; añadir Yjs/Hocuspocus donde el tipo lo requiera.

## 7. Riesgos y decisiones a cerrar

- **Licencias:** tldraw requiere licencia en producción; Univer tiene frontera core vs Pro; BlockNote XL tiene términos GPL/comercial — validar legalmente antes de comprometer roadmap.
- **Paridad vs. valor:** copiar el **patrón UX/funcional** (verificabilidad, progreso, split, export, contexto) aporta más valor rápido que replicar 1:1 cada feature de la suite de Claude.
- **Mantenimiento:** preferir libs activas y con integración React clara; evitar proyectos archivados (Luckysheet) o con mantenimiento incierto.
- **Seguridad/sandbox:** embeds, iframes y ejecución de contenido generado deben pasar por las políticas de OpenWork/Comex.

## 8. Fuentes de esta evaluación

- Stack: `package.json`, `apps/app/package.json`, estructura `apps/app/src/react-app/*`.
- Investigación funcional/diseño: `investigacion-web-funcionalidades.md`, `investigacion.md`.
- Web (consultas 2026-11-16): documentación/sitios de Univer, tldraw, BlockNote, Tiptap, comparativas de editores/spreadsheets/whiteboards/BI (Liveblocks, Eddyter, Domternal, PkgPulse, pistack, GitHub/OpenSoftwareAlliance, Evidence/Superset/Metabase, etc.).
