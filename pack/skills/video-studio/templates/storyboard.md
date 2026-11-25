# Storyboard

Una fila por beat. El tiempo es acumulado, no relativo.

| # | Tiempo | Escena | Voz (línea) | SFX | Movimiento | Texto en pantalla | Transición |
|---|---|---|---|---|---|---|---|
| 1 | 0.0 | Hook: el problema en una imagen | | whoosh | push-in 4 % | | corte |
| 2 | 3.0 | | | | | | |

Reglas:
- El hook dura `attention.hookSeconds` de `style.json`.
- Un pattern interrupt cada `motion.patternInterruptSeconds`.
- La voz se genera antes de cerrar los tiempos: si dura más, se ajusta la escena, no se acelera la voz.
- Cada texto en pantalla se lee en el tiempo que está visible (mínimo 1.2 s).
