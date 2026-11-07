# Puntero del agente en el navegador

`browserAgentPointer` · self_hosted · brianpadilla3072 · desactivada por defecto.

La implementación local existente envía al preload del navegador Electron el estado de control del agente y muestra su puntero cuando está activo. Se resuelve mediante el registro compartido, con `DEN_FEATURE_BROWSER_AGENT_POINTER=true` para habilitarlo. No concede permisos de navegación ni modifica las aprobaciones. Al desactivar desaparece el indicador y se conserva el navegador.

Este documento completa la referencia de un cambio local previo. Esta iteración no verificó visualmente el puntero nativo en Electron; la captura y aceptación de ese cambio siguen pendientes. No se usa una captura de Chromium web como prueba del navegador nativo.
