---
name: cli
description: Cargar el contexto de herramientas de CLI (Devin, Claude Code, Codex) y arrancar el flujo de delegación/supervisión
---

Estás por usar una **herramienta de CLI** (Devin, Claude Code, Codex, etc.) desde OpenWork.
Cargá `.opencode/skills/herramientas-cli/SKILL.md`: ahí está la invocación, los modos de
permiso, la supervisión obligatoria y el prompt de contexto.

Recordatorio clave: **esta app puede usar herramientas de CLI como Devin. Si algo funciona
mal, lo arreglamos nosotros; esto es probar de manera real. Cuando usamos un CLI, lo que
vemos roto lo arreglamos.**

Argumentos: `$ARGUMENTS`
- Si pide delegar: verificar disponibilidad, preparar prompt en `/tmp/opencode/<tarea>.md`,
  invocar en segundo plano, supervisar, verificar y reparar.
- Si pide probar algo: invocar el CLI y verificar el resultado; arreglar lo roto.
- Si pide solo contexto: cargar la skill y explicar el flujo.

No hacer commits sin pedido explícito. Limpiar recursos al terminar.