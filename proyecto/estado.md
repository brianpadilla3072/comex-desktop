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
