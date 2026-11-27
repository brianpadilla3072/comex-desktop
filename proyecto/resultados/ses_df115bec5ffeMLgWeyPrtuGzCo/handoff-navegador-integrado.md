# Handoff: enlace de sesión en el navegador integrado

Estado al 2026-11-25. Contexto para otro agente. No incluye credenciales ni tokens.

## 1. Objetivo

Que `http://localhost:40707/#/workspace/ws_5306b194fa17/session/ses_dfcc3aa06ffej1ew4Xj51K3WJO` abra esa conversación en la ventana principal de Electron cuando se usa la herramienta nativa del navegador integrado, sin caer en `/welcome` y sin dejar la pestaña del browser tool rota.

El usuario pidió además: probarlo con el navegador integrado (no solo externo) y, al final, reiniciar la app para que el cambio del proceso principal de Electron tomara efecto.

## 2. Síntoma reportado

- `browser_open` con esa URL entregaba la sesión pero devolvía `next: "observe"` sobre una pestaña sin URL (`about:blank`).
- El siguiente `browser_observe`/`browser_act` fallaba con `invalid_url` (“Use a complete HTTP or HTTPS website address”), un error engañoso.
- La ruta manual de la barra del panel integrado sí funcionaba: la ventana principal navegaba al hash destino y no aparecía `/welcome`.

## 3. Causa raíz

1. Los enlaces del mismo origen a `/workspace/.../session/...` deben entregarse a la ventana principal de Electron. Si se cargan como sitio web en una pestaña del panel, se crea un renderer duplicado no autenticado que redirige a `/welcome`.
2. Las pestañas creadas por la herramienta de navegador son `automationProtected`. El interceptor original de `browser-panel.mjs` las excluía, así que el handoff no se hacía y `loadURL` se abortaba con “Browser operation could not finish”.
3. Después del handoff, la pestaña nunca carga un renderer: queda en `about:blank`. El guardián de URL del task host rechazaba esa pestaña con `invalid_url` en vez de explicar que el enlace ya fue entregado.

## 4. Cambios de código aplicados

- `apps/desktop/electron/browser-panel.mjs`
  - Marca la pestaña con `appSessionHandoff = <enlace>` en dos rutas: handoff previo a `loadURL` para pestañas automation, e interceptor `did-start-navigation` para navegación manual.
  - El resultado de la herramienta devuelve la URL destino y `handoff: true`; el estado del panel expone el campo.
  - El temporizador de limpieza del view pasó de 0 a 200 ms, igual que el handoff de `openwork://`, para no tocar el view durante la navegación entrante.
- `packages/computer-use/browser-task.mjs`
  - `open` termina con recibo terminal: `handoff: true`, `next: "none"` y nota explicativa.
  - Cualquier operación posterior sobre esa pestaña responde `app_link_handed_off` con instrucciones claras.
  - `navigate` limpia la marca y recupera la pestaña para uso normal; `browser_close` sigue funcionando.
- `packages/computer-use/browser-task-app-handoff.test.mjs` (nuevo, 4 tests): recibo terminal, `observe` con `app_link_handed_off`, recuperación por `navigate`, regresión de `open` normal.
- `packages/browser-tabs/index.d.ts`: tipos `appSessionHandoff` y `handoff`.
- `evals/proofs/app-session-link.proof.test.ts`: proof E2E usa la herramienta real por `/browser/task` y verifica ambos extremos.
- `evals/worlds/app-session-link.ts`: solo calcula la URL del enlace para el proof.
- Helpers puros ya existentes de este tramo: `apps/desktop/electron/app-session-link.mjs` y `apps/app/src/app/lib/app-session-link.ts`; `apps/app/src/react-app/shell/app-session-link-listener.tsx` navega el renderer al hash recibido por deep link.

## 5. Cómo funciona el flujo corregido

1. La herramienta nativa `browser_open` recibe una URL de sesión del mismo origen.
2. `browser-panel.mjs` detecta la ruta con `appSessionRouteFromUrl`, hace handoff a la ventana principal **antes** de `loadURL` y marca la pestaña como entregada.
3. La ventana principal recibe el deep link y su listener de renderer navega al hash destino. No se crea un renderer autenticado duplicado, por lo que no aparece `/welcome`.
4. La herramienta devuelve un recibo terminal en vez de pedir `observe`.
5. Si se intenta operar la pestaña entregada, la respuesta es `app_link_handed_off`, no `invalid_url`.
6. `browser_navigate` borra la marca y permite volver a usar la pestaña como sitio web normal.

## 6. Verificación

- 52 tests de `packages/computer-use` en verde.
- `bun test` de los helpers puros de app y Electron en verde.
- `pnpm typecheck` limpio.
- `pnpm --dir evals lint:specs`: 148 archivos, 0 errores.
- Proof E2E local bajo Xvfb: 1/1.
- `pnpm test:comex` se detiene en `check:rust-readiness` por dos infracciones ajenas y preexistentes en `apps/server/src/designs/html-archive.ts` y `apps/server/src/specialists/sheet-model.ts`. No se tocaron ni se subió el baseline.
- Verificación final en vivo, ya con la app reiniciada:
  - `browser_open` de la URL exacta → `handoff: true`, `next: "none"`, nota “opened the conversation in the main app window”.
  - `browser_observe` sobre esa pestaña → `app_link_handed_off`.
  - Por CDP: ventana principal en `http://localhost:40707/#/workspace/ws_5306b194fa17/session/ses_dfcc3aa06ffej1ew4Xj51K3WJO`, `welcome:false`, título “OpenWork”.
  - `browser_tabs` vuelve a conectar.

## 7. Reinicio de la app (estado actual)

- Se detuvo el Electron anterior (PID `2315788`) con `SIGTERM`.
- Apareció un segundo stack `pnpm dev` con `PORT=0`, perfil por defecto y su propio Electron en CDP `9823`; se detuvo su grupo de procesos (`63410`) para evitar dos instancias y perfiles distintos compitiendo por el puerto.
- Se relanzó `pnpm dev` con el mismo perfil de desarrollo anidado ya usado por este chat:
  - `XDG_CONFIG_HOME` y `OPENWORK_DATA_DIR` apuntan al estado anidado existente.
  - `OPENWORK_ELECTRON_START_URL=http://localhost:40707`
  - `PORT=40707`
  - `OPENWORK_ELECTRON_OZONE_PLATFORM=x11`
  - `OPENWORK_ELECTRON_REMOTE_DEBUG_PORT=9823`
- Electron nuevo: PID `81681`, CDP `127.0.0.1:9823`, base `http://localhost:40707`. No se reiniciaron los Vite preexistentes (el de 40707 sigue en PID `2969618`).

## 8. Incidente del puente del navegador tras el reinicio

- `apps/server/src/comex/installed-browser.ts` escribe `{}` en los descriptors al cerrar (`close()`).
- Al arrancar, el motor ya tenía cargado el wrapper `.opencode/plugins/comex-browser/server.js` con una ruta de descriptor vieja.
- El servidor nuevo regeneró el descriptor vivo en una ruta de runtime más profunda y actualizó el wrapper, pero el motor en marcha seguía leyendo la ruta anterior, así que `browser_tabs` daba `fetch failed`.
- Solución aplicada en el entorno: copiar el descriptor vivo (contiene `directory`, `url` tipo `http://127.0.0.1:<puerto>/browser` y `token`) a las rutas de descriptor que el motor tenía capturadas. Después `browser_tabs` conectó. El token nunca se guardó en el repo ni en `proyecto/estado.md`.
- Esto es un parche de entorno, **no** un fix de código committed. Si vuelve a pasar después de otro reinicio, repetir este paso.

## 9. Limpieza y registro

- Se borraron los dos scripts CDP temporales y el log propios en `/tmp/opencode`.
- Se liberaron sus registros con `pnpm resource-cleanup release ...`.
- `pnpm check:resource-cleanup` → “Sin recursos pendientes”, exit 0.
- Evidencia registrada en `proyecto/estado.md` (sección “Reinicio en vivo de la app de desarrollo”).
- No se hicieron commits ni pushes; la regla del repo es no commitear sin pedido explícito.

## 10. Pendiente real para el siguiente agente

1. Si el enlace vuelve a fallar, primero correr `browser_tabs`. Si da `fetch failed`, comparar la ruta del descriptor en `.opencode/plugins/comex-browser/server.js` con los archivos `installed-browser/<sha256>.json` bajo el runtime config activo y copiar el descriptor vivo a la ruta que el motor tiene capturada.
2. La mejora de fondo pendiente: hacer que el plugin resuelva el descriptor dinámicamente contra la ruta de runtime vigente, o que `install()` escriba también en la ruta que el motor ya cargó, para no depender de copiar archivos a mano tras cada reinicio.
3. Mantener la verificación con las herramientas nativas (`browser_open`, `browser_observe`, `browser_tabs`), no con `element.click()` ni con un navegador externo: un navegador externo no ve el renderer de escritorio y para remoto se usa la web self-host vinculada, sin `#`.
4. Si se toca código, repetir los tests listados en el punto 6 y `pnpm check:resource-cleanup`.
