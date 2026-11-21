---
name: herramientas-cli
description: Usar herramientas de CLI (Devin, Claude Code, Codex, etc.) desde OpenWork para tareas largas o pesadas: invocación, modos de permiso, supervisión y reparación de lo que se rompa. Usar SIEMPRE que la persona pida delegar trabajo a un CLI, probar algo "de manera real", o cuando una tarea exceda lo razonable para el agente actual. También cuando se vea un error tras usar un CLI: se arregla, no se asume bien.
---

# Herramientas de CLI desde OpenWork

OpenWork puede invocar CLIs instalados (Devin, Claude Code, Codex, etc.) para
tareas largas o pesadas. La práctica acordada: **si algo funciona mal, lo
arreglamos nosotros; esto es probar de manera real. Cuando usamos un CLI, lo
que vemos roto lo arreglamos.**

## CLIs disponibles (verificar con `which` antes de usar)

**Recomendado (gratis, mucho uso):**
- `opencode` — OpenCode CLI. Modelo gratis: `opencode-go/hy4-flash-free` (y otros `*-free`).
  Invocación: `opencode run --auto -m opencode-go/hy4-flash-free "<prompt>"`.
  `--auto` auto-aprueba permisos no denegados explícitamente. Sin cuota, ideal para tareas largas.

**Otros:**
- `devin` — agente rápido, terminal + cloud. ⚠️ Tiene modelo gratis (SWE-2 Flash Medium, 262K, Free) pero la cuenta está sin cuota (out_of_quota / billing error) → no puede crear blueprint ni hacer trabajo real. Además, en `-p` rechaza tool calls con confirmación → no edita. Verificar `devin auth status` y cuota antes de usar.
- `claude` — Claude Code (CLI). Autenticado. `claude -p --dangerously-skip-permissions "<prompt>"`.
- `codex` — OpenAI Codex CLI. `codex exec "<prompt>"`.

Antes de invocar, confirmá que el binario existe y está autenticado.

## Invocación

**Devin (no interactivo):**
```
devin --permission-mode accept-edits --prompt-file <archivo.md> -p
```
- `--permission-mode`: `auto` (solo lectura), `accept-edits` (ediciones en workspace),
  `smart` (+ acciones seguras), `dangerous` (todo). Para trabajo real en el repo: `accept-edits`.
- `--prompt-file`: archivo con el prompt completo (mejor que inline para prompts largos).
- `-p` / `--print`: no interactivo, imprime y sale.
- Pasar el path del repo como argumento posicional si hace falta.

**Claude Code:**
```
claude -p "<prompt>"
```
(con `--permission-mode` según versión).

**Codex:**
```
codex exec "<prompt>"
```

## Supervisión (obligatoria)

1. Lanzar el CLI en segundo plano (background) y **no bloquear** el chat.
2. Polling: cada ~1–2 min revisar `ps` y `git status`/`git diff --stat`.
3. Cuando termina, **verificar**:
   - `git diff --stat` (qué cambió).
   - `pnpm typecheck` (app + server) si tocó código.
   - `bun test` sobre los archivos afectados.
   - `build:web` si tocó la app.
4. Si algo está roto (typecheck/test/build fallan, o el comportamiento es incorrecto): **arreglarlo nosotros**, no asumir que está bien. El CLI es una herramienta, el juicio es nuestro.
5. Si el CLI no hizo cambios (prompt muy largo, timeout, fallo silencioso): reportarlo y reintentar con un prompt más acotado o hacerlo a mano.

## Reglas
- No commits sin pedido explícito (regla del repo).
- Limpieza de recursos: matar solo los PIDs propios, borrar solo tu scratch (`/tmp/opencode/<tarea>/`).
- Si el CLI toca archivos que no debía, revertir con `git checkout -- <archivo>`.
- El prompt debe incluir: objetivo, archivos a tocar, restricciones (no commits, no tocar permisos/identidades), criterios de éxito (typecheck/tests), y referencia de formato si aplica.
- Para tareas muy largas, partir en fases y supervisar cada una.

## Prompt de contexto (para el agente)

> Esta app puede usar herramientas de CLI como Devin. Si algo funciona mal, lo arreglamos nosotros; esto es probar de manera real. Cuando usamos un CLI, lo que vemos roto lo arreglamos. Antes de invocar: verificar que el binario existe y está autenticado. Durante: supervisar con polling de git status/typecheck/tests. Después: verificar y reparar lo que falle. No asumir que el CLI hizo bien el trabajo.

## Referencias
- Devin: `devin --help`, `devin auth status`, `devin doctor`.
- Memoria del proyecto: `proyecto/estado.md` (sección de práctica con CLIs).