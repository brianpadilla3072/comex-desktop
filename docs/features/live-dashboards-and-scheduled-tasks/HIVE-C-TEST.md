# HIVE-C-TEST — Probando el recorrido completo "live-dashboards" como persona real

**Estado: trabas C-1 y C-2 CORREGIDAS** (orquestador: mensaje honesto para
dataset sin correr; `chunks.length` en el lector de pasajes). Test de usuario
`specialist-live-user.test.tsx` (15 tests / 85 asserts) en verde.

Rol: *front tester* de la celda C. Un solo recorrido de punta a punta: menú →
diálogo con **todas** las flags encendidas → propuestas → tareas (Correr ahora) →
datasets (error de refresh, dataset solo-consulta) → fuentes (lector de pasajes) →
paneles (bloques + fallo por proyecto) → salidas (auditoría) → y, por cada familia,
un 500 para ver si la app miente. Todo con fetch mockeado con las formas JSON reales
de `apps/server/src/specialists/routes.ts`. No modifiqué código de producción. No
commiteé nada.

- Test escrito: `apps/app/tests/specialist-live-user.test.tsx` — **15 tests, 85
  asserts, todos en verde** (`cd apps/app && bun test tests/specialist-live-user.test.tsx`).
  No cambié ni una línea de componentes para que pasen.
- El resto de la suite de especialistas sigue verde con este archivo incluido
  (los 7 tests anteriores de `specialist-*.test.tsx` no se tocaron).

## Qué funciona

- **Paso 1 — todas las flags:** el ítem del menú se llama "Contexto, agentes y
  skills" y el título del diálogo lista las seis secciones
  ("Contexto, agentes y skills · Tareas · Datos · Fuentes · Paneles · Salidas de
  Taller"). El home muestra los seis resúmenes **con contenido real** (fila de
  tarea, fila de dataset, fila de fuente, fila de panel, fila de salida, agentes y
  skills con conteo), no placeholders. El título deja de ser mentiroso — el fix de
  la traba 6 de HIVE-A-TEST llegó.
- **Paso 2 — propuestas:** la de tarea muestra badge "Tarea" + "Se crea PAUSADA ·
  Cada 20 min"; la de plan muestra badge "Plan" + "Al aceptar se aplican: skill +
  dataset + panel + tarea pausada". Al aceptar el plan, el panel "Resultado de la
  propuesta aceptada" muestra `✓ skill`, `✗ panel — La spec del panel no valida…`,
  `✓ tarea`: la pieza fallida se nombra con su detalle, sin desaparecer en un
  "aceptado" mentiroso.
- **Paso 3 — Correr ahora:** abrir "Corridas" antes de correr muestra "Sin corridas
  todavía."; tras el POST de run-now (`started:true`), el GET de runs **vuelve a
  salir** (conteo de requests antes/después) y la fila manual nueva aparece con
  badge "corriendo" + "a pedido" + notice "Corrida iniciada…". La invalidación de
  `["specialist-task-runs", …]` funciona.
- **Paso 4a — refresh que falla:** con un 422 del provider, el mensaje accionable
  ("Conectá Tavily desde Herramientas y fuentes para investigar.") se ve en el
  `role="alert"`; no hay notice de éxito y el conteo de snapshots no cambia.
- **Paso 4b — dataset solo-consulta (`latest: null`):** abrir el detalle de un
  dataset con `lastSnapshotAt: null` / 0 snapshots **no rompe la vista** (se lee
  "0 snapshots en el proyecto:", el título y la fila siguen vivos). Con una
  salvedad: ver traba C-1.
- **Paso 5 — fuentes:** el lector muestra las anclas `[fuente:src_soja_1a2b3c4d#0]`
  y `#1` con el texto de cada pasaje; la fuente con 0 pasajes se lee en su fila
  como "sin pasajes indexados todavía". Con una salvedad menor al abrirla: ver
  traba C-2.
- **Paso 6 — paneles:** el panel abierto dibuja stat (491, último cierre), línea
  SVG, tabla ordenada desc por fecha y bloque "Cambios desde la última corrida"
  ("+1 nuevo"). El segundo workspace muestra **en voz alta**
  `Este panel no se puede dibujar acá: El dataset "search-precios-soja" no existe
  en este proyecto.` — sin pantalla blanca. Y un bloque `line` sobre una columna
  no numérica dice "Este gráfico no tiene valores numéricos para dibujar (columna
  ausente o no numérica)" en vez de un gráfico mudo.
- **Paso 7 — salidas:** los tres estados de auditoría son distinguibles: válida
  ("✓ 1/1 citas resuelven a pasajes reales del proyecto."), sin anclas ("Sin
  anclas: esta salida no está anclada a fuentes del proyecto.") y rota ("1 cita no
  resuelve: [fuente:src_rota#3]. No la des por buena sin revisarlas.").
- **Paso 8 — honestidad ante 500 (8a–8g):** para **cada** familia (propuestas,
  tareas, datasets, fuentes, paneles, salidas) el resumen muestra su error +
  "Volver a intentar" y **nunca** el copy de lista vacía ("Sin tareas programadas.",
  "Sin datasets todavía.", "Sin fuentes todavía.", "Sin paneles todavía.", "Sin
  salidas todavía."). Los fixes de HIVE-A (tareas) y HIVE-B (B-1, datasets) están;
  las demás familias ya tenían la rama `isError`. Y un 500 de **biblioteca** muestra
  su banner ("No se pudo leer la biblioteca; el resto … sigue disponible.") sin
  secuestrar el diálogo: tareas y datos siguen visibles — el bug de
  `library-dialog.tsx:80` que marcó HIVE-A está corregido.

## Dónde me trabo

1. **Paso:** abro un dataset que nació de una propuesta (solo-consulta, sin ningún
   snapshot todavía) en "Datos de investigación". **Qué pasa:** el detalle dice
   "0 snapshots en el proyecto:" y abajo, en el `<pre>`, leo literalmente
   **`null`**. Sé que el dataset todavía no corrió, pero el `null` es jerga de
   programador: no dice qué hacer ni por qué está vacío. **Qué faltaría:** un
   mensaje honesto cuando `latest` es null ("Todavía no tiene snapshots: se
   genera con el primer Actualizar / al correr la tarea que lo creó"), en vez de
   volcar el JSON crudo (traba C-1).

2. **Paso:** en "Fuentes citables" abro "Ver pasajes" de una fuente con 0
   pasajes (la fila ya decía "sin pasajes indexados todavía"). **Qué pasa:** se
   abre un cuadro vacío — un `<ol>` sin ítems, sin ningún texto. La fila de arriba
   sí lo dice, así que no es una mentira, pero el detalle está mudo. **Qué
   faltaría:** el fallback "Sin pasajes: la evidencia guardada no tiene texto
   largo para dividir." ya existe en el código, pero nunca se dispara porque
   `chunks: []` es truthy; con `chunks.length` alcanzaría (traba C-2).

## Bugs UI encontrados (documentados, no arreglados)

- **C-1 `library-dialog.tsx:272-276 + 357` — `null` crudo para un dataset
  solo-consulta.** `detail` con `latest: null` pasa por `previewText(null)` →
  `JSON.stringify(null)` → `"null"`. La vista no se cae (paso 4b en verde), pero
  el "0 snapshots" + `null` es la versión blanda de mentir: el usuario ve un
  literal de código en vez de "todavía sin ejecutar". Repro: datasets view → abrir
  `search-aranceles-nueva-5e6f7a8b` (0 snapshots) → leer el `<pre>`.
- **C-2 `library-dialog.tsx:434` — detalle de fuente con 0 pasajes queda en blanco.**
  `detail.data?.chunks ? <ol>` con `chunks: []` renderiza la lista vacía; el
  mensaje "Sin pasajes: …" sólo aparece si `chunks` es undefined (nunca con el
  server real, que manda `[]`). Repro: fuentes view → "Ver pasajes" en "aduana
  argentina" → cuadro sin texto.

## Mejoras puntuales pedidas a Celda C (o a quien toque)

1. **Copy honesto para `latest: null`** en `DatasetsView` (espejo del "tooLarge"
   que ya se maneja): "Todavía no tiene snapshots…" cuando `lastSnapshotAt` es
   null. Cubrir con un assert en el test (hoy deliberadamente no afirmo el
   contenido del `<pre>` para no asertar el `null` — al arreglarse C-1, afirmar
   el mensaje nuevo).
2. **`{detail.data.chunks?.length ? <ol> : <p>Sin pasajes…</p>}`** en
   `SourceRow` (C-2). Una línea.

## Notas del test (aclaraciones honestas)

- Cada test re-renderiza desde el menú con la misma app y las mismas dos
  workspaces, como haría un usuario que abre el diálogo una vez por tarea; el
  `flush` tras cada click es de 30–60 ms (lo mismo que los tests hermanos).
- El mock del plan aceptado devuelve `applied` con una pieza fallida (`panel`)
  simulando el camino real de `routes.ts:197-248` (cada pieza con su propio gate);
  el detalle de la falla es verosímil, no copiado de un server real con paneles
  encendidos — el punto era verificar que la UI muestra `✗` + detalle, no qué
  texto exacto manda el server.
- Los mocks de run-now (`started:true` + runs que crece) emulan la forma del
  server con motor; el caso sin motor (`started:false` + detalle del motor) ya
  está cubierto por el test de tareas hermano y por la traba 3 de HIVE-A-TEST.
- **Deliberadamente no probé acá** (cubiertos por tests hermanos o porque
  exceden "recorrido honesto"): crear/editar/eliminar tareas, paneles y salidas;
  gating con cada flag apagada (ya en `specialist-*-ui.test.tsx`); el reintento
  tras un 500 (el botón existe y está asertado; el refetch posterior es el mismo
  camino que el test de datasets hermano ya verificó); y "Correr ahora" sobre una
  tarea **pausada** (heredado de HIVE-A-TEST, nota menor: el botón sigue
  habilitado en pausadas — lo verifiqué en el código, `library-dialog.tsx:841`,
  pero no lo re-abrí como traba nueva porque ya está documentado).
