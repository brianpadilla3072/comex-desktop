# Levantar el proyecto en modo dev (OpenWork / comex-desktop)

## Importante: NO usar `pnpm dev` a secas en este entorno

El script `pnpm dev` levanta Electron sobre Wayland por defecto y la ventana
**no se muestra** en la sesión GNOME. Además, el puerto `5173` suele estar
ocupado por otro proyecto (Clawmint), lo que hace que la app cargue el proyecto
equivocado.

## Forma correcta (ventana visible + proyecto correcto + perfil real con tus datos)

```bash
cd "/home/brian/Proyectos/build agents and skils/comex-desktop"

DEN_FEATURE_DESKTOP_COMPANION=true \
OPENWORK_DEV_MODE=1 \
PORT=0 \
OPENWORK_ELECTRON_REMOTE_DEBUG_PORT=9823 \
pnpm dev
```

- `DEN_FEATURE_DESKTOP_COMPANION=true` fuerza `--ozone-platform=x11`, así la
  ventana aparece en XWayland y es visible en GNOME.
- `PORT=0` hace que Vite use un puerto libre (evita cargar Clawmint del
  `5173`) y arranca el vite propio de este proyecto.
- Sin `OPENWORK_DEV_PROFILE=auto`: usa el perfil por defecto
  (`~/.config/com.differentai.openwork.dev`) con tus workspaces, sesiones y
  datos reales (Fabiana Apolonio, multichurch, etc.).
- CDP queda en `http://127.0.0.1:9823`.

> NO usar `pnpm dev` a secas: corre en Wayland (ventana no visible) y reutiliza
> el perfil compartido que puede estar bloqueado por otra instancia.
> NO usar `pnpm dev:worktree`: crea un perfil aislado sin tus datos.

## Stack web headless (sin ventana, UI equivalente)

Ya suele estar corriendo:

```bash
pnpm dev:headless-web -- --browser   # deja webUrl http://127.0.0.1:5178
```

Abrir `http://127.0.0.1:5178` en el navegador para ver la UI de este proyecto.

## Puertos

| Puerto | Qué sirve |
|--------|-----------|
| 5173   | Otro proyecto (Clawmint) — NO usar para comex |
| 5178   | Vite de comex-desktop (headless stack) |
| 8778   | OpenWork API local (headless) |
| 9823   | CDP del desktop Electron |

## Si el CDP no responde

El puerto 9823 puede quedar ocupado por un proceso anterior:

```bash
fuser -k 9823/tcp
```

y relanzar.

## Verificación rápida de que es el proyecto correcto

La página debe mostrar `<title>OpenWork</title>` (no "Clawmint") y la ventana
de escritorio se titula "OpenWork - Dev".

## Crear un workspace sobre una carpeta que ya tiene `.opencode`

Antes, `POST /workspaces/local` devolvía `409 project_has_configuration`
("La carpeta ya tiene una configuración de agentes…") y la UI lo disfrazaba
como _"OpenWork server is unavailable"_. Ahora:

- `apps/server/src/specialists/packs.ts`: `prepareSpecialistWorkspace`
  **adopta** la carpeta escribiendo solo `.opencode/specialist-application.json`
  con el `applicationId`; no sobreescribe nada del `.opencode` existente.
  Sigue rechazando el caso `project_already_bound` (otra aplicación).
- `apps/app/src/react-app/shell/session-route.tsx`: `handleCreateWorkspace`
  propaga el mensaje real del servidor; el texto genérico de "servidor no
  disponible" queda solo para cuando no hay `client` (servidor caído).

Tras cambiar `packs.ts` hay que recompilar el servidor, porque el dev carga
`apps/server/dist/embedded.js`:

```bash
cd apps/server && pnpm exec tsc -p tsconfig.json
```

y reiniciar la app. El workspace `comex-desktop`
(`/home/brian/Proyectos/build agents and skils/comex-desktop`) ya quedó creado
y vinculado a la aplicación especialista activa.

## Puente del navegador integrado (`browser_*`)

Si `browser_tabs()` decía _"El navegador de Comex no está conectado a este
proyecto"_, la causa no era el bridge sino los wrappers `comex-browser`:
OpenCode carga los `.opencode/plugins/comex-browser/` de **todos los workspaces
ancestros**, queda registrado el primero y su `descriptorFile` fijo pertenecía
a otro proyecto (`directory` distinto) → fallaba la validación.

Fix en `apps/server/src/comex/installed-browser-plugin.ts`: el descriptor se
resuelve por el directorio de la sesión,
`sha256(realpath(context.location.directory)).json`, dentro de la carpeta del
descriptor — no por el archivo fijo del wrapper. Así cualquier wrapper cargado
conecta el navegador con el workspace que lo pidió.

Tras cambiarlo hay que recompilar el bundle y reiniciar:

```bash
cd apps/server
pnpm exec bun build src/comex/installed-browser-plugin.ts --external effect \
  --outfile dist/opencode-plugins/comex-installed-browser-plugin.js \
  --target node --format esm
```

La app copia ese bundle a
`~/.config/com.differentai.openwork.dev/openwork-dev-data/xdg/config/openwork/installed-browser/plugin.mjs`
al iniciar. Verificar con `browser_tabs()` → `{"ok":true,...,"tabs":[]}` (
sin pestañas abiertas es un resultado válido).
