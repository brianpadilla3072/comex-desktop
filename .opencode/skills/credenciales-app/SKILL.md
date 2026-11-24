---
name: credenciales-app
description: "Gestionar credenciales (usuario/contraseña) de sitios web para la aplicación, guardadas en la carpeta privada del sistema de OpenWork (~/.config/openwork/workspaces/<workspace>/credentials.json, 0600) con solo un alias/origin en el workspace. Usar SIEMPRE que el usuario pida guardar, recuperar o usar contraseñas de sitios, 'loguearme', 'usar mis credenciales', 'recordar contraseña de X', o cuando se necesite autenticarse en un sitio del navegador integrado. NUNCA guardar contraseñas en archivos del repo ni en memoria compartida."
---

# Gestión de credenciales de la aplicación

Almacena credenciales (sitio, usuario, contraseña) en un archivo **privado** fuera del
repo, con permisos `600` (solo el usuario puede leerlo). El helper `cred_helper.py`
permite listar, agregar, obtener y eliminar entradas sin tocar el JSON a mano.

## Ubicación

- **Por workspace (preferido):** `~/.config/openwork/workspaces/<hash-del-workspace>/credentials.json` (permisos 600; carpeta 700). Lo escribe `specialist_workspace_save { kind: "credential", origin, alias, secret }` de la carpeta del sistema de OpenWork, fuera del repo y del workspace. El id del workspace se deriva de su ruta, así que cada proyecto tiene su propio archivo y no comparte secretos con otro.
- **En el workspace solo queda la referencia:** `proyecto/recursos/index.json` guarda `origin` (sin usuario, contraseña, query ni fragmento), `alias` y un `secretRef`; NUNCA el valor.
- **Legacy:** `~/.config/openwork/credentials.json` (permisos 600) y el helper `~/.config/openwork/cred_helper.py` (permisos 700) siguen disponibles para credenciales globales sin scope de workspace.
- **Nunca** copiar estos archivos al repo ni a ningún workspace.

En macOS usa `~/Library/Application Support/openwork` y en Windows `%APPDATA%/openwork`, según la carpeta de configuración de OpenWork. `OPENWORK_SERVER_CONFIG` cambia la raíz.

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

## Credenciales ligadas a un workspace

Cuando la persona diga "guardá esta credencial para este proyecto", "que no se pierda al cambiar de workspace" o pida fijar credenciales del navegador:

1. Usá la tool del agente:
   ```json
   specialist_workspace_save {
     "kind": "credential",
     "origin": "https://ejemplo.com",
     "alias": "ejemplo-com",
     "secret": "<valor que dio la persona>"
   }
   ```
2. La tool deja el alias y el `origin` en `proyecto/recursos/index.json` del workspace y el valor en la carpeta privada del sistema. La respuesta **nunca** devuelve el secreto.
3. Para recordar solo el sitio sin guardar valor, llamá a la misma tool sin `secret`.
4. `specialist_workspace_list` muestra los alias guardados, sin secretos.
5. En el front, el menú de tres puntitos «Guardar en workspace» cubre archivos y URLs; los secretos **no** se ponen en ese menú.

## Reglas de seguridad

- **NUNCA** escribir contraseñas en archivos del repo, en skills, en memoria
  compartida, ni en el chat.
- **NUNCA** mostrar la contraseña en la respuesta al usuario — solo confirmar
  que se guardó/obtuvo.
- El archivo `credentials.json` tiene permisos 600 y su carpeta 700; no cambiarlos.
- El workspace y los `datasets` nunca contienen valores de credenciales, aunque la persona pida "guardar todo": se guarda la referencia, no el secreto.
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