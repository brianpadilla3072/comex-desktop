# Evaluación repetible de Comex

`scripts/comex-eval.mjs` evalúa archivos realmente escritos por un modelo a través del mismo servicio OpenCode que usa Comex. No necesita abrir Electron ni instalar dependencias. Es una herramienta de desarrollo, no cambia la selección de modelos de la app.

## Ejecutar con modelos reales

Con el servicio ya iniciado y los proveedores autenticados en OpenCode:

```bash
node scripts/comex-eval.mjs --endpoint http://127.0.0.1:4096 --engine v2 \
  --models proveedor/modelo,otro-proveedor/otro-modelo --runs 3 --out /tmp/comex-evaluacion
```

El nombre es `providerID/modelID` del catálogo del servicio; se conserva el resto de las barras del ID. El runner no elige ni cambia las cuentas del usuario. Para un único caso, usar `--only informe-con-fuentes` o `--only continuidad-y-correccion`. Se puede elegir `--engine v1` para un servicio legado. El endpoint debe apuntar al motor; v2 agrega `/api`, v1 usa las rutas nativas sin ese prefijo. Un endpoint de interfaz web no sirve.

Autenticación opcional desde el entorno: `COMEX_EVAL_TOKEN` (Bearer) o `COMEX_EVAL_USERNAME` y `COMEX_EVAL_PASSWORD` (Basic). No poner secretos en argumentos. También se aceptan `COMEX_EVAL_ENDPOINT`, `COMEX_EVAL_ENGINE` y `COMEX_EVAL_MODELS`. El runner nunca escribe credenciales, transcripciones ni cuerpos de errores HTTP en el reporte. Los IDs de sesiones y directorios temporales quedan en el reporte para inspección local.

Cada caso usa un directorio temporal nuevo. Las herramientas conservan los permisos del servicio: el runner no los concede automáticamente. Cada turno tiene un límite de 120 segundos, configurable con `--timeout-ms` (100 a 600000). Al fallar intenta interrumpir solo su sesión; no reintenta consumos automáticamente. Las sesiones y archivos se conservan para inspeccionar resultados. Un directorio temporal **no es un sandbox**: el motor sigue aplicando su propia política de herramientas. Este runner requiere que el servidor pueda leer/escribir los directorios temporales de la máquina que lo ejecuta; no usarlo contra un servidor remoto sin filesystem compartido.

## Qué se mide

- `informe-con-fuentes`: suma numérica y referencias exactas a dos registros locales de prueba. Comprueba las fuentes provistas, no la veracidad de páginas de internet.
- `continuidad-y-correccion`: checkpoint materializado y verificado al terminar el primer turno; segundo turno en la misma sesión, con conservación de cliente/moneda y corrección del total. No prueba reinicio del servicio ni recuperación después de cerrar la app.
- Completitud: proporción de checks deterministas aprobados leyendo el JSON real del disco. Un mensaje que diga «terminado» no aprueba un caso.
- Errores: fallos de ejecución, errores del asistente/herramientas, checkpoint inválido y archivo ausente/inválido. Un error de herramienta impide aprobar aunque el archivo final exista.
- Tiempo: duración real de creación de sesión, turnos y lectura de resultados.
- Costo USD y tokens: valores informados por OpenCode. Si falta un contador en cualquier mensaje de asistente, el total es `null` / «desconocido», nunca cero inventado. Un cero explícito del motor se preserva; no se verifica la factura del proveedor.

El runner guarda `results.json` y `comparison.md` después de cada caso. Un fallo posterior conserva las observaciones anteriores. El código de salida es 0 si todos los casos pasan, 1 si hay fallos medidos y 2 para errores de configuración/ejecución del comando. `--help` documenta los argumentos.

## Comparar y elegir modelos

```bash
node scripts/comex-eval.mjs --compare /tmp/corrida-a/results.json,/tmp/corrida-b/results.json \
  --out /tmp/comex-comparacion
```

Solo se combinan reportes con el mismo hash de suite y versión. La tabla muestra denominadores y tipo de evidencia. Para decidir usar el mismo conjunto de casos, mismo número de repeticiones y el mismo entorno/herramientas/permisos. Primero comparar tareas aprobadas, errores y referencias; después tiempo y costo conocido. El reporte no inventa un puntaje general ni un ranking automático. No alcanza para declarar paridad con Codex, calidad editorial, calidad de Word/Excel, seguridad o estabilidad de instalaciones.

El modo programático permite etiquetar `evidence: 'fixture'` en pruebas. La CLI siempre usa `live`; una fixture de transporte no es una corrida del modelo y no se mezcla con ella en la tabla. La suite está versionada y su hash cambia cuando cambian prompts, entradas o verificaciones.

## Verificación implementada

```bash
node --test scripts/comex-eval.test.mjs
```

Las pruebas verifican protocolo HTTP v2 con servidor fixture explícito, dos turnos, archivos/checkpoint, v1, autenticación Basic, propagación de errores, valores desconocidos y reportes persistidos. No abren la app de escritorio y no prueban inteligencia del modelo.

En esta sesión se encontró un servicio local en el puerto 4096. `/api/health` y el catálogo protegido respondieron 401. El recibo estándar de estado con URL/PID no estaba disponible; el archivo de configuración disponible solo contenía contraseña y tampoco autenticó con Basic. No se realizó inferencia ni se declara ninguna evaluación de calidad viva aprobada. Se necesita la conexión autenticada efectiva del servicio para obtener ese resultado.
