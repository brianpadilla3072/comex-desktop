# Estado inicial de Comex Desktop

Inicio: 05/11/2026.

## Base

- Fork: https://github.com/brianpadilla3072/comex-desktop
- Upstream: https://github.com/different-ai/openwork (rama `dev`).
- Commit de partida: `7c2b45414b57d11e03994e5adbaed2a7cf8b3024`.
- Rama de implementación: `comex/bootstrap`.
- Nombre de trabajo del repositorio: Comex Desktop; marca final pendiente.
- Node requerido por upstream: `>=24.22.1 <25`.
- Gestor fijado por upstream: `pnpm@11.4.0`.

## Incorporado

- `pack/`: copia inicial del pack local, con 12 herramientas y 4 asistentes.
- Especificación, plan y propuesta en `docs/comex/`.
- `.github/workflows/comex-pack.yml`: preparado localmente para validar el pack en pushes y PRs. No publicado: la sesión OAuth de GitHub carece del alcance `workflow`.
- Remotes locales `origin` (fork) y `upstream` (OpenWork), y `rerere` habilitado.

La validación de formato pasó localmente. No prueba la carga real en OpenWork ni los flujos de producto.

## Próximo tramo

1. Configurar Node y pnpm exactos y verificar el build del escritorio.
2. Implementar seed con hashes por archivo, actualización sin sobreescritura de cambios y pruebas de dos actualizaciones consecutivas.
3. Integrar el pack en recursos del instalador y arranque local.
4. Marca, bienvenida en castellano, privacidad y releases propios.
5. Generación de Word/Excel sin Python instalado por la usuaria.
6. Probar los criterios de aceptación en Windows limpio.

## Límites actuales

Este primer commit prepara el fork: todavía no modifica la app ni instala automáticamente el pack. No hay instalador Comex ni release publicada. Los workflows, el updater y la telemetría heredados aún requieren adaptación antes de distribuir. El instalador Electron no fue compilado. El frontend sí pasó TypeScript y build de producción usando el runtime Node 24.22.1 disponible en Codex y pnpm 11.4.0; el Node por defecto de la shell sigue siendo 22.

La especificación prevalece sobre el plan cuando difieren: `.md` como alternativa no satisface los entregables Word/Excel del MVP. Las capacidades posteriores al MVP y los criterios 16/17 deben reconciliarse al cerrar el alcance. La licencia propia del pack sigue pendiente; no se agrega una declaración de licencia sin esa decisión.

## Actualización del TP 1 de 2026

El pack se sincronizó con las instrucciones locales para los dos productos y destinos distintos, encuesta real, logística e Incoterm, informe y defensa. El protocolo está en `aceptacion-tp1-2026.md`; la matriz está en `pack/skills/estudio-mercado-internacional/references/tp1-2026.md`. Los enlaces relativos copiados de la documentación original deben resolverse según estas ubicaciones del fork.

Sincronizar archivos no integra el pack en el arranque. La validación estructural tampoco demuestra investigación real, carga de herramientas ni generación de entregables en la app. El flujo completo sigue pendiente. No se prometen respuestas de encuesta inventadas ni generación automática de PowerPoint.

## Acabado visual

Se aplicó el tema oscuro neutro con la distribución del chat existente y marca Comex. La maqueta y las capturas están documentadas en `diseno/README.md`. Los bloques de resultados, fuentes y estado del campo de esa maqueta aún no están conectados a datos de sesión.
