# Spike — Excalidraw embebido (issue #5, Whiteboard)

**Fecha:** 2026-11-17  
**Estado:** ✅ **validado** — embed, generación programática, export, persistencia y offline funcionan con código real.  
**Método:** proyecto Vite + React + TS **desechable** en `/tmp/opencode/excalidraw-spike` (fuera del repo). No se modificaron `package.json`, lockfiles ni ningún archivo de la app. No se hizo commit.

> Este spike valida la decisión tomada en `../matriz-decisiones.md` §2 y `../issues/04-whiteboard.md`: `@excalidraw/excalidraw` (MIT) embebido, sin pago.
>
> **Estado de integración (2026-11-24):** Excalidraw todavía no está integrado en la app. El
> artefacto `board` actual usa un visor mínimo de nodos y conectores; el issue #5 sigue abierto.

---

## 1. Versiones exactas instaladas

| Paquete | Versión | Rol |
|---|---|---|
| `@excalidraw/excalidraw` | **0.18.1** (MIT) | editor embebido |
| `react` / `react-dom` | **19.3.1** / **19.3.1** | peer declarado `^17.0.2 \|\| ^18.2.0 \|\| ^19.0.0` |
| `vite` | **8.3.8** | bundler |
| `@vitejs/plugin-react` | **6.3.0** | plugin React |
| `typescript` | **7.0.2** | type-check (`tsc -b`) |
| `@types/react` / `@types/react-dom` | **19.3.0** / **19.3.0** | tipos |
| pnpm / Node | **12.4.1** / **v22.22.1** | entorno |

`pnpm peers check` reporta *warnings* de peers: los `@radix-ui/*@1.0.x` internos de Excalidraw declaran React `^16.8 || ^17 || ^18`. **No rompen nada**: el build y el runtime con React 19 funcionaron (ver §8). Es ruido conocido de las dependencias fijadas por Excalidraw.

---

## 2. Comandos ejecutados

```bash
mkdir -p /tmp/opencode/excalidraw-spike
cd /tmp/opencode/excalidraw-spike
# scaffold manual (package.json, tsconfig*, vite.config.ts, index.html, src/)
pnpm add react@19 react-dom@19 @excalidraw/excalidraw@0.18.1
pnpm add -D vite@8 @vitejs/plugin-react@6 typescript@7 @types/react@19 @types/react-dom@19
# assets offline:
cp -r node_modules/@excalidraw/excalidraw/dist/prod/{fonts,locales,data} public/
pnpm build                      # => exit 0
pnpm preview --host 127.0.0.1 --port 4178
# smoke test con Playwright/Chromium headless (script desechable, no parte de la app)
```

`pnpm build` = `tsc -b && vite build`.

---

## 3. Embed mínimo (verificado)

El contenedor **debe tener altura definida**: Excalidraw ocupa el 100% de su padre. Sin altura, no se ve nada.

```tsx
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css"; // obligatorio: sin esto no hay UI

export default function Board() {
  return (
    <div style={{ height: 500, width: "100%" }}>
      <Excalidraw />
    </div>
  );
}
```

`vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // La doc oficial lo recomienda porque Vite elimina process.env.*.
  // En este spike build y runtime funcionan también SIN esta línea (Vite 8),
  // pero se recomienda mantenerla por robustez / compatibilidad con Preact.
  define: { "process.env.IS_PREACT": JSON.stringify("false") },
});
```

**API real (importante):** `getSceneElements`, `getAppState`, `getFiles`, `addFiles` y `updateScene` **no son exports de nivel superior**; están en el objeto `ExcalidrawImperativeAPI` que se obtiene con la prop `excalidrawAPI={(api) => ...}`. Sí son exports de nivel superior: `Excalidraw`, `convertToExcalidrawElements`, `exportToBlob`, `exportToSvg`, `exportToCanvas`, `serializeAsJSON`, `restore`, `restoreElements`, `MIME_TYPES`, `THEME`, etc. Los tipos se importan por subpath (`@excalidraw/excalidraw/types`, `@excalidraw/excalidraw/element/types`) solo con `import type` (el exports map solo declara la condición `types`).

---

## 4. Generar elementos desde código + `updateScene` (clave para el agente)

```tsx
import { Excalidraw, convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);

const elements = convertToExcalidrawElements([
  { type: "rectangle", id: "proveedor", x: 120, y: 160, width: 180, height: 90,
    label: { text: "Proveedor" } },
  { type: "rectangle", id: "cliente", x: 460, y: 160, width: 180, height: 90,
    label: { text: "Cliente" } },
  { type: "text", id: "titulo", x: 120, y: 80, text: "Flujo de exportación", fontSize: 24 },
  { type: "arrow", id: "flecha", x: 300, y: 205, width: 160, height: 0,
    start: { id: "proveedor" }, end: { id: "cliente" } },  // binding real
]);

apiRef.current!.updateScene({ elements });
// <Excalidraw excalidrawAPI={(api) => (apiRef.current = api)} />
```

**Resultado real observado:** 4 skeletons → **6 elementos** (`rectangle, rectangle, text, arrow, text, text`): cada `label` de un rectángulo crea un elemento `text` enlazado. La flecha quedó **bindeada** a ambos rectángulos (verificado en screenshot: la punta toca "Cliente" y se mueve con él). Es un detalle a tener en cuenta al contar elementos o al generar from-prompt.

Otros tipos de skeleton soportados por `convertToExcalidrawElements`: `rectangle`, `diamond`, `ellipse`, `text`, `line`, `arrow`, `image` (con `fileId`), `frame`/`magicframe` (con `children`). Opciones: `{ regenerateIds: boolean }`.

---

## 5. Export PNG y SVG

```tsx
import { exportToBlob, exportToSvg } from "@excalidraw/excalidraw";

const api = apiRef.current!;
const elements = api.getSceneElements();
const files = api.getFiles();

// PNG -> Blob
const blob = await exportToBlob({
  elements, files, mimeType: "image/png", exportPadding: 16,
});

// SVG -> SVGSVGElement (serializar con XMLSerializer)
const svg = await exportToSvg({ elements, files, exportPadding: 16 });
const text = new XMLSerializer().serializeToString(svg);
```

**Resultado real:** PNG **19.441 bytes** (download válido), SVG **7.283 bytes** / 7.282 chars. Ambos generados desde la escena creada por código. Sin errores de página.

Nota: durante la exportación aparece en consola `Failed to use workers for subsetting, falling back to the main thread. ErrorEvent` (ver §9, Electron). El export igualmente produce archivos válidos.

---

## 6. Guardar / cargar escena JSON

```tsx
import { serializeAsJSON, restore } from "@excalidraw/excalidraw";
import type { AppState, BinaryFiles, BinaryFileData } from "@excalidraw/excalidraw/types";

// GUARDAR
const elements = api.getSceneElements();          // ExcalidrawElement[]
const appState = api.getAppState();               // AppState completo
const files = api.getFiles();                     // BinaryFiles (record)
const json = serializeAsJSON(elements, pickPersisted(appState), files, "local");
// guardar `json` en el artefacto board.scene (o IndexedDB / IPC de Electron)

// CARGAR
const parsed = JSON.parse(json);
const restored = restore(
  { elements: parsed.elements, appState: parsed.appState, files: parsed.files },
  null, null,
);
api.updateScene({ elements: restored.elements, appState: restored.appState });
const binaries: BinaryFileData[] = Object.values(restored.files);
if (binaries.length) api.addFiles(binaries);      // imágenes embebidas
```

`appState` completo **no** debe persistirse tal cual: contiene estado efímero de UI. En el spike se guardó un subconjunto (`viewBackgroundColor`, scrollX/scrollY, zoom, gridSize, estilos del ítem actual, etc.). `restore()` sanea y repara bindings; es el mismo camino que usar `loadFromBlob` para un `.excalidraw`.

**Resultado real:** guardado **5.834 chars**, 0 archivos binarios (la escena de prueba no tenía imágenes); carga con `restore + updateScene + addFiles` → 6 elementos, 0 files, sin pérdida. Pendiente de validar en el issue el caso con imágenes (`addFiles` con datos reales), pero la firma y el flujo están confirmados por tipos + ejecución.

---

## 7. Fuentes self-host / funcionamiento offline

Documentado oficialmente: por defecto Excalidraw descarga fuentes desde `https://esm.run/@excalidraw/excalidraw/dist/prod`. Para offline:

```bash
cp -r node_modules/@excalidraw/excalidraw/dist/prod/fonts public/fonts
# opcional pero recomendado para packs de idioma y datos de imagen:
cp -r node_modules/@excalidraw/excalidraw/dist/prod/locales public/locales
cp -r node_modules/@excalidraw/excalidraw/dist/prod/data   public/data
```

```ts
// en el entry, ANTES de renderizar (src/main.tsx):
window.EXCALIDRAW_ASSET_PATH = "/"; // = carpeta que contiene fonts/, locales/, data/
```

**Verificación real (Playwright, bloqueando TODAS las peticiones externas):** **0 requests externos**; 4 peticiones de fuentes locales (`/assets/Assistant-*.woff2` inyectadas por el CSS + `/fonts/Excalifont/Excalifont-Regular-*.woff2` servida por `EXCALIDRAW_ASSET_PATH`). El editor renderizó los 2 canvas y generó el diagrama normalmente. ⇒ apto para Electron sin red.

En Electron hay que asegurarse de que `public/fonts` (13 MB) quede dentro del paquete (`app.asar` o `extraResources`) y que la ruta base sea correcta con el protocolo que use la app (`file://` o custom). Si se usa un custom protocol, conviene setear `EXCALIDRAW_ASSET_PATH` a esa URL base.

---

## 8. Resultado del `pnpm build`

```
$ tsc -b && vite build
vite v8.3.8 building client environment for production...
✓ 1761 modules transformed.

dist/index.html                     0.48 kB │ gzip:   0.30 kB
dist/assets/index-*.css           142.02 kB │ gzip:  22.37 kB
dist/assets/index-*.js          1.312,35 kB │ gzip: 415,24 kB   <- bundle principal
dist/assets/chunk-EIO257PC-*.js 1.820,99 kB │ gzip: 744,20 kB   <- chunk más grande

(!) Some chunks are larger than 500 kB after minification.
✓ built in ~3 s     [exit 0]
```

**Tamaños aproximados del `dist/`:** **23 MB** total — `assets/` 8,0 MB (162 archivos JS/CSS/WOFF2), `fonts/` 13 MB, `locales/` 1,7 MB, `data/` 4 KB.

- El bundle incluye **Mermaid** (dependencia `@excalidraw/mermaid-to-excalidraw`): por eso aparecen decenas de chunks de diagramas (`katex`, `cytoscape`, `sequenceDiagram`, `architectureDiagram`, etc.). Es el mayor responsable de la cantidad de chunks; en el issue se puede evaluar code-splitting / lazy-load del editor.
- **No hay errores de SSR**: esto es esperable — Excalidraw no soporta SSR (la doc lo dice para Next.js). En Electron + Vite es todo cliente, así que **no aplica**.
- Único warning del build: chunks > 500 kB (no es error).
- Sin errores de TypeScript (`tsc -b` limpio).

---

## 9. Limitaciones confirmadas

1. **Páginas múltiples: NO.** El tipo `ExcalidrawElement` incluye `frame` / `magicframe`, pero **no existe concepto de `pages`**: la escena es un array plano de elementos. Los frames son el sustituto para seccionar un tablero. Confirmado por inspección de `types.d.ts` y `element/types.d.ts`.
2. **Colaboración: NO incluida en el paquete npm.** No hay dependencias `yjs`, `y-websocket` ni `socket.io`. El export `LiveCollaborationTrigger` es **solo un botón UI** (`{isCollaborating, onSelect}`); el backend/sync hay que implementarlo (Yjs/Hocuspocus) o diferirlo. Coincide con la decisión del issue (fase 2).
3. **Estilo: sketch por defecto.** La identidad es hand-drawn (tipografía Excalifont, `roughness`). Se puede atenuar bajando `roughness`/`strokeStyle` en los elementos generados y sobrescribiendo variables CSS (`--color-primary*`) con un selector más específico: `.mi-app .excalidraw { --color-primary: … }` y `.mi-app .excalidraw.theme--dark { … }`. **No es white-label total**: no se puede cambiar la tipografía base ni quitar la estética dibujada a mano con la API pública. Aceptado en la decisión.
4. **SSR: no soportado.** Irrelevante en Electron/Vite (cliente puro), pero si algún día se prerenderiza hay que cargarlo con `dynamic(..., { ssr: false })`.
5. **Electron / `file://`:** en el smoke test apareció `Failed to use workers for subsetting, falling back to the main thread` al exportar. Bajo `file://` los Web Workers suelen estar bloqueados; Excalidraw cae al hilo principal y sigue funcionando, pero el subsetting de fuentes puede ser más lento. Mitigación: servir assets por un protocolo custom o aceptar el fallback. También hay que incluir los 13 MB de fuentes en el instalador.
6. **Peer warnings de Radix/React 19** (§1): ruido, sin impacto funcional observado.
7. **Export de imágenes con `addFiles`** no se probó con binarios reales (el flujo y las firmas sí están validados; marcar como pendiente en el issue).

---

## 10. Recomendación para el issue #5

**Confirmar Excalidraw (MIT) para el MVP.** El spike demuestra que:

- el embed mínimo funciona con contenedor con altura;
- el agente puede dibujar vía `convertToExcalidrawElements` + `updateScene`, con flechas **bindeadas** (criterio clave del issue);
- PNG y SVG se exportan con `exportToBlob` / `exportToSvg` (el issue original dudaba del SVG: **sí está disponible**);
- la escena se guarda/carga con `getSceneElements/getAppState/getFiles` + `serializeAsJSON`/`restore` + `updateScene`/`addFiles`;
- funciona **sin red** con `window.EXCALIDRAW_ASSET_PATH` y las fuentes copiadas al bundle.

**Notas para la estimación:** sumar ~23 MB al paquete (13 MB fuentes); el bundle principal es ~1,3 MB (415 kB gzip) más un chunk de ~1,8 MB; prever code-splitting (lazy-load del editor) y verificar el worker de subsetting bajo el protocolo de Electron. Mantener colaboración y multi-página fuera del MVP. El estilo sketch se acepta y se customize con variables CSS; no prometer white-label.

**Siguiente paso (fuera de este spike):** verificar `addFiles` con una imagen real y el `Ask Claude` con contexto de selección; ya no hay riesgo de librería.

---

## 11. Fuentes consultadas

- Código instalado: `@excalidraw/excalidraw@0.18.1` — `dist/types/excalidraw/{index,types,data/transform,data/json,data/restore,utils/export}.d.ts` y `dist/types/excalidraw/element/types.d.ts`.
- https://plus.excalidraw.com/docs/sdk/excalidraw/installation (self-hosting de fuentes, dimensiones)
- https://plus.excalidraw.com/docs/sdk/excalidraw/integration (module bundler, SSR/Next, `IS_PREACT` en Vite)
- https://plus.excalidraw.com/docs/sdk/excalidraw/customizing-styles (variables CSS)

*Este spike no modifica la app: todo el código de prueba vive en `/tmp/opencode/excalidraw-spike`.*
