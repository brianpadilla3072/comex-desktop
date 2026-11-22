---
name: cerebro-cli
description: Usar un CLI gratis como "cerebro" (razonamiento) y nosotros ejecutamos los tools: estrategia para no gastar tokens. Aplica por defecto cuando se usa un CLI sin tools (print mode). Usar SIEMPRE que la persona pida delegar análisis/razonamiento a un CLI, o cuando se quiera ahorrar tokens. Nunca usar Claude Code. Intentar que sea escalable.
---

# Cerebro CLI — razonamiento gratis, ejecución nuestra

**Principio:** el razonamiento pesado (análisis, diseño, plan, generación de código) lo hace un
CLI con modelo gratis; nosotros solo leemos su salida, aplicamos los cambios concretos (ediciones
pequeñas y dirigidas) y verificamos (typecheck/tests). Así gastamos nuestros tokens solo en
ejecución y verificación, no en razonamiento.

**Nunca usar Claude Code** (`claude`). Usar OpenCode (gratis) o Devin (solo texto).

## Probe de capacidades (solo cuando el usuario lo pide)

El probe se hace **solo cuando el usuario dice explícitamente** "quiero configurar el CLI de X".
No se hace automáticamente ni en cada uso.

**Dónde se guarda:** `.opencode/cli-capabilities/<cli>.md`. Antes de usar un CLI, leer el
probe guardado. Si no existe, preguntar al usuario si quiere configurarlo, o usar un CLI que
ya tenga probe.

**Después del probe:** el alcance queda guardado. En usos futuros, si una tarea es acorde a
las capacidades de un CLI disponible (según su probe), se delega automáticamente a ese CLI
(sin re-probar).

**Nunca usar Claude Code** (`claude`), salvo pedido explícito del usuario.

## Herramientas (en orden de preferencia)
1. **OpenCode** (`opencode run --auto -m opencode-go/hy4-flash-free "..."`) — gratis, ya probado, auto-aprueba. **El cerebro principal.** Puede editar si se le permite; si no, solo razona.
2. **Devin** (`devin --permission-mode dangerous -p "..."`) — puede editar en modo dangerous, pero la cuenta tiene cuota limitada (out_of_quota): sirve para tareas cortas/medianas. Para tareas largas, preferir OpenCode.
3. **Codex** (`codex exec "..."`) — con cuota limitada; reservar.

## Flujo (por defecto al usar un CLI sin tools)
1. Formular la pregunta/análisis como prompt (archivo en `/tmp/opencode/<tarea>.md`).
2. Invocar el CLI en segundo plano, capturar su salida (texto).
3. **Nosotros** leemos la salida, decidimos qué aplicar, hacemos las ediciones (pequeñas, dirigidas).
4. Verificamos: typecheck + tests + build (nuestro costo es mínimo).
5. Si algo está roto: lo arreglamos nosotros (no asumimos que el CLI hizo bien).

## Para no gastar tokens (escalable)
- Pedir al CLI que devuelva **solo lo necesario**: plan en bullets, snippets acotados, no explicaciones largas.
- Evitar re-leer archivos grandes nosotros; delegar el análisis al CLI y pedirle "qué cambiar y dónde".
- Usar `--format json` si ayuda a parsear.
- No repetir el mismo análisis: guardar el resultado en `/tmp/opencode/` y reutilizar.
- Para tareas largas, partir en fases y supervisar cada una (polling de `ps` + `git diff`).
- Si el CLI es de solo texto (sin tools), usarlo como cerebro puro: él razona, nosotros ejecutamos.

## Estrategia escalable
- **Batch de análisis**: mandar al CLI varias preguntas en un solo prompt (no una por una).
- **Caché de resultados**: guardar la salida en `/tmp/opencode/<tarea>.md` y reutilizar en sesiones futuras.
- **Verificación mínima**: solo typecheck + tests de los archivos tocados, no el suite completo.
- **Fallback**: si el CLI falla o deja algo roto, lo arreglamos nosotros / cambiamos de herramienta.

## Prompt de contexto (para el agente)

> Esta app puede usar herramientas de CLI como cerebro (razonamiento gratis) y nosotros ejecutamos los tools. Si algo funciona mal, lo arreglamos nosotros; esto es probar de manera real. Cuando usamos un CLI, lo que vemos roto lo arreglamos. Nunca usar Claude Code. Usar OpenCode (gratis) como cerebro principal. Devin puede editar en modo dangerous pero tiene cuota limitada (out_of_quota): usarlo para tareas cortas/medianas. Pedir al CLI salida acotada (bullets/snippets). Guardar resultados en /tmp/opencode/ y reutilizar. Verificar con typecheck/tests.

## Referencias
- Memoria del proyecto: `proyecto/estado.md` (sección de práctica con CLIs).
- Skill relacionada: `herramientas-cli`.