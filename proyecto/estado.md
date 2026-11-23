# Memoria del proyecto

## Objetivo y alcance
Que lo que ya existe en comex-desktop sea estable, escalable y estructurado, preparado para
llevar el servidor y el escritorio a Rust. Desde 2026-11-20 el objetivo pedido es además la
paridad de funcionamiento con la app de Codex (escritorio + web + acceso remoto), con el mismo
criterio de excelencia. Hoja de ruta aprobada, cada fase detrás de un flag, con tests y prueba en
vivo: (1) acceso remoto seguro, (2) web igual al escritorio, (3) centro de mando de tareas en
paralelo, (4) aislamiento por tarea y panel de revisión, (5) bandeja de resultados de las
automatizaciones. Se copia el modelo de trabajo, no las funciones de Git.

## Decisiones
- Política estricta de preparación para Rust: `docs/rust-readiness.md` (reglas R1-R8), en
  `AGENTS.md`. `pnpm check:rust-readiness` falla ante infracciones nuevas; la línea de base
  (`scripts/rust-readiness-baseline.json`) solo baja. Vectores de contrato en `contracts/`.
- Herramienta de depuración para personas y agentes: `pnpm dev:agent` (skill
  `.opencode/skills/dev-agent-toolkit`). Sesiones aisladas, clics y teclado reales, archivos sin
  diálogos nativos, errores de la página, registro de eventos y API como host.
- Portabilidad de aplicaciones detrás de `specialistAppPortability` (activado). Diseño en
  `docs/features/specialist-app-portability/README.md`.
- Español por defecto en Comex detrás de `comexSpanishLocale`. Se mantiene el tuteo de `es.ts`.
- Acceso remoto (fase 1, hecha): `remoteDevicePairing` (activado). Código de un solo uso →
  token de dueño por dispositivo, revocable. Las rutas `host` y casi todas las `host-token`
  aceptan dispositivos vinculados; `/den-session` y `/cloud-provider-sync` siguen siendo solo del
  escritorio. Con Tailscale: servidor en 127.0.0.1 y `tailscale serve` (detrás del proxy todo
  llega desde 127.0.0.1, por eso nunca se confía en "local"). Diseño:
  `docs/features/remote-device-pairing/README.md`. La web de `openwork-server web` se construye
  con `pnpm --filter @openwork/app build:selfhost` (no con `build`).
- Restablecer configuración borra solo claves de preferencias (lista en
  `apps/app/src/react-app/domains/settings/state/reset-app-config.ts`), nunca tokens, conexiones,
  historial ni idioma.
- **Regla de flags (aclaración del usuario, 2026-11-23):** la política de "toda
  change visible arranca detrás de un flag **off**" se reserva a funciones que
  consumen recursos de la PC (motores, workers, trabajo en segundo plano, etc.) o
  que cambian comportamiento sensible. Las mejoras de UI livianas y puramente
  opt-in (botones, visores, toggles) deben **verse siempre** y usar solo si se
  quiere: se declaran con `default: true` o directamente sin flag. No volver a
  justificar un default apagado en este tipo de cambios.

## Evidencia y resultados
- 2026-11-19, segundo tramo: app 2108 tests, server 806, `pnpm test:comex`, typechecks,
  `features:check`, guardrails de UI (0 nuevas), puente de Electron (42 métodos) y
  preparación para Rust (0 nuevas, 135 congeladas), todo en verde.
- Verificado en Electron con `pnpm dev:agent`: ventana visible en Wayland sin el asistente,
  primera aplicación sin Comex preseleccionado, exportar, importar, descargar, subir archivos,
  Complementos sin scroll horizontal, modelos y proveedores sin errores 500.
- Arreglado y con test: pack autocontenido (borrador-html, yt_transcript.py, sin rutas
  personales; el validador las rechaza), acciones de recuperación de Ajustes (estaban
  simuladas), puente del navegador que bloqueaba modelos y proveedores, `recordHealthy` en
  desarrollo, botón de Ollama, proyectos que no seguían el renombre de la aplicación, menú en el
  navegador sin permisos, etiqueta accesible en inglés, estados de las tarjetas, 435 traducciones
  más.

- 2026-11-20, colmena (69 hallazgos) corregida: app 2122 tests, server 795, `test:comex`,
  typechecks, flags, guardrails, Rust (0 nuevas) y puente de Electron en verde. Probado en vivo:
  traducciones, compactación persistente, borrar app activa, modelo real (OpenCode Go con la
  clave de prueba, en un perfil aislado) y la vinculación completa en Chrome detrás de un proxy
  que imita a Tailscale (código, canje, acceso de dueño, variables de entorno, revocación, SSE).
- El verificador de Rust ocultaba infracciones cuando un string contenía `/*`; se reescribió con
  un escáner de una pasada y aparecieron 3 `JSON.parse` sin validar en `server.ts` (corregidos).

- 2026-11-20, segunda ronda en paralelo (10 agentes, integrados en `dev` con rebase y pruebas):
  aprobaciones en la web (`webApprovals`), explorador de carpetas (`webFolderBrowser`),
  notificaciones (`webNotifications`), centro de control (`commandCenter`, `/command-center`,
  API en `/command-center/snapshot`), exportación `.owapp` con archivos de trabajo
  (`specialistAppZipBundle`), aislamiento por tarea con revisión (`taskIsolationReview`, apagado
  por defecto), bandeja de resultados (`resultsInbox`, `/inbox`), toda la app en español (test de
  cobertura), guardas de calidad (HOME aislado en todos los tests del servidor, recorrido
  completo) y Rust de 135 a 24 congeladas. Suites: app 2188, server 857, `test:comex` en verde.
  Probado en vivo por un proxy tipo Tailscale con clics reales: vincular, crear app, exportar e
  importar `.owapp`, crear workspace eligiendo carpeta, aprobar un cambio, centro y bandeja.
- Lección: probar la web siempre con clics reales (no `element.click()`) y con la build
  `build:selfhost`; así aparecieron la capa de arranque que tapaba `/pair` y la colisión entre la
  página `/command-center` y la ruta de la API (ahora hay un test que lo impide).

## Próximos pasos
1. Traducciones: faltan unas 1.170 claves en español (extensions 393, connect 263 y otras).
2. Investigar un timeout intermitente de `GET …/opencode2/api/session` justo después de importar
   una aplicación (recarga del motor). Se reproduce con `pnpm dev:agent` (`errors` lo muestra).
3. "Limpiar contenedores" de Ajustes quedó conectado pero no se probó en vivo: borraría
   contenedores Docker reales con prefijos de OpenWork. Probar en una máquina descartable.
4. Rust: bajar las 135 ocurrencias congeladas (120 `JSON.parse` sin validar, 15 dobles casts) y
   sumar vectores de contrato (horarios de tareas, rutas de biblioteca, formato del store).
5. Portabilidad: exportar también archivos de trabajo del proyecto, no solo la carpeta de datos, y
   avisar cuando una fuente local apunta a un archivo que no viaja.
6. Probar con el motor real `taskIsolationReview` (mover la sesión a la copia) antes de activarlo.
7. Textos que quedan: "Select folder" y "Want more analytics?" en el diálogo de crear workspace,
   la descripción de las aprobaciones viene del servidor en inglés ("Patch workspace config"), y
   los textos escritos a mano de Comex usan voseo ("Creá tu primera aplicación") mientras `es.ts`
   usa tuteo: unificar.
8. El botón "Centro de control" no responde durante los primeros segundos tras arrancar (espera
   el flag); quedan 24 ocurrencias congeladas de Rust (17 en `specialists/`).
9. w1-3 ("Cannot update a component while rendering") quedó muy reducido (suscripciones a la
   caché de consultas); vigilar si reaparece al borrar una aplicación.
10. orch-2: se acotó una espera sin límite al arrancar; falta la pantalla estática de `index.html`
   ("Starting OpenWork" en inglés, recarga recién a los 45 s), que necesita un flag.

## 2026-11-20 — Fix: chat lateral de Diseño colapsado y sistema de diseño que no se actualiza
- Reporte (con captura, workspace juveconfe): en `/design/:ws/:id` el chat de al lado se veía mal
  (composer arriba, píldoras "Ir al inicio / Ir a lo más reciente" flotando sobre el header) y el
  contenido del editor de sistema no reflejaba los edits del agente.
- Causa 1: el `<aside>` de `design-chat-panel.tsx` no tenía `flex-1`; con altura auto, el scroller
  absoluto de `SessionSurface` colapsa a 0. Fix: `flex-1` en el aside.
- Causa 2: `SystemEditor` keyeaba la query de tokens solo por `design.updatedAt` (que no cambia
  cuando el agente escribe archivos en disco) e ignoraba la prop `revision` que la página poll cada
  3 s. Fix: `revision` en la query key + `reloadKey={revision}` en los previews de componentes
  (`system-sections.tsx`, tipo `SystemDesignFrame`).
- Tests de regresión nuevos en `design-studio-ui.test.tsx` (panel estira) y
  `design-system-editor.test.tsx` (bump de revision recarga tokens y previews). 75 tests de design
  en verde + `pnpm typecheck` limpio. Sin commit (regla del repo: solo a pedido).
- Verificación visual headless intentada con `pnpm world up dev-app-web`: bloqueada por conflicto
  de motores en este checkout (el `opencode` del PATH es v2 y el engine gestionado del world es v1;
  la DB aislada `tmp/dev-headless-opencode.db` quedó con esquema v2). El dev app del usuario
  (vite :35771 + electron dev) toma el fix por HMR; queda confirmar visualmente ahí.
- Recursos: world dev-app-web detenido (puertos 5178/8778 libres), scratch
  `/tmp/opencode/design-chat-fix/` borrado; la DB del world quedó restaurada al estado previo.

## 2026-11-20 — Comandos de Design en `/` + skill/agente de sistema de marca
- Agregados comandos de app en `apps/app/src/react-app/domains/session/commands/catalog.ts`:
  `design` ("Diseño") y `marca` ("Sistema de marca"), con `group: "Design"`, detrás del flag
  `designStudio`. Iconos en `icons.ts` (Palette, Gem).
- `use-chat-commands.tsx`: handlers `design` (dispatch `openwork-open-design`) y `marca`
  (inserta `/diseno-marca `). `session-route.tsx` escucha el evento y navega a `/design`
  (gateado por `designStudio`).
- Menú `/` agrupa por `group` (renderiza encabezado "Design" en `composer.tsx`); `SlashCommandOption.group?`.
- Comandos de motor nuevos: `diseno-pagina`, `diseno-cambiar`, `diseno-doc` (además de
  `diseno-marca` existente) en `.opencode/commands/`.
- Skill `diseno-sistema-marca`, agente `disenador-de-sistemas-de-marca` y comando
  `/diseno-marca` en `.opencode/` (prompt de contexto incluido).
- Tests: `chat-commands.test.ts` actualizado a 13 comandos (5 pass). `pnpm typecheck` limpio.
- El fallo combinado en `composer-caret-refocus` es pre-existente (flaky de orden), no por mis cambios.
- Nuevo: editor de sistema ahora es documento continuo (todas las secciones apiladas en un scroll, nav con scrollspy por IntersectionObserver, click scrollea a la sección). `system-editor.tsx`. Tests de design en verde (20 + 33).
- F2/F5: nuevo `apps/server/src/designs/system-generators.ts` (tokensCss, tokensMd, componentMd, indexDts, bundleCss, systemManifest) y `designHtmlArchive` ahora incluye tokens.css, api/tokens.md, api/components/*.md, components/index.d.ts, components/bundle.css y manifest.json en el zip de sistemas. Test `gen-pack.test.ts` verde.
- Migración de consumidores a v2 completada con OpenCode (free, hy4-flash-free, --auto), supervisada y verificada. `DesignTokens`/`designTokensSchema` ahora v2; system-model, system-editor, system-sections, system-token-dialog, system-files, system-overview, system-context, templates migrados. typecheck (app+server) limpio, tests verdes, build:web OK. Práctica validada: usar CLI como cerebro/ejecutor y reparar lo que se rompa.
- Análisis de por qué Devin rompió/cortó: (1) cuenta out_of_quota (billing error) en tareas pesadas (blueprint, trabajo largo); (2) el modo `-p` (print) rechaza tool calls que requieren confirmación **a menos que se use `--permission-mode dangerous`** (con dangerous sí edita, probado). Conclusión: Devin sirve para tareas cortas/medianas con `--permission-mode dangerous`; para tareas largas preferir OpenCode (gratis). Práctica: si un CLI falla, lo arreglamos/cambiamos de herramienta, no asumimos que está bien. Nunca usar Claude Code.
- Recordatorio de práctica: esta app puede usar herramientas de CLI como Devin. Si algo funciona mal, lo arreglamos nosotros; esto es probar de manera real. Cuando usamos un CLI, lo que vemos roto lo arreglamos.
- Probe de capacidades: se hace solo cuando el usuario lo pide ("quiero configurar el CLI de X"). Resultado guardado en `.opencode/cli-capabilities/<cli>.md`. Después, si una tarea es acorde a las capacidades de un CLI disponible (según su probe), se delega automáticamente a ese CLI (sin re-probar). Nunca usar Claude Code. Comando: `/probe-cli <cli>`.
- Probe de Gemini: cuota excedida (429) en free tier → no usable ahora (retry ~6h). Requiere `--skip-trust` y `rg` en PATH. Guardado en `.opencode/cli-capabilities/gemini.md`.
- Nuevo: skill `cerebro-cli`, agente `cerebro-cli` y comando `/cerebro` en `.opencode/` — estrategia de usar un CLI gratis (OpenCode) como cerebro (razonamiento) y nosotros ejecutamos los tools, para no gastar tokens. Nunca usar Claude Code. Escalable: batch de análisis, caché de resultados, verificación mínima.
- Nuevo: skill `herramientas-cli`, agente `operador-cli` y comando `/cli` en `.opencode/` para usar CLIs (Devin, Claude Code, Codex) con supervisión y reparación. Incluye el prompt de contexto con la práctica acordada.

## 2026-11-22 — Visores de artefactos slides/sheet/board y flag comexArtifacts
- Reporte: el usuario no veía las pestañas de los visores de artefactos. Causa raíz doble: (1) `comexArtifacts` estaba off por defecto; (2) los visores `slides/sheet/board` (issue #8) no tenían ninguna ruta de creación — `createArtifactFromOutput` solo producía `doc`/`data`, y las salidas `table` (filas JSON) fallaban la validación de spec de panel (`422 invalid_artifact`), así que nunca se podía abrir una hoja.
- Fix 1: `comexArtifacts` default → `true` en `packages/features/src/registry.ts` (self-hosted; sigue off en cloud); test `comex-artifacts` actualizado; `packages/features` rebuildeado. `comexWorkspace` ya era true.
- Fix 2: `SheetView` ahora son pestañas reales (tablist + botones role=tab, solo hoja activa) en `apps/app/src/react-app/domains/artifacts/views/sheet-view.tsx`.
- Fix 3 (raíz): en `apps/server/src/specialists/artifacts.ts` se agregó `tableRowsToSheetContent` (filas JSON → `{sheets:[{id,name,cells}]}` con encabezado + celdas A1..); `createArtifactFromOutput` mapea salida `table` → artefacto tipo `sheet` con contenido convertido. Test nuevo en `apps/server/test/artifacts.test.ts`.
- Verificación: 7 smoke tests de views (slides/sheet/board + vacíos + switch de pestañas), 5 tests de servidor (artifacts + comex-artifacts), typechecks app y server limpios, builds de server y app:web OK. Smoke tests temporales borrados. Sin commit (regla del repo).
- Pendiente para el usuario: reiniciar el servidor de la app para que el proceso vivo tome el nuevo default/build (el proceso detectado en :3011 era viejo, del 19-11). Nota: el flag y el build están correctos; sin un artefacto `sheet` creado no hay pestañas que mostrar. Con el fix, abrir una salida `table` del mini-Studio en el panel genera el artefacto hoja con pestañas.

### 2026-11-22 — Diagnóstico en vivo (app Electron real, CDP :9823 / API :44129)
- El flag `comexArtifacts` YA estaba `true` en el proceso vivo (`/comex/features`); el bloqueo real era que no existía ninguna salida/artefacto y que una salida `table` se guardaba como `data` con filas crudas → `/artifacts/:id/resolve` responde 422 `invalid_artifact` y el panel no abría.
- Fix complementario en el front (sin reinicio, HMR verificado en el proceso vivo): `apps/app/src/react-app/domains/artifacts/views/table-to-sheet.ts` convierte filas JSON a `{sheets:[...]}`; `artifact-body.tsx` detecta artefactos `data` con contenido array y los renderiza con `SheetView` (pestañas) en vez de `DataView`. Test `artifact-body-sheet-fallback.test.tsx` (2 pass) + typecheck limpio.
- Se creó en la app una salida `table` de ejemplo y el artefacto `art-3bc166c0` ("Exportaciones de ejemplo", workspace multichurch) vía API autenticada. Para verlo: selector de aplicación → "Contexto, agentes y skills" → pestaña "Salidas" → "Abrir en el panel".
- El fix del servidor (table → tipo `sheet`) requiere reiniciar la app para artefactos nuevos; el fix del front ya cubre los artefactos `data` existentes.

## 2026-11-22 — Visor Markdown/MDX en páginas del chat
- Pedido del usuario: poner un visor md y mdx; aclaró que apunta a las **páginas del chat** (pestañas de recurso `page`), no a los artifacts (que ya tenían `MarkdownPreview`/`MdxPreview`).
- Implementado detrás del flag nuevo `chatPageMdMdxViewer` (self_hosted, default **false**, categoría workbot), declarado primero en `packages/features/src/registry.ts` y sincronizado al Helm (`features:sync` tras rebuild de `@openwork/features`; el dist viejo había impedido el primer sync). Helper `chatPageMdMdxViewerEnabled()` en `apps/server/src/comex/features.ts`, expuesto en `/comex/features` (`routes/core.ts`), tipado en `openwork-server.ts` y leído en `DesktopConfigProvider` con hook `useChatPageMdMdxViewerEnabled()`.
- `WorkspacePage` (`workspace-resource-view.tsx`): con el flag encendido agrega cabecera con toggle **Editar / Vista previa**; la vista previa usa `MarkdownPreview` para `.md`/`.markdown`/`.mmd` y `MdxPreview` (iframe sandbox, compile con `@mdx-js/mdx`) para `.mdx`. El editor sigue siendo el default. `resourcePagePath` respeta `.mdx`/`.markdown`/`.mmd` en vez de agregar `.md`.
- Verificación: typecheck app y server limpios; `features:check` OK; test de estado de pestañas ampliado y test nuevo `chat-page-md-mdx-viewer.test.tsx` (2 tests: sin flag solo editor; con flag markdown→mdx→volver a editar), 8/8 en esos dos archivos. Suite completa app: 2442 pass / 14 fail, todas pre-existentes y reproducidas en aislamiento (`mcp-app-frame`, `projects-list-page`, `session-stop-refresh`); `check:rust-readiness` falla por `designs/html-archive.ts` (R2 JSON.parse), archivo ajeno a este tramo.
- Commits: la parte de registry/servidor/tipo de cliente quedó incluida en `fa94b1cfd6` (commit concurrente de otro tramo que tocó los mismos archivos); el resto (UI, hook, tests, docs, Helm) en `ba3730b932`. No se hicieron commits de los cambios ajenos ni de la memoria. Para verlo: activar `DEN_FEATURE_CHAT_PAGE_MD_MDX_VIEWER=true` (o /admin) y reiniciar el servidor de la app; queda pendiente la comprobación visual en la app con el flag encendido. Docs en `docs/features/chat-page-md-mdx-viewer/README.md`.
- Nota: el `features:sync` también reflejó en Helm el flag `artifactSpreadsheetEditor`, que estaba declarado en el registry pero aún no sincronizado (cambio ajeno, generado correctamente).

## 2026-11-23 — Selector de elementos del navegador integrado
- Pedido del usuario: un botón tipo puntero, como Cursor/Windsurf, que al activarse resalte en azul el elemento bajo el cursor, permita comentar cada selección y la mande al chat para seguir escribiendo.
- Implementado detrás del flag nuevo `browserElementSelector` (self_hosted, default false, categoría computerUse): se declaró antes que el código, se buildeó `@openwork/features` y se sincronizó Helm. `browserElementSelectorEnabled()` en `apps/server/src/comex/features.ts`, expuesto en `/comex/features`, tipado en `openwork-server.ts` y leído en `DesktopConfigProvider` con `useBrowserElementSelectorEnabled()`.
- Núcleo en `apps/desktop/electron/browser-content-preload.cjs`: `installElementPicker()` vive en el mundo aislado; dibuja el contorno azul y una etiqueta con `getBoundingClientRect`, captura el clic (evitando la acción de la página), abre un input de comentario y envía el elemento por IPC. Escape cancela el comentario o sale del modo.
- Host en `browser-panel.mjs`: handlers `element-selector-enabled`, `element-selector-state`, `setElementSelector`, `element-picked` y `element-selector-exit`; valida que el mensaje venga de una pestaña con el picker activo, recorta campos y reenvía al renderer. Solo una pestaña puede tener el picker activo y se apaga automáticamente cuando el agente toma el control (`lockAgentViewport`).
- UI: botón con `MousePointer2` en la barra del navegador (`side-panel.tsx`, solo con el flag), textos nuevos en `es.ts`/`en.ts`, y `session-surface.tsx` inserta el elemento + comentario como chip de texto en el borrador. Tipos del puente en `desktop.ts`.
- Verificación: `features:check`, typechecks app/server, `node --check` de los tres archivos Electron, `check:electron` (43 métodos), tests del servidor (936 +1 aserción del flag), test nuevo `apps/app/tests/browser-element-picker.test.ts` (resaltado → comentario → IPC → Escape) y suite app 2444 pass / 13 fallos pre-existentes. `check:rust-readiness` sigue fallando por `designs/html-archive.ts` (ajeno).
- Sin commit. Docs y límites en `docs/features/browser-element-selector/README.md`.
- Ajuste pedido por el usuario al ver la captura: "debería verse siempre y usar solo si se quiere". Se pasaron `browserElementSelector` y `chatPageMdMdxViewer` a `default: true` en el registry (self_hosted); los flags siguen existiendo para apagarlos desde /admin o con `DEN_FEATURE_*=false`. Rebuildeado `@openwork/features`, Helm resincronizado, `features:check` y tests de features/ruta en verde. El usuario debe reiniciar la app una vez: los procesos vivos (server :8787, Electron :44129) tienen cacheado el default anterior y no tomaron el cambio. Con el default nuevo, el botón del puntero aparece justo después de "Volver a cargar" en la barra del navegador.
- **Decisión final del usuario (2026-11-23): "quita el flag, que sea por defecto activado y no pueda cambiarse".** Se eliminaron por completo `browserElementSelector` y `chatPageMdMdxViewer` del registry, de `apps/server/src/comex/features.ts`, de `/comex/features` (`routes/core.ts`), del tipo de `openwork-server.ts`, de los hooks/estado de `DesktopConfigProvider`, de la UI (`side-panel.tsx` y `workspace-resource-view.tsx`, ahora siempre visibles), del handler `element-selector-enabled` del main y del método del preload. Se actualizaron tests y docs (ya no mencionan flags) y se resincronizó Helm. Verificación: `features:check`, typechecks app/server, `node --check` de los tres archivos Electron, `check:electron`, 26 tests de features, test de `/comex/features`, 12 tests de UI/pestañas/picker. Docs: `docs/features/{browser-element-selector,chat-page-md-mdx-viewer}/README.md`. Commiteado en `75ddee70ee` (20 archivos). Sigue pendiente el reinicio de la app y la comprobación visual.

## 2026-11-23 — Fix: Enter del selector no agregaba el elemento al chat
- Reporte: con el picker activo, escribir el comentario y apretar Enter no insertaba el chip en el borrador.
- Diagnóstico por CDP (pestaña `dios-nuestro-padre.comunidad-iglesia.org`): el formulario del mundo aislado sí hacía submit y el main reenviaba `openwork:browser:element-picked` con el `sessionId` correcto; un observer nuevo en el renderer veía el evento, pero no aparecía el chip. Tras recargar el renderer sí aparecía.
- Causa: `SessionSurface` se reutiliza al cambiar de conversación y los tres efectos que registran `onAddToChat`, `onAddComment` y `onElementPicked` tienen deps `[]`; capturaban `props.sessionId` del primer mount y filtraban (`payload.sessionId !== props.sessionId`) todos los picks de la sesión nueva.
- Fix en `apps/app/src/react-app/domains/session/surface/session-surface.tsx`: `browserSessionIdRef` actualizado en cada render y usado por los tres callbacks. Verificación: typecheck app y 3 tests enfocados en verde; en vivo, cambiar de sesión y volver **sin recargar** ahora inserta el chip (`Pasted text · …`). Sin commit.
- Nota de estado: el tab del navegador pertenecía a `ses_dfcc3aa0…` y la ventana abierta mostraba otra sesión; con el tab de otra sesión `setElementSelector` devuelve `false` (no hay tab en pantalla para la sesión visible) y el botón parece no hacer nada. Es comportamiento esperado del registry, no un bug del picker.

## 2026-11-23 — Foto opcional del nodo en el selector (solo si se pide)
- Pedido del usuario: «estaría bueno que también pueda sacar una foto del nodo específico si es necesario», aclarado dos veces como **«la captura solo si es necesario, si el usuario lo pide»**. No hay captura automática.
- `browser-content-preload.cjs`: el cuadro de comentario del picker tiene un checkbox *Adjuntar captura del elemento*, **desmarcado por defecto** y reseteado en cada clic. Solo tildado, `commit()` calcula el rect viewport del elemento (`x/y/width/height` + `scrollX/scrollY`), oculta contorno y formulario antes de enviar el IPC y manda `capture`. Sin tildar, envía `capture: null`.
- `browser-panel.mjs`: `captureRegionFromPage()` valida `include === true`, coordenadas finitas, rect positivo y tope de 8192 px por lado; convierte a coordenadas de documento. Handler `element-picked` async: espera un turno de pintado (60 ms), usa `webContents.capturePage(region)`, agrega `screenshot` con data URL PNG y la reenvía; si falla, el chip de texto y el comentario llegan igual (best-effort).
- `session-surface.tsx`: `handleAttachFilesRef` actualizado por render (mismo patrón que `browserSessionIdRef`, porque el componente se reutiliza entre sesiones) convierte el data URL en `File` PNG y lo adjunta al borrador junto al chip. `desktop.ts` suma `screenshot?: string` a `BrowserPickedElement`.
- Verificación: `node --check` de los dos archivos Electron, `pnpm --filter @openwork/app typecheck` limpio y `browser-element-picker.test.ts` ampliado a 2 tests (sin captura → `capture: null`; con checkbox → rect delimitado), 2/2 en verde. No existe el script `check:electron` en `package.json` (sí en tramos anteriores de otra rama). Falta la comprobación visual en la app: tildar el checkbox y confirmar que el PNG aparece como adjunto; sin tildar, confirmar que no se toma foto. Sin commit.
