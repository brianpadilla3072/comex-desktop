# Verificación de rendimiento de Comex

Se revisaron el chat, el mapa de agentes, las consultas periódicas y el catálogo de archivos. Se corrigió una fuente concreta de trabajo innecesario sin cambiar Electron ni la presentación de los detalles. Las mediciones posteriores de RAM y CPU de Electron están en [RENDIMIENTO-RAM-CPU.md](./RENDIMIENTO-RAM-CPU.md). Todavía no se midieron el arranque empaquetado ni la latencia de inferencia.

## Mejora comprobada

`AgentDetails` calculaba `JSON.stringify(output)` para todas las herramientas aunque sus detalles estuvieran plegados. El resultado se recortaba a 20.000 caracteres después de convertirlo completo. Cada actualización del componente repetía esa conversión.

La conversión ahora vive en el contenido que monta la sección desplegable y se memoriza mientras el objeto de llamada permanece igual. Las filas plegadas no formatean sus resultados. Los comandos, estados, errores y resultados visibles se conservan; se comprueba también que una actualización de salida a error refresque el contenido. Es un refactor de rendimiento del comportamiento existente, sin nueva capacidad ni cambio de defaults; no agrega una feature. Conserva DESIGN P3/P5/S3 y la presentación existente.

La prueba de regresión falló antes del cambio porque `toJSON` se ejecutaba con los detalles cerrados; después pasó.

## Medición local

Benchmark sintético del componente React real en Bun 1.3.10 y happy-dom, con 12 herramientas, 8.000 filas por resultado y 12 actualizaciones del padre. Comparó la versión de HEAD con la del árbol de trabajo en el mismo proceso. Las cifras son una corrida local, sin umbral automático de tiempos ni promesa para otros equipos.

| Medida | Antes | Después |
| --- | ---: | ---: |
| Conversiones al abrir detalle del agente, con herramientas plegadas | 12 | 0 |
| Conversiones en 12 actualizaciones del padre | 144 | 0 |
| Mediana por actualización | 48,42 ms | 7,59 ms |

Evidencia local: `tmp/comex-agent-map-performance.json`. El fixture y la copia del componente anterior se conservaron en `tmp/comex-performance-audit/`, fuera del código de producción. Esta medición no es un benchmark de Chromium, Electron empaquetado, RAM, arranque ni ejecución de modelos.

## Lo que ya existe y conviene conservar

- El chat usa TanStack Virtual con alturas medidas y caché en `components/chat/progressive-message-list.tsx`.
- El Markdown de respuestas en streaming se procesa por bloques en `components/markdown/markdown.tsx`, evitando rehacer todo el documento por cada fragmento.
- El detalle de agentes ya consulta solamente el agente seleccionado y deja de sondear al finalizar, con una lectura final.

## Siguientes mediciones

El panel de proyecto consulta archivos cada 15 segundos. Cada consulta crea una sesión de archivos, recorre el catálogo y cierra la sesión (tres peticiones). El servidor aplica el límite después del recorrido. La lectura de metadatos ahora usa lotes acotados, como se documenta abajo. Excluye `.git` y `node_modules` cuando lo pide este panel; aun así conviene medir carpetas con muchos documentos antes de cambiar el recorrido o introducir caché.

También hay observadores de flags que comparten clave de consulta; no se contó cada observador como una petición independiente porque TanStack puede deduplicar solicitudes. Las consultas de features en segundo plano requieren revisar sus garantías de actualización antes de alterar intervalos o permisos.

Para evaluar un cambio de tecnología, medir primero una versión empaquetada: arranque frío/caliente, CPU/RAM en reposo, conversación larga, navegador abierto y documento grande. No hay evidencia en esta revisión que justifique por sí sola una migración completa a Tauri.

## Optimización del catálogo de archivos

Se reemplazó la lectura secuencial de metadatos por lotes de hasta ocho operaciones `stat`. La recursión entre carpetas sigue siendo secuencial: no se abren todas las carpetas en paralelo ni se conserva una promesa por cada archivo del proyecto. Se conservan el orden, las revisiones, la exclusión opcional de `.git` y `node_modules`, el tratamiento de errores y la omisión de enlaces simbólicos. No agrega caché ni cambia los intervalos de actualización. Es un refactor del comportamiento existente, sin nuevo flujo visible.

Comparación local del recorrido real anterior y posterior sobre la misma carpeta temporal: 6.000 archivos en 60 carpetas, Node 24.22.1, dos rondas de calentamiento y nueve rondas medidas, alternando el orden de ambas versiones. Cada ronda comprueba igualdad completa de los resultados, incluidos los metadatos.

| Medida (mediana) | Antes | Después |
| --- | ---: | ---: |
| Tiempo de recorrido | 206,51 ms | 166,38 ms |
| Tiempo de CPU del proceso | 229,50 ms | 202,10 ms |

En esta corrida el recorrido redujo su duración aproximadamente un 19 % y su tiempo de CPU un 12 %. El tiempo de CPU suma trabajo en distintos hilos, por lo que puede superar el tiempo transcurrido. Son resultados del catálogo en un sistema de archivos local caliente; no equivalen a una mejora del 19 % en toda la app ni demuestran una reducción de RAM. El equipo no estaba dedicado exclusivamente al benchmark.

Evidencia local: `tmp/comex-catalog-performance/result.json`, con muestras individuales y el benchmark. Pruebas de regresión: `apps/server/test/workspace-catalog.test.ts` (dos pruebas, correctas); comprobación de tipos del servidor correcta. Los archivos temporales del fixture se eliminaron al terminar.

La convivencia de los dos motores sigue pendiente de diseño y verificación de compatibilidad: no se desactivó ninguno para obtener esta mejora.
