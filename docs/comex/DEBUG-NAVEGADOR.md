# Diagnóstico del navegador en vivo

`pnpm debug:browser` observa una app existente o abre una web en Chrome/Chromium/Edge headless con un perfil temporal exclusivo. No reinicia Electron, cambia permisos, envía prompts ni usa el perfil del navegador personal.

Requiere Node con `fetch`/`WebSocket` globales (la versión requerida por el repositorio). No instala navegadores ni desactiva su sandbox. Para conectarse a Electron hay que arrancarlo con CDP habilitado. Usar la dirección que informa ese arranque, sin asumir un puerto.

```sh
pnpm debug:browser doctor --cdp http://127.0.0.1:<puerto>
pnpm debug:browser watch --cdp http://127.0.0.1:<puerto> --seconds 8
pnpm debug:browser web --url 'http://localhost:<puerto-web>/#/workspace/<workspace>/session/<sesion>' --seconds 8
pnpm debug:browser native --cdp http://127.0.0.1:<puerto> --session <sesion-solicitante> --url '<enlace-exacto>' --seconds 8
```

`doctor` identifica el renderer por la presencia del puente Electron, excluyendo la cápsula. Si hay varios exige `--target <id>`. `watch` registra su URL durante el intervalo pedido. `web` reproduce el comportamiento fuera de Electron; `--reload` recarga y repite la observación. `native` descubre el puente vivo mediante `getUiControlBridgeInfo` de esa ventana y usa `/browser/task` (las mismas operaciones de las herramientas nativas). Comprueba el recibo de apertura, hace observe y observa la ventana principal. Solo cierra una pestaña nativa si no existía antes de la prueba. La apertura de un enlace de sesión puede cambiar la conversación visible de la ventana principal.

La detección del navegador contempla Windows, macOS y Linux. `--browser <ejecutable>` o `CHROME_PATH` resuelven ubicaciones no estándar; `--cdp` o `CDP_URL` indican el endpoint. No hay IDs de conversación, perfiles personales ni rutas de esta instalación en el código. La integración real se verificó en Linux; los candidatos Windows/macOS tienen pruebas de lógica, todavía no ejecución en esos sistemas.

La salida es JSON por línea con `version: 1`: muestras de URL/título, presencia de puente/bootstrap, fallos HTTP/red, excepciones JS y errores de consola. No guarda headers, cookies, tokens, cuerpos de peticiones ni argumentos de consola. Oculta credenciales y parámetros de URL. Las rutas y títulos pueden contener datos del proyecto: revisar la salida antes de compartirla. Los errores de consola se cuentan sin copiar su contenido. El resultado informa si cambió la URL y si terminó en welcome; eso describe lo observado, no valida por sí solo todo el producto.

Registra recursos en el guardián del repo apenas los crea: PID, perfil temporal, puerto y pestaña. Usa una sesión exclusiva por ejecución. `finally` cierra y libera los propios; una pestaña nativa cuya eliminación no pudo comprobarse conserva el registro para inspección. Tras una interrupción forzada (`SIGKILL` o caída del sistema), el guardián puede indicar recursos que deban cerrarse manualmente. No se infiere propiedad por nombre de proceso.

```sh
pnpm check:resource-cleanup
node --test scripts/live-browser-debug.test.mjs
```

## Preparación para Rust

- `scripts/live-browser-debug-core.mjs`: decisiones puras con entradas explícitas (argumentos, candidatos por sistema, redacción de URL y resumen de observaciones).
- `scripts/live-browser-debug.mjs`: adaptador de I/O para procesos, archivos temporales, HTTP, CDP y el registro de recursos. Reutiliza el cliente CDP existente; no introduce dependencias de runtime al producto.
- `contracts/live-browser-debug/v1/cases.json`: vectores de comportamiento para que la implementación futura de Rust produzca los mismos resultados. Son fixtures sintéticos, sin credenciales reales.
- Salida UTF-8/JSON, versión entera y error estable `live_debug_failed`. Equivalentes previstos: `url`, `serde`/`serde_json`, `tokio::process`, HTTP/WebSocket y tipos explícitos para los eventos. La migración no requiere ejecutar JS en el host; solo las expresiones fijas de inspección dentro del renderer mediante el protocolo CDP.

Esto es tooling de desarrollo, separado del servidor y los helpers de producto. No declara que el port a Rust ya exista ni que otros sistemas operativos hayan sido probados en vivo.
