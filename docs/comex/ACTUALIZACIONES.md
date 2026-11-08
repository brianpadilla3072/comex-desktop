# Actualizaciones automáticas de Comex

La distribución de escritorio de este repositorio usa sus propias GitHub Releases:
`brianpadilla3072/comex-desktop`. La compilación, los feeds de descarga, el
catálogo de versiones y la recuperación apuntan al mismo repositorio.

## Publicar un cambio

1. Integrar el cambio y subirlo a `main`, la rama de producción del repositorio.
   Cada push a `main` que toque `apps/`, `packages/`, `pack/`, `scripts/` o la
   configuración de build compila y publica una versión nueva automáticamente.
2. El workflow **Comex release** valida el pack y el actualizador, y compila
   Windows x64 (NSIS `.exe`) y Linux x64 (`.AppImage`).
3. La versión es `1.0.N`, donde `N` es el número de ejecución del workflow. Se
   puede forzar otra versión ejecutando el workflow manualmente desde Actions
   sobre `main`. No hay que crear tags a mano.
4. Los dos builds suben artefactos internos de Actions. Se comprueba que cada
   manifiesto tenga la versión esperada y que sus instaladores coincidan en
   tamaño y SHA-512. Windows incluye el blockmap de NSIS.
5. Solo cuando las validaciones y ambos builds terminan correctamente se crea
   una release borrador, se suben todos los archivos y se publica como Latest.
   El catálogo `comex-release.json` incluye la versión nueva y las versiones
   anteriores completas publicadas por este circuito.

Los cambios exclusivamente documentales fuera de `apps/`, `packages/`, `pack/`
y `scripts/` no disparan una compilación. Las ramas de trabajo y los PR no
publican versiones. No se usa el workflow de releases heredado de OpenWork.

## Qué sucede en la computadora instalada

La app ya comprueba actualizaciones al abrir y cada 15 minutos mientras está
abierta; también vuelve a comprobar al recuperar foco o conexión. Por defecto
descarga en segundo plano y prepara la instalación al salir normalmente de la
aplicación. Conserva la opción de reiniciar voluntariamente desde la interfaz.
Cerrar una ventana que deja la app ejecutándose en segundo plano no equivale
a salir de la aplicación. Se respetan las preferencias existentes de desactivar
comprobaciones o descargas, y las restricciones de versiones de una organización.

El catálogo propio evita depender del número de versión aprobado por el Den
original de OpenWork. Las descargas del catálogo usan el transporte HTTP de
Electron para resolver las redirecciones de GitHub sin depender de CORS.
No se incorpora un token de GitHub en la app: las releases deben ser públicas.

Los identificadores de aplicación, directorios de datos y nombres técnicos de
los artefactos `openwork-*` se conservan para no cambiar las rutas de instalación
y los datos existentes. Los documentos de trabajo no forman parte del instalador.
El mecanismo existente del pack sigue conservando las skills personalizadas y
dejando las nuevas versiones en archivos `.nuevo` cuando hay conflicto.

## Primera instalación y alcance

La primera instalación debe hacerse con un instalador creado por este circuito.
Una instalación antigua que todavía apunta a `different-ai/openwork` necesita
reemplazarse una vez con el instalador propio. Un checkout ejecutado en modo
desarrollo no se actualiza como una app empaquetada.

Esta primera implementación publica Windows y Linux x64. En Linux debe usarse
el AppImage para este circuito de autoactualización; no el archivo `.tar.gz`.
Windows se publica sin firma de código, siguiendo el camino de empaquetado sin
firma existente: el sistema puede mostrar avisos de editor desconocido.
macOS, ARM64, alpha, cloud y enterprise no se publican por este workflow.
macOS requiere preparar firma y notarización antes de incorporarlo.

## Fallos, reintentos y pausa

- Si falla una validación o un build, la release anterior sigue siendo Latest.
- Si falla la subida, la release queda en borrador. Reejecutar el mismo workflow
  reutiliza la versión y el borrador del mismo commit.
- Reejecutar una versión ya publicada no vuelve a subir ni sustituir sus archivos.
- Una ejecución antigua no puede reemplazar una versión `1.0.N` más reciente.
- Para detener nuevas publicaciones, desactivar **Comex release** en Actions.
  Esto no retira una actualización que alguien ya haya descargado.
- Si una versión tiene un problema, publicar la corrección como otra versión
  superior. El mecanismo de recuperación existente puede ofrecer instaladores
  anteriores verificados; no se implementa un rollback automático por fallos.

## Verificación

```bash
node --test apps/desktop/electron/updater.test.mjs scripts/release/comex-artifacts.test.mjs
bun test apps/app/tests/comex-release-metadata.test.ts apps/app/tests/version-gate.test.ts
python3 pack/scripts/validar.py
```

Antes de anunciar el circuito como probado en producción, instalar una release
A en Windows y Linux, publicar B, y comprobar descarga e instalación al salir,
persistencia de chats y configuración, y conservación de una skill editada.
Las pruebas locales y la validación del workflow no reemplazan esa prueba A→B.

Esta modificación configura el circuito de distribución y corrige los destinos
de la distribución Comex; conserva el comportamiento y las preferencias del
actualizador existente. No agrega un flujo de producto ni cambia sus defaults,
por lo que no requiere una nueva feature del registro.
