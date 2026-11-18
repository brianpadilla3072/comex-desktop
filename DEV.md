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
