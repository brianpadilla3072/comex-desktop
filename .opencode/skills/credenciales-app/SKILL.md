---
name: credenciales-app
description: "Gestionar credenciales (usuario/contraseña) de sitios web para la aplicación, guardadas en un archivo privado (~/.config/openwork/credentials.json) con permisos 600. Usar SIEMPRE que el usuario pida guardar, recuperar o usar contraseñas de sitios, 'loguearme', 'usar mis credenciales', 'recordar contraseña de X', o cuando se necesite autenticarse en un sitio del navegador integrado. NUNCA guardar contraseñas en archivos del repo ni en memoria compartida."
---

# Gestión de credenciales de la aplicación

Almacena credenciales (sitio, usuario, contraseña) en un archivo **privado** fuera del
repo, con permisos `600` (solo el usuario puede leerlo). El helper `cred_helper.py`
permite listar, agregar, obtener y eliminar entradas sin tocar el JSON a mano.

## Ubicación

- Archivo: `~/.config/openwork/credentials.json` (permisos 600).
- Helper: `~/.config/openwork/cred_helper.py` (permisos 700).
- **Nunca** copiar este archivo al repo ni a ningún workspace.

## Uso del helper

```bash
# Listar sitios guardados (sin mostrar contraseñas)
python3 ~/.config/openwork/cred_helper.py list

# Obtener credenciales de un sitio (JSON con user y password)
python3 ~/.config/openwork/cred_helper.py get <sitio>

# Agregar o actualizar credenciales
python3 ~/.config/openwork/cred_helper.py add <sitio> <usuario> <password>

# Eliminar credenciales de un sitio
python3 ~/.config/openwork/cred_helper.py remove <sitio>
```

## Flujo para autenticarse en un sitio

1. Verificar si hay credenciales guardadas:
   ```bash
   python3 ~/.config/openwork/cred_helper.py list
   ```
2. Si el sitio está listado, obtenerlas:
   ```bash
   python3 ~/.config/openwork/cred_helper.py get <sitio>
   ```
3. Usar las credenciales para hacer login (en el navegador integrado o via
   browser_handoff si requiere 2FA).
4. Si no hay credenciales, pedirle al usuario que las proporcione y guardarlas:
   ```bash
   python3 ~/.config/openwork/cred_helper.py add <sitio> <usuario> <password>
   ```

## Reglas de seguridad

- **NUNCA** escribir contraseñas en archivos del repo, en skills, en memoria
  compartida, ni en el chat.
- **NUNCA** mostrar la contraseña en la respuesta al usuario — solo confirmar
  que se guardó/obtuvo.
- El archivo `credentials.json` tiene permisos 600; no cambiarlos.
- Si el usuario pide "guardar mi contraseña de X", pedirle el usuario y la
  contraseña, guardarlas con el helper, y confirmar solo el sitio (no el password).
- Para sitios con 2FA o CAPTCHA, usar `browser_handoff` para que el usuario
  complete el login manualmente.

## Ejemplo

Usuario: "logueame en Gmail"
1. `python3 ~/.config/openwork/cred_helper.py list` → ver si gmail está.
2. Si está: `python3 ~/.config/openwork/cred_helper.py get gmail` → obtener user/pass.
3. Abrir Gmail en el navegador integrado, llenar el formulario con las credenciales.
4. Si no está: pedir usuario y contraseña, guardar con `add`, y luego loguear.

## Integración con otras skills

- `descargar-video-youtube`: si un video requiere login (restricción de edad),
  usar las credenciales del sitio con `--cookies-from-browser`.
- `youtube-transcripcion`: si un video es privado, usar las credenciales para
  acceder.
- `fact-check-html`: el navegador integrado ya tiene las sesiones guardadas en
  `Partitions/openwork-browser/`.