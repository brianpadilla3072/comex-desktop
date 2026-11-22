# Diseño técnico — Modelo de artefacto y shell tipo Office (issue #1)

> **Estado:** propuesta de diseño para destrabar el épico
> [`00-epico-artefactos-oficina.md`](issues/00-epico-artefactos-oficina.md). No contiene código de
> aplicación; las interfaces y los JSON de abajo son contrato, no implementación.
> **Decisiones guiadas por:** `AGENTS.md` (feature flag, verificación headless), `DESIGN.md`
> (P1–P11, S1–S7, V1–V7, T3, R6 del §9 de `investigacion.md`),
> `investigacion.md` §6/§7/§9/§10 e `investigacion-web-funcionalidades.md` §1/§9.
>
> **Tesis:** el cambio no es visual, es de *estatus del objeto* (`investigacion.md` §1). Hoy las
> salidas del mini-Studio viven dentro de un `DialogContent ... lg:max-w-2xl` de 672 px
> (`apps/app/src/react-app/domains/specialists/library-dialog.tsx:62`) y se leen en cajas con
> `max-h-80` / `max-h-64` (`:783`, `:785`, `:789`). El diseño separa **gestión** (ese diálogo, que
> se conserva) de **lectura/edición** (un shell de artefacto en el panel de sesión), sin tocar el
> motor de paneles deterministas.

---

## 1. Modelo de datos

### 1.1Principios

- **El artefacto es un objeto, no un mensaje** (`investigacion.md` §6, capa 1): si se puede nombrar,
  se puede abrir; si se puede abrir, tiene shell.
- **Envolver, no migrar**: las salidas existentes (`SpecialistOutput`,
  `apps/app/src/app/lib/openwork-server.ts:228-236` y `apps/server/src/specialists/outputs.ts:18-38`)
  siguen siendo la fuente. Un artefacto `doc`/`data` puede apuntar a una salida por
  `metadata.outputRef`; no se copia su contenido ni se invalida su auditoría.
- **Unión discriminada por `type`**: `content` cambia de forma según el tipo, y el compilador
  obliga a tratar cada variante por separado. Sin `any` ni `as` (`AGENTS.md` → Coding).
- **`sources` son referencias**, nunca contenido: apuntan a `specialist_sources` /
  `specialist_datasets` / `specialist_outputs`, que ya tienen routes y tests propios.
- **`versions` es metadatos**: el contenido versionado vive en archivos del workspace; la lista de
  versiones solo dice qué archivo corresponde a cada versión.

### 1.2Interfaces TypeScript (contrato)

Ubicación propuesta: `apps/app/src/react-app/domains/artifacts/types.ts` (tipos compartidos de UI),
con el espejo Zod en servidor (§1.4). Tipos primitivos reutilizados:
`SpecialistOutput["kind"]` (`openwork-server.ts:228`), `SpecialistOutputAudit`
(`openwork-server.ts:236`).

```ts
// --- Base ------------------------------------------------------------------
export type ArtifactType = "doc" | "slides" | "sheet" | "board" | "data";
export type ArtifactStatus = "streaming" | "draft" | "saved" | "archived";
export type ArtifactAuthor = "agent" | "user";

export type ArtifactSourceRef =
  | { kind: "source"; id: string; label: string }
  | { kind: "dataset"; id: string; label: string }
  | { kind: "output"; id: string; appId: string; label: string };

export type ArtifactVersion = {
  id: string;              // v1, v2…
  createdAt: number;       // epoch ms
  author: ArtifactAuthor;
  contentRef: string;      // archivo relativo dentro de <datos>/artefactos/<id>/
  label?: string;          // "Versión inicial", "Tras revisión"…
};

export type ArtifactAudit = {
  total: number;
  valid: number;
  invalid: Array<{ sourceId: string; chunk: number; reason: string }>;
};

/** Campos comunes a todo artefacto. `content` se añade por variante. */
export interface ArtifactBase {
  id: string;                    // slug kebab-case, mismo régimen que outputs.ts:43
  type: ArtifactType;
  title: string;                 // P2: título O descripción, nunca ambos en el shell
  status: ArtifactStatus;        // P1: mostrar estado, no explicarlo
  sources: ArtifactSourceRef[];
  versions: ArtifactVersion[];
  metadata: ArtifactMetadata;
  createdAt: number;
  updatedAt: number;
}

export type ArtifactMetadata = {
  workspaceId: string;
  workspaceName?: string;
  schemaVersion: 1;
  /** Enlace a la salida del mini-Studio de la que nace, si la hay. */
  outputRef?: { appId: string; outputId: string; workspaceId: string };
  /** Auditoría de citas calculada en servidor (investigación §9 R5 / patrón 11). */
  audit?: ArtifactAudit;
  focus?: string;                // heredado de specialist_outputs
  /** Plantilla de presentación elegida; por tipo (ver §3.4 y R10). */
  format?: "report" | "dashboard" | "compact" | "table" | "deck" | "canvas";
  /** Clave del tema aplicado por el issue #06; nunca valores cosméticos sueltos. */
  theme?: string;
};

// --- Variantes --------------------------------------------------------------
export interface DocArtifact extends ArtifactBase {
  type: "doc";
  content: string;               // Markdown; mismo contenido que specialist_output_generate
  // issue #01 — visor/editor de documentos
}

export interface SlidesArtifact extends ArtifactBase {
  type: "slides";
  content: {
    slides: Array<{
      id: string;
      title?: string;
      blocks: Array<{ id: string; kind: "text" | "image" | "table" | "chart"; ref: string }>;
      notes?: string;
      skipped?: boolean;         // "Skip slide" sin borrar (§3 de la web)
    }>;
  };
  // issue #02 — solo render/present; sin modelo de objetos arrastrables
}

export interface SheetArtifact extends ArtifactBase {
  type: "sheet";
  content: {
    sheets: Array<{
      id: string;
      name: string;
      cells: Record<string, { value: string; formula?: string; format?: "number" | "currency" | "percent" | "date" }>;
    }>;
  };
  // issue #03 — hoja verificable: la fórmula es contenido, no decoración
}

export interface BoardArtifact extends ArtifactBase {
  type: "board";
  content: {
    nodes: Array<{ id: string; kind: "note" | "section" | "text"; x: number; y: number; text: string }>;
    edges: Array<{ id: string; from: string; to: string; label?: string }>;
  };
  // issue #04 — lienzo acotado; NO canvas infinito (anti-patrón 3)
}

export interface DataArtifact extends ArtifactBase {
  type: "data";
  content: {
    /** Un bloque por cada bloque del spec determinista; se resuelve con specialist_panel_read. */
    blocks: Array<{
      id: string;
      kind: "stat" | "line" | "bar" | "table" | "markdown" | "changes";
      source: { datasetId?: string; queryRef?: string };
      note?: string;             // nota metodológica visible (patrón 9 / R3)
    }>;
    narrative?: string;
  };
  // issue #05 — render editorial sobre datos vivos, nunca una captura
}

export type Artifact =
  | DocArtifact | SlidesArtifact | SheetArtifact | BoardArtifact | DataArtifact;

/** TABLA ÚNICA para el inspector de tipos. Al cambiar `Artifact`, cambiar esta fila. */
export type ArtifactContentByType = {
  doc: DocArtifact["content"];
  slides: SlidesArtifact["content"];
  sheet: SheetArtifact["content"];
  board: BoardArtifact["content"];
  data: DataArtifact["content"];
};
```

**Mapeo con lo que ya existe** (evita inventar un fifth wheel):

| Variante | Origen real | Nota |
|---|---|---|
| `doc` | `specialist_output_generate` con `kind: report`/`mindmap` (`library-plugin.ts:58-60`) | Markdown + citas `[fuente:<id>#<n>]` |
| `data` | `specialist_output_generate` con `kind: table` **o** un `specialist_panel_read` | El contenido del panel resuelto se referencia, no se reimplementa |
| `sheet` | `artifact-spreadsheet-editor.tsx` (ya en `domains/session/artifacts/`) | El motor de celdas ya existe; el shell solo lo enmarca |
| `slides`, `board` | nuevos (issues #02, #04) | heredan el shell; no heredan el editor de texto rico |

### 1.3Esquema JSON de persistencia

**Dónde vive.** Misma filosofía que `apps/server/src/specialists/outputs.ts:9-13`: archivos del
workspace, versionables en git y portables en el pack — nunca una tabla nueva en la DB, nunca
`localStorage` para contenido.

```
<datos del workspace>/
└── artefactos/
    ├── index.json                       # ArtifactMeta[] (id, type, title, status, updatedAt)
    └── <artifact-id>/
        ├── artifact.json                # metadatos del artefacto (abajo)
        ├── content.md                   # doc / mindmap
        ├── content.json                 # slides | sheet | board | data
        └── versions/
            └── v1.md | v1.json …        # contentRef de ArtifactVersion
```

El root se deriva con `dataPath(directory, "artefactos")`, equivalente a
`salidasRoot = dataPath(directory, "salidas")` en `outputs.ts:41`, implementado en
`apps/server/src/specialists/project-data.ts`. Escritura atómica con `tmp` + `rename` y
`mode: 0o600`, copiando el patrón de `writeIndex` (`outputs.ts:55-61`). Límite de tamaño análogo a
`CONTENT_LIMIT = 300 * 1024` (`outputs.ts:16`).

`artifact.json` (schemaVersion 1):

```json
{
  "schemaVersion": 1,
  "id": "informe-soja-cierre",
  "type": "doc",
  "title": "Informe de soja — cierre de campaña",
  "status": "draft",
  "sources": [
    { "kind": "source", "id": "src_soja", "label": "Fuente oficial de soja" },
    { "kind": "dataset", "id": "ds_comtrade", "label": "Comtrade 2019–2024" }
  ],
  "versions": [
    { "id": "v1", "createdAt": 1763000000000, "author": "agent", "contentRef": "versions/v1.md", "label": "Versión inicial" }
  ],
  "metadata": {
    "workspaceId": "ws_local",
    "schemaVersion": 1,
    "outputRef": { "appId": "comex", "outputId": "informe-soja-cierre", "workspaceId": "ws_local" },
    "audit": { "total": 12, "valid": 12, "invalid": [] },
    "focus": "Costos de exportación a la UE",
    "format": "report",
    "theme": "default"
  },
  "createdAt": 1763000000000,
  "updatedAt": 1763000000100
}
```

**Reglas de persistencia:**

1. `status: "streaming"` mientras el agente genera (patrón 7, creación progresiva); nunca se
   escribe al índice hasta pasar a `draft`/`saved`.
2. `draft` ≠ `saved`: editar no pisa lo guardado (patrón 12 / R8). `Guardar` crea una versión
   nueva; `Descartar` vuelve a `versions[última]`. Sin auto-guard sobre el archivo generado.
3. `audit` se calcula **en servidor** reutilizando `extractCitations` y la lógica de
   `specialist_output_generate` (`apps/server/src/specialists/library-tool-api.ts`); el cliente
   nunca recalcula ni inventa el `valid/total`.
4. Los `sources` se validan contra `specialist_sources` / `specialist_datasets` al escribir; una
   referencia rota se conserva y se marca en `audit.invalid` (fail loud, §7.3).
5. Leer un artefacto cuyo `contentRef` no existe devuelve error de resolución, no un cuerpo vacío.

### 1.4Validación y capa de acceso

- Espejo Zod del JSON en `apps/server/src/specialists/artifacts.ts`: `artifactMetaSchema`,
  `artifactVersionSchema`, `artifactContentSchema` (discriminado por `type`), con el mismo estilo
  que `outputMetaSchema` (`outputs.ts:28-38`).
- Cliente: extender `apps/app/src/app/lib/openwork-server.ts` con `getArtifacts`,
  `getArtifact`, `createArtifact`, `saveArtifactVersion`, junto a los métodos de salida actuales
  (`:2599-2602`). Tipos `Artifact`/`ArtifactAudit` se importan desde `domains/artifacts/types.ts`
  o se definen en `openwork-server.ts` como hacen hoy `SpecialistOutput` (`:230`).
- En memoria: un store Zustand **solo de referencias y preferencias**, no de contenido — ver §7.

---

## 2. Componentes

### 2.1Árbol del shell

```
SessionPage                                  apps/.../session/chat/session-page.tsx
└─ WorkbenchPanelGroup                        apps/.../session/chat/workbench-panel-group.tsx
   ├─ ResizablePanel PRIMARY  → SessionSurface (chat, sin cambios)
   └─ ResizablePanel SECONDARY → SidePanel     apps/.../session/panel/side-panel.tsx
      ├─ PanelTabList / SidePanelTab (existentes)
      │  └─ NUEVO: tab "studio"  →  StudioArtifactPanelTab
      ├─ ComexProjectPanel (existente, se conserva)  ← estado "sin tab activa"
      ├─ ArtifactPanel (existente, se conserva)      ← archivos / OpenTarget
      └─ StudioArtifactShell (NUEVO)                 ← tab "studio"
         ├─ ArtifactHeader             título · tipo · estado · Compartir/Exportar · Mostrar chat · cerrar
         ├─ ArtifactStatusStrip        chips: tipo · proyecto · hace 2 h · 12/12 citas · Draft
         ├─ ArtifactBody               despacha por type (§2.3)
         ├─ ArtifactContextBar         flotante, solo sobre selección (patrones 4 y 5)
         └─ ArtifactDock               cápsula inferior, ≤ 6 acciones, cambia por tipo (R9)
```

Archivos nuevos propuestos, todos bajo
`apps/app/src/react-app/domains/artifacts/shell/`:

| Componente | Responsabilidad | NO hace |
|---|---|---|
| `studio-artifact-shell.tsx` | Compone header/estado/cuerpo/dock; coordina `focusMode` y `selection` | Fetch, cálculo de auditoría, edición de celdas |
| `artifact-header.tsx` | Cromo estable: título, cerrar, `Compartir/Exportar`, `Mostrar chat` | Acciones de contenido |
| `artifact-status-strip.tsx` | Chips de estado (P1/R5). Popover con el detalle de citas/fuentes | Explicar la UI con prosa |
| `artifact-body.tsx` | Elegir el render por `artifact.type`; proveer scroll del panel | Duplicar renderers |
| `artifact-context-bar.tsx` | Barra sobre selección; contenido por tipo de bloque (patrones 4–5) | Estar visible sin selección |
| `artifact-dock.tsx` | Acciones frecuentes + `Pedir un cambio` (patrón 6) | Botones decorativos o deshabilitados (anti-patrón 8) |

`Compartir/Exportar` es **una** puerta con pestañas (patrón 13 / R7), implementada con `Popover`
+ `Tabs` de `@/components/ui`; no un menú por formato. Exportación client-side (`.md` / `.json` /
`.csv`) sin endpoint nuevo, como en el plan de Fase 1 de `investigacion.md:815-817`.

### 2.2Dónde se monta respecto al diálogo y a los paneles

- **Diálogo actual se conserva.** `SpecialistLibraryDialog` se monta hoy en
  `apps/app/src/react-app/domains/specialists/provider.tsx:116` y es el lugar de *gestión*
  (configurar, listar, borrar). No se mete el shell dentro de él.
- **El visor es otra superficie.** Se monta en `side-panel.tsx` como una rama más del dispatcher de
  `activeTab` (`:874-902`), junto a `browser`, `mcp-app`, `remote-thread`, `app` y `artifact`.
  En el estado "sin tab activa" sigue mandando `ComexProjectPanel` (`:864-867`), que es el hub que
  hoy muestra salidas y paneles.
- **Puente explícito, nunca automático.** En `OutputsView` (`library-dialog.tsx:714-751`) y
  `OutputDetail` (`:753-777`), la fila pasa de `Ver`/`Ocultar` a `Ver` + `Abrir en el panel`, que
  llama `usePanelTabStore.getState().openTab(sessionId, { type: "studio", artifactId })`. Esto
  respeta S5 y R6: una salida *ofrece* abrir; no secuestra el foco ni abre sola.
- **El diálogo puede cerrarse al abrir el artefacto** (es un acto del usuario); el hilo de chat y
  el `SidePanel` permanecen. No se pierde el objeto al volver: la tab `studio` queda en el store.
- **El `artifact-panel.tsx` actual NO se toca**: resuelve `OpenTarget` (archivos/Markdown/PDF/
  docx) y es la superficie correcta para archivos del workspace. El shell es para *salidas
  tipadas*, no para cualquier archivo.

### 2.3Render por tipo (dentro de `ArtifactBody`)

| Tipo | Renderer | Reutiliza |
|---|---|---|
| `doc` | `views/doc-view.tsx` | `MarkdownPreview` de `apps/.../session/artifacts/preview` (ya usado en `OutputBody:783`), columna de lectura `max-w-[68ch]`, sin `max-h` |
| `data` | `views/data-view.tsx` | resolución de `specialist_panel_read`; bloques KPI/narrativa/nota al pie del §4.5 |
| `sheet` | `views/sheet-view.tsx` | `artifact-spreadsheet-editor.tsx` existente + barra adaptativa del patrón 5 |
| `slides` | `views/slides-view.tsx` | filmstrip + slide activa; **sin** zoom/presentador completo |
| `board` | `views/board-view.tsx` | nodos/ejes del schema; sin canvas infinito |

Regla transversal (R1): el scroll es **del panel**, nunca un `max-h-80` dentro de otro scroll.
Los estados del §States de `DESIGN.md` (cargando con skeleton de la forma, vacío, error, bloqueado,
sin auditoría, auditoría rota, exportado) se diseñan en el shell, no en cada renderer.

---

## 3. Interacción: split chat/artefacto y modo foco

### 3.1Componentes existentes que se reutilizan

- `@/components/ui/resizable` → `ResizablePanelGroup`, `ResizablePanel`, `ResizableHandle`
  (`apps/app/src/components/ui/resizable.tsx:1-48`), envoltorios de `react-resizable-panels`.
- `WorkbenchPanelGroup` + `useGroupRef` + `PRIMARY_PANEL_ID`/`SECONDARY_PANEL_ID`
  (`workbench-panel-group.tsx:6-88`): ya sabe restaurar un `Layout`, persistir el ratio en
  `useWorkbenchUiState` (`workbench-ui-state.ts`) y devolver el foco del separador.
- `usePanelRef` y `useIsMobile` en `session-page.tsx:16,39`.
- `usePanelTabStore` / `useSidePanelTabs` (`panel-tab-store.ts`, `use-side-panel-tabs.ts`) para la
  tab `studio`; `PanelTabList` para el strip.
- Primitivas Base UI (`Button`, `Tooltip`, `Popover`, `DropdownMenu`, `Badge`, `Skeleton`) — P5.

### 3.2Split 42/58

1. Al abrir una tab `studio`, `session-page.tsx` pasa `secondaryVisible` al
   `WorkbenchPanelGroup` (`:2200-2206`) y el artefacto se coloca en el panel secundario, en lugar
   del segundo chat. El ancho objetivo es ~42 % chat / 58 % artefacto (`investigacion.md` §1.3),
   frente a los `defaultSize="280px"` del panel lateral actual (`:2349`).
2. El ratio se guarda con `setSplitRatio(owner, layout[PRIMARY_PANEL_ID])` ya existente
   (`workbench-panel-group.tsx:81-87`), con `owner` derivado de `surface.draftScope` +
   `baseUrl` + `runtimeWorkspaceId` (`:2201-2203`). Persistencia por sesión, sin rutas nuevas.
3. En móvil (`useIsMobile()`), el split no existe: el artefacto se muestra como hoja completa; se
   reutiliza la lógica `narrowPane === "chat" | "split"` ya presente en `session-page.tsx`.

### 3.3Modo foco con `Mostrar chat`

- El header del shell lleva un botón que alterna `focusMode`. En foco, el primario se oculta
  (`primaryVisible = false` en `WorkbenchPanelGroup`) y el artefacto ocupa el 100 %; el botón
  cambia de `Maximizar` a **`Mostrar chat`** (patrón 2). Es el mismo botón, con el mismo
  significado en todos los tipos (S6).
- Se implementa con el `groupRef` que ya expone `useGroupRef`: `setLayout({ [SECONDARY_PANEL_ID]: 100 })`
  al entrar en foco y `setLayout(layoutAnterior)` al salir. El ratio previo se conserva en
  `useWorkbenchUiState`, **no** en un estado nuevo del componente, para que sobreviva al cambio
  de tab y a la recarga.
- Al salir de foco se devuelve el foco al control que lo pidió (S7); `Esc` cierra popovers y
  barras contextuales, no el artefacto (el cierre es acción explícita del header).
- Nada de esto auto-navega ni roba foco (S5): `Mostrar chat` y `Abrir en el panel` son acciones
  del usuario.

### 3.4Acciones por tipo (R9)

| Tipo | Dock (≤ 6) | Barra contextual |
|---|---|---|
| `doc` | Copiar, Exportar `.md`, Pedir un cambio, Índice, Borrar | sobre texto seleccionado: comentar / `Pedir cambio aquí` |
| `data` | Copiar, Exportar `.csv`, Fuentes, Pedir cambio | sobre bloque: formato (número/moneda/%), orden, exportar |
| `sheet` | Celda, Copiar, Exportar `.csv`, Pedir cambio | `fx` con la fórmula real + formato de la celda |
| `slides` | Texto, imagen, tabla, Exportar, Chat | sobre objeto: estilo/color/alineación (sin handles completos) |
| `board` | Selección, nota, sección,Pedir cambio, Exportar `PNG` | sobre nodo: estilo, conector |

`Pedir un cambio` inserta en el composer el prompt con el `artifactId` como contexto; es la
"doble vía" del patrón 6 sin reimplementar el chat.

---

## 4. Feature flag

**Nombre propuesto:** `comexArtifacts` (clave del registro en `packages/features/src/registry.ts`).
Se activa con `DEN_FEATURE_COMEX_ARTIFACTS=true` (convención `DEN_FEATURE_<KEY>` documentada en
`registry.ts:31`) y por defecto **`false`**: es comportamiento visible nuevo, así que `AGENTS.md`
obliga a ponerlo detrás de flag; el apagado debe devolver al flujo actual (diálogo + caja + tabs
existentes) sin deploy.

Puntos de activación (todos, no solo la UI):

| # | Archivo | Cambio |
|---|---|---|
| 1 | `packages/features/src/registry.ts` | entrada `comexArtifacts`: `label`, `description`, `category: "experience"`, `added: "2026-11-17"`, `since: "2026-11"`, `author`, `docs: "docs/features/comex-office-reference/README.md"`, `deployments: ["self_hosted"]`, `default: false` |
| 2 | `apps/server/src/comex/features.ts` | `comexArtifactsEnabled()` con `resolveFeature("comexArtifacts", ...)`, mismo patrón que `comexScopedMemoryEnabled()` (`:60-64`) |
| 3 | `apps/server/src/routes/core.ts:152` | añadir `comexArtifacts: comexArtifactsEnabled()` a la respuesta de `GET /comex/features` |
| 4 | `apps/app/src/app/lib/openwork-server.ts:2621` | añadir `comexArtifacts?: boolean` al tipo de `getComexFeatures()` |
| 5 | `apps/app/src/react-app/domains/session/comex/use-comex-feature.ts` | exponer `useComexArtifactsFeature(client)` (o extender el hook con el campo). `useQuery` con la misma key `["comex-feature", client.baseUrl]` y `staleTime: 15_000`; **no** crear una query nueva |
| 6 | `apps/app/src/react-app/domains/specialists/provider.tsx:116` y `library-dialog.tsx` | pasar el flag al diálogo para mostrar `Abrir en el panel` solo si está on |
| 7 | `side-panel.tsx` | registrar la rama `studio` solo si el flag está on; apagado = tabs y dispatcher actuales intactos |
| 8 | `apps/server/src/specialists/library-tool-api.ts` / `library-plugin.ts` | las herramientas que producen esquemas de artefacto también se gatean en servidor (defensa en profundidad) |

**Doble gate:** el cliente comprueba el flag para pintar la superficie y el servidor para servir
las rutas; si el flag se apaga, las rutas devuelven 404 y la UI cae al flujo anterior. El flag
*nuevo* es `comexArtifacts`; `studioOutputs` (`registry.ts:327`, default `true`) se conserva como
flag de las salidas existentes y no se reutiliza para esta experiencia (sería imposible apagarla
sin deploy).

---

## 5. Plan por archivos (orden y dependencias)

Orden respetando el épico (`06 → 01 → 05 → 04 → 03 → 02`) y el principio de que la fundación va
antes que cualquier render. `P0` destraba el issue #1; los bloques posteriores son los sub-issues.

### P0 — Fundación del flag (issue #1, prerequisites)

1. `packages/features/src/registry.ts` — registrar `comexArtifacts`.
2. `apps/server/src/comex/features.ts` — helper `comexArtifactsEnabled()`.
3. `apps/server/src/routes/core.ts` — exponer el campo en `/comex/features`.
4. `apps/app/src/app/lib/openwork-server.ts` — tipo del campo (**y más adelante**, métodos de
   artefacto).
5. `apps/app/src/react-app/domains/session/comex/use-comex-feature.ts` — hook derivado.

### P1 — Modelo y persistencia (issue #1)

6. `apps/app/src/react-app/domains/artifacts/types.ts` (**nuevo**) — interfaces del §1.2.
7. `apps/server/src/specialists/artifacts.ts` (**nuevo**) — Zod schemas, `artifact.json`,
   `index.json`, versions, `dataPath(directory, "artefactos")`, adaptador desde `SpecialistOutput`.
8. `apps/server/src/specialists/artifacts-routes.ts` (**nuevo**) — GET/POST/PUT; registrar en
   `apps/server/src/server.ts` junto a las rutas de `specialist_outputs`.
9. `apps/app/src/app/lib/openwork-server.ts` — `getArtifacts/getArtifact/createArtifact/saveArtifactVersion`.
10. `apps/server/test/artifacts.test.ts` y `apps/server/test/artifacts-routes.test.ts` (**nuevos**).

### P2 — Shell (issue #1; lo consumen #05, #03, #02, #04)

11. `apps/app/src/react-app/domains/artifacts/shell/studio-artifact-shell.tsx` (**nuevo**).
12. `.../shell/artifact-header.tsx`, `artifact-status-strip.tsx`, `artifact-context-bar.tsx`,
    `artifact-dock.tsx`, `artifact-body.tsx` (**nuevos**).
13. `apps/app/src/react-app/domains/artifacts/views/doc-view.tsx` (**nuevo**) — primer renderer;
    reutiliza `MarkdownPreview`.
14. `apps/app/src/react-app/domains/artifacts/state/artifact-store.ts` (**nuevo**) — store de refs
    y preferencias de UI, estilo `panel-tab-store.ts`.

### P3 — Integración (issue #1)

15. `apps/app/src/react-app/domains/session/panel/panel-tab-store.ts` — añadir `"studio"` a
    `PanelTabType` (`:10`), `StudioArtifactPanelTab`, y actualizar `isSameTab` (`:138-184`),
    `partialize` (`:408-424`) y `mergePersistedSessions` (`:198-238`) — hoy solo sobreviven las
    pestañas `browser` a la recarga.
16. `apps/app/src/react-app/domains/session/panel/use-side-panel-tabs.ts` — acción para abrir tab
    `studio` desde una salida.
17. `apps/app/src/react-app/domains/session/panel/side-panel.tsx` — rama `activeTab?.type === "studio"`
    en el dispatcher (`:874-902`) + gate del flag (`:622` ya trae `useComexFeature`).
18. `apps/app/src/react-app/domains/specialists/library-dialog.tsx` — `OutputsView`/`OutputDetail`
    añaden `Abrir en el panel`; la auditoría pasa de párrafo (`:770-775`) a llave
    `metadata.audit` del artefacto.
19. `apps/app/tests/specialist-outputs-ui.test.tsx` (**nuevo o existente**) — flujo de apertura.

### P4 — Split y foco (issue #1 + Fase 3 de `investigacion.md`)

20. `apps/app/src/react-app/domains/session/chat/workbench-panel-group.tsx` — pasar el artefacto
    por `SECONDARY_PANEL_ID`; exponer `setLayout` para modo foco.
21. `apps/app/src/react-app/domains/session/chat/workbench-ui-state.ts` — persistir `focusMode` y
    ratio por `owner`.
22. `apps/app/src/react-app/domains/session/chat/session-page.tsx` — `secondaryVisible` cuando
    hay tab `studio`; botón `Mostrar chat` / `Maximizar`.

### P5 — Temas y sub-issues

23. `apps/app/src/app/index.css`, `styles/colors.css`, `styles/tailwind-theme.css` — tokens del
    issue **#06** (va primero, según la estimación del épico). El shell consume `--dls-*` y
    `--chart-*`; sin hex.
24. issue **#05** (Data): `views/data-view.tsx`, sobre `specialist_panel_read` — depende de P2.
25. issue **#04** (Board): `views/board-view.tsx` — depende de P2 y #06.
26. issue **#03** (Sheets): `views/sheet-view.tsx` sobre `artifact-spreadsheet-editor.tsx` —
    depende de P2.
27. issue **#02** (Slides): `views/slides-view.tsx` — depende de P2 y #06.

**Matriz de dependencias:**

```
P0 (flag) ──► P1 (modelo/persistencia) ──► P2 (shell) ──► P3 (integración) ──► P4 (split/foco)
                                              │
                                              ├──► #05 Data ──► (nada)
                                              ├──► #03 Sheets
                                              └──► #06 temas ──► #04 Board, #02 Slides
```

El shell se reutiliza en al menos dos funcionalidades (P2 + #05), que es el criterio de
aceptación del épico. Ningún sub-issue puede empezar antes de P2.

---

## 6. Estrategia de tests (headless)

`AGENTS.md` es explícito: no abrir la app de escritorio; verificar en Chrome headless.

### 6.1Cómo ejecutar

- Especificar con `seed.appWeb` (skill `write-a-spec`) los specs de las superficies nuevas.
- `run-tests` indica qué placement tests cubren el working tree (no asumir cobertura).
- `pnpm test:comex` — definido en `package.json:80`: corre `@openwork/features`, tests de
  `apps/server/test` (incluye `comex-workspace.test.ts` y `specialist-applications.test.ts`),
  `pnpm --filter @openwork/app test:comex`, los unittest de `pack/tests` y `validar.py`.
- Para revisión visual: `pnpm world up dev-app-web --detach -- --browser` y manejar la dirección
  `cdp` impresa (`drive-desktop-cdp`). Adjuntar screenshots a real size (P10).

### 6.2Qué verificar

| Nivel | Archivo | Casos |
|---|---|---|
| Flag | `apps/server/test/comex-workspace.test.ts` | `comexArtifacts` default false; `DEN_FEATURE_COMEX_ARTIFACTS=true` habilita; ruta `/comex/features` devuelve el campo; rutas de artefacto devuelven 404 con flag off |
| Registry | `packages/features/src/resolve.test.ts` | la nueva clave aparece en `FEATURE_KEYS`, pasa `featureKeySchema` y respeta `default: false` |
| Persistencia | `apps/server/test/artifacts.test.ts` | escritura atómica de `artifact.json`/`index.json`; validación Zod por tipo; `contentRef` roto falla en voz alta; auditoría calculada en servidor con citas rotas; `draft` no pisa `saved` |
| Rutas | `apps/server/test/artifacts-routes.test.ts` | GET/POST/PUT con `workspace` query, patrón de `specialist-outputs-routes.test.ts` |
| Store de tabs | `apps/app/tests/...` (nuevo, estilo `panel-tab-store` tests) | `openTab({type:"studio"})`, `isSameTab`, `closeTab` conserva el hilo, `partialize`/`merge` restaura la tab `studio` y no resucita un `artifactId` borrado |
| UI de salidas | `apps/app/tests/specialist-outputs-ui.test.tsx` | `Abrir en el panel` visible solo con flag on; no auto-apertura (S5); el chat mantiene scroll y selección al alternar |
| UI del shell | `apps/app/tests/artifact-shell.test.tsx` (**nuevo**) | header fijo; `max-h` ausente en el cuerpo; chips de auditoría `12/12` y ruta rota; dock cambia por tipo; `Mostrar chat` / `Maximizar` alterna y restaura ratio; estados skeleton/empty/error/exportado |
| Flotantes | `apps/app/tests/floating-surface-guard.test.ts` (existente) | `Compartir/Exportar` y la barra contextual usan primitivas Base UI; cierran con `Esc`, devuelven foco, no posicionan a mano |
| Paneles (regresión) | `apps/app/tests/specialist-panels-ui.test.tsx`, `specialist-datasets-ui.test.tsx` | siguen pasando sin cambios: ningún renderer nuevo reemplaza los bloques deterministas |
| Accesibilidad | spec `seed.appWeb` | teclado en header/dock/popovers, nombre accesible, foco visible, `prefers-reduced-motion` |

Criterio de salida: `pnpm test:comex` verde + screenshots de los estados tocados + revisión con
`DESIGN.md` (checklist de "Before opening a UI PR").

---

## 7. Riesgos y mitigaciones

### 7.1Qué NO reemplazar

1. **Paneles deterministas.** `specialist_panel_write` / `specialist_panel_read`, `PanelCanvas`
   (`library-dialog.tsx:569`) y los bloques `stat|line|bar|table|markdown|changes` son la fuente de
   verdad de los datos. `DataView` es un **render editorial** sobre esa resolución, no un nuevo
   motor de paneles ni un clon de `panel_read`. Si el panel no resuelve, debe seguir fallando en
   voz alta igual que hoy (§7.3).
2. **`ArtifactPanel` (`artifact-panel.tsx`).** Sigue siendo la superficie de archivos/`OpenTarget`,
   con su `DocxPreview` tras `useComexFeature` (`:436`). El shell no lo sustituye: convive como otra
   rama de `activeTab`.
3. **`ComexProjectPanel` y el diálogo de biblioteca.** El home y la gestión no se convierten en
   "hub" en este issue (eso es Fase 4). Solo se añade el botón de apertura.
4. **Salidas y auditoría existentes.** No se reescribe `outputs.ts` ni se migra `index.json`: el
   artefacto envuelve por `metadata.outputRef`. `audit.valid/invalid/total` se consume, no se
   recalcula en el cliente.
5. **Editor de texto rico / canvas infinito / permisos por link** — anti-patrones 3, 6 y 7 de
   `investigacion.md` §11. Quedan fuera.

### 7.2Cómo evitar duplicar lógica de datos

- **Una sola fuente por dato:** servidor (`specialist_outputs`, `specialist_panels`,
  `specialist_datasets`, `specialist_sources`) + TanStack Query con las mismas query keys
  (`["comex-feature", client.baseUrl]`, `OUTPUTS_KEY(...)`). El store Zustand nuevo guarda **solo**
  `artifactId`, `focusMode`, ratio y `theme`; nunca `content`, `sources` ni `audit`.
- **Adaptador, no espejo:** `artifacts.ts` convierte `SpecialistOutputMeta` → `ArtifactBase`
  (`kind: report|mindmap → type: doc`; `table → data`) sin copiar contenido. El contenido se lee
  con los métodos ya existentes `getSpecialistOutput` / `getSpecialistOutputAudit`.
- **Cálculo de auditoría en un lugar:** `extractCitations` y la validación de anclas siguen en
  `apps/server/src/specialists/`; el shell solo muestra `metadata.audit` como chip (R5).
- **Un lugar para compartir/exportar** (R7): una sola puerta en el header; no duplicar el
  `DropdownMenu` de `artifact-panel.tsx:344-370` ni los botones `Ver`/`Eliminar` de la fila.
- **Estados visuales, no intersticios** (P11): `streaming` muestra el esqueleto con la forma del
  contenido y la primera sección; no un spinner de pantalla completa ni un "Preparing…".

### 7.3Riesgos concretos

| Riesgo | Mitigación |
|---|---|
| El flag queda a medias y aparece una superficie sin salida | Doble gate (cliente + servidor); apagado = dispatcher y diálogo actuales intactos |
| `panel-tab-store` pierde la tab `studio` al recargar | Actualizar `partialize`/`mergePersistedSessions` junto con `isSameTab`; reconciliar contra el índice de artefactos como hace `syncTranscriptArtifacts` (`:351-378`) |
| Regresión visual en paneles al pasar por `DataView` | Tests de `specialist-panels-ui.test.tsx` sin cambios + screenshots antes/después |
| `max-h-80` reaparece "por comodidad" | Regla R1 en revisión: scroll del panel; test del shell que falla si el cuerpo tiene `max-h-*` |
| Hex o serif importada de Claude | R3/R11: tokens `--dls-*` y `--chart-*`, system stack; checklist de `DESIGN.md` |
| Confidencialidad (`AGENTS.md`) | Ningún fixture, nombre de cliente ni ticket externo en tests/specs/screenshots; usar IDs internos |
| Over-engineering (suite Office) | R10: `slides`/`board` solo render acotado; sin presentador completo, sin canvas infinito, sin panel Design de 4 formatos |
| Auto-apertura al generar | S5/R6: la tarjeta ofrece `Abrir en el panel`; `createArtifact` no llama a `openTab` |

---

## Criterios de aceptación derivados (para el issue #1)

- [ ] `Artifact` con esquema versionado y persistencia en `<datos>/artefactos/`, detrás de `comexArtifacts`.
- [ ] Un `report` de 20 KB se lee con un solo scroll del panel, sin `max-h` interno.
- [ ] El shell se reutiliza en `doc` y en `data` (render sobre panel determinista).
- [ ] `Abrir en el panel` desde `OutputsView` conserva el hilo y el scroll del chat.
- [ ] `Mostrar chat` / `Maximizar` alterna split y foco restaurando el ratio previo.
- [ ] `12/12 citas` visible como chip con detalle a un clic; sin párrafo explicativo.
- [ ] Exportar `.md`/`.csv` produce el contenido completo, en un clic.
- [ ] `pnpm test:comex` verde; screenshots de los estados tocados adjuntos al PR.
