# Implementación y evidencia de las mejoras Comex

La implementación local cubre continuidad estructurada, panel de proyecto/Git, runtime de entregables, evaluación por modelo y verificación secuencial. Esto no equivale a certificar paridad con Codex: la evidencia local y la aceptación externa se registran por separado.

## Verificación reproducible

```bash
node scripts/comex-verify.mjs --out /tmp/comex-verificacion
```

Ejecutar con el Node requerido por el repositorio y con Bun/Python disponibles. `COMEX_BUN` y `COMEX_PYTHON` permiten indicar rutas explícitas sin modificar el sistema. El script ejecuta cada grupo en orden y los archivos Node con concurrencia 1. Incluye flags, servidor, evaluación, orquestador, distribución, pack, interfaz y typechecks.

El resultado está en `verification.json` y logs individuales acotados/redactados. Se escribe evidencia después de cada paso. Un timeout mata el árbol de procesos de ese paso; el resto de verificaciones independientes continúa. Errores de arranque/ejecución son `Failed`; skips o evidencia truncada son `Incomplete`.

- `localStatus`: gates locales observados en esa corrida.
- `externalAcceptance.status`: siempre `Incomplete` mientras falten pruebas externas reales.
- `status`: no puede ser `Passed` solo porque los tests locales pasan.
- El código de salida refleja los gates locales; consultar el JSON para la aceptación completa.

El runner no imprime variables de entorno ni argumentos de comandos. Redacta valores de variables de credenciales y patrones de autenticación antes de guardar logs. La redacción es defensa adicional, no un motivo para agregar credenciales a fixtures o a salidas de tests.

## Evidencia de evaluación y orquestación

Comandos verificados sobre el árbol de trabajo:

```bash
node --test scripts/comex-eval.test.mjs
node --test --test-concurrency=1 scripts/comex-verify.test.mjs
```

Evaluación: 9 pruebas aprobadas. Orquestación: 7 pruebas aprobadas. Las pruebas HTTP de evaluación usan una fixture explícita y no demuestran calidad de modelos reales. La consulta al servicio instalado encontró autenticación requerida (401); no se certificó inferencia viva. Detalles en [EVALUACION.md](EVALUACION.md).

La corrida final `tmp/comex-parity-verification-final/verification.json` verificó los diez grupos: nueve `Passed` y distribución `Incomplete`. Se aprobaron 173 pruebas en total, sin fallos; 6 pruebas de actualización se omitieron porque requieren macOS en este host Linux. Distribución ejecutó 71 casos: 65 aprobados y 6 omitidos. Typechecks del servidor y de la interfaz aprobados. El resultado local y general permanece `Incomplete` por esas omisiones y la aceptación externa pendiente.

Se comprobó además la interfaz contra servidor/OpenCode v2 reales: guardar resumen y crear worktree desde el panel con autorización de host suministrada al navegador de prueba. Las capturas están en los documentos de `comex-continuity` y `comex-git-workspace`. Los proyectos y datos de esa prueba son fixtures explícitos.

El runtime Python 3.12.12 portable de uv pasó construcción, reubicación e imports; produjo Word/Excel con `PATH=/nonexistent`. El Word sintético final se renderizó y se inspeccionaron sus tres páginas; se corrigió el índice vacío añadiendo resultados en caché antes de que Word actualice los números. Esto no valida la apariencia de todos los documentos ni el comportamiento de Microsoft Word/Excel.

`features-sync --check` pasó registro/esquema/reglas; la renderización del chart Helm se omitió porque Helm no está instalado. El workflow de release se validó como YAML y separa evidencias documentales de los artefactos que publica. No se ejecutó GitHub Actions ni se publicó una release.

Los resultados son de ese árbol y esa corrida: cambios posteriores requieren repetir los gates afectados. La evidencia del verificador no acredita la aceptación externa.

## Aceptación externa que sigue requiriendo evidencia

1. Trabajo académico completo con modelo autenticado y fuentes/campo reales.
2. Instalación de Windows en máquina limpia.
3. Actualización instalada de A a B conservando los datos del usuario.
4. Verificación del runtime documental en la instalación empaquetada limpia.
5. Revisión visual de documentos producidos.

La prueba sintética del pack comprueba generadores locales y estructura/contenido medible. No acredita investigación de mercado, encuestas, apariencia visual ni el instalador distribuido.

## Activación local

Las nuevas superficies quedan desactivadas por defecto hasta su despliegue controlado:

```bash
DEN_FEATURE_COMEX_CONTINUITY=true
DEN_FEATURE_COMEX_GIT_WORKSPACE=true
```

Son variables del proceso de la app/servidor, resueltas por el registro compartido. Al desactivar se conservan checkpoints y worktrees. El trabajo aislado se abre como otro proyecto; no se implementó traslado automático del chat, merge ni publicación de PR. Los puntos de recuperación se guardan explícitamente; no hay resumen automático de todo el historial. El evaluador compara resultados; no cambia por sí solo el modelo de producción.
