# Matriz de decisión — opciones bloqueantes de los issues #4, #5 y #7

> **Fecha:** 2026-11-17. Datos de precios/licencias consultados en fuentes oficiales el 2026-11-17. Verificar antes de comprar/firmar.
> **Objetivo:** dar contexto concreto para elegir, no decidir por el usuario. Incluye una recomendación fundada por opción.

---

## 1. Sheets (issue #4): Univer vs FortuneSheet

### Datos verificados

| | **Univer** | **FortuneSheet** |
|---|---|---|
| Licencia | Core **Apache-2.0**; capacidades avanzadas en capa **comercial** | **MIT** (todo) |
| Precio | Freemium $0 (marca de agua, 3 conexiones, 10 exportaciones/mes); **Business $99/mes o desde $1.000/año** (25+ conexiones, 5.000+ exports/mes); Enterprise a medida | Gratis |
| Motor de fórmulas | Motor propio avanzado (comercial); core incluye edición/fórmulas/orden/filtro/tablas | `handsontable/formula-parser` forkeado; fórmulas built-in |
| Gráficos / pivots | **Comercial** (charts, pivot, pivot charts, sparklines, shapes, impresión) | En roadmap (✔ conditional formatting, hooks, freeze, find/replace, datos etc.; **pivots y charts sin marcar**) |
| XLSX / import-export | **Servicio comercial** (XLS/XLSX/CSV/TSV, DOCX, PPTX) | Plugin externo `fortuneexcel` (MIT) |
| Colaboración | **Servicio comercial** (OT, cursores, selecciones, historial, worktrees) | Hooks `onOp`/`applyOp` + backend propio (demo Express/MongoDB) |
| Headless / agente | `Server SDK` + `AI SDK` comerciales; el core tiene APIs open-source | Sin SDK de agente; se manipula el modelo de datos |
| Madurez / actividad | Muy activo, 22,6k★ (2026-10), versión 1.0 (sep 2026) | 3,8k★, 325 forks, 982 commits; último push ~dic 2025; **pre-1.0: "estructura y APIs pueden cambiar"** |
| Stack | TS, preset `UniverSheetsCorePreset`, React/Vue/Angular | TS/React, `import { Workbook } from '@fortune-sheet/react'` |

### Riesgo específico para Comex (importante)
Univer Business cubre **un dominio principal y sus subdominios**. La propia FAQ dice que para **aplicaciones de escritorio sin dominio** hay que contactar al proveedor para confirmar el alcance. Comex es desktop-first (Electron). Esto puede encarecer o bloquear la opción comercial; hay que preguntarlo antes de comprometer el roadmap.

### Contexto para elegir
- **Elegir Univer (Business)** si: se necesita exportación XLSX real, gráficos/pivots, colaboración y un SDK que el agente pueda usar; hay presupuesto (~USD 1.000/año mínimo) y se confirma por escrito el alcance desktop. Da la paridad más cercana a Claude Sheets.
- **Elegir Univer core** si: alcanza con grilla, fórmulas, formato y filtros; se acepta implementar export CSV propio y sin charts/pivots/colab. Es Apache-2.0 puro, sin costo.
- **Elegir FortuneSheet** si: la prioridad es **cero costo y cero dependencia comercial**, y el MVP se limita a grilla + fórmulas + formato condicional + CSV. Se acepta mantener una librería pre-1.0 y conviene construir export XLSX/colaboración aparte.

**Recomendación:** empezar con un **spike de 2–3 días con Univer core** sobre un dataset real de Comex para medir cuánto del MVP cae en la capa comercial. Si la mayoría cae ahí, decidir entre pagar Business (confirmando desktop) o bajar a FortuneSheet. No comprar antes del spike.

---

## 2. Whiteboard (issue #5): Excalidraw vs tldraw

### Datos verificados

| | **Excalidraw** (`@excalidraw/excalidraw`) | **tldraw SDK** |
|---|---|---|
| Licencia | **MIT** | Licencia propia: desarrollo gratis con marca de agua; **producción requiere license key** (100 días de trial; pricing "value-based"/ Contact sales; FAQ pública: ~**USD 6.000/año** para equipos <10) |
| Madurez | 135,9k★, 16,2k forks, muy activo | 51,5k★, 692k descargas semanales |
| Estilo | Hand-drawn (sketch) — se puede reducir `roughness`, pero la identidad es "dibujo a mano" | Canvas limpio y totalmente tematizable (white-label con licencia) |
| Herramientas | Formas, flechas con binding, texto, free-draw, borrador, undo/redo, zoom/pan, imágenes, librerías, dark mode | Formas, flechas inteligentes, notas, freehand, multimedia, embeds, undo/redo, minimapa, grid/rulers, selección/transformación avanzada |
| Export | PNG, SVG, clipboard, `.excalidraw` JSON (formato abierto) | Imagen; la FAQ indica PDF en evaluación (verificar) |
| Pages/frames | **No** (una sola escena) | **Sí** (pages/frames) |
| Colaboración | En **excalidraw.com** (E2E, links); el **paquete npm no la trae** — implementar con WebSocket/Yjs propio | **Incluida** (`@tldraw/sync`, self-host, hasta 50 usuarios, cursores, viewport following, cursor chat) |
| Extensibilidad | API de elementos y `convertToExcalidrawElements` | `ShapeUtil`, tools, bindings, UI components, **Editor API** y módulo `ai` (agentes que dibujan) |
| Offline/desktop | Requiere self-host de fuentes (`window.EXCALIDRAW_ASSET_PATH`) | Host anywhere, sin verificación online de licencia (según FAQ) |

### Contexto para elegir
- **Elegir Excalidraw** si: querés **MIT, cero licencia**, export SVG/JSON, y un MVP rápido de pizarra; aceptás estilo sketch, sin pages/frames y colaboración hecha por nosotros (o diferida). Bonus: `convertToExcalidrawElements` permite que el agente genere diagramas desde un prompt/dataset con poco código.
- **Elegir tldraw** si: la pizarra es **estratégica**, querés temas propios (white-label), pages/frames, colaboración incluida y que el agente manipule el canvas con una API rica; aceptás ~USD 6.000/año (o contactar sales) y el modelo de licencia.

**Recomendación:** para el MVP de Comex, **Excalidraw**. Cubre el patrón del video (canvas, zoom, notas, conectores, lápiz, export) sin costo ni licencia, y su formato JSON es portable. Revisar tldraw solo si en el MVP aparece el requisito real de **colaboración en vivo + temas propios + múltiples páginas**.

---

## 3. Temas/estilos (issue #7): es una decisión interna, no de vendor

### Contexto
- No hay repos externos que aporten valor aquí: es la capa que garantiza que los otros cinco artefactos se vean como Comex.
- Decisión ya tomada en la investigación: **no copiar la paleta oscura cálida ni las tipografías de Claude**; usar tokens propios y tipografía del sistema.
- Riesgo concreto: hay hex hardcodeados en `apps/app/src/react-app/domains/specialists/library-dialog.tsx:673` y `:688`, además de medidas fijas (`max-w-2xl` en `:62`, `max-h-80` en `:783`).
- Beneficio transversal: si esto se hace primero, los issues #2–#6 heredan consistencia y no hace falta retocarlos después.

### Criterio para "elegir"
No hay opciones a evaluar; hay que **confirmar la convención de tokens** (nombres, escala, contraste) y ejecutar la migración. Es la decisión de menor riesgo y la que debe ir primero en el orden de ejecución.

---

## Tabla resumen

| Decisión | Opción recomendada | Costo | Principal riesgo | Cuándo reconsiderar |
|---|---|---|---|---|
| Sheets #4 | Spike con **Univer core** → decidir Business vs FortuneSheet | $0 core / ~$1.000 año Business | Licencia por dominio vs desktop; features clave en capa comercial | Si el spike muestra que charts/XLSX/colab son imprescindibles |
| Whiteboard #5 | **Excalidraw** (MIT) | $0 | Sin pages/frames ni collab en el paquete; estilo sketch | Si se requiere colaboración en vivo + white-label + páginas |
| Temas #7 | **Tokens propios + tipografía del sistema** | $0 | Migración de hex hardcodeados | Ninguno (decisión cerrada por investigación) |

## Fuentes consultadas (2026-11-17)

- Univer: https://univer.ai/pricing/ , https://univer.ai/ , https://github.com/dream-num/univer , https://docs.univer.ai/overview/features/sheets
- FortuneSheet: https://github.com/ruilisi/fortune-sheet (README, licencia MIT, hooks `onOp`)
- Excalidraw: https://github.com/excalidraw/excalidraw (README, licencia MIT), https://plus.excalidraw.com/docs/sdk/excalidraw/integration
- tldraw: https://tldraw.dev/pricing , https://tldraw.dev/faq , https://tldraw.dev/community/license , https://docs.tldraw.dev/features/composable-primitives/multiplayer-collaboration

## Resolución (2026-11-17)

**Restricción del usuario:** todo debe ser **open source / sin pago** y tiene que ir **dentro de la app** (embebible).

### Sheets (#4) — decisión: stack 100% OSS
- Se descarta **Univer Business** (de pago) y **SheetXL** (motor, lector XLSX y toolkit React son comerciales; solo skills/fórmulas/CLI son MIT).
- Se descartan **Jspreadsheet CE** y **RevoGrid core** porque el motor de fórmulas está en la versión Pro; no cumplen "fórmulas reales sin pago".
- Se descarta **Luckysheet** (archivado).
- **Se adopta `Univer` core (Apache-2.0)** como primera opción: ya trae grilla, fórmulas, formato condicional, filtros/orden, validación, comentarios, celdas combinadas, texto enriquecido, congelar paneles, undo/redo, Facade API para el agente y soporte explícito a **Vite, React 18/19 y Electron** (el stack de Comex). El quick start funciona sin licencia comercial.
- Complementos OSS para cubrir lo que la capa comercial de Univer no da:
  - **XLSX/CSV**: `SheetJS Community Edition` (Apache-2.0) o `exceljs` (MIT) — lectura/escritura en cliente/servidor.
  - **Gráficos**: componentes propios de Comex (Recharts/Nivo) leyendo valores vía Facade API.
  - **Colaboración**: diferida; si se necesita, Yjs/Hocuspocus (OSS).
- **Plan B**: si el core de Univer resulta demasiado pesado o el spike falla, migrar a **FortuneSheet (MIT)**, aceptando motor de fórmulas más limitado y librería pre-1.0.

### Desviación de implementación (2026-11-23/24)

La implementación fusionada en `dev` **no usa Univer**. `apps/app/package.json` incluye
`jspreadsheet-ce` y `@jspreadsheet-ce/react`; `views/jspreadsheet-view.tsx` monta Jspreadsheet CE
con una barra `fx` propia. Las herramientas `specialist_sheet_*` usan además `sheet-model.ts`, un
evaluador propio sin `eval`.

Esto no invalida el spike de Univer, pero sí cambia el estado del issue #4:

- Univer queda como evaluación histórica, no como dependencia actual.
- Antes de cerrar Sheets hay que revalidar licencia, distribuciones cubiertas, paridad de
  fórmulas, XLSX, formato condicional y compatibilidad con el resto de criterios.
- No se debe afirmar que la suite está “100% Univer” ni que todos los criterios de #4 están
  completos.

### Whiteboard (#5) — decisión: Excalidraw (MIT)
Confirmado por el usuario. Librería embebida `@excalidraw/excalidraw`, MIT, muy activa (136k★), usada por Notion/Replit/Obsidian. Cubre canvas infinito, zoom, formas, flechas con binding, lápiz, texto, undo/redo, export PNG/SVG y formato JSON abierto. Aceptar limitaciones: sin páginas múltiples, sin colaboración en el paquete npm, estilo sketch y self-host de fuentes para offline. No instalar tldraw (licencia de pago en producción).

### Temas (#7) — decisión: tokens propios + tipografía del sistema
Sin proveedor externo; ejecutar primero.

### Nota para los issues
Estas decisiones se reflejan como comentario en los issues #4, #5 y #7 de GitHub.

## Cómo registrarlo cuando decidas

Actualizar el issue correspondiente (#4, #5, #7) con la decisión y la justificación, y este documento con la fecha. Las decisiones ya están registradas como bloqueantes en `issues/README.md` y en `proyecto/estado.md`.
