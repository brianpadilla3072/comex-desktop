# Prueba en seco — skill `limitaciones-honestas`

Fecha: 2026-11-17. Modalidad: **prueba en seco** (se recorrió el SKILL.md paso por paso como
si fuera el agente; no se ejecutó con un modelo cargado). Se puntúa con la grilla de
`taller-de-agentes`: Disparo / Procedimiento / Entregable.

## Caso 1 — caso real (el que motivó la skill)

**Pedido:** "Tengo las transcripciones y los `.mdx` del curso 'Máquina de Ventas' de Mica &
Pedro en `fabiana apolonio`. Hacé el análisis de limitaciones honestas."

- **Disparo:** ✅. El description menciona "auditar las promesas de un curso", "separar
  marketing de viabilidad" y "documento de limitaciones honestas": carga sin nombrar la skill.
- **Procedimiento:** ✅. Inventario de promesas desde el material → una sección por promesa con
  las 4 preguntas → clasificación con la taxonomía → tabla resumen → conclusión. El documento
  existente (`investigacion/limitaciones-honestas.md`, 10 secciones + resumen) sirve como
  referencia de salida y confirma que el formato es alcanzable.
- **Entregable:** ✅. Salen las 10 secciones, la tabla resumen y la frase honesta. Verificable:
  10 filas = 10 secciones; cada promesa va literal con origen.
- **Resultado: APROBADO.**

## Caso 2 — borde: material mínimo

**Pedido:** "Quiero auditar las promesas de automatización de un producto, pero solo tengo el
texto de la landing, sin transcripciones ni documentación."

- **Disparo:** ✅. "auditar las promesas de un producto por su viabilidad real".
- **Procedimiento:** ✅. El paso 2 extrae promesas literales del material disponible con cita
  (en este caso, sección de la landing + URL); el paso 3 de "Entrada" pide material si no hay
  ninguno, pero acá sí lo hay. La skill no inventa promesas para completar la lista.
- **Entregable:** ✅. `.md` con las promesas citadas a la landing y sus bloqueos. Queda
  explícito en el documento que la fuente es solo la landing (no un material verificable).
- **Resultado: APROBADO.**

## Caso 3 — compuesto: dos productos y comparación

**Pedido:** "Analizá las limitaciones honestas de dos cursos y decime cuál tiene más promesas
no automatizables, con un cuadro comparativo y un informe visual con KPIs."

- **Disparo:** ✅. "separar marketing de viabilidad" + "auditar las promesas de un curso".
- **Procedimiento:** ✅ (tras corrección). El primer recorrido mostró un hueco: el flujo estaba
  pensado para un solo producto. Se **generalizó** el SKILL.md agregando la regla de repetir el
  inventario por producto y sumar una tabla comparativa contando promesas por categoría de
  bloqueo. Interfaces definidas: `fact-check-html` para el informe visual,
  `investigacion-con-fuentes` para las citas.
- **Entregable:** ✅. Un `.md` por producto + tabla comparativa + HTML de `fact-check-html`
  como entrega adicional. El conteo por categoría es reproducible desde la taxonomía.
- **Resultado: APROBADO (con la corrección ya incorporada).**

## Conclusión

3/3 aprobados en seco. La corrección del caso 3 se aplicó al SKILL.md **antes** de instalar, no
como parche de un ejemplo. Queda pendiente re-testear con un modelo real con la skill cargada
en la app (no hecho en esta sesión: esto fue prueba en seco, no ejecución).
