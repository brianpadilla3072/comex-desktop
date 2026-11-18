---
name: limitaciones-honestas
description: "Generar un análisis de limitaciones honestas para cualquier curso, producto, promesa o flujo automatizado con IA: separar cada promesa de lo que la IA puede hacer realmente hoy y explicar (1) qué se prometió, (2) por qué no es posible tal cual, (3) qué necesitaría la IA para que sí lo fuera (accesos, permisos, dinero, tiempo, leyes) y (4) qué se puede hacer en forma realista. Usar SIEMPRE que se pida auditar las promesas de un curso o producto por su viabilidad real, separar marketing de viabilidad, decir qué puede y qué no puede hacer la IA en un proceso, o crear/actualizar un documento de 'limitaciones honestas'. No es un fact-check de verdad histórica: para eso usar fact-check-html."
---

# Limitaciones Honestas

Convierte un documento de promesas (un curso, un producto, un flujo "automático con IA")
en un análisis sobrio de qué se puede hacer hoy y qué no. El entregable es un `.md` con
una sección por promesa, una tabla resumen y una conclusión honesta.

Esta skill es **global**: no está atada al curso con el que se estrenó. Sirve para cualquier
material. El primer caso trabajado quedó en
`/home/brian/Proyectos/fabiana apolonio/investigacion/limitaciones-honestas.md` como referencia.

## Principio rector

La IA puede **asistir** en casi todas las etapas, pero no **ser la máquina automática** que
se anuncia. Los bloqueos rara vez son solo de tecnología: son de **acceso, permisos, dinero,
tiempo y leyes**. Una limitación honesta no se resuelve con un mejor prompt: se resuelve con
esas condiciones, o se acepta que la etapa sigue siendo humana.

Dos reglas evitan caer en el marketing ni en el cinismo:

- **No confundir juicio con dato.** "Validada", "buena", "que vende" son juicios humanos.
  La IA puede listar señales; no las convierte en verdad por sí sola.
- **No convertir probabilidad en certidumbre.** La IA puede aumentar la probabilidad de un
  resultado (mejor investigación, mejores tests, iteración más rápida); nunca garantizar un
  resultado de mercado.

## Cuándo usarla y con qué se encadena

- Usar cuando pidan **viabilidad de promesas de IA**, no verdad histórica de afirmaciones.
- Si además hay que verificar si un dato es cierto → `fact-check-html` (veredictos y KPIs).
- Si hay cifras que citar → `investigacion-con-fuentes` (fuente, fecha, período; nada inventado).
- Si hay que auditar el borrador terminado → agente `verificador-de-fuentes` y `revisor-exigente`.
- Interfaces: esta skill manda en el **formato de análisis**; las demás aportan verificación
  y presentación. Si un pedido activa dos skills con criterios distintos, manda esta para la
  estructura y la otra para el chequeo de datos.

## Entrada esperada

1. **Material fuente**: transcripciones, `.mdx`, apuntes, docs, CSV, links del producto o curso.
2. **Las promesas a auditar**: si la persona no las da, extraerlas del material con cita literal
   (archivo y minuto/párrafo). Nunca inventar promesas para completar la lista.
3. Si falta material, **pedirlo** antes de redactar. Un análisis sin fuente es opinión.

## Flujo obligatorio

1. **Leer todo el material** disponible antes de escribir. Recolectar las promesas textuales.
2. **Inventario de promesas**: tabla con `Promesa literal | Origen (archivo/minuto)`. Esta tabla
   es la que evita que se cuele una promesa inventada.
3. **Una sección por promesa** con las cuatro preguntas fijas (copiar de
   `assets/plantilla-limitaciones-honestas.md`):
   - **Promesa del curso/producto** (literal, citada).
   - **Limitación honesta**: por qué no es posible tal cual. Ir al bloqueo concreto, no a
     "la IA todavía no llega".
   - **Qué necesitaría hacer la IA para que sea posible**: lista de condiciones verificables
     (acceso, permisos, datos, presupuesto, tiempo, figura legal).
   - **Qué se puede hacer hoy (realista)**: entregable ejecutable con lo que ya existe.
4. **Clasificar cada bloqueo** con `references/taxonomia-bloqueos.md`. Marcar el principal y
   mencionar los secundarios. La taxonomía es lo que hace el análisis reutilizable.
5. **Distinguir asistir de hacer sola** en cada fila: la IA "asiste", "solo arma prompts" o
   "no puede". No usar "automatizable" sin esta distinción.
6. **Tabla resumen** `Funcionalidad | ¿IA puede asistir? | ¿Puede hacerlo sola? | Bloqueo principal`
   con una fila por sección. El número de filas debe coincidir con el de secciones.
7. **Conclusión**: el método legítimo detrás del marketing + la frase honesta que lo reemplaza.
8. **Auditoría final** (checklist de abajo) y recién entonces entregar.

Si piden analizar **varios productos en un informe**, repetir el inventario y las secciones por
producto, y agregar una tabla comparativa final contando promesas por categoría de bloqueo.
La taxonomía existe para eso: permite decir "este curso tiene más bloqueos de PERMISO y DINERO
que el otro" sin reescribir cada análisis.

## Formato de salida (estructura fija)

```markdown
# Limitaciones honestas de <producto/curso> (<autor>)

> Para qué sirve / tesis (la IA asiste; no es la máquina automática).

## 1. <Promesa>
**Promesa:** ...
### Limitación honesta
### Qué necesitaría hacer la IA para que sea posible
### Qué se puede hacer hoy (realista)
---
(una sección por promesa)

## Resumen: qué es automatizable hoy y qué no
| Funcionalidad | ¿IA puede asistir? | ¿Puede hacerlo sola? | Bloqueo principal |

## Conclusión
> Frase honesta para reemplazar el marketing: "..."
```

## Auditoría final (obligatoria antes de entregar)

- [ ] Cada promesa va literal y con origen (archivo o minuto); ninguna fue inventada.
- [ ] Cada "por qué no" apunta a un bloqueo concreto de la taxonomía, no a una frase genérica.
- [ ] "Qué necesitaría" no asume que la IA tiene personalidad jurídica, cuenta bancaria,
      credenciales o permisos que hoy no existen.
- [ ] "Qué se puede hacer hoy" es realmente ejecutable con las herramientas disponibles.
- [ ] La tabla resumen cuadra con la cantidad de secciones.
- [ ] Ninguna cifra ni fuente inventada; si un dato no se pudo verificar, se marca como tal.
- [ ] No se presenta un resultado, un plazo ni el "piloto automático" como hecho concreto.

## Reglas de redacción

- Español rioplatense, tono sobrio; ni celebrar el curso ni desacreditarlo.
- Un "no" sin fundamento es tan débil como un "sí" sin evidencia: siempre va con la razón.
- Si el material se contradice, citar ambos lados y dejar constancia de la contradicción.
- No usar "claim", "growth hacking" ni anglicismos innecesarios.

## Output

- `investigacion/limitaciones-honestas.md` del proyecto correspondiente, o la ruta que pida
  la persona. No sobreescribir un archivo existente sin leerlo y conservar lo verificable.
- Si se pide versión visual, encadenar `fact-check-html` como entrega adicional.

## Recursos

- `assets/plantilla-limitaciones-honestas.md` — copiar y completar.
- `references/taxonomia-bloqueos.md` — leer antes de clasificar los bloqueos.
