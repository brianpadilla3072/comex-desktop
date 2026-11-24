---
name: limpieza-recursos
description: "Estándar obligatorio al terminar (o interrumpir) cualquier tarea: liberar procesos, puertos, tabs del navegador y archivos temporales propios SIN tocar los de otros agentes ni del usuario. Usar siempre que se levante un servidor, un mundo headless, un browser, un script de prueba, un worktree o un archivo temporal; y como checklist final de cada entrega."
---

# Limpieza de recursos (estándar del sistema)

Regla de oro: **limpiá solo lo que creaste**. Un checkout compartido puede tener otros
agentes trabajando; "limpiar" nunca puede significar matar su processes ni borrar sus archivos.

**Regla dura:** ningún agente da un tramo por terminado sin haber registrado cada recurso que
abrió y sin que `pnpm check:resource-cleanup` termine con código 0. Anotar el PID en la nota
mental **no cumple**: el registro machine-readable es el único comprobante. El guardián adopta
por sí mismo las sesiones de `pnpm dev-agent` (lee `tmp/dev-agent/<sesion>/session.json`) y los
worlds de verificación levantados con `pnpm world up dev-app-web` (lee su snapshot en
`evals/results/.worlds/scripts/`: PID y puertos de `webUrl`/`openworkUrl`/`cdp`, nunca tokens ni
rutas; se libera al bajar con `pnpm world down`). Todo lo demás — spawn directo, servidores,
puertos, tabs y rutas — se registra a mano. Un check en rojo no se "arregla" matando por
heurística ni tocando el registro de otra sesión.

## 1. Al empezar: registrar dueño

Anotá en la nota mental de la tarea cada recurso que abras **y registralo en el guardián apenas
lo abras**, con un nombre de sesión estable (minúsculas, dígitos y guiones):

| Recurso | Registro en el guardián | Qué pasar |
|---|---|---|
| Servidor / vite / script | `pnpm resource-cleanup add <sesion> pid <pid>` | la `cmdline` como cuarto argumento (detecta reuso de PID) |
| Mundo headless / puerto | `pnpm resource-cleanup add <sesion> port <puerto>` | `dev-app-web` ya se adopta solo; si no, el puerto devuelto por `pnpm world up …` |
| Pestañas del browser | `pnpm resource-cleanup add <sesion> tab <tabId>` | el `tabId` de `browser_open` |
| Temporales | `pnpm resource-cleanup add <sesion> path /tmp/opencode/<tarea>` | tu subdirectorio propio |
| Worktree | `pnpm resource-cleanup add <sesion> path <ruta>` | ruta devuelta por `git worktree add` |

El registro vive en `tmp/resource-cleanup/<sesion>.json` (gitignored) y es la **única** prueba
de dueño que acepta el guardián: sin registro, un proceso es invisible a propósito (nunca se
infiere dueño por puerto, nombre ni antigüedad). Las pestañas no se pueden sondear desde Node:
para ellas el `release` explícito es obligatorio.

Usá siempre `/tmp/opencode` como raíz de scratch (pre-creado y aprobado), nunca `/tmp` genérico.

## 2. Al terminar: checklist (en este orden)

1. **Procesos**: matar solo los PIDs registrados. Antes de matar un proceso por puerto,
   identificar el dueño: `ss -ltnp | grep ':<puerto>'`. Si el PID no es tuyo, **no lo toques**.
   Después de cerrar cada recurso, correr
   `pnpm resource-cleanup release <sesion> <pid|port|path|tab> <valor>`.
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
9. **Guardián**: correr `pnpm check:resource-cleanup` al final. Solo detecta y falla (`exit 1`):
   **nunca** mata procesos, cierra tabs ni borra rutas. Si sale `LEAK`, cerrá el recurso con su
   herramienta, hacé `release` y volvé a correr el check. `SPARED` significa PID reutilizado y
   no cuenta como leak. No borres ni liberés el registro de otra sesión para que el check pase.

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
- **`check:resource-cleanup` en rojo**: es una señal, no un botón de limpieza. Nunca lo
  "arregles" matando procesos por heurística ni editando el registro ajeno: liberá solo tus
  recursos. Si el registro de otra sesión quedó sucio, reportalo y dejalo.

## 5. Entrega

En el resumen final, declarar explícitamente qué se limpió y qué se dejó (y por qué), por ejemplo:
"Maté solo mi vite del 5178; los otros dos vite son de otro agente. Borré mi `/tmp/opencode/<tarea>`;
el resto de `/tmp/opencode` es de otros agentes y no se tocó. `pnpm check:resource-cleanup`: sin
recursos pendientes." Si el check falló, decir qué queda registrado y por qué no se tocó.
