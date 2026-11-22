---
name: captura-pantalla
description: Procedimiento para sacar una captura de pantalla de la app OpenWork en ejecución y mostrarla en el chat rápidamente. Usar cuando el usuario pida ver una foto/pantalla/captura.
---

# Captura de pantalla de OpenWork

## Cuándo usar
Cuando el usuario pida "mostrame una foto", "captura", "screenshot" de la app.

## Pasos
1. Verificar que la app está corriendo (proceso electron).
2. Obtener el target principal desde CDP:
   `curl -s http://127.0.0.1:9823/json/list`
3. Tomar la captura:
   - Enviar `Page.captureScreenshot` por WebSocket al target principal.
   - Guardar en `/tmp/opencode/screenshot.png`.
4. Servir el archivo:
   - `cd /tmp/opencode && python3 -m http.server 8765` (si no está corriendo).
5. Mostrar en el chat:
   - Incluir `![Captura](http://localhost:8765/screenshot.png)`.
   - También dar la URL por si no renderiza.

## Notas
- El servidor HTTP puede quedar corriendo para reutilizar.
- Si el target cambió, re-listar con `/json/list`.
---
name: captura-pantalla