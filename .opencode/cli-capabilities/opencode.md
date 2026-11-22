# Capacidades de OpenCode (probe)

Fecha: 2026-11-21
Binario: /home/brian/.opencode/bin/opencode
Versión: v2.2.0

## Autenticación y cuota
- Sin autenticación requerida para modelos free.
- Modelos gratis disponibles: `opencode-go/hy4-flash-free`, `opencode-go/longcat-2.5-free`, `opencode-go/iceman-contributor-free`, etc.
- Sin cuota limitante para modelos free (probado).

## Modos de permiso
- `--auto`: auto-aprueba permisos no denegados explícitamente → **edita archivos** (probado).
- Sin `--auto`: interactivo.

## Capacidades
- ✅ Razonamiento (análisis, diseño, plan, generación de código).
- ✅ Edición de archivos con `--auto` (probado: migró consumidores a v2).
- ✅ Ejecución de comandos (typecheck, tests, build).
- ✅ Tareas largas (probado: migración completa de consumidores).
- ✅ Modelos gratis con mucho uso.

## Cuándo usar
- **Cerebro principal y ejecutor** para tareas largas/medianas.
- Invocación: `opencode run --auto -m opencode-go/hy4-flash-free "<prompt>"` o `--prompt-file`.
- Pasar el path del repo como argumento posicional.

## Límites
- Requiere el servidor de OpenCode corriendo (o `--standalone`).
- Modelos free pueden tener rate limits ocasionales.