# Medición de RAM y CPU de Comex

Fecha local: 6 de noviembre de 2026.

Se ejecutó Electron 43.8.1 real con una compilación nueva de producción del frontend, servidor embebido y motores OpenCode reales. La shell se ejecutó sin empaquetar, en modo de desarrollo y con perfil nuevo. No hubo Vite, inferencia ni acceso a proyectos personales. El historial importado contiene 400 mensajes sintéticos y 256.035 caracteres.

La ventana usó Ozone headless con viewport y pantalla emulados a 1280 × 800. Se inspeccionó una captura real para comprobar que el historial estaba renderizado. Las primeras pruebas a 1 × 1 píxel y durante errores de preparación se descartaron.

## Resultados

Cada escenario se midió durante 30 segundos, con lecturas aproximadamente cada segundo. RAM en MiB; CPU normalizada al equipo de cuatro núcleos lógicos (100 % equivale a ocupar los cuatro).

| Escenario | RAM PSS media | RAM PSS pico | RAM RSS sumada media | CPU media del equipo |
| --- | ---: | ---: | ---: | ---: |
| Conversación vacía, tras cargar | 1260.9 MiB | 1313.3 MiB | 1697.8 MiB | 4.1 % |
| Historial de 400 mensajes, sin interacción | 1261.0 MiB | 1316.8 MiB | 1704.3 MiB | 2.7 % |
| Desplazamiento continuo del historial | 1313.2 MiB | 1349.6 MiB | 1756.1 MiB | 18.0 % |
| Reposo después del desplazamiento | 1300.7 MiB | 1349.7 MiB | 1744.1 MiB | 2.1 % |

PSS reparte las páginas de memoria compartidas entre procesos y permite estimar la RAM física atribuible al conjunto. La suma RSS puede contar esas páginas varias veces; no debe compararse directamente con PSS. No faltaron lecturas de PSS en las mediciones válidas.

El desplazamiento se generó cada 50 ms, con pasos de 220 píxeles y cambio de dirección en los extremos. Representa desplazamiento sostenido, no lectura quieta. Los límites de carga incremental del historial se mantuvieron; no se forzó a montar los 400 mensajes a la vez.

## Qué consume memoria

Distribución media durante el historial quieto:

| Grupo | RAM PSS media | Procesos máximos |
| --- | ---: | ---: |
| Motores de agentes | 855.5 MiB | 2 |
| Proceso principal y servidor embebido | 142.1 MiB | 1 |
| Utilidades y zygotes | 53.9 MiB | 3 |
| Proceso gráfico | 64.5 MiB | 1 |
| Interfaz | 144.9 MiB | 1 |

Había dos procesos de motor. La API del runtime confirmó un motor administrado por el servidor y otro v2 con chatRouting activo y v2Only desactivado. Los motores representan aproximadamente el 68 % de la PSS durante ese escenario. Conviene investigar la convivencia de ambos antes de atribuir todo el consumo a Electron. Esta prueba no determina que uno pueda eliminarse sin afectar compatibilidad o tareas.

## Alcance y límites

- Se incluyeron los ocho procesos identificados del árbol de Electron y sus motores; el muestreador y otras aplicaciones se excluyeron de las sumas.
- El equipo tenía otras aplicaciones activas. Su ocupación total varió aproximadamente entre el 48 % y el 67 % de CPU media durante los escenarios; las latencias y los picos son orientativos.
- No se probó un instalador, Windows, una sesión de inferencia, el visor Office ni pestañas adicionales del navegador integrado.
- Unos minutos de prueba no permiten afirmar ni descartar una fuga de memoria.
- El modo sin pantalla y las opciones de sandbox de la prueba no reproducen todas las condiciones gráficas de un escritorio normal.

## Reproducibilidad y evidencia

El muestreador reutilizable es `scripts/comex-resource-sample.py`:

```bash
python3 scripts/comex-resource-sample.py --pid PID_DE_LA_APP --seconds 30 --out informe-nuevo.json
```

Es de solo lectura y específico de Linux. Lee contadores de CPU de `/proc/<pid>/stat` y PSS de `/proc/<pid>/smaps_rollup`. La salida distingue CPU por núcleo y total del equipo. Rechaza sobrescribir informes existentes.

Evidencia local en `tmp/comex-resource-test/valid-1280x800/`: `summary.json`, `run.json`, los cuatro informes con muestras, `history-1280x800.png` y `cleanup.json`. Las credenciales privadas de preparación se guardaron fuera de esos informes, con permisos 0600.

La preparación descubrió que el navegador Electron importaba `@openwork/features` sin declararlo como dependencia del escritorio. Se agregó la dependencia de workspace; el arranque real confirmó que quedó resuelta. No se cambiaron los motores ni su política para obtener las cifras. Al terminar se detuvieron los motores desde el puente nativo y se cerraron los procesos de prueba.
