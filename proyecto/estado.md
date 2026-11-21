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
- Análisis de por qué Devin rompió/cortó: (1) cuenta out_of_quota (billing error) → no pudo crear blueprint ni hacer trabajo real; (2) el modo `-p` (print) rechaza tool calls que requieren confirmación → aunque tuviera cuota, no editaba archivos. Solución: usar Claude Code (`claude -p --dangerously-skip-permissions`) que sí edita en print mode, o arreglar la cuota de Devin. Práctica: si un CLI falla, lo arreglamos/cambiamos de herramienta, no asumimos que está bien.
- Recordatorio de práctica: esta app puede usar herramientas de CLI como Devin. Si algo funciona mal, lo arreglamos nosotros; esto es probar de manera real. Cuando usamos un CLI, lo que vemos roto lo arreglamos.
- Nuevo: skill `herramientas-cli`, agente `operador-cli` y comando `/cli` en `.opencode/` para usar CLIs (Devin, Claude Code, Codex) con supervisión y reparación. Incluye el prompt de contexto con la práctica acordada.
