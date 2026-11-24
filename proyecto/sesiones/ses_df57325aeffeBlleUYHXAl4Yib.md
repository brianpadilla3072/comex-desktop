# Notas de esta sesión

## Objetivo
Cerrar el visor MD/MDX nativo y atender el nuevo pedido: evitar versiones duplicadas al editar archivos, y persistir por workspace archivos, URLs y credenciales del navegador.

## Avances y decisiones
- Visor MD/MDX nativo terminado y verificado (paleta scoped, textos legibles en ambos temas). Código commiteado por otra sesión en `7230a86947`; memoria en `49c46f1c93`. Quedó sin commitear solo el párrafo nuevo de `proyecto/estado.md` (regla del repo: no commitear sin pedido explícito).
- Checks finales: typechecks de app y servidor limpios; tests focalizados del visor (6 pass) y `doc-tools` (6 pass) en verde. Suite de app: 2477 pass / 14 fail. Los 14 fallos son preexistentes (`mcp-app-frame`, `projects-list-page`, `spanish-tu-register-sources`, entre otros; el visor no falla). `features:check` y `check:rust-readiness` fallan por deudas preexistentes en `HEAD` (values.yaml desactualizado desde `c5897e7b5e`; JSON.parse sin validar en `sheet-model.ts` y `html-archive.ts`), no por este tramo.
- Recursos propios limpiados: sesión aislada `doc-view-shot` bajada (ya no existía al llamar `down`), servidor de imágenes del 8766 terminado por SIGTERM. No se tocó el python ajeno del 8765.
- Investigación del nuevo pedido (solo lectura): los archivos del chat se actualizan in-place; los artefactos `doc`/`sheet` crean versión nueva por guardado y hay versiones byte-idénticas reales (`art-118131dd`, 25 versiones). Los adjuntos ya se copian al inbox del workspace pero no hay acción visible para fijarlos. Las URLs se guardan en `localStorage` por scope de workspace, no como archivo. Las credenciales viven fuera del repo (vault del SO / `~/.config/openwork/credentials.json` 0600); no deben copiarse al workspace.

- Confirmadas las tres decisiones y aplicadas: dedup por bytes idénticos (conserva historial),
  credenciales como referencia en workspace + valor en carpeta privada del sistema por
  workspace, y fijado de TODAS las fuentes desde menú de tres puntitos y desde tool del agente.
- Implementado en servidor: dedup en `artifacts.ts`; módulo `workspace-resources.ts`; tools
  `specialist_workspace_save`/`_list`; rutas REST `GET/POST …/workspace-resources`; skill de
  credenciales actualizado. Implementado en front por subagente verificado: tipos/métodos en
  `openwork-server.ts`, `save-to-workspace-menu.tsx` y cableado en artefactos, biblioteca
  (datasets/fuentes/salidas), adjuntos del chat, URLs del navegador y tarjetas de recurso.
- Verificación al cerrar: 14 tests focalizados pass, typecheck app/servidor limpio,
  `pnpm check:resource-cleanup` exit 0. Sin commit ni push (no hubo pedido explícito). No se
  abrieron servidores, pestañas ni worktrees propios en este tramo.

## Próximo paso
Si el usuario lo pide: reiniciar app/servidor para que las tools nuevas aparezcan en la sesión,
probar el menú en vivo y considerar corregir las deudas preexistentes (fallo de
`specialist-datasets-routes.test.ts` en `HEAD`, deuda de `features:check` y Rust). Nada de eso
se hizo sin pedido.
