# Investigación completa: funcionalidades y diseño de la suite ofimática de Claude

> **Estado:** completada como referencia de investigación (2026-11-16).  
> **Objetivo:** documentar con suficiente detalle **qué hace** y **cómo se ve/comporta** cada funcionalidad de la suite de Claude (Docs, Slides, Sheets, Whiteboard, Data, Design) para poder copiar patrones de funcionalidad y diseño en Comex, con trazabilidad a fuentes.  
> **Fuentes base:** investigación web (soporte/anuncios oficiales Anthropic y secundarias) + análisis del video EDteam y 29 capturas en `investigacion.md`/`frames/`.

## Convenciones de este documento

- **[Confirmado web]**: afirmado en documentación/anuncios oficiales consultados.
- **[Observado en video]**: visible en el video/capturas analizadas (`investigacion.md`), no necesariamente documentado oficialmente.
- **[Inferido / no confirmado]**: plausible pero sin confirmación explícita; no asumir como contrato de producto.
- **Para replicar en Comex**: recomendaciones de copia/adaptación (no implementar aquí; respetar `DESIGN.md` y el alcance de Comex).

## Índice

1. [Modelo común de la suite (Artifacts)](#1-modelo-común-de-la-suite-artifacts)
2. [Claude Docs](#2-claude-docs)
3. [Claude Slides](#3-claude-slides)
4. [Claude Sheets](#4-claude-sheets)
5. [Claude Whiteboard](#5-claude-whiteboard)
6. [Claude Data](#6-claude-data)
7. [Claude Design / capa de marca](#7-claude-design--capa-de-marca)
8. [Contraste video vs documentación oficial](#8-contraste-video-vs-documentación-oficial)
9. [Guía de replicación para Comex (funcionalidad + diseño)](#9-guía-de-replicación-para-comex-funcionalidad--diseño)
10. [Checklist de completitud y seguimiento](#10-checklist-de-completitud-y-seguimiento)
11. [Fuentes](#11-fuentes)

---

## 1. Modelo común de la suite (Artifacts)

### Concepto y contenedor [Confirmado web]
- Un **artifact** es algo que Claude crea para poner frente a alguien (diseño, deck, documento, dashboard, herramienta interactiva). Se abre **junto a la conversación**, se puede editar, retomar y compartir. (Support: “What are artifacts…”)
- Se inicia desde cualquier conversación, desde “Output” en el cuadro de mensaje, desde la pestaña **Artifacts**, o (según plantilla) desde Claude Code. Todo lo creado se guarda en la pestaña **Artifacts**.
- Plantillas/tipos: **Docs, Slides, Design, Data, Sheets (beta), Whiteboards (beta), Motion (beta)**. Funcionan con el mismo patrón: editar hablando con Claude o directamente, actualización en vivo, compartir o exportar cuando está listo.

### Ciclo de trabajo [Confirmado web]
- **Crear**: prompt en chat o plantilla; Claude puede pedir aclaraciones antes de generar (Docs).
- **Editar**: híbrido — conversación, edición directa en el lienzo/página, y en algunos casos comentarios dirigidos (“Edit with Claude”/`@Claude`).
- **Persistir**: guardado automático/asociado al artifact (según tipo); historial/versiones donde aplica (p. ej. Data; en Docs hay limitaciones conocidas de acceso a historial según ancho de panel).
- **Compartir**: enlace con niveles de acceso según tipo/plan; requiere cuenta Claude para abrir compartidos en general. **Exportar**: formatos según plantilla.

### Diseño/UI común observado [Observado en video]
- **Shell de artefacto propio** (no contenido inline en el chat): header mínimo, cuerpo dominante, controles flotantes.
- **Split chat ↔ artefacto** (~42/58 en Docs/Whiteboard) o **canvas completo** con `Mostrar chat` (Slides, Sheets, Data).
- **Dock/barra inferior flotante** contextual y barras sobre selección; el cromo fijo se minimiza.
- **Progreso visible** durante generación (“buscando…”, pasos, esqueleto temprano) y estados como `Draft`.

**Para replicar en Comex:** tratar salidas/paneles como superficies de primer nivel (visor/editor) con metadatos, estado, acciones y coexistencia con el chat — no solo como bloques dentro de un diálogo.

---

## 2. Claude Docs

### Qué es y dónde vive [Confirmado web]
- Plantilla de artifact: **“living documents you write with Claude and your team in real time”**. Documento rich-text con encabezados, tablas y formato; puede tener **más de una pestaña** (“como secciones de un cuaderno”). Se abre en ventana propia junto a la conversación y se guarda en **Artifacts**.
- Disponible en **Free, Pro, Max, Ultra, Team, Enterprise** (y superficies compatibles: web, desktop, Claude Code; iOS/Android con edición/visualización según caso). En Enterprise, activación por defecto indicada para 15 oct 2026 (owners pueden activar antes). Requiere *Cloud code execution and file creation* activado en Capacidades.

### Capacidades funcionales [Confirmado web]
- **Creación con contexto:** Claude parte del contexto disponible (archivos, memoria, proyectos, skills, apps conectadas, según acceso) y puede hacer preguntas aclaratorias antes de redactar. Ejemplos: specs, reportes, guías, briefs desde notas/Drive/etc.
- **Edición directa:** clic y escribir; cambios se guardan automáticamente y aparecen en tiempo real para quienes tienen el doc abierto.
- **Edición por conversación:** pedir cambios en el chat (“Tighten the intro…”); Claude edita y explica qué cambió.
- **Comentarios y `@Claude`:** seleccionar texto y comentar; mencionar `@Claude` para que responda en el hilo, haga el cambio y explique. Claude también deja comentarios al redactar (elecciones/preguntas).
- **Edición localizada:** en doc/Markdown, seleccionar texto → **“Edit with Claude”** para editar en el punto marcado. Ediciones en lote en borradores multiarchivo Markdown.
- **Colaboración:** personas con acceso de edición trabajan a la vez; Claude actúa con los permisos de quien lo pide (no puede editar por alguien con solo lectura).
- **Gráficos/visuales insertados:** pedir charts/diagramas/timelines construidos desde apps conectadas; **no se actualizan solos** aunque vengan de datos conectados (pedir “pull latest data” para refrescar).
- **Compartir:** doc privado por defecto. Niveles: **Viewer** (leer), **Commenter** (leer/comentar), **Editor** (leer/editar/comentar/exportar). Solo el owner renombra/elimina. Apertura de compartidos requiere cuenta Claude. Reglas por plan para compartir dentro/fuera de org y por enlace/email (ver Share artifacts); en Team/Enterprise el owner controla compartir fuera. **Borrar es permanente** (sin papelera).
- **Exportar:** **Word (.docx), PDF, Markdown (.md), Google Docs**. También se puede pedir convertir el doc en presentación con **Claude Slides**.

### Diseño y UI para replicar [Observado en video + inferido de web]
- **Layout:** split ~42/58 chat/documento; documento como lienzo dominante con márgenes de lectura, título, metadatos/chips (autor, fecha, tipo) y secciones con headings. Scroll independiente; progreso de generación visible mientras el agente investiga/escribe.
- **Edición in-context:** selección de texto con affordances de comentario/edición; cambios del agente explicados (comentarios/hilo).
- **Header/acciones:** controles de compartir/exportar accesibles; estado implícito de colaboración.
- **Comportamiento clave a copiar:** el usuario puede leer/editar mientras Claude trabaja; la primera versión útil aparece pronto (esqueleto → contenido).

### Límites y notas [Confirmado web]
- Historial de versiones: con panel angosto puede abrirse sobre el texto y no ser alcanzable por Tab desde toolbar (limitación conocida).
- Charts/diagramas no auto-actualizan.
- Actividad (edits/comentarios) no registrada aún en Compliance API.
- Móvil: no se pueden cambiar ajustes de compartición en apps iOS/Android.
- Accesibilidad: issue VoiceOver/typing en Chrome 150–152 y Claude Desktop (usar Chrome 153+ o Safari).
- **No detallado oficialmente (accesible):** inventario completo de formato rico/tablas/imágenes como controles UI nombrados, modelo exacto de presencia/cursores, conflictos de coedición, tamaño máximo del documento.

### Fuentes
- https://support.claude.com/en/articles/16923645-get-started-with-claude-docs
- https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them
- https://support.claude.com/en/articles/9547008-share-artifacts
- https://support.claude.com/en/articles/12138966-release-notes

---

## 3. Claude Slides

### Qué es y dónde vive [Confirmado web]
- Artifact/plantilla para presentaciones: crear, editar, presentar y descargar dentro de Claude. Se abre junto al chat, se guarda en Artifacts. Acceso desde web, desktop, móvil y Claude Code. Distinto de **Claude for PowerPoint** (add-in dentro de PowerPoint).

### Capacidades funcionales [Confirmado web]
- **Generación:** desde prompt, notas, reportes, archivos o trabajo previo en el chat; puede usar contexto disponible (proyectos/skills/apps) y dejar placeholders si faltan datos.
- **Edición:** por conversación (cambios dirigidos a diapositivas específicas) y **directa/manual** — seleccionar, doble clic para texto, arrastrar/redimensionar; toolbar para texto, imágenes, tablas y formas; panel **Properties** (fuente, color, etc.).
- **Gestión de slides:** filmstrip/miniaturas para navegar, añadir, reordenar, duplicar; **Skip slide** (omitir al presentar/descargar sin borrar).
- **Contenido:** gráficos desde datos indicados (snapshot al construir; pedir actualización si cambian), imágenes/logos, notas del orador (generadas o manuales, no visibles en la slide).
- **Presentar:** pantalla completa; **Present with speaker notes** abre segunda ventana con notas, reloj y vista actual/siguiente.
- **Colaboración:** comentarios; con “Send to Claude” puede aplicar cambios y responder en hilo. Con acceso de edición, trabajo simultáneo y visibilidad de quién está en cada slide (según Academy).
- **Marca:** uso de sistemas de diseño configurados o imitación de deck/archivo de marca adjunto.
- **Exportar/compartir:** **PowerPoint (.pptx), PDF**; también HTML, PNG de slide actual y envío a **Google Slides** (si Drive conectado) según flujos documentados. Compartir por enlace con niveles según plan. En export a PPTX: texto/tablas/imágenes/fondos/notas editables, pero gráficos/iconos/formas pueden rasterizarse; se omiten transiciones y slides omitidas (Academy).

### Diseño y UI para replicar [Observado en video + Confirmado web]
- **Modos:** canvas a ancho completo con opción `Mostrar chat` (el chat se oculta para priorizar lienzo 16:9). Filmstrip/miniaturas a la izquierda; slide activa al centro; sub-barra superior (añadir slide, vista, zoom, presentar, compartir/exportar).
- **Selección directa:** bounding box con 8 handles, arrastre/redimensión; **barra contextual flotante** sobre el objeto (texto/estilo/color/alineación según selección). Panel de propiedades lateral/contextual.
- **Dock inferior flotante:** inserción rápida (texto, imagen, tabla, formas, comentario, acceso a chat) — patrón de acciones cerca del contenido.
- **Accesibilidad/teclado:** áreas (toolbar, slide, formato flotante, thumbnails, propiedades) navegables con `F6/Shift+F6`, edición con Return/Escape, presentación con flechas/Escape (documentado en ayuda de artifacts/slides).

### Límites y notas [Confirmado web / no confirmado]
- Cuenta contra límites de uso; requiere artefactos/capacidades habilitadas. Despliegue/gestión por plan y org (Artifacts settings).
- **No totalmente confirmado:** fidelidad de editabilidad 100% nativa en todo PPTX exportado; coedición en tiempo real con semántica exacta más allá de lo descrito. API/integraciones de terceros no anunciadas en fuentes revisadas.

### Fuentes
- https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them
- https://academy.claude.com/tutorials/using-claude-design-for-presentations-and-slide-decks
- https://support.claude.com/en/articles/17457950-use-artifacts-with-a-keyboard-or-screen-reader

---

## 4. Claude Sheets

### Qué es y dónde vive [Confirmado web]
- Hoja de cálculo integrada en Claude, **beta** (anunciada 10 nov 2026 con Whiteboards y Data). Artifact editable por usuario/equipo/Claude en las mismas celdas. Web y escritorio; acceso básico **solo lectura** en móvil. Guardada en Artifacts.
- Planes de pago **Pro, Max, Ultra, Team, Enterprise**. On por defecto en Team; en Enterprise off por defecto hasta habilitar en Artifacts.

### Capacidades funcionales [Confirmado web]
- **Generación y estructura:** pestañas, fórmulas entre pestañas, formato, dropdowns, checkboxes, gráficos (barras, líneas, circulares y otros) desde prompt.
- **Fórmulas reales:** persisten en celdas; se pueden escribir propias. Ayuda indica **144 funciones**. Cada edición de Claude se resalta al aplicarse.
- **Datos:** importar **CSV, Google Sheets, Excel** o pegar desde Excel/Sheets; exportar **.xlsx y CSV**; “Send to” a partners (Airtable, Asana, monday.com, Smartsheet). No reemplaza Excel completo (para eso, Claude for Excel / exportar).
- **Edición y análisis:** pedir cambios en lenguaje natural, preguntar sobre rango seleccionado, editar directo, comentar, compartir y trabajar simultáneamente. Historial de versiones (restaurar descarta posteriores).
- **Límites de tamaño/capacidad:** hasta **100.000 celdas** por hoja.

### Diseño y UI para replicar [Observado en video + parcial web]
- **[Observado] Grilla real:** encabezados de columnas/filas, selección de celda/rango, **barra `fx`** mostrando valor o fórmula (p. ej. `=D3-F3`, `=D2*(1-E2/100)-F2`, `=SUM(Ventas!$G$2:$G$201)`), pestañas de hoja inferiores (`Ventas`, `Dashboard`, etc.), zoom (dropdown).
- **[Observado] Dock/toolbar contextual:** cambia según selección — formato de texto/alineación/color/relleno/bordes/combinar, formato condicional, formato numérico/moneda/%, insertar (dropdown/persona/fecha/checkbox) en estados adecuados; acciones rápidas cerca del contenido.
- **[Observado] Formato condicional visible** (resaltado por reglas) y **dashboard construido sobre la grilla** (celdas combinadas/estilo reporte, KPIs, tablas resumen) en pestañas dedicadas.
- **[Observado] Split chat/hoja** durante creación y modo hoja a ancho completo con `Mostrar chat`.
- **[Web]** menciona edición en celdas, fórmulas persistentes, resaltado de ediciones de Claude, selección de rangos — coherente con lo observado; nombres exactos `fx`/“dock” no aparecen textuales en la ayuda consultada (tratarlos como observación de UI).

### Límites y no soportado [Confirmado web]
- **No disponible aún:** tablas dinámicas, rangos protegidos, buscar/reemplazar, ordenación multi-columna, vistas de filtro, desplegables multi-selección, exportación a PDF.
- **No soportado:** macros, VBA, Power Query, DAX, diseño de impresión.
- **Sin datos en vivo** desde apps conectadas; no usable como fuente de datos de docs/decks/dashboards. HIPAA, CMEK, ZDR no soportados en beta.
- **Conclusión de copia:** replicar el patrón “hoja verificable” (fórmulas visibles, formato condicional, grilla como superficie), no prometer paridad Excel avanzada.

### Fuentes
- https://support.claude.com/en/articles/18324300-get-started-with-claude-sheets
- https://claude.com/resources/articles/sheets-whiteboards-data
- `investigacion.md` §4.3 (anatomía observada)

---

## 5. Claude Whiteboard

### Qué es y dónde vive [Confirmado web]
- Pizarra compartida (artifact) para pensar con Claude y el equipo: organiza ideas en **diagramas, flujos y grupos** con **formas, flechas y secciones**. Útil antes de la versión final; se puede convertir en **doc o deck**. **Beta** en planes de pago (Pro/Max/Ultra/Team/Enterprise), web/Desktop/Mobile; guardada en Artifacts. No disponible en Claude for Teachers.

### Capacidades funcionales [Confirmado web]
- **Generación/organización:** desde descripción o dictado (voz, ~25 idiomas; sigue idioma del navegador) crea timelines, responsables, fechas; reagrupa por tema, ordena pasos, conecta dependencias; sugiere huecos; foco por selección de región para preguntar sobre esa parte.
- **Colaboración:** edición/reordenamiento en vivo, “seguir” a un compañero. Compartir por “Share”; invitaciones fuera de org según settings/plan.
- **Contenido:** añadir imágenes y videos. **No** importar tablero desde archivo.
- **Salida:** convertir a doc/presentación; **Send to** Lucid, Miro, Zoho Vani; **exportar PNG** (Share > Export).
- **Limitaciones beta:** trabaja solo con lo que hay en el tablero (**sin contexto de apps conectadas**). No disponible para orgs HIPAA-ready; restricciones con zero data retention para Claude Code.

### Diseño y UI para replicar [Observado en video + parcial web]
- **[Observado] Canvas amplio tipo pizarra** con cuadrícula/fondo, controles de **zoom** (p. ej. 28%, 47%, 60%, 104% visibles como control), paneo/espacio de trabajo extenso, secciones/frames.
- **[Observado] Objetos y diagramas:** bloques/formas, conectores (líneas/flechas, ortogonales/punteadas en diagramas), etiquetas numeradas, post-its/notas, selección con **handles** y nodos de conexión, barra contextual de formato.
- **[Observado] Herramientas:** dock inferior con cursor/mano, texto, sección/frame, nota adhesiva, lápiz/dibujo, formas, stickers/emoji, comentario y **“Ask Claude”**; prompt flotante (“Describe a change”) para pedir cambios al lienzo. Sub-barra de lápiz con colores/trazos en capturas.
- **[Observado] Compartir:** popover con pestañas/acciones de compartir y exportación.
- **[Web no detalla nombres/herramientas exactas]:** “formas, flechas y secciones” y “sketch” se mencionan en términos generales; la granularidad de herramientas (post-it, lápiz, conectores específicos, lienzo infinito estricto) es principalmente **evidencia visual del video**.

### Contraste de exportación (importante)
- **[Confirmado web]:** exportación documentada a **PNG** y envío a **Lucid/Miro/Zoho Vani**.
- **[Observado en video]:** se menciona/exportación hacia flujos tipo Miro/Lucidchart/vectorial en la demo; tratar formatos vectoriales/SVG nativos como **no confirmados oficialmente** salvo verificación actual en producto.

### Fuentes
- https://support.claude.com/en/articles/18324319-get-started-with-claude-whiteboards
- https://claude.com/resources/articles/sheets-whiteboards-data
- https://lucid.co/blog/send-claude-whiteboard-to-lucid
- `investigacion.md` §4.4

---

## 6. Claude Data

### Qué es y dónde vive [Confirmado web]
- Artefacto para datos empresariales: convierte preguntas en lenguaje natural en **Dashboards, Scrollyteller, Visual short, Visual analysis**. Evolución/GA de Claude Dashboards (10 nov 2026). Web/Desktop/Mobile, chat o Artifacts > Data. Planes de pago; consultas certificadas y live sharing en beta.

### Capacidades funcionales [Confirmado web]
- **Fuentes:** data warehouses (Redshift, BigQuery, ClickHouse, Databricks, Snowflake) y otras apps conectadas; requiere conector.
- **Transparencia:** Claude escribe **una consulta SQL por gráfico**, la ejecuta y muestra **la query y cuándo se refrescaron los datos**; se puede abrir/ajustar la consulta.
- **Formatos:** dashboard (exploración rápida), scrollyteller (narrativa con scroll), visual short (video breve), visual analysis (resumen escrito).
- **Refresco:** al abrir cuando los datos están “due” (no calendario fijo), **Refresh data** inteligente, caché y cadencias configurables por dashboard.
- **Gobernanza/calidad:** **consultas certificadas** (badge, reutilizables; definibles en Claude o vía dbt/Looker/Cube MCP; editar quita certificación), **live sharing** (org ve resultados con acceso del creador, limitado a queries necesarias), historial/versiones con restauración, cambios rastreados.
- **Diseño y salida:** soporte de sistemas de diseño; envío a herramientas BI/analytics partners para análisis profundo.

### Diseño y UI para replicar [Observado en video + Confirmado web]
- **[Observado] Composición editorial:** hero/título, bloque narrativo con cifras destacadas, grilla de **KPIs** (tarjetas), gráficos (líneas/barras), y **nota metodológica al pie** explicando cálculo/fórmula — jerarquía tipográfica clara.
- **[Observado] Scrollytelling:** narrativa paso a paso con foco en serie protagonista y atenuación del contexto (patrón focus+context), pie/caption reactivo.
- **[Observado] Estados y controles:** barra de `Draft` con `Undo/Redo/Save/descartar`, acceso a historial y fuentes; panel **Design/estilos** con opciones de apariencia y selección de formato (Dashboard/Scrollyteller/Visual short/Visual analysis) — controles vistos como dropdowns/campo numérico/tarjetas, **no sliders reales** en las capturas.
- **[Web]** confirma inspección de query/refresh, formatos, sharing con control de fuentes (“Your access”), y versionado/restauración.

### Límites y riesgos [Confirmado web]
- Orientado a preguntas rápidas/exploratorias; para análisis profundo, derivar a BI. Cuenta contra límites de uso.
- **Live sharing:** ejecuta con acceso del creador; revisar antes de compartir.
- **No especificado en docs consultadas:** límites exactos de tamaño/filas/tipos de archivo más allá de conectores y SLAs finos.

### Fuentes
- https://support.claude.com/en/articles/17454700-get-started-with-claude-data
- https://claude.com/resources/articles/sheets-whiteboards-data
- https://claude.com/resources/articles/dashboards-and-motion
- `investigacion.md` §4.5

---

## 7. Claude Design / capa de marca

### Qué es y dónde vive [Confirmado web]
- Capacidad oficial de diseño integrada en Claude/Artifacts (chat + lienzo) para crear trabajo visual alineado a marca (prototipos, one-pagers, maquetas, slides, micrositios, etc.). No es hoy una app totalmente separada; convive con flujos en chat, Artifacts, Claude Code (`/design`, `/design-sync`) y uso parcial en móvil. `claude.ai/design` heredado con cierre indicado para 14 dic 2026 (según fuentes).

### Capacidades funcionales [Confirmado web]
- **Sistemas de diseño/brand kit:** importar desde GitHub, archivos, cargas o código; extraer paleta, tipografía, componentes y patrones; verificación/corrección contra el sistema. Gobernanza en equipos/Enterprise (sistema estándar/default, restricciones).
- **Edición:** chat + lienzo, comentarios en línea, edición directa de texto y layout, ajustes visuales; entrada desde prompts, imágenes y archivos (DOCX/PPTX/XLSX mencionados).
- **Salida/handoff:** exportar a PDF/PPTX/HTML (y otros flujos), compartir por enlace, enviar a herramientas del ecosistema y continuar en Claude Code.

### Relación con el resto de la suite [Confirmado web]
- Capa transversal dentro de Artifacts junto a Docs/Slides/Dashboards/Motion: aporta consistencia visual y temas a salidas.

### Límites [Confirmado web]
- Beta/preview en evolución; consumo contra límites de uso; limitaciones conocidas de colaboración/guardado/rendimiento en casos complejos y paridad móvil incompleta. Calidad depende de los assets del sistema de diseño.

### Diseño/UI para replicar [Observado en video]
- **Panel “Design/estilos”** (en Data) como control lateral de apariencia y formato: selección de paleta/tipografía/esquinas/tamaño de texto y tarjetas de formato (Dashboard, Scrollyteller, etc.). Controles mayormente dropdowns/inputs/tarjetas — patrón de “tema aplicado” sin exponer complejidad técnica.

### Fuentes
- https://claude.com/blog/claude-design-stays-on-brand-for-daily-work
- https://claude.com/product/design
- https://support.claude.com/en/articles/14604416-get-started-with-claude-design
- https://support.claude.com/en/articles/14604397-set-up-your-design-system-in-claude-design

---

## 8. Contraste video vs documentación oficial

| Tema | Observado en video (`investigacion.md`) | Documentación oficial consultada | Estado |
|---|---|---|---|
| Export Docs | Popover con opciones que incluyen Notion (captura) | Docs exporta a Word, PDF, Markdown, Google Docs | **Divergencia / a verificar en producto actual** |
| Export Whiteboard | Se menciona exportación a formatos tipo Miro/Lucidchart/vectorial | PNG documentado; “Send to” Lucid, Miro, Zoho Vani | **Parcialmente alineado** (envío a tools sí; SVG/vectorial nativo no confirmado) |
| “Sliders” en estilos | No hay sliders reales; Design muestra dropdowns/campo numérico/tarjetas | N/A (UI no detallada) | **Aclarado por evidencia visual** |
| Barra `fx` / dock en Sheets | Visibles y funcionales en capturas | Fórmulas persistentes y edición en celdas confirmadas; nombres UI no textuales | **Funcionalidad confirmada, nomenclatura UI observada** |
| Whiteboard: zoom, post-its, lápiz, conectores, handles | Claramente visibles | Descripción general (formas, flechas, secciones, sketch) | **Capacidades compatibles; detalle de herramientas inferido de video** |
| Colaboración en tiempo real | Implícita en demos | Docs/Whiteboard: descrita; detalles operativos (cursores, conflictos, permisos finos) limitados | **Confirmación parcial** |

---

## 9. Guía de replicación para Comex (funcionalidad + diseño)

### 9.1 Principios de producto a copiar
- **Artefacto como objeto de primer nivel:** abrir salidas y paneles en superficie propia (visor/panel) con identidad, estado, acciones y contexto, no solo dentro de un modal estrecho.
- **Chat + artefacto convivientes:** split o modo foco con retorno rápido al chat (`Mostrar chat`), preservando contexto.
- **Edición híbrida:** acción directa donde aplique + asistencia por chat/comando contextual (“pedir cambio”, “explicar”, “regenerar sección”).
- **Progreso y confianza:** mostrar generación incremental/estados, y exponer verificabilidad (citas/fuentes/fórmulas/queries) en el lugar, no enterrada.
- **Compartir/exportar unificados:** punto único de salida cuando existan artefactos exportables.
- **Jerarquía editorial en datos:** KPIs + narrativa + nota metodológica; foco por atenuación de contexto en visualizaciones.

### 9.2 Patrones de diseño/UI (adaptar a `DESIGN.md` de Comex)
- **Shell:** header compacto (título, estado, acciones clave), cuerpo scrollable, controles flotantes contextuales.
- **Dock contextual:** acciones cambian según selección/estado (vacío vs. numérico vs. objeto), reduciendo barras fijas.
- **Tablas/hojas:** priorizar legibilidad, fórmulas/cálculos trazables, formato condicional con intención; no copiar estilos visuales ajenos (paleta/tipografía propias de Comex/sistema).
- **Dashboards:** tarjetas KPI claras, gráficos con lectura directa, anotación metodológica/fuente visible.
- **Whiteboard/diagramas:** si se implementa, favorecer canvas con herramientas esenciales, conectores y selección clara; export/interop según capacidades reales.
- **Accesibilidad y teclado:** navegación por áreas, foco visible, atajos coherentes, estados vacíos/error definidos.

### 9.3 Mapeo sugerido a Comex (alto nivel)
| Funcionalidad Claude | Equivalente/objetivo en Comex | Prioridad de patrón |
|---|---|---|
| Docs | Visor/editor de salidas (informes, resúmenes, entregables) con citas y exportación | Alta |
| Sheets | Vistas tabulares verificables y cálculos trazables (no paridad Excel completa) | Media/Alta según casos |
| Slides | Presentación estructurada de hallazgos (export/present) si aplica al flujo | Media |
| Whiteboard | Lienzo para exploración/diagramas de decisiones (opcional) | Media/Baja |
| Data | Paneles/KPIs con narrativa, fuente y metodología | Alta |
| Design | Sistema de estilos/temas coherente aplicado a artefactos | Transversal |

### 9.4 Qué no copiar literalmente
- Paleta oscura cálida, tipografías o branding de Claude.
- Promesas de capacidades no soportadas (coedición perfecta, paridad Excel, conectores/datos en vivo) sin respaldo.
- Flujos que dependan de infraestructura/planes externos no disponibles en Comex.

---

## 10. Checklist de completitud y seguimiento

### Cobertura funcional y de diseño
- [x] Modelo común de Artifacts (ciclo, compartir, exportar, patrón chat+artefacto)
- [x] Docs: capacidades, colaboración, export, UI observada, límites
- [x] Slides: capacidades, edición/presentación/export, UI observada, límites
- [x] Sheets: fórmulas/formato/import-export, UI observada (fx/dock/grilla), límites beta
- [x] Whiteboard: organización/colaboración/export/send-to, UI observada, límites beta
- [x] Data: formatos, SQL/transparencia, refresco, certificación/live sharing, UI observada
- [x] Design: brand kit/capa de estilos, relación transversal, límites
- [x] Contraste video vs. documentación oficial (divergencias clave)
- [x] Guía de replicación para Comex (funcionalidad + diseño/UI)

### Seguimiento opcional (mejora continua, no bloqueante)
- [ ] Re-verificar en producto/docs actuales los puntos divergentes (export Notion en Docs, export vectorial Whiteboard) si cambia el acceso a documentación o el producto.
- [ ] Capturar nomenclatura UI exacta vigente (nombres de botones/paneles) si se dispone de sesión de prueba en Claude.
- [ ] Profundizar en accesibilidad/atajos específicos por plantilla con pruebas directas.
- [ ] Derivar backlog técnico en Comex (issues/tareas) a partir de §9.3.

---

## 11. Fuentes

### Oficiales (Anthropic / Claude)
- Docs: https://support.claude.com/en/articles/16923645-get-started-with-claude-docs
- Artifacts: https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them
- Compartir: https://support.claude.com/en/articles/9547008-share-artifacts
- Accesibilidad/teclado artifacts: https://support.claude.com/en/articles/17457950-use-artifacts-with-a-keyboard-or-screen-reader
- Slides (tutorial): https://academy.claude.com/tutorials/using-claude-design-for-presentations-and-slide-decks
- Sheets: https://support.claude.com/en/articles/18324300-get-started-with-claude-sheets
- Whiteboard: https://support.claude.com/en/articles/18324319-get-started-with-claude-whiteboards
- Data: https://support.claude.com/en/articles/17454700-get-started-with-claude-data
- Design: https://claude.com/product/design ; https://support.claude.com/en/articles/14604416-get-started-with-claude-design ; https://support.claude.com/en/articles/14604397-set-up-your-design-system-in-claude-design
- Lanzamientos/contexto: https://claude.com/resources/articles/sheets-whiteboards-data ; https://claude.com/resources/articles/dashboards-and-motion ; https://support.claude.com/en/articles/12138966-release-notes

### Secundarias / partners (contraste)
- https://lucid.co/blog/send-claude-whiteboard-to-lucid
- https://coursiv.io/blog/claude-docs-slides-design
- https://cellcog.ai/blog/claude-whiteboards-sheets-data/

### Material interno del repo (análisis de video/UI)
- `docs/features/comex-office-reference/investigacion.md`
- `docs/features/comex-office-reference/frames/` (29 capturas)
- `docs/features/comex-office-reference/README.md`
