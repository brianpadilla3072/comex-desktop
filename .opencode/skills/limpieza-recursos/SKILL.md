---
name: limpieza-recursos
description: "Estándar obligatorio al terminar (o interrumpir) cualquier tarea: liberar procesos, puertos, tabs del navegador y archivos temporales propios SIN tocar los de otros agentes ni del usuario. Usar siempre que se levante un servidor, un mundo headless, un browser, un script de prueba, un worktree o un archivo temporal; y como checklist final de cada entrega."
---

# Limpieza de recursos (estándar del sistema)

Regla de oro: **limpiá solo lo que creaste**. Un checkout compartido puede tener otros
agentes trabajando; "limpiar" nunca puede significar matar su processes ni borrar sus archivos.

## 1. Al empezar: registrar dueño

Anotá en la nota mental de la tarea (o en un archivo de scratch) cada recurso que abras:

| Recurso | Qué registrar | Cómo |
|---|---|---|
| Servidor / vite / script | PID del proceso y de su padre | `echo $! > /tmp/opencode/<tarea>.pid` |
| Mundo headless | nombre del world y su `webUrl` | salida de `pnpm world up …` |
| Pestañas del browser | `tabId` devuelto | resultado de `browser_open` |
| Temporales | un **subdirectorio propio** | `/tmp/opencode/<tarea>/` |
| Worktree | ruta + rama | salida de `git worktree add` |

Usá siempre `/tmp/opencode` como raíz de scratch (pre-creado y aprobado), nunca `/tmp` genérico.

## 2. Al terminar: checklist (en este orden)

1. **Procesos**: matar solo los PIDs registrados. Antes de matar un proceso por puerto,
   identificar el dueño: `ss -ltnp | grep ':<puerto>'`. Si el PID no es tuyo, **no lo toques**.
2. **Verificar puertos**: `curl -s -o /dev/null -w "%{http_code}" --max-time 1 http://127.0.0.1:<puerto>/`
   debe dar `000` (cerrado). Un `world down` puede dejar un vite huérfano.
3. **Pestañas**: cerrar solo las de esta conversación con `browser_close` (por `tabId`).
   Si aparece `tab_limit`, liberar las propias antes de abrir otra.
4. **Temporales**: borrar **tu** subdirectorio (`rm -rf /tmp/opencode/<tarea>/`).
   **Nunca** `rm -rf /tmp/opencode` completo: contiene worktrees, spikes y datos de otros agentes.
5. **Mundos headless**: `pnpm world down <nombre>` y verificar el puerto (paso 2).
6. **Worktrees**: **no borrar** un worktree con cambios sin commitear sin confirmación explícita.
   Si se consolidó el trabajo en otro checkout, dejarlo como respaldo y decirlo.
7. **Archivos de verificación temporales** (tsconfigs, scripts de test ad-hoc): borrarlos en el
   mismo paso en que se usan.
8. **Memoria**: si el tramo fue significativo, actualizar `proyecto/estado.md` con lo hecho y lo
   pendiente, para que otro agente no repita el trabajo.

## 3. Senales de que quedó algo sucio

- `ss -ltnp` muestra un vite/node con tiempo de ejecución similar al de tu tarea.
- `pgrep -af '<tu script>'` devuelve PIDs.
- `du -sh /tmp/opencode` creció respecto al inicio y el delta no es de otro agente.
- Un `browser_tabs` con pestañas que ya no se usan.

## 4. Casos límite

- **Node**: el repo puede pedir Node ≥24 mientras el sistema tiene 22. Usar el binario en caché
  de `pnpm dlx node@24` con `--experimental-strip-types` para scripts `.mjs/.ts`; no instalar
  nada global ni dejar binaries sueltos.
- **Error ajeno en typecheck**: aislar con un `tsconfig` temporal que excluya ese archivo,
  verificar, y borrar el tsconfig enseguida. No modificar el archivo ajeno.
- **No confundir "limpio" con "commiteado"**: no hacer commit sin pedido explícito.

## 5. Entrega

En el resumen final, declarar explícitamente qué se limpió y qué se dejó (y por qué), por ejemplo:
"Maté solo mi vite del 5178; los otros dos vite son de otro agente. Borré mi `/tmp/opencode/<tarea>`;
el resto de `/tmp/opencode` es de otros agentes y no se tocó."
