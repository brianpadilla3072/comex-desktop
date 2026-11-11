# Respaldo y recuperación local

La copia incluye las carpetas elegidas; no descubre todas las ubicaciones automáticamente. Elegir configuración/estado de la aplicación, carpetas de los proyectos que se quieran preservar, configuración de OpenCode y cada almacén de historial que la instalación use. Si se reutiliza OpenCode instalado, su historial puede estar fuera del perfil de esta app. Revisar overrides XDG y rutas configuradas antes de copiar.

Los chats, claves y documentos pueden ser sensibles. La carpeta de copia usa permisos privados en sistemas POSIX; no está cifrada. Guardarla en un destino privado. Las credenciales del llavero de macOS/Windows/Linux no se exportan como credenciales portables.

## Crear una copia

Cerrar la aplicación y el motor que usa esas carpetas. La opción `--app-closed` registra esa confirmación; no mata procesos ni verifica por sí sola que otros clientes hayan cerrado el mismo motor. Las copias entre varias bases no son una transacción global.

Usar Node 24.22.1 o el runtime de desarrollo requerido por el repositorio:

```sh
pnpm backup:local create --source "/ruta/estado-app" --source "/ruta/datos-opencode" --source "/ruta/proyecto" --to "/ruta/privada/respaldo-nuevo" --app-closed
pnpm backup:local verify --backup "/ruta/privada/respaldo-nuevo"
```

El destino debe ser nuevo y estar fuera de los orígenes. No se siguen symlinks; elegir sus carpetas reales por separado. Las bases `.db`, `.sqlite` y `.sqlite3` se copian con la API de backup de SQLite: incluye transacciones confirmadas del WAL y omite los journals laterales. Los archivos no SQLite con esas extensiones requieren excluirse del conjunto o elegir un origen apropiado. Un archivo cambiado durante la copia invalida el intento. El límite es 100.000 archivos.

`manifest.json` guarda rutas relativas, tamaño y SHA-256. No guarda las rutas absolutas originales. Verificar hashes detecta corrupción accidental; no autentica un respaldo cuyo manifiesto también haya sido alterado maliciosamente.

## Preparar una recuperación

```sh
pnpm backup:local restore --backup "/ruta/privada/respaldo-nuevo" --to "/ruta/recuperacion-nueva"
```

La herramienta verifica todos los archivos antes de copiar y rechaza destinos existentes, escapes de ruta y enlaces simbólicos. Cada origen se conserva como una carpeta numerada. No reemplaza el perfil en uso.

Con la aplicación cerrada, inspeccionar la recuperación, conservar el perfil anterior y probar primero en un perfil aislado de la misma versión. Elegir después las carpetas correctas de la instalación; no mezclar ni borrar a ciegas almacenes v1/v2. Reautenticar proveedores cuando la protección del sistema operativo lo requiera. La copia de archivos no acredita por sí sola que una versión diferente pueda leerlos.

Verificación automatizada: snapshot SQLite con WAL confirmado, notas, hashes, restauración en destino nuevo, rechazo de sobrescritura, corrupción y symlinks. No se hizo una restauración sobre el perfil real del usuario ni una aceptación de instalación en Windows.
