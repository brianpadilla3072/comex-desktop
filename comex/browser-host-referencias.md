# Browser host: referencias y plan (skill "Browser" de Comex)

Fecha: 2026-11-09. Decide qué repo y qué carpetas usamos de referencia para que la
skill built-in `browser` del motor funcione de verdad en Comex, y qué se hizo mientras tanto.

## Qué pasa hoy (diagnóstico verificado)

- El motor OpenCode v2 lista siempre la skill built-in `browser` (path `/builtin/browser.md`)
  y la chip aparece en el `+` del composer.
- Esa skill y sus `tools.browser.*` están **diseñadas para estar ocultas hasta que un
  "desktop browser" se engancha a la sesión** por el protocolo `experimental.browser`
  (README de `@opencode/plugin-browser`, abajo). Comex no engancha ninguno.
- Sin host enganchado, el motor **deniega el permiso de la skill al enviar** → el banner
  "Selected skills are not permitted in OpenCode v2. Nothing was sent." (reproducido:
  `POST /api/session/:id/permission {action:"skill",resources:["browser"]}` → `effect:"deny"`,
  mientras `datos-comex` u otras responden `allow` con "Acceso completo" activo).
- El navegador que Comex ya ofrece al usuario es otro camino: el botón **Browser** de la
  barra lateral + las tools que inyecta `comex-browser` / `openwork-chrome-devtools` con
  sus propios nombres. No es la skill built-in.

## Fase 1 (hecha en este commit): desbloquear todo

- `apps/app/src/app/lib/opencode-v2-adapter.ts`: la built-in `browser` (`path`
  empieza con `/builtin/` e `id === "browser"`) sale del catálogo del composer
  (`mergeV2CommandCatalog`) y de la resolución al enviar (`promptAsync`), igual que ya
  salían las `openwork-cloud-`. Un draft viejo que la traiga puesta ve
  "is not available" en vez de un bloqueo de permisos.
- Test: `apps/app/tests/opencode-v2-commands.test.ts` (7/7, typecheck sin errores nuevos).
- Efecto: **todas las skills que pueden funcionar en Comex funcionan**; la única oculta es
  la que no puede funcionar sin la fase 2.

## Fase 2 (proyecto): implementar el host en Comex

No hay que "simular a ciegas": el contrato es público y estable, y OpenWork ya tiene el
chasis (panel Browser con Chromium de Electron y CDP accesible — endpoint DevTools visto
en logs del paquete).

### Referencias (fuente de verdad)

- **Repo**: `github.com/sst/opencode` (fork de trabajo del motor; LICENSE MIT).
- **Tag**: `v2.2.0` — **debe casar con el sidecar empaquetado**
  (`apps/desktop/resources/sidecars/versions.json` → `opencode2: 2.2.0`,
  sha256 `87a4d6ac3c1b5691d4fb5e88f473992016b37ede6611c5cb7092fcdb1d91fad0`).
  Regla de mantenimiento: cada bump del sidecar, re-leer estas carpetas contra el tag nuevo.
- **Paquete del protocolo (server side + schemas)**: `packages/plugin-browser/`
  - `README.md` — el contrato completo: flujo `attach`(version 4)→`state`→`control`/`command`→`result`,
    semántica de `replaced`, límites de 5 MiB, tuneles, lighthouse, recuperación de errores.
  - `src/rpc.ts` — `Browser.Operations`: la fuente de verdad de inputs/outputs/descripciones
    de las ~40 acciones (tabs, navigate, snapshot con refs `e12`, click/fill/…, files,
    console/network, trace/cpu/heap, lighthouse). Export publicado: `@opencode/plugin-browser/rpc` (npm).
  - `src/connection.ts` — cómo el motor registra attachments desktop y hace pending RPC.
  - `src/tools.ts` — el workflow de `tools.browser.*` que la skill enseña.
  - `src/skill.ts` — el contenido de `/builtin/browser.md`.
  - `src/tunnel.ts` + `src/proxy.ts` — relay TCP/CONNECT por RPC (la página usa la red del server).
  - Desactivable por config: `{ "plugins": ["-opencode.browser"] }`.
- **Implementación desktop de referencia (comportamiento a portar)**: `packages/gui-plugins/src/browser/`
  (`connection.ts`, `cdp.ts`, `chromium.ts`, `files.ts`, `analysis.ts`, `errors.ts`,
  `address.ts`, `comment.ts`, `diagnostics.ts` + sus `*.test.ts`) y
  `packages/app/src/servers/connect/browser.ts`. Ojo: vive sobre el runtime GUI de OpenCode
  (Solid + SDK de plugin GUI de `packages/plugin/src/gui/`), que OpenWork NO comparte —
  se porta el **comportamiento**, no el andamiaje.

### Dónde entra en OpenWork

- Cliente del protocolo: `apps/server/src/engine-v2-preview.ts` ya habla con el sidecar
  (`sidecar.fetchJson`, auth del engine); ahí se sostiene el `attach` por sesión y se
  consumen los eventos `control`.
- Ejecutor de comandos: el panel Browser del Electron main del desktop
  (`apps/desktop/electron/`, pestañas WebContentsView + CDP) — mapear
  `Browser.Command` → operaciones CDP reales.
- Consecuencia en la fase 1: cuando el host esté activo, **revertir/quitar el filtro**
  `isOpenWorkUnavailableEngineSkill` (o condicionarlo a "no hay host"), para que la chip
  vuelva y funcione.

### Cortes sugeridos

1. Spike: `attach` + `tabs.open/list/focus/close` + `navigate` + `snapshot`/`find` +
   `click/fill/press/wait` + `screenshot` + `evaluate` sobre el panel existente.
2. Diagnóstico: `console`, `network.list/get`.
3. Heavy: `trace.*`, `cpu.*`, `heap.*`, `lighthouse`, `files.*`, diálogos, frames.
   (El protocolo ya soporta devolver fallos tipados, degrada honesto.)
4. `tunnel/proxy` (localhost de la página a través del server) — último, es el más fino.

## Decisiones registradas

- Se documenta el reference pinning al tag del sidecar (este archivo) — pedido del usuario 2026-11-09.
- Fase 1 se publica como reemplazo in-place de v1.0.22 (política de versiones acordada).
- La distribución sigue manual: tu amigo vuelve a bajar el mismo `.exe` de releases/latest.
