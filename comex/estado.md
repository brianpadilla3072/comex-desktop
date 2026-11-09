# Memoria del proyecto

## Consigna y alcance
Pendiente de confirmar.

## Productos y destinos
Pendientes de decisión de la estudiante.

## Decisiones y supuestos
Sin decisiones registradas.

## Fuentes y evidencia
Ver fuentes.md y cumplimiento.md cuando existan.

## Trabajo de campo
Encuesta pendiente; no hay respuestas reales registradas.

## Próximos pasos
Confirmar alcance, productos y destinos.

## Desarrollo de la aplicación: rendimiento (2026-11-06)

Se midieron RAM y CPU en Electron real con perfil aislado y viewport de 1280 × 800; alcance y evidencia en `docs/comex/RENDIMIENTO-RAM-CPU.md`. No es una medición del instalador ni de inferencia. Se optimizó el catálogo de archivos con lotes de ocho lecturas de metadatos, conservando filtros y resultados. La comparación sobre 6.000 archivos y la validación se documentan en `docs/comex/RENDIMIENTO.md`. Queda pendiente investigar la convivencia de los motores antes de alterar su ciclo de vida. Esto no modifica el estado pendiente del trabajo de campo académico.

## Desarrollo de la aplicación: catálogo de modelos (2026-11-06)

Se implementó `comexModelGuide`: JSON incluido en el release, copia SQLite y observaciones locales por proveedor/modelo. La URL de actualización está vacía por defecto; puede fijarse en el JSON antes de publicar o con `OPENWORK_MODEL_CATALOG_URL`. Consulta diaria desde la aplicación, sin servidor externo ni agente. El selector distingue Go como suscripción y muestra fichas con datos del motor y seis barras; sin evidencia las barras son grises. No hay evaluaciones de inteligencia inventadas ni benchmarks integrados todavía. Mantenimiento y validación en `docs/features/comex-model-guide/README.md`. Esto no modifica los pendientes del trabajo académico ni el estado de la encuesta.

Ajuste del catálogo r2: selector y fichas compactos, doce ofertas con referencias de AA Intelligence Index v5.0.1 y escala editorial documentada. Tres endpoints gratuitos llevan asterisco de referencia al modelo base, sin asegurar identidad ni rendimiento del endpoint. Los modelos anónimos conservan `s/d`. La fecha exacta de ejecución no se inventa: se guarda la fecha de consulta y `measuredAt: null`.

Catálogo r3: se amplió a 18 ofertas con nivel y cinco fichas con N/A documentado. Los modelos con puntuación se muestran primero dentro de su proveedor o grupo de costos; se conserva el orden de favoritos, recientes y búsquedas. Sin evaluación se muestra “Sin datos”, sin un medidor gris que parezca nivel cero. Las referencias al modelo base siguen marcadas con asterisco.

Catálogo r4: a pedido del usuario se investigaron las 24 ofertas que faltaban, con 22 estimaciones editoriales separadas de las 18 referencias AA existentes. Se muestran ≈, rango, confianza y fuentes, con criterios publicados por oferta en `docs/features/comex-model-guide/investigacion-r4.md`. Big Pickle y Pulse Alpha mantienen ausencia de nivel por evidencia insuficiente. No se hicieron inferencias ni mediciones propias, y no se identifican los modelos stealth por rumores. Las estimaciones se distribuyen en el JSON incluido en el release; no se añade un servidor. Los pendientes académicos y la encuesta siguen sin cambios.

Selector: se agregó una comparación gráfica de inteligencia y costo al pasar sobre una fila. Punto grande = oferta actual, arriba = más capacidad, izquierda = menor costo para un ejemplo fijo de tokens. Go compara consumo de referencia y aclara la suscripción. Ofertas sin precio/nivel no tienen punto inventado; referencias y estimaciones no se mezclan. Una alternativa más barata solo se sugiere si alcanza el nivel, conservadoramente considerando los rangos estimados. Evidencia en `docs/features/comex-model-guide/model-guide-value.png`; pruebas de lógica e interfaz y typecheck completados. No cambia el estado del trabajo académico.

Ajuste confirmado por el usuario: conservar el aspecto y los colores de las barras, quitar los números de la fila y mostrar detalles al pasar sobre las barras. Implementado con demora de 250 ms y sin hover en el resto de la fila. La ficha incluye conclusión, alternativas con nombre y escala de costo fija; las recomendaciones evaluadas comparan valores originales, evitando equivalencias falsas entre modelos del mismo tramo. Pruebas y evidencia en `docs/features/comex-model-guide/README.md`. Sin cambios en los pendientes académicos.

Compositor: referencia visual aportada por el usuario aplicada en `comexWorkspace`, con esquinas redondeadas, adjuntos a la izquierda, modelo y menú directo de esfuerzo a la derecha. Solo se ofrecen variantes reales del catálogo; no confundir modos con nivel de inteligencia. Permisos de escritorio conservan consulta real, restricciones y confirmación antes de habilitar modo amplio; no se modificaron permisos. Dictado continúa sujeto a su disponibilidad nativa. Capturas y validación en `docs/features/comex-model-guide/README.md`. No se enviaron inferencias durante las pruebas. Sin cambios académicos.

El usuario aclaró que “modos” significa permisos, no esfuerzo de razonamiento ni perfiles de agente. Se añadieron los tres iniciales solicitados: Solicitar aprobación, Aprobar automáticamente y Acceso completo, más creación/duplicado/edición/eliminación de perfiles por proyecto. La plantilla Investigar permite lectura/web, bloquea edición y pregunta por comandos/exterior; se guardó como perfil sin activarla. Activar es una acción separada con revisión, exige proyecto inactivo y mantiene restricciones existentes. Integración nativa v2 verificada por metadatos y rechazo de excepciones de agentes que debiliten el modo, con reversión si no se confirma. No se modificaron los permisos activos del proyecto durante la validación. Evidencia en `docs/features/comex-permission-modes/README.md`. No cambia los pendientes del trabajo académico.

Ajuste confirmado: desactivar significa ocultar un modo sin borrarlo. Se implementó **Personalizar modos → Editar → Modo habilitado**, incluso para los tres iniciales; se conserva el perfil y los permisos actuales. “Crear modo personalizado” también se movió dentro de Personalizar modos. El selector solo muestra modos habilitados y la entrada de gestión; cada fila de gestión tiene Editar y las acciones secundarias quedan dentro del editor. Verificados ocultamiento persistente, recuperación, interfaz a 390 px, seis pruebas de servidor y typechecks. No se cambiaron los permisos activos del proyecto. Sin cambios en los pendientes académicos.

## Desarrollo de la aplicación: tareas programadas y complementos (2026-11-06)

Se aplicaron las dos referencias visuales aportadas por el usuario bajo el flag existente `comexWorkspace`, conservando el alcance general del producto. Tareas programadas incorpora lateral, búsqueda, filtro y seis ejemplos que precargan el editor. Complementos incorpora Personalizar, Habilidades, instalados, pestañas Públicos/Personales y catálogo en dos columnas sobre los datos existentes. No se instalaron complementos ni se programaron tareas durante la verificación. Evidencia y límites de las capturas en `docs/features/scheduled-tasks-complements/README.md`. Sin cambios en los pendientes académicos.

## Desarrollo general de la aplicación: objetivos y continuidad (2026-11-06)

El alcance del producto es general; Comercio Exterior es una aplicación o pack,
no una restricción del producto. Se añadió `taskContinuity`, con objetivos por
conversación, criterios, límite de turnos y continuaciones usando exactamente
`opencode/big-pickle`. El servidor guarda extractos automáticos sin sobrescribir
los checkpoints manuales, pausa ante detención o admisión incierta y conserva
el estado al reiniciar. El mismo chat puede ir a un worktree y volver manteniendo
su hogar persistente; retirar un worktree requiere que esté limpio, integrado
y sin conversaciones que lo usen. Los cambios de código requieren un turno de
revisión; los informes no. Se corrigió la propagación local de la credencial de
host y la verificación de movimientos asíncronos. Evidencia, capturas, límites y
pruebas en `docs/features/task-continuity/README.md` y `verification.json`. El
servidor debe permanecer abierto para continuar objetivos. No se generó un
instalador ni se publicó un release. Esto no modifica los pendientes académicos.

## Desarrollo general de la aplicación: navegación y disposición (2026-11-06)

A pedido del usuario se inspeccionó la aplicación actual y se adaptó la estructura a la referencia: barra de iconos permanente con cuenta al pie, panel contextual, menús superiores, Proyectos y Recientes, pestañas visibles y Resultados/Fuentes con memoria y herramientas desplegables. Se conserva el control existente `comexWorkspace` y el alcance general del producto. Tareas programadas y Complementos no duplican el árbol de proyectos ni conservan encima el panel derecho del chat. Evidencia y límites de validación en `docs/features/workspace-navigation/README.md`. Validación en navegador de escritorio y móvil sin enviar mensajes ni cambiar permisos; no se generó instalador. Sin cambios en pendientes académicos.

## Memoria por niveles (2026-11-06)

El usuario confirmó los niveles conversación, proyecto y aplicación, con conversación por defecto, y pidió implementarlos. Se agregó `comexScopedMemory`: SQLite local y panel Memoria con los tres niveles para agregar, editar y borrar notas. Conversación se aísla por chat/proyecto; proyecto usa su carpeta canónica de origen; aplicación se comparte entre proyectos de la misma instalación e identidad autenticada de conexión. No se extrae memoria del historial ni de texto citado/pegado: órdenes directas con contenido concreto como “recordá en proyecto: usar euros” se guardan al admitir un prompt v2 y producen un recibo de nivel y contenido para la confirmación del agente. Las notas previas se conservan en Notas anteriores. Evidencia y límites en `docs/features/comex-scoped-memory/README.md`. Pasaron 21 pruebas de backend, typechecks, comprobación de banderas y verificación de creación/persistencia/edición/eliminación en navegador y móvil. Los ejemplos de prueba se retiraron; no se enviaron inferencias. Esto no cambia los pendientes académicos ni acredita respuestas de encuesta.

## Comandos del compositor (2026-11-06)

El usuario pidió definir e implementar los comandos de la referencia y medir código/escala. Aclaró que OpenCode debe seguir siendo el dueño de la ejecución, salvo herramientas propias de la app. Se agregó `comexChatCommands`: presentación y alias en el menú `/`, sin otro motor, historial, registro de ejecución ni base de datos. Archivar/bifurcar/lateral reutilizan las operaciones existentes de OpenCode; Compactar llama a session.compact; Iniciar prepara `/init` nativo mediante el envío normal; MCP/Estado consultan datos existentes, incluyendo límites Go/Console cuando se informan. Fijar usa la preferencia de lateral existente. Boceto PNG, copia HTML revisable y mascota son herramientas locales. No hay publicación ni enlaces públicos automáticos. Se conserva el catálogo nativo y sus comandos de plugins con `:`. La bifurcación vacía se bloquea conforme al rechazo real del motor, y no se agrega una prohibición propia de compactar durante actividad. Evidencia, límites, métricas y 26 pruebas en `docs/features/comex-chat-commands/README.md`. La validación no ejecutó modelos ni `/init`. Sin cambios en los pendientes académicos.

## Desarrollo general: pestañas de herramientas (2026-11-06)

El + abre Nueva pestaña, separado de Nuevo chat, siguiendo la referencia completa del usuario. Se conectaron archivos, páginas Markdown, terminal, navegador nativo y chat lateral a una barra común, con metadatos y borradores por servidor/proyecto/cuenta. El guardado de páginas nuevas usa `createOnly` con aprobación y creación exclusiva para conservar archivos existentes, incluido un conflicto concurrente. Evidencia, siete pruebas, typechecks y límites de las pruebas del puente nativo en `docs/features/workspace-resource-tabs/README.md`. No se reinició un servidor compartido, se enviaron mensajes, se generó instalador ni se modificaron permisos. Sin cambios en los pendientes académicos.

## Tarjeta compacta del chat (2026-11-06)

A pedido del usuario se agregó Resultados/Fuentes a la derecha del chat, detrás de `comexWorkspace`, con datos del historial y pestañas asociadas a la conversación. Fuentes separa aportes del usuario y muestra miniaturas; Ver todo amplía la lista y las imágenes. Los botones + reutilizan nueva pestaña y adjuntos del borrador. Reserva espacio en pantallas amplias; los paneles completos y el chat dividido conservan su disposición. Typecheck de la app y verificación headless del componente con datos de prueba; sin enviar mensajes ni subir archivos reales. Captura y límites en `docs/features/session-resources-card/README.md`. Sin cambios en pendientes académicos.

## Fuentes como pestaña y menú de contexto (2026-11-06)

El usuario corrigió la referencia: Ver todo abre una pestaña Fuentes, y + ofrece Usar complementos / Adjuntar archivos o carpetas. Se reemplazó el diálogo completo por una pestaña identificada por chat y con lectura del historial nativo, aislada por conexión e identidad. Lista adjuntos, rutas disponibles y llamadas reales de herramientas; no inventa rutas para imágenes que solo conservan datos. El menú anidado con búsqueda reutiliza catálogo y acciones del compositor, y lleva los archivos elegidos al borrador. Las carpetas se aportan como archivos adjuntos, sin permiso persistente. Conectar complementos abre la administración existente. Se conserva comexWorkspace. Seis pruebas de estado y verificación headless con fixtures; captura y límites en docs/features/session-resources-card/README.md. Sin mensajes, cargas ni conexiones reales; sin cambios en pendientes académicos.

## Feedback visual de agentes (2026-11-06)

El usuario pidió reproducir la actividad visual de sus capturas y confirmó Subagentes dentro de la tarjeta Resultados/Fuentes. Se incorporaron tiempo encima del turno, filas compactas de herramientas con comando/salida desplegables, avisos compactos de tareas delegadas, compactación respaldada por estado/eventos nativos y resumen de subagentes entre Resultados y Fuentes. El resumen abre una pestaña Subagentes por chat, con lista, detalle, estado y comandos del hijo elegido. Se preservan conversaciones y acciones nativas, el mapa previo y el alcance general del producto. Los recuentos distinguen trabajando/listos/esperas/errores/detenidos/sin confirmar. Sin otro motor u orquestador. Typecheck y ocho pruebas de estado; verificación headless con componentes reales y fixtures, sin lanzar investigación ni agentes reales. Capturas y límites en docs/features/execution-feedback/README.md. Bun no disponible para el ejecutor antiguo. Sin cambios en pendientes académicos.

## Estado propio de OpenWork fuera de `.opencode` (2026-11-08)

El usuario reportó que al usar la app, los archivos que creaba caían dentro de la carpeta `.opencode` del proyecto elegido y pidió que nada toque esa carpeta. Reproducción con el servidor real: los adjuntos de chat se guardaban en `<proyecto>/.opencode/openwork/inbox`, el outbox y el audit legacy vivían ahí, y el motor OpenCode v2 nacía con el cwd heredado de la app (lanzada desde comex-desktop), tratando el repo como su proyecto. Se movió todo el estado propio de OpenWork a `<proyecto>/.openwork/` (inbox, outbox, chat-attachments, pdf-pages, audit de respaldo y openwork.json), con lectura de las rutas viejas solo para compatibilidad; nuke limpia ambas y los archivos de workspace archivegan/restauran `.openwork/openwork.json` migrando el legacy al restaurar. El spawn del motor v2 ahora recibe un cwd de trabajo bajo el storage de runtime, nunca el folder de arranque. Para el control pedido estilo Codex: con comexWorkspace activo, un archivo creado con nombre sin carpeta se guarda en `comex/proyecto/<sesión>/` dentro del proyecto elegido, y la instrucción del proyecto ordena al agente crear sus archivos ahí y nunca dentro de `.opencode` ni fuera del proyecto; sin proyecto asignado el documento queda como borrador local hasta elegir destino. Verificado con servidor real en /tmp (adjunto y escritura con aprobación cayeron en `.openwork` y `comex/proyecto/…`, `.opencode/openwork` ausente, cwd del motor neutralizado); typecheck de server y app sin nuevos errores (queda el error preexistente en session-route.tsx y el test engine-cold-start que requiere red, ambos sin relación). No se tocó el `.opencode` nativo del motor (skills/agents/plugins/opencode.json del pack). Sin instalador ni release. Esto no modifica los pendientes académicos.

## División de la conversación con otra página (2026-11-08)

El usuario pidió que en una conversación la primera pestaña sea la conversación y, si hay más páginas, aparezca un botón para dividir y elegir cuál va del otro lado. En la barra común de pestañas se agregó el botón “Dividir” (solo con una pestaña abierta además de la conversación): al activarlo quedan la conversación a la izquierda y la pestaña elegida a la derecha, y seleccionar otra pestaña cambia la del lado; la conversación y la página lateral quedan ambas marcadas como actuales. Al elegir la conversación o cambiar de proyecto se comporta como antes. No es el chat lateral compacto existente; es una superficie completa al lado del chat. Verificado con tres pruebas de render (botón solo aparece con segunda página, aria-pressed y resaltado doble en split, resaltado único sin split), seis pruebas de estado de pestañas y typecheck de app y server (queda solo el error preexistente de session-route.tsx). Sin instalador ni release; no se tocó el sandbox de permisos. Esto no modifica los pendientes académicos.

## División ajustable y ubicación de botones (2026-11-08)

Se agregó divider arrastrable entre la conversación y la página del split (20–80%, se guarda en localStorage, ajustable también con flechas del teclado; columna en pantallas chicas, fila en grandes). A pedido del usuario con captura: el botón del extremo derecho del header pasó a ser SOLO el icono Dividir (sin texto) cuando hay una segunda pestaña; “Open side” (que muestra/oculta el panel derecho de contexto — no divide) se movió como icono chico al final de la barra de pestañas. Sin segunda pestaña, el extremo derecho conserva Open side. Tres pruebas de render actualizadas a la nueva API y typecheck de app sin errores nuevos. Sin instalador ni release. Sin cambios en pendientes académicos.

## Scroll del panel derecho sutil (2026-11-08)

A pedido del usuario con captura: la barra de scroll del panel derecho (Resultados/Fuentes) era la nativa de Chromium, gruesa y con flechas. Se agregaron reglas en comex-shell.css escopadas a [data-comex-side-panel]: delgada (8 px), thumb redondeado casi invisible que se marca al pasar por el panel, sin botones de flecha. No afecta otras barras. Cambios en vivo vía HMR en la ventana de dev. Sin cambios académicos.

## Release desde main con builds Linux y Windows (2026-11-08)

El usuario pidió subir a main y que pasen las dos compilaciones, incluida Linux. La corrida 1.0.16 en dev falló en Linux por un 504 intermitente de GitHub Releases al descargar el sidecar OpenCode (curl sin reintentos; mismo 504 que se vio localmente). prepare-sidecar.mjs ahora reintenta 5 veces en curl y usa MaximumRetryCount en PowerShell, así Windows y Linux son tolerantes al CDN. Se canonicé comex-release.yml a la versión de main (dispara con push a main, versión 1.0.<run> o input explícito, jobs prepare/validate/build linux+win/publish); dev mantiene el mismo archivo, por lo que las corridas por dev dejan de publicar y la publicación vive solo en main. main recibe el merge de dev (estado.md, workflows y docs consolidados). Release esperado: v1.0.<run> con artefactos linux y win. Sin cambios en pendientes académicos.

## Distribución de escritorio y actualizaciones (2026-11-07)

El release automático pasó de `dev` a `main`. Cada push a `main` que toque `apps/`, `packages/`, `pack/`, `scripts/` o la configuración de build compila y publica Windows x64 (NSIS `openwork-win-x64-<versión>.exe`) y Linux x64 (AppImage), con versión `1.0.<número de ejecución>`. El workflow manual permite forzar otra versión `1.0.N`. Se publicó la versión 1.0.14 (run 42432159410): `latest.yml` apunta a `1.0.14` y `comex-release.json` informa `latestAppVersion: 1.0.14`. La app instalada consulta `releases/latest/download` cada 15 minutos y se actualiza sola. Los binarios siguen sin firma de código (`SIGN_WINDOWS=false`), por lo que Windows puede mostrar el aviso de SmartScreen. Pendiente: fijar `main` como default branch y, si se desea, configurar firma (Azure Trusted Signing ya cableado, o certificado PFX). No cambia los pendientes académicos ni el estado de la encuesta.

## Fix Windows: descarga del sidecar sin parámetros incompatibles (2026-11-08)

El run de main 1.0.18 pasó Linux (los reintentos de curl funcionaron) pero falló Windows: mi `-RetryIntervalSec` no existe en PowerShell 5.1 del runner (NamedParameterNotFound). El fallback ahora usa curl.exe con los mismos reintentos en Windows y deja Invoke-WebRequest clásico como último recurso; la extracción quedó separada en su propia llamada. Se vuelve a subir a main para publicar con las dos plataformas. Sin cambios académicos.

## Fix crítico: plugins del server fuera del asar (2026-11-08)

Al instalar el release 1.0.14 (AppImage) en esta máquina, la app mostró "OpenWork couldn't start": el server arrancaba pero al levantar el motor crasheaba con `ERR_MODULE_NOT_FOUND` sobre `app.asar/server/dist/opencode-plugins/openwork-chrome-devtools.js`. Causa: `electron-builder.base.yml` excluía `server/dist/opencode-plugins/**` del asar (dejándolos solo en extraResources para el motor), pero cuatro módulos del server (`opencode-v2-browser-bridge/context-bridge/read-adapter/background-questions`) los importan estáticamente. Este bug estaba también en 1.0.19 y explica el cuadro del amigo en Windows (no motor, no navegador, no tools, no api): la app bootea y solo falla al iniciar el motor, que el smoke de Windows no ejercitaba. Fix: los JS quedan dentro del asar y solo se excluye `*.wasm` (pdfium); extraResources sigue dando los archivos reales al motor vía `openworkPluginPath`. Publicado como 1.0.20 tras verificar el AppImage nuevo arrancando el motor en esta máquina. Queda pendiente reforzar el smoke para que ejercite engine-start, no solo el arranque de la ventana. Sin cambios académicos.

## Auto-actualización desde la pantalla de arranque roto (2026-11-09)

El bug: cuando la app no puede arrancar (pantalla "OpenWork couldn't start"), el updater nunca chequea el feed — el poller de 15 minutos vive en la UI sana (electron-updater-state montado desde Settings), así que una build rota no puede repararse sola (huevo-gallina). En loading-overlay.tsx la pantalla de error ahora pregunta al feed directamente por IPC (openwork:updater:check, handler ya registrado en updater.mjs) y ofrece "Update to X and restart" con progreso de descarga y botón de reintento; usa download()/installAndRestart() existentes. El tipo onDownloadProgress se agregó al bridge canónico (desktop.ts) con la firma exacta que ya usaba electron-updater-state. Solo app.isPackaged: en dev el check devuelve unavailable y no se muestra. Typecheck de app sin errores nuevos. Las builds ya instaladas y rotas (1.0.14/1.0.19 del amigo) no pueden beneficiarse: necesitan instalar 1.0.21 a mano; desde 1.0.21 en adelante, cualquier rotura futura de arranque puede autorrepararse. Esto no modifica los pendientes académicos.

## Fix real del asar: re-inclusión explícita de plugins (2026-11-09)

1.0.20/1.0.21 seguían crashando (ERR_MODULE_NOT_FOUND de openwork-chrome-devtools.js) porque la negación `!server/dist/opencode-plugins/*.wasm` de electron-builder 26.18 no se comportó como documentaba: el folder seguía fuera del asar en CI. Verificado además que `@electron/asar list` por CLI trunca silenciosamente en asares enormes — las mediciones correctas usan la API del módulo (`listPackage`). Fix definitivo en base.yml: excluir `!server/dist/opencode-plugins/**` del glob recursivo y re-incluir la carpeta explícitamente con la forma objeto `from/to/filter: **/*.js` (la misma ya probada para node_modules). Comprobado con build local `electron-builder --dir`: el asar quedó con 42 entradas de plugins, devtools presente, 0 wasm adentro. Queda pendiente confirmar en el release de CI (1.0.22) que el AppImage no crash al iniciar el motor con workspace. Sin cambios académicos.

## Prueba de runtime: 1.0.22 pendiente de CI, fix confirmado en ejecución (2026-11-09)

La build local empaquetada (linux-unpacked, misma config del fix) en entorno 100% aislado (HOME falso sin opencode de sistema): 0 ERR_MODULE_NOT_FOUND, motor "Engine folder warmed", deps del motor sembradas desde el tgz, y api/model + api/provider responden 200 — el camino que crasheaba en 1.0.14/1.0.19/1.0.20/1.0.21 funciona. Un falso "Couldn't load your models" observado antes fue contaminación de mi seed de server.json, no bug. Falta la verificación final del asar del AppImage de CI v1.0.22 con la API del modulo (42 entradas esperadas). Sin cambios académicos.

## Fix puente navegador en AppImage (500 en provider/model) (2026-11-09)

Con el asar arreglado, la app empaquetada ya no crashea pero el modo "OpenCode instalado" devolvía 500 en api/provider y api/model en cada arranque posterior al primero. Causa: installed-browser escribía en el proyecto `.opencode/plugins/comex-browser/server.js` con un import absoluto hacia adentro del `app.asar` de la monta efímera del AppImage (`/tmp/.mount_XXXX`, cambia en cada corrida, y el daemon suelto de todos modos no lee adentro del asar); su guard de integridad rechazaba reescribirlo, dejando un plugin roto permanente → el engine 500eaba. Fix: el plugin se buildea self-contained (bun build → dist/opencode-plugins/comex-installed-browser-plugin.js, via la carpeta que ya es extraResources), install() copia ese bundle a una ruta estable (runtimeStorageDir/installed-browser/plugin.mjs) y server.js referencia esa ruta — idéntica entre corridas; y si el archivo existente es nuestro (MARKER) pero su import ya no existe en disco, se reescribe (migración de mounts viejos), mientras las ediciones a mano siguen rechazándose. Tests: 3/3 +1 nuevo de migración, tsc server ok. Pendiente: validar con el release que salga (1.0.23) que provider/model responden 200 en la AppImage instalada. Sin cambios académicos.

## Resiliencia de descargas CI ante incidentes de GitHub (2026-11-09)

El release 1.0.23 (puente estable) falló dos veces seguidas en CI por 504 de GitHub en sus release-assets (sidecars de sst/opencode y toolset AppImage de electron-builder) — incidente que también se vio en local durante todo el día. No es un bug del código: validate/prepare verdes, publish skipped, tag inexistente. prepare-sidecar ahora reintenta 10 veces cada 20s (curl y curl.exe) para sobrevivir cortes cortos. El release queda pendiente de una corrida verde; el puente estable ya está en main listo para publicar. Sin cambios académicos.

## Resiliencia de descargas CI ante incidentes de GitHub (2026-11-09)

El release 1.0.23 (puente estable) falló dos veces seguidas en CI por 504 de GitHub en sus release-assets (sidecars de sst/opencode y toolset AppImage de electron-builder) — incidente que también se vio en local durante todo el día. No es un bug del código: validate/prepare verdes, publish skipped, tag inexistente. prepare-sidecar ahora reintenta 10 veces cada 20s para sobrevivir cortes cortos. El release queda pendiente de una corrida verde; el puente estable ya está en main listo para publicar. Sin cambios académicos.
