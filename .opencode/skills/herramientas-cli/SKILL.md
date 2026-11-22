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
- `devin` — agente rápido, terminal + cloud. Tiene modelo gratis (SWE-2 Flash Medium, 262K, Free). En `-p` rechaza tool calls con confirmación a menos que se use `--permission-mode dangerous` (ahí sí edita, probado). La cuenta tiene cuota limitada (out_of_quota en tareas pesadas): para tareas largas preferir OpenCode; Devin sirve para tareas cortas/medianas. Verificar `devin auth status` antes de usar.
- `codex` — OpenAI Codex CLI. `codex exec "<prompt>"`. Con cuota limitada.
- `gemini` — Gemini CLI (v0.70.0). ⚠️ Cuota excedida (429) en free tier → no usable ahora (retry en ~6h). Requiere `--skip-trust` en headless y `rg` en PATH. Probe guardado en `.opencode/cli-capabilities/gemini.md`.

**Nunca usar Claude Code** (`claude`). Reservar para casos donde no haya alternativa y con confirmación explícita.

Antes de invocar, confirmá que el binario existe y está autenticado.

## Probe de capacidades (solo cuando el usuario lo pide)

El probe se hace **solo cuando el usuario dice explícitamente** "quiero configurar el CLI de X"
(o similar). No se hace automáticamente ni en cada uso.

**Dónde se guarda:** `.opencode/cli-capabilities/<cli>.md` (y opcionalmente en `proyecto/estado.md`).
Antes de usar un CLI, leer el probe guardado. Si no existe, **no probar por iniciativa propia**:
preguntar al usuario si quiere configurarlo, o usar un CLI que ya tenga probe.

**Después del probe:** el alcance queda guardado. En usos futuros, si una tarea es acorde a las
capacidades de un CLI disponible (según su probe), se delega automáticamente a ese CLI
(sin re-probar). No es necesario que el usuario lo pida de nuevo.

**Nunca usar Claude Code** (`claude`), salvo pedido explícito del usuario.

**Probe (una sola vez por CLI):**
1. `which <cli>` y `<cli> --version` / `<cli> --help` → confirmar que existe.
2. `<cli> auth status` / `<cli> doctor` → confirmar autenticación y cuota.
3. Probe de lectura: `<cli> -p "lee <archivo> y reporta su contenido"` (o equivalente).
4. Probe de escritura: `<cli> --permission-mode dangerous -p "crea /tmp/opencode/probe.txt con 'ok' y léelo"` (o equivalente).
5. Registrar el resultado en `.opencode/cli-capabilities/<cli>.md` (y opcionalmente en `proyecto/estado.md`): qué puede hacer, qué no, modos de permiso, cuota, límites.

**Uso posterior:** leer el probe guardado para saber el alcance; no re-probar salvo que el
CLI falle o cambie de versión.

**Nunca asumir** que un CLI puede hacer algo: probarlo la primera vez. Lo que vemos roto
lo arreglamos / cambiamos de herramienta.

## Matriz de decisión (para no gastar tokens)

Antes de ejecutar una tarea, leer el probe guardado (`.opencode/cli-capabilities/<cli>.md`):

| Tarea | CLI puede hacerla (según probe) | Acción |
|---|---|---|
| Análisis/razonamiento | Sí (gratis) | Delegar al CLI, nosotros aplicamos |
| Edición de archivos | Solo si tiene tools + permisos | Delegar si `--auto`/`dangerous` funciona; si no, nosotros editamos |
| Tarea larga/pesada | Solo si tiene cuota | Delegar si hay cuota; si no, partir o hacer a mano |
| Lectura de archivos | Sí (siempre) | Delegar (ahorra tokens) |
| Verificación (typecheck/tests) | Sí | Delegar o hacer nosotros (barato) |

**Regla:** si el probe dice que el CLI no puede hacer la tarea (sin cuota, sin tools, sin permisos),
no gastar tokens intentándolo: hacerla nosotros o cambiar de CLI.

## Invocación

**Devin (no interactivo):**
```
devin --permission-mode dangerous --prompt-file <archivo.md> -p
```
- `--permission-mode`: en `-p` (print mode), `accept-edits`/`auto` rechazan tool calls que requieren
  confirmación → usar `dangerous` para auto-aprobar todo. (`auto` solo lectura, `accept-edits`
  ediciones, `smart` + acciones seguras, `dangerous` todo.)
- `--prompt-file`: archivo con el prompt completo (mejor que inline para prompts largos).
- `-p` / `--print`: no interactivo, imprime y sale.
- Pasar el path del repo como argumento posicional si hace falta.
- ⚠️ La cuenta tiene cuota limitada (`out_of_quota`): tareas pesadas (blueprint, trabajo largo)
  pueden fallar. Para tareas largas, preferir OpenCode (gratis). Devin sirve para tareas cortas/medianas.

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