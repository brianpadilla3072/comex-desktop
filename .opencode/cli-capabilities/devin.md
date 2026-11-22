# Capacidades de Devin (probe)

Fecha: 2026-11-21
Binario: /home/brian/.npm-global/bin/devin
Versión: 3000.14.30821

## Autenticación y cuota
- Autenticado: sí (Brian Padilla, Free tier).
- Cuota: **out_of_quota** (billing error) en tareas pesadas (blueprint, trabajo largo).
- Modelos: SWE-2 Flash Medium (262K, Free) disponible, pero bloqueado por cuota de org.

## Modos de permiso
- `auto`: solo lectura.
- `accept-edits`: ediciones, pero en `-p` (print) rechaza tool calls con confirmación → no edita.
- `smart`: + acciones seguras.
- `dangerous`: auto-aprueba todo → **sí edita** (probado: creó, leyó y borró archivo).

## Capacidades
- ✅ Responder texto/análisis (razonamiento).
- ✅ Comandos de solo lectura (`ls`, `cat`, `grep`, etc.).
- ✅ Ediciones con `--permission-mode dangerous` (probado).
- ❌ Tareas pesadas (blueprint, trabajo largo) — bloqueado por cuota.
- ❌ No ve pantalla ni contexto fuera de la terminal.

## Cuándo usar
- Tareas cortas/medianas que requieran edición: usar `--permission-mode dangerous`.
- Análisis/razonamiento: usar como cerebro de texto (`devin -p "..."`).
- Para tareas largas: preferir OpenCode (gratis, sin cuota limitante).

## Límites
- Cuota de organización (out_of_quota) en tareas pesadas.
- Print mode rechaza confirmaciones salvo `dangerous`.
- No garantiza verificación visual real.