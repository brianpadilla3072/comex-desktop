# Paneles vivos y tareas programadas — manual de diseño

> Estado: **plan**. Ninguna de estas habilidades existe todavía en la distribución local.
> Este documento es el manual de cómo funcionaría cada una, qué se espera de ella
> por sí sola, y cómo se conectan en conjunto para el escenario objetivo:
> *"investigá este tema → mostrame los datos en un panel → actualizalo cada 20
> minutos consultando las mismas fuentes → que quede como tarea/skill"*.

Cada habilidad se construye sobre código que **ya está en el repo** (se indica
dónde). La regla de diseño general: ninguna pieza habla con la nube de Den para
ejecutar; todo es self-hosted bajo flags de `packages/features/src/registry.ts`.

---

## Mapa de componentes

```text
                    (persona pide)              (persona enseña / repite)
                        │                              │
                        ▼                              ▼
              Herramientas de motor            specialist_propose
              (plugin comex-library,           (propuestas que la
               aplican directo)                 persona acepta/descarta)
                        │                              │
   ┌────────────────────┼──────────────────┬───────────┘
   ▼                    ▼                  ▼
[2] DATASETS ──alimenta──▶ [3] PANELES     [5] CAPTURA
   │                        (vista viva)     (skill + tarea + panel
   │                                          como propuesta unida)
   │                                              ▲
   ▼                                              │
[1] SCHEDULER ──"reejecutar dataset X, refrescar panel Y"──┘
   (cada N minutos, durable, sobrevive reinicio)
        │
        └──▶ [4] MCP APPS LOCAL (loopback) — vía opcional de renderizado
             interactivo de paneles (fase D+; no bloquea 1–3)

[6] FUENTES Y CITAS ──ancla todo texto generado (chat, [7], paneles):
    cada salida citable referencia fuentes con id + ancla clickeable.
[7] SALIDAS (mini-Studio) ──consumen [2]+[6]: mapa mental, informe,
    flashcards/quiz, tabla comparativa — todas con citas, todas archivos.
```

Flujo de datos por escena:

```text
research (Tavily) ──▶ comex/datasets/<id>/query.json + snapshots/<ts>.json
                            │                         ▲
                            ▼                         │ re-ejecución
                     panel .panel.json ────▶ scheduler dispara el runner
                     (render en artifacts/         (cada 20 min)
                      chat en vivo)
```

## Referencias del mercado (noviembre 2026)

Qué hacen los tres productos parecidos y qué lezione toma este plan:

- **Gemmas de Gemini / Custom GPTs** = configuración guardada inyectada al abrir
  el chat: instrucciones + archivos de conocimiento (RAG, 10–20 archivos) +
  acciones (esquemas OpenAPI / apps conectadas). No son software nuevo. Google
  está **eliminando Gems** (17-nov → 17-dic 2026) para convertirlas en **skills
  invocables con `/nombre` desde cualquier chat**: valida la arquitectura
  nuestra de aplicación = contexto + agentes + skills compartidos, en vez de
  "asistente en compartimento".
  *Lección anti-patrón:* el RAG de Gems **cae en el conocimiento general del
  modelo en silencio** cuando nada matchea el archivo — por eso "mi Gem ignora
  mi documento". Nuestros paneles y datasets nunca imitan eso: ver "fallar en
  voz alta" en [3].
- **Artefactos de Claude** = contenido autocontenido (HTML/React/SVG) que el
  host monta en iframe de origen opaco con CSP estricto (`connect-src 'self'`):
  no puede tocar red ni credenciales por sí mismo. En 2026 crecieron a:
  (a) artefactos con **conectores** — el widget pide tools MCP *al runtime*,
  con las credenciales del **espectador**, aprobadas por el usuario la primera
  vez; (b) **storage persistente** pago (20 MB texto); (c) artefactos que
  **llaman al modelo** desde la página (mini-apps); (d) templates como punto de
  partida (Docs/Slides/Design) en vez de hoja en blanco.
  *Validación:* nuestro [4] (MCP Apps local) es el mismo patrón: sandbox opaco
  + puente de tools read-only como única ventana.
- **Lo que NO tiene ninguno** — y es nuestro diferenciador: Gems/GPTs/Artefactos
  refrescan solo cuando el usuario abre o pide. **Ninguno** tiene scheduling
  durable local sobre fuentes ([1]) ni **línea de datos re-ejecutable** con
  snapshots e historia ([2]).

---

## [1] SCHEDULER — tareas periódicas locales

**Qué es.** Un ejecutor de tareas con horario dentro de `apps/server`, sin
dependencia de Den. La unidad es una **tarea programada**: un prompt (o una
acción estructurada) que corre cada N minutos/horas/días, o a una hora dada.

**Maquinaria que ya existe y se reusa:**

- `apps/server/src/task-continuity.ts` — loop `setInterval` de 3 s con estado
  persistente en SQLite (`createWorkspaceKvStore`, tabla `task_continuity`) que
  ya sabe despachar prompts al motor por HTTP autenticado (`…/prompt`,
  `delivery: "queue"`). El scheduler es esencialmente este mismo loop con un
  criterio de vencimiento (`nextRunAt <= now`) en lugar de "el chat quedó idle".
- `packages/automations/src/tick.ts` (`selectDueAutomations`) y
  `@openwork/types/automation-schedule` (`nextAutomationOccurrence`,
  `recoverableAutomationOccurrence`) — matemática pura de schedules con
  recuperación de corridas perdidas. Importable directo; hoy solo la usa Den.
- `apps/server/src/task-recovery.ts` — precedente de re-prompt durable tras
  reinicio.

**Qué se espera de ella (contratos):**

- **Granularidad en minutos** — a diferencia de Automations de cloud (mínimo 1
  hora), soportar `{ every: 20, unit: "minutes" }`, además de daily/weekly/once.
- **Durable (implementado, enmendado tras revisión)**: el *estado* de tareas vive en
  `specialists/<app>/tasks.json` (patrón proposals.ts, serializado por aplicación, claim
  CAS antes de despachar) en vez de la tabla KV — no gana nada con SQLite aquí; la
  *evidencia* de cada corrida es un archivo del proyecto: `comex/tareas/<taskId>/runs/<ts>.json`
  (auditable, git-eable). Un reinicio del server retoma: si `nextRunAt` quedó atrás,
  corre una vez y registra `missed` (coalescing, nunca ráfaga); una corrida que pisa a
  otra en curso queda como `skipped_overlap` (una línea por claim).
- **Honesto sobre el apagado**: si la PC estuvo apagada, la próxima corrida es
  ya; no se finge cumplimiento. UI muestra "última corrida / próxima / errores".
- **Contexto de corrida**: cada corrida crea (o reusa, según política) una
  sesión en el workspace de la aplicación, guarda la salida, y deja evidencia
  consultable: `comex/tareas/<taskId>/runs/<ts>.json`.
- **Concurrencia**: una tarea no corre dos veces a la vez (claim antes de
  despachar, igual que continuity). Si la corrida anterior sigue andando, se
  saltea y marca `skipped_overlap`.
- **Límites**: máx. de tareas activas por aplicación, timeout por corrida,
  paleta de errores (fuente caída, motor no disponible) con backoff.
- **Permisos**: una tarea heredará los permisos del workspace; no puede
  escalarlos. El prompt guardado se muestra completo en la UI antes de activar.

**API y UI esperadas:**

- Rutas: `GET/POST /specialist-applications/:id/tasks`,
  `PUT/DELETE …/tasks/:taskId`, `POST …/tasks/:taskId/run-now`,
  `GET …/tasks/:taskId/runs`.
- UI: sección "Tareas programadas" por aplicación (junto a "Contexto, agentes y
  skills"), con lista, próximo disparo, historial de corridas, pausar/reanudar.
- Flag nueva: `scheduledTasks` (self_hosted, on por defecto con la feature).

**Herramientas de motor (vía el puente `comex-library` existente):**

- `specialist_task_create` { prompt, schedule, dataset?, panel?, name } — con
  pedido explícito aplica directo.
- `specialist_task_list` / `specialist_task_update` / `specialist_task_pause`.
- `specialist_propose` acepta `kind: "task"`.

**No es / no hace:** no es un cron de sistema (las instrucciones del turno ya
prohíben escribir cron/systemd como sustituto); no ejecuta UI; no decide sola
cuándo crearse (eso lo proponen las herramientas de captura).

---

## [2] DATASETS — investigaciones con identidad

**Qué es.** El faltante estructural más chico y más importante: hoy la
evidencia de research es un archivo JSON suelto en
`comex/fuentes/tavily/<uuid>.json` sin registro de *qué consulta* la produjo.
Un **dataset** es esa consulta hecha objeto: fuente + parámetros + snapshots
sucesivos. Es el contrato que permite "consultar **las mismas** fuentes".

**Dónde se apoya:** `apps/server/src/specialists/integrations/research-factory.ts`
ya ejecuta las queries por CLI de Tavily y guarda evidencia con symlink-guard;
solo cambia *dónde* y *con qué metadata* la guarda. La persistencia sigue siendo
archivos en el workspace (inspeccionables, versionables con git), no una BD.

**Estructura esperada (por workspace):**

```text
comex/datasets/<id>/
  dataset.json        # nombre, pregunta, herramienta+parámetros de la consulta,
                      # providers usados, createdFrom (sesión/turno), schema aprox.
  query.json          # la consulta re-ejecutable tal cual (params + filtros)
  snapshots/<ts>.json # cada corrida: retrievedAt, evidencePath, datos ≤ 1 MiB
  LATEST -> snapshots/<ts>.json
```

**Qué se espera:**

- **Re-ejecutable**: correr `query.json` otra vez produce un snapshot nuevo sin
  que nadie reconstruya el prompt. El runner del scheduler usa exactamente esto.
- **Inmutable por snapshot**: los datos históricos nunca se pisán; un panel o un
  informe puede citar `snapshots/2026-11-09T14:20Z` y seguir siendo verídico.
- **Linaje**: cada snapshot sabe de qué dataset vino y qué tarea (si la hubo) lo
  produjo; cada dataset sabe en qué chat nació.
- **Registro por aplicación**: manifiesto `comex/datasets/index.json` para que
  `specialist_dataset_list` sea barato.
- **Límites**: tamaño de snapshot (1 MiB como el host de MCP Apps), retención
  configurable (por defecto 50 snapshots), todo escrito con los mismos guards
  anti-symlink que `research-factory`.

**API y UI esperadas:**

- Rutas: `GET …/datasets`, `GET …/datasets/:id` (con snapshots),
  `POST …/datasets/:id/refresh` (corre la consulta una vez ya mismo).
- UI: pestaña "Datasets" — lista con última actualización, botón "Actualizar",
  vista del último snapshot como tabla.
- Herramientas de motor: `specialist_dataset_create` (desde parámetros de
  consulta), `specialist_dataset_list/read`, `specialist_dataset_refresh`.
  `research` pasa a **registrar automáticamente** cada consulta grande como
  dataset candidato (propuesta si no fue pedido, directo si el usuario dijo
  "guardá estos datos").

**No es / no hace:** no es una BD ni un data-frame con transformaciones; si la
IA necesita limpiar/transformar, escribe un script que *lee* el snapshot y
*produce* un dataset derivado (otro `<id>` con `derivedFrom`). Eso mantiene la
re-ejecución trivial.

---

## [3] PANELES — visualización viva de datasets

**Qué es.** La vista. Un panel es un archivo declarativo del workspace que
describe gráficos/tablas/tarjetas **sobre un dataset** (o varios). La IA lo
genera y lo edita; el renderizador de la app lo monta y se refresca solo cuando
cambia el snapshot.

**Por qué no alcanza con el HTML estático de hoy:** el artifact
`HTMLPreview` (`…/domains/session/artifacts/preview.tsx`, iframe
`sandbox="allow-scripts"`) funciona como fallback pero es one-shot: no tiene
puente de datos, no se refresca cuando el archivo de datos cambia, y depender de
CDNs para charts es frágil offline. El repo **no tiene ninguna librería de
gráficos**; la primera dependencia nueva del feature es `echarts` (o
`vega-lite`) empaquetada en la app, sin CDN.

**Formato esperado (`*.panel.json` en el workspace):**

```jsonc
{
  "panel": "cotizaciones-soja",
  "title": "Soja — última 40 sesiones",
  "source": { "dataset": "soja-tavily" },          // o "file": "ruta/ok.csv"
  "refresh": { "watch": "latest" },                 // se repinta al cambiar el snapshot
  "blocks": [
    { "type": "stat",    "field": "cierre", "agg": "last" },
    { "type": "line",    "x": "fecha", "y": ["cierre"], "title": "Precio" },
    { "type": "table",   "limit": 20, "sort": { "by": "fecha", "desc": true } },
    { "type": "markdown", "text": "Fuente: {source.dataset.query.question}" }
  ]
}
```

**Qué se espera:**

- **Render determinista**: `panel.json` + snapshot → mismos pixels. Sin código
  arbitrario de la IA en el camino (nada de `<script>` propios; eso es [4]).
- **Vivo sin recargar**: un watcher (el `reload-watcher.ts` del server ya
  observa archivos del workspace) notifica; el render reléé `LATEST` y se
  repinta. Ver "última actualización: hace 4 min".
- **Editable en el chat**: "pasá la línea a barras" → la IA edita el
  `panel.json` con `specialist_panel_write`; el panel se repinta solo.
- **Edición directa desde la vista** (patrón "Edit with Claude" / comentarios
  sobre el canvas): seleccionar un bloque del panel (una columna de la tabla,
  un título, un gráfico) y pedir el cambio sobre *ese* bloque — la request viaja
  al chat con la ubicación exacta, sin describir a mano qué se quiso decir.
- **Plantillas de panel por aplicación**: la biblioteca ya ofrece plantillas de
  agente/skill; el panel nace de una plantilla (`timeline + tabla + stat`,
  `comparativa de series`, `monitoreo de precios`) que la IA instancia y adapta,
  no de hoja en blanco (lección de los templates de Claude, y del hecho de que
  los templates reducen paneles genéricos).
- **Fallar en voz alta**: si el snapshot no existe, está viejo o no matchea el
  schema, el panel **lo dice** (badge "sin datos desde hace 2 h — reintentar" /
  "columna `cierre` no encontrada"), muestra la tabla cruda del último snapshot
  y el error, nunca pantalla blanca y **nunca completa con memoria del modelo**
  (anti-patrón del RAG silencioso de Gems).
- **Abrible en dos superficies**: como pestaña del panel de artefactos
  (clasificador nuevo en `classifyOpenTarget`: `kind: "panel"`) y fijable para
  que quede visible mientras se charla (la infra de *retained surface* de los
  tiles de dashboard ya demuestra el patrón, aunque hoy esté gated en Den).
- **Fallback**: un bloque que no puede resolverse se degrada a sí mismo (muestra
  el error en ese bloque, no en todo el panel).

**API / herramientas de motor:**

- `specialist_panel_write` { name, spec } / `specialist_panel_list/read/delete`
  — mismas reglas que la biblioteca: directo si fue pedido, propuesta si se
  enseñó de paso.
- El panel es un archivo **de la aplicación**, no del proyecto: vive en
  `specialists/<app>/panels/` y se materializa en los proyectos con el mismo
  `specialist-sync.json` de la biblioteca (con protección `.nuevo`).

**No es / no hace:** no es un BI con filtros interactivos complejos (eso es [4]);
no corre lógica de la IA en el render; no hace consultas por sí mismo — *siempre*
lee datasets, nunca llama a Tavily directo (esa es la costura con [1]/[2]).

---

## [4] MCP APPS LOCAL — paneles interactivos de segunda generación

**Qué es.** El upgrade ambicioso: que un panel pueda *interactuar* (clickear un
punto, pedir drill-down, apretar "Refrescar ahora" desde el propio widget). El
host ya existe y es serio: `mcp-app-frame.tsx` (iframe opaco `allow-scripts`,
puente postMessage MCP Apps, auto-size, resultado→widget) más
`mcp-app-host.ts` del server (resuelve recursos `ui://` por `resources/read`,
CSP deny-by-default, límites 512 KiB/1 MiB). Su doc acepta **loopback HTTP**.

**Qué faltaba (y ya existe, ver "Implementado (celda D)"):** todo el *productor*. El host solo
resuelve recursos de servidores MCP remotos configurados (no stdio), y quien genera las apps de
workflow es `ee/apps/den-api` (`workflow-artifact-app.ts`) — nube. Los plugins
de motor (comex-research, comex-library) registran tools nativas de OpenCode,
que **no pueden colgar recursos `ui://`**.

**Cómo se conecta (diseño esperado):**

- El server abre un **MCP server propio en `127.0.0.1:<puerto>`** (Streamable
  HTTP), proyectado como conexión MCP del workspace con token scoped del mismo
  estilo que el descriptor de `library-tool-api.ts`.
- Expone tools `readOnlyHint: true` sobre las piezas locales:
  `dataset_read`, `dataset_refresh`, `panel_snapshot`, y una tool
  `dashboard_render` con `_meta.ui.resourceUri` a un `ui://openwork/panel/v1`.
- El recurso `ui://` es un HTML self-contained determinista (generado del
  `panel.json` por el mismo compiler que usa [3]) que habla MCP Apps: recibe el
  structuredContent del snapshot y puede pedir drill-downs vía sus propias
  tools (el host ya restringe: solo tools del servidor de origen, read-only).
- Beneficio: los paneles de [3] pasan a renderizarse **inline en el chat** con
  datos vivos, y queda el mismo camino que "generated apps" de Den pero
  self-hosted.

**Qué se espera (guardrails):**

- Sin ejecución de código de la IA en el widget: la IA genera *spec*, un
  compiler emite el HTML. (Si algún día se deja HTML arbitrario, es solo con
  CSP empty-network como el doc de workflow-artifacts exige.)
- El widget no puede mutar nada: escribir sigue siendo territorio de [5]/biblioteca.
- Loopback nada más: nunca expuesto fuera de 127.0.0.1; el token, 0600, mismo
  patrón que `/specialist-tool`.

**Es fase D+: no bloquea el escenario central.** "Cada 20 minutos" + panel que
se repinta se logra con [1]+[2]+[3]; [4] agrega interactividad dentro del widget.

**Implementado (celda D).** La pieza quedó así, toda local:

- `apps/server/src/specialists/panel-app.ts` — el productor que faltaba:
  - Endpoint MCP en `POST /specialist-mcp` (Streamable HTTP, respuestas JSON), **solo loopback**
    (rechaza cualquier otro host) y autenticado con el **mismo token scoped por proyecto** que ya
    usa el puente de tools: un proyecto, una credencial, ningún secreto nuevo.
  - Tools **read-only**: `dashboard_render` (con `_meta.ui.resourceUri`), `panel_snapshot`,
    `panel_list`, `dataset_list`, `dataset_read`. No hay tool de escritura ni de refresh: mutar
    sigue siendo territorio de la biblioteca, las tareas y [7].
  - Recurso `ui://openwork/panel/v1`: HTML **determinista** (mismos bytes para todos los paneles y
    proyectos), self-contained, sin red (`connectDomains` vacío ⇒ CSP deny-by-default), sin `eval`,
    sin código de la IA. El server **pre-computa cada bloque** con la misma semántica del panel
    (`panelAggregate`), así que el widget solo pinta: ni una fórmula duplicada en JS.
  - Handshake MCP Apps completo (`ui/initialize` → `ui/notifications/initialized`,
    `tool-input`/`tool-result`, `size-changed`) y un botón "Actualizar" que re-llama
    `dashboard_render`; click en una fila abre su detalle. Fallar en voz alta: un resultado con
    error o un panel inexistente pinta el motivo, nunca una tarjeta en blanco.
- **Proyección**: al guardar un panel (y en cada preparación de turno) el server escribe
  `mcp.openwork-panels = { type:"remote", url: …/specialist-mcp, headers: {Authorization}, oauth:false }`
  en la config runtime del workspace. Idempotente; con la flag apagada **borra** la entrada. El
  motor v2 real se conecta (`/api/mcp` → `status: connected`) y el catálogo de MCP Apps la lista.
- **Chat**: el plugin de resultados v2 ahora preserva el resultado de una llamada **directa** a un
  App de primera parte (`openwork-panels_*` con `_meta.ui.resourceUri`), no solo las de Code Mode,
  así la tarjeta abre con datos vivos. El widget solo puede llamar tools del mismo server y
  read-only: el host ya lo restringe.
- **Límite de tamaño**: el resultado del tool viaja bajo el tope de 1 MB del host; si un panel no
  entra, primero se recorta la tabla (el bloque dice "Mostrando X de Y filas") y, si ni así entra,
  la tool responde con el motivo en vez de mandar una tarjeta a medio serializar.
- **Flag**: `specialistPanelApps` (default on self_hosted; apagarla con
  `DEN_FEATURE_SPECIALIST_PANEL_APPS=false`). Requiere también `specialistPanels`.

**Límite explícito:** el widget no refresca datasets (eso dispara una consulta real) y no puede
pedirle nada al modelo; D++ sigue fuera de alcance.

**Opción D++ (anotada, no comprometida):** los "artifacts que llaman a Claude"
(de claude.ai) sugieren un panel que *pregunta al modelo sobre sus propios datos*
("resumime esta serie") desde el propio widget. En nuestro caso sería una tool
no-readOnly del MCP loopback que abre un turno en el chat con el contexto del
panel; requiere UI de aprobación por turno y por eso queda fuera del plan inicial.

---

## [5] CAPTURA — cómo la IA *aprende* todo esto sin que le pidan

**Qué es.** La costura con la biblioteca existente (`specialist_propose`,
`proposals.ts`, `library-plugin.ts`) para que el escenario "se enseña solo"
funcione con las piezas nuevas.

**Regla heredada (idéntica a la biblioteca):**

- **Pedido explícito → aplica directo**: "creame una tarea que actualice esto
  cada 20 min" → `specialist_task_create` + `specialist_dataset_create` +
  `specialist_panel_write`, todo junto, y responde con la ficha creada.
- **Enseñado de paso → propuesta**: si el usuario repitió dos veces "traé los
  aranceles de X y hacé una tablita", la IA arma **una propuesta compuesta**
  { skill "traer-aranceles-X" + dataset (query capturada) + panel + schedule },
  que la persona acepta/descarta desde la misma sección de propuestas.

**Qué se espera de los tipos nuevos de propuesta:**

- `kind: "task"` lleva prompt + schedule + datasets/paneles referidos; al
  aceptar, se valida contra el scheduler y queda **pausada por defecto** hasta
  confirmación (una tarea que corre sola sin que nadie la vea correr una vez es
  la receta para datos fantasma).
- `kind: "panel"` y `kind: "dataset"`: al aceptar, se crean por la misma API
  validada (rutas contenidas, límites de tamaño, como `library.ts`).
- Las propuestas compuestas son atómicas o dicen qué parte falló.

**Instrucciones del turno** (en `instructions.ts`): agregar la doctrina — "los
datos que se consultan de nuevo viven en datasets; las vistas que se repiten
viven en paneles sobre datasets; lo periódico vive en tareas; nunca escribas
cron ni scripts sueltos como sustituto; si no hubo pedido explícito, proponé."

---

## [6] FUENTES Y CITAS — el ancla de confianza (patrón NotebookLM)

**Qué es.** NotebookLM (hoy "Gemini Notebook", rebrand de julio 2026) se
diferencia de los chatbots generales por una sola mecánica: **responde solo
desde tus fuentes y cada afirmación lleva una cita clickeable que salta al
párrafo exacto**. Nosotros ya acumulamos ese material sin darle identidad:
`comex/fuentes/tavily/<uuid>.json` es evidencia cruda que nadie puede citar.
[6] convierte la evidencia en **fuente citable de primera clase** — es la base
de confianza que también necesita [7].

**Estructura esperada:**

```text
comex/fuentes/
  index.json                  # registro por aplicación: id, provider, consulta
                              # que la produjo (dataset?), retrievedAt, título
  <uuid>.json                 # el payload ya guardado por research-factory
  <uuid>.chunks.json          # opcional: texto chunked con offsets para anclas
```

**Qué se espera:**

- **Sintaxis de cita estable**: `[fuente:<uuid>#<n>]` emitida por la IA en
  cualquier salida larga (respuesta de chat, informe, bloque de panel). Un
  post-procesador en el render del markdown (el pipeline existe:
  `markdown-primitive.ts`) la transforma en **chip numerado clickeable**.
- **Lectura sin salir de la app**: clic en el chip abre un lector en el panel de
  artefactos (pestaña nueva `source` en `classifyOpenTarget`) posicionado en el
  chunk citado, con "abrir evidencia cruda" debajo.
- **Modo anclado (grounded)** por aplicación, una línea de instrucción +
  política en `context.md`: *"respondé solo desde fuentes del dataset X; si no
  está, decilo y citá qué fuentes tienen información cercana"*. Es lo inverso al
  anti-patrón de Gems: la negación explícita ("no lo sé") es un feature, no un
  fallo.
- **Fuentes vivas opcionales**: una fuente puede apuntar a un archivo local del
  workspace (PDF, planilla) o a un snapshot de dataset — igual que Gems mantiene
  vivos los Docs de Drive, un `file:`-source refresca su índice cuando cambia.
- **Integridad**: la cita nunca miente — el ancla se valida al renderizar; si el
  chunk no existe, el chip muestra "fuente modificada desde la cita", no se
  pierde. Nunca se cita un número de página que no se leyó.
- **Costo**: lectura/registrado son operaciones de archivo; el chunking se hace
  on-demand la primera vez que algo cita la fuente.

**API y herramientas de motor:**

- `GET …/sources`, `GET …/sources/:id` (por aplicación).
- `specialist_source_read` { id, chunk? } — la IA lee de vuelta el ancla antes de
  citar (obligatorio en el doctrinal de `instructions.ts`: *no se cita de memoria*).
- research-factory pasa a registrar automáticamente cada evidencia en `index.json`
  con back-reference a la consulta/dataset que la produjo (misma escritura
  endurecida contra symlinks que hoy).

**No es / no hace:** no es un índice vectorial ni un RAG nuevo — el material
demás lo provee [2] y el motor; [6] solo da identidad, anclas y UI de cita.

## [7] SALIDAS — el mini-Studio sobre nuestro material

**Qué es.** NotebookLM produce del mismo material **nueve salidas** (Audio/Video
Overview, Slides, Mind Map, Reports, Flashcards, Quiz, Infographic, Data Table).
La idea a robar no es cada formato sino la mecánica: **una sola fuente de
verdad → muchas formas de digerirlo, generadas de a una, con costo anunciado antes de
correr**. [7] es un set de habilidades plantillas + una tool de motor que las
instancia sobre datasets/fuentes, con las citas de [6] atravesadas.

**Catálogo inicial (mapeado con lo que ya sabemos renderizar):**

| Salida | Qué produce | Dónde renderiza | Esfuerzo |
|---|---|---|---|
| **Mapa mental** | `*.mmap.md` con fence `mindmap` | **Mermaid ya instalado** (`mermaid-zoom-viewport.tsx`, zoom + fullscreen + SVG descargable) | bajo — la puerta de entrada |
| **Tabla comparativa** | dataset → `table` de `panel.json` | panel de [3] | bajo (ya planificado) |
| **Informe** (briefing / guía / artículo / "create your own") | markdown con citas [6] + TOC | `MarkdownPreview`; exportable a docx | medio (plantillas de sección) |
| **Flashcards / Quiz** | `*.cards.json` (Q/A + cita + dificultad) | tipo de panel nuevo, pasar con keyboard; CSV export | medio |
| **Slide deck** | `.pptx` generado | artifact preview externo / download | alto — último |
| **Audio Overview** (Deep Dive/Brief/Critique/Debate dos hosts) | guion generado por la IA → TTS local → mp3 en el workspace | descarga / compartir | experimental, fase E |

**Qué se espera:**

- **Todo salida es un archivo del workspace** (`comex/salidas/<id>/`), no estado
  efímero de nube: versiona en git, viaja en el pack exportado, se puede abrir
  con cualquier otra app. Es la ventaja estructural contra NotebookLM (allá el
  audio/video viven en Google; acá son tuyos).
- **Toda salida cita o dice que no citó**: el informe sin [fuente:] muestra
  advertencia "no anclado a fuentes" — coherencia con fallar-en-voz-alta de [3].
- **Costo anunciado**: antes de generar (informe largo, deck, audio, o corrida
  programada de [1]) la UI muestra la estimación y confirma — el patrón "AI
  Usage bar" de NotebookLM que según sus usuarios "cambia cuánto experimentás".
  En nuestro caso la métrica es tiempo de modelo/local, no quota cloud, pero el
  efecto es el mismo.
- **Parametrizable**: cada plantilla recibe {fuentes/datasets incluidos, foco,
  extensión, idioma} — como los focus prompts de NotebookLM. La tool de motor
  recibe esos parámetros, no un prompt libre re-inventado cada vez.
- **Regenerable**: regenerar la salida después de un refresh del dataset
  ([1]+[2]) re-usa la misma plantilla — es el puente natural entre "actualizame
  los datos cada 20 min" y "regalme el informe al final del día": tarea
  programada cuya acción es regenerar una salida.

**Herramientas de motor:**

- `specialist_output_generate` { kind, from: [dataset|source ids], focus?, length?, lang? }.
- Las plantillas viven en la biblioteca de la aplicación ([5] las puede proponer:
  "así me gusta el briefing" → nueva plantilla custom).

**No es / no hace:** no clona Video/Infographic (dependen de generación de
imagen/video cloud); no guarda estado aparte de los archivos; no genera código
nuevo por salida — usa las plantillas renderizables existentes.

---

## El conjunto: el escenario completo, corrido

> **Usuario:** "Investigá cómo viene la exportación de soja a China y armame un
> panel con los datos."
>
> 1. `tavily_research` (research plugin) → la IA ve que es información viva y
>    registra **dataset** `export-soja-china` con su `query.json` [2].
> 2. Escribe `panels/export-soja.panel.json` sobre ese dataset [3] → la app lo
>    abre como pestaña, con tabla + línea + "última act. 15:02".
>
> **Usuario:** "Ok, pero que se actualice solo cada 20 minutos con las mismas
> fuentes."
>
> 3. Pedido explícito → `specialist_task_create` { schedule: every 20m,
>    action: refresh dataset `export-soja-china` } [1]. La tarea queda visible
>    en "Tareas programadas" con próxima corrida.
> 4. Cada corrida: runner re-ejecuta `query.json` → snapshot nuevo en [2] → el
>    watcher notifica → el panel de [3] se repinta solo. El chat **no** se llena
>    de mensajes: las corridas dejan evidencia en `comex/tareas/<id>/runs/`.
> 5. Reinicio de la PC a la mañana: el scheduler coalesce las corridas perdidas,
>    corre una y muestra "3 corridas perdidas, actualizado 08:15" [1].
>
> **Usuario (dos semanas después):** "Cada lunes hacé lo mismo pero con trigo."
>
> 6. Sin pedido explícito de guardarlo → **propuesta compuesta** [5]: skill
>    "panel-semanal-trigo" + dataset + tarea. El usuario la ve en la sección de
>    propuestas y acepta.
>
> **Usuario (en cualquier momento):** "Resumime qué dice la investigación" /
> "armame un informe con las conclusiones."
>
> 7. La IA lee los snapshots del dataset (que saben a qué **fuentes** [6]
>    apuntan) y responde con chips `[fuente:…]` clickeables que abren el
>    pasaje exacto de la evidencia; el informe sale por `specialist_output_generate`
>    [7] como markdown con TOC, **cada claim citado o marcado "no anclado"** —
>    y si un dato no está en las fuentes, dice que no está (modo grounded).

**Invariantes del conjunto (lo que hace que sea "muy dinámico como Gemini" sin
volverse anárquico):**

- **Un solo camino hacia las fuentes**: todo refresh pasa por datasets; ningún
  panel ni tarea "recuerda" cómo consultar — la consulta es datos, no memoria.
- **Vista ≠ ejecución**: los paneles leen snapshots; los que consultan son el
  runner y el research plugin. (En [4], el widget pide vía tools read-only del
  mismo server.)
- **Todo es archivos del workspace** inspeccionables: `comex/datasets/`,
  `panels/`, `comex/tareas/` — auditable, git-eanable, portable en el pack.
- **Cero credenciales embebidas**: `query.json`, `task` y `panel` guardan
  *parámetros*, nunca tokens/keys — la re-ejecución usa las integraciones vigentes
  de la aplicación (lección del modelo de Claude: las acciones corren con las
  credenciales de **quien mira/ejecuta**, no del autor). Por eso exportar un pack
  con paneles y tareas a otra máquina es seguro; si una fuente exige clave nueva,
  el refresh **falla en voz alta** y pide conectar el provider, no inventa datos.
- **La persona siempre manda**: directo solo ante pedido explícito; lo demás,
  propuesto; las tareas aceptadas nacen pausadas; nada toca permisos.
- **Self-hosted de punta a punta**: cero dependencias de Den; `packages/automations`
  entra como librería, no como servicio.

## Fases de construcción sugeridas

| Fase | Pieza | Apalancamiento en código existente | Riesgo |
|---|---|---|---|
| A | [1] Scheduler | task-continuity loop + packages/automations math + KV store | bajo |
| B | [2] Datasets | research-factory (solo cambia destino+metadata) | bajo |
| B2 | [6] Fuentes y citas | index sobre los `comex/fuentes/*.json` ya escritos + `markdown-primitive` (chips) + artifact panel (lector) | medio (UI de cita, validación de anclas) |
| C1 | [3] Paneles declarativos | artifact panel + reload-watcher + classifyOpenTarget | medio (1 dep nueva: charts) |
| C2 | [5] Captura ampliada | proposals.ts + library-plugin (extender kinds) | bajo |
| C3 | [7] Salidas mini-Studio | mapa mental = **mermaid existente**; tabla = [3]; informe = markdown preview; flashcards = tipo de panel | bajo–medio (deck y audio quedan fuera) |
| D | [4] MCP Apps local | mcp-app-host completo (loopback ya permitido) | alto (MCP server propio + compiler de ui://) |
| E | Audio Overview local | guion por la IA + TTS local externo al repo | experimental (fuera del plan inicial) |
| F1–F5 | Backlog alineado (abajo) | extienden [1][2][5][6][7] — todo es archivo + instrucciones | bajo–medio |

Cada fase con su flag en el registry (`scheduledTasks`, `specialistDatasets`,
`specialistPanels`, `specialistSources`, `studioOutputs`, `specialistLocalApps`)
y sus pruebas al estilo de `test/specialist-library.test.ts` (CRUD + propagación
+ autenticación + flujo de rutas con arnés de dispatcher).

## Verificación de salida esperada (test de aceptación del conjunto)

Un solo test de integración que: crea dataset con query fake determinista →
tarea every-20-min (relojeable) → avanza el tiempo → snapshot nuevo → el
`panel.json` resuelto por el renderer produce los datos del snapshot 2 →
reinicio simulado del server coalesce y corre una → y la propuesta compuesta
aceptada produce el mismo estado. Extendido con [6]/[7]: la evidencia queda
registrada en `index.json`, una salida `mindmap` y un informe generado desde
el dataset citan `[fuente:…]` cuyas anclas resuelven, y una afirmación sin
fuente sale marcada como no anclada. Ese test es la definición de "funciona en
conjunto".

## Backlog alineado (top 5, después de A→C3)

Lo que sigue sumó la revisión "¿rompe el sentido de la app?": todo es
archivo + instrucciones, sin superficies nuevas grandes, y conserva las tres
leyes (la persona manda, todo auditable, self-hosted). Ordenadas por retorno
por unidad de esfuerzo:

1. **Sources locales** (extiende [6]) — un dataset o informe puede anclarse a
   material que la persona arrastra al workspace (PDF, XLSX, web guardada), no
   solo a evidencia de research. Mismo grounding de NotebookLM sin nube: el
   índice de `comex/fuentes/index.json` acepta entradas `file:` con chunking
   on-demand, y las citas funcionan idéntico. Requiere un extractor de texto
   (PDF) — lo demás ya existe.
2. **Diff de snapshot** (extiende [1]+[2]) — cada corrida del runner marca
   *qué cambió* desde el snapshot anterior ("+2 filas, -1 fuente caída, precio
   X ±3%") como archivo `comex/datasets/<id>/diffs/<ts>.json`. Es lo que hace
   útil el histórico y da gracia al badge "actualizado hace 4 min" del panel:
   sin diff, refrescar es solo ruido; con diff, la tarea periódica cuenta la
   noticia. Puro comparador de JSON, sin UI nueva (un bloque `stat` más en [3]
   con "cambios desde la última corrida").
3. **Ensayo de tareas** (dry-run, extiende [1]) — antes de activar (y desde la
   UI de toda tarea), "probala una vez": corre el prompt mostrando qué tools
   usaría y qué escribiría, con persistencia desactivada (flag de sesión).
   Costo: pasar un modo `dryRun` por el despachador existente de
   task-continuity y un aviso en el tool-bridge que bloquea escrituras. Es la
   respuesta directa al miedo legítimo de "dejo que esto corra solo cada 20
   minutos".
4. **Presupuesto de corrida** (extiende [1]+[7]) — al crear la tarea o generar
   una salida, estimación honesta: turnos por corrida × tokens del prompt
   guardado → "≈ N MB de snapshots/día, M corridas hasta el límite de retención".
   Se apoya en los contadores de uso que el motor ya expone por sesión; se
   muestra junto al toggle de activar (patrón "AI Usage bar" de NotebookLM,
   adaptado: acá el costo es local, así que se expresa en tiempo y espacio, no
   en quota).
5. **Generador de skills desde OpenAPI** (extiende [5]+[6]) — la persona pega
   la URL de un endpoint (o un JSON OpenAPI), la IA lee el schema y **propone**
   un pack mínimo: skill de consulta (con parámetros), dataset cuya
   `query.json` apunta a esa API vía fetch autenticado con las credenciales del
   usuario (guardadas como integración, nunca embebidas), y panel sobre el
   resultado. Es la versión local y auditable de las "Actions" de los Custom
   GPTs: mismo poder, pero la consulta queda como archivo re-ejecutable que
   viaja en el pack — no como configuración opaca en una nube.

**Descartes explícitos de esta revisión** (para que quede la razón, no solo la
lista): generadores de video/infografía cloud (front-end de suscripciones),
marketplace interno de paneles (problema de confianza de código ajeno; el pack
ya resuelve compartir), colaboración multiusuario en tiempo real (es otro
producto), agentes autónomos permanentes sin pedido explícito (rompe "la
persona manda" — el ensayo + presupuesto de este backlog cubren el mismo caso
de uso con transparencia).

Estas cinco entran como fase **F1–F5** después de C3, cada una con su flag
(`sourcesLocalFiles`, `snapshotDiffs`, `taskDryRun`, `taskBudgets`,
`openapiSkills`) y tests al mismo estilo.
