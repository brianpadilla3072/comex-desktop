---
name: cerebro
description: Cargar el contexto de cerebro CLI (razonamiento gratis con OpenCode, ejecución nuestra) y arrancar el flujo
---

Estás por usar un **CLI gratis como cerebro** (razonamiento) y nosotros ejecutamos los tools,
para no gastar tokens. Cargá `.opencode/skills/cerebro-cli/SKILL.md`.

Recordatorio clave: **esta app puede usar herramientas de CLI como cerebro. Si algo funciona
mal, lo arreglamos nosotros; esto es probar de manera real. Cuando usamos un CLI, lo que
vemos roto lo arreglamos. Nunca usar Claude Code.**

Argumentos: `$ARGUMENTS`
- Si pide razonar: formular prompt acotado, invocar OpenCode (`opencode run --auto -m opencode-go/hy4-flash-free`), capturar salida, aplicar cambios, verificar.
- Si pide solo contexto: cargar la skill y explicar el flujo.

No hacer commits sin pedido explícito. Limpiar recursos al terminar.