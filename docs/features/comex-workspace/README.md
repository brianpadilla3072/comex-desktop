# Espacio Comex

`comexWorkspace` · `self_hosted` · autor: `brianpadilla3072`.

Esta distribución local de Comex activa la integración por defecto, sin exigir una cuenta de Den. El operador puede desactivarla con `DEN_FEATURE_COMEX_WORKSPACE=false`; la decisión pasa por el registro compartido de features. No está disponible en cloud.

## Comportamiento

- Al abrir un proyecto, instala los 4 agentes y las 12 skills de `pack/` en `.opencode/`. Las actualizaciones reemplazan solamente archivos oficiales sin modificaciones. Si la estudiante personalizó un archivo, conserva su versión y deja la actualización en `.nuevo` (con sufijo de hash si ya había otra actualización).
- El panel Proyecto lista archivos reales del proyecto, fuentes y cumplimiento. Abre resultados solamente cuando la persona lo pide (DESIGN S5). Reutiliza los paneles de archivos, Excel y navegador existentes (P5).
- Los DOCX se muestran en un visor de lectura con ajuste de ancho. No edita Word; la paginación puede diferir de Microsoft Word. Utiliza [docx-preview](https://github.com/VolodymyrBaydalka/docxjs), cargado bajo demanda. Valida el ZIP y sus tamaños descomprimidos; desactiva fragmentos HTML, elimina vínculos activos y sanitiza el contenido. El iframe tiene sandbox sin permisos y CSP sin conexiones externas.
- La memoria del proyecto se guarda en `comex/estado.md`. Cada chat conserva notas propias en `comex/sesiones/<id>.md`. Se pueden revisar y guardar desde Proyecto. Los borradores sin guardar se conservan localmente y las escrituras verifican la versión del archivo. Si otra sesión cambió la memoria, muestra ambas versiones antes de permitir guardar; se pueden recuperar las notas descartadas durante esa comparación.
- En cada turno de OpenCode v2 se incorporan hasta 12.000 caracteres de memoria del proyecto y 6.000 de la sesión actual, como datos no confiables. Los archivos de más de 128 KiB se omiten del contexto automático. Se instruye al asistente principal a actualizar resúmenes trazables al cerrar un tramo significativo; esto depende del comportamiento del modelo. La memoria no equivale a todo el historial de otros chats. Los auditores mantienen sus permisos de solo lectura.
- El inicio ofrece tres pedidos en castellano: TP de investigación, cotización y revisión de informe/fuentes.
- La conexión de proveedores en OpenCode v2 usa `/api/integration` para descubrir métodos y los endpoints nativos `connect/key` y `connect/oauth`. OpenCode Console permite iniciar sesión con la cuenta; Go conserva su conexión por clave. Comex habilita Console al estar activa la feature y permitidos los proveedores propios; la restricción de modelos de la organización sigue prevaleciendo. La capa nunca consulta el listado de credenciales, que devolvería secretos. Referencia: [API oficial de OpenCode v2](https://dev.opencode.ai/v2/docs/api).
- El navegador nativo de Electron conserva sus controles y herramientas existentes. El botón Abrir navegador utiliza ese mismo panel. La versión web no ofrece el navegador nativo.
- El empaquetado incluye `pack/` como recurso externo y comunica su ubicación al servidor.

## Desactivación

El interruptor oculta el panel Comex y el visor Word nuevo; deja de instalar/actualizar el pack y de incorporar memoria automática a los turnos v2. Conserva los documentos, notas y chats. Los agentes, skills e instrucciones AGENTS.md ya instalados siguen en la carpeta: desactivar no los desinstala ni borra personalizaciones. El navegador y Excel existentes siguen disponibles.

## Evidencia

Capturas de la aplicación real con documentos de ejemplo explícitos; no representan una investigación terminada. Se mantuvo el chat como superficie principal, controles compartidos y paneles por acción de la persona (DESIGN P5, P7, P10, S5).

### Word

![Word real](word.png)

### Excel

![Excel real](excel.png)

### Memoria del proyecto

![Memoria persistente del proyecto](memoria.png)

### Memoria de sesión

![Memoria separada de sesión](sesion.png)

### Conflicto de memoria

![Comparación de notas](conflicto-memoria.png)

### Conexión de cuenta

![Proveedores nativos](proveedores.png)

### Navegador nativo

![Navegador Electron](navegador.png)

## Validación y límites

Resultado global: **Incomplete**. La integración local tiene pruebas verdes; falta la validación académica con modelo, campo real y una instalación Windows limpia.

Batería reproducible: `pnpm test:comex` (Node 24, pnpm fijado por el repositorio, Bun y Python con python-docx/openpyxl). Son 67 pruebas: registro de features (26), instalación/memoria (8), panel (5), visor Word (2), generadores (6), autenticación nativa (6), errores de conexión (4) y reglas de acceso a Console (6) y presentación de errores de credenciales (4). Ninguna omitida.

Mejoras verificadas en los generadores: códigos HS/país como texto, decimales en ambos formatos, rechazo de valores no finitos, respuestas multilínea intactas y fórmulas importadas tratadas como datos literales. La cotización rechaza costos negativos o no finitos.

Verificado en Linux:

- `python3 pack/scripts/validar.py`: 12 skills y 4 agentes válidos.
- `node --import ./apps/server/node_modules/tsx/dist/loader.mjs --test apps/server/test/comex-workspace.test.ts`: actualizaciones y conflictos del pack, symlinks rechazados, memoria persistente separada por sesión e interruptor del operador.
- Typecheck de app y servidor; compilaciones del servidor y frontend. El control de features no pudo renderizar Helm porque Helm no está instalado.
- Integración de UI con servidor y motor reales: abrir DOCX y XLSX, guardar memoria, recargar y volver a leer, guardar notas de otro alcance. Sin errores de página.
- Validación en Chromium del visor DOCX: rechazo de ZIP excesivo y DTD; exclusión de altChunk y CSP presente.
- Regresiones adicionales: 3 pruebas de inicio de workspace, 5 de instrucciones v2 y 12 del navegador nativo (incluido Chromium real) pasan.
- El motor enumera los 4 agentes y las 12 skills instalados (además de las skills globales existentes).
- Navegación nativa de Electron a INDEC con título y URL reales.

La prueba de UI adicional confirmó comparación/resolución de conflictos con archivos reales; la desactivación en UI se comprobó simulando la respuesta del endpoint de feature, además de las pruebas del resolvedor del servidor. El catálogo de autenticación se consultó en Chromium contra el motor real: Console devuelve clave y cuenta OAuth, Go devuelve clave. Prueba real posterior: se reutilizó la conexión Go ya guardada en el equipo dentro del perfil local de Comex y se envió un único mensaje de prueba con `opencode-go/gpt-6-luna`. El proveedor respondió HTTP 401 con `api_key_expired`; no se obtuvo una respuesta de inferencia. La clave debe reemplazarse desde la consola de OpenCode. Reautenticarse no renueva una clave vencida. No se registraron claves en el repositorio ni en capturas.

La presentación v2 ahora conserva `response.body`, identifica `api_key_expired` y explica la renovación en castellano. Una conexión que el motor ya marca `needs_auth` no se anuncia como conectada después de guardar. Go aparece junto a Console en la lista de proveedores y tiene el enlace Obtener una clave nueva.

![Error real de clave vencida](clave-vencida.png)

![Reemplazar clave de Go](reconectar-go.png)

No se ejecutó una investigación completa mediante un modelo, ni se verificó la generación autónoma del informe académico. Los generadores del pack requieren sus dependencias Python. Las encuestas necesitan respuestas reales. No se generó ni validó un instalador Windows/macOS ni una presentación PowerPoint. El siguiente hito es ejecutar el caso TP1 con proveedor configurado, contrastar sus fuentes y evaluar los entregables con `pruebas/casos/tp1-2026/criterios.md` en el proyecto padre.
