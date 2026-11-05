---
name: taller-de-agentes
description: Crear, modificar, probar e instalar skills y agentes de OpenCode para comercio exterior — cuando aparece una tarea nueva que se va a repetir, cuando algo del pack quedó corto, o cuando se pide "creá una skill para X", "hacé un agente que haga Y", "automatizar este trabajo", "modificar una skill existente", "probar esta skill". Usar SIEMPRE que la conversación gire alrededor de fabricar nuevas capacidades del pack (skills, agentes, scripts), no para usarlas.
---

# Taller de Agentes

Cómo se fabrican las piezas del pack. La regla que ahorra trabajo: **primero preguntar si esto es una skill nueva, una extensión de una existente, o nada de eso.** Una skill por impulso que se solapa con dos existentes empeora el pack: cada descripción compite con las otras y el modelo carga instrucciones que se contradicen.

## ¿Crear o no crear?

- ¿Esta tarea se va a repetir en más de un trabajo, o tiene un formato/resultados que hay que clavar? → **skill nueva** (extiende el pack).
- ¿Lo nuevo es un **entregable o formato** que encadena skills existentes, sin aportar contenido nuevo (una ficha, un checklist, una matriz ya definida)? → **skill nueva y delgada que ENLAZA**: no copia lo que ya está en `datos-comex` o `analisis-mercados`, solo fija el orden y el formato de salida. Es composición, no duplicación.
- ¿Es un rol con criterio propio que orquesta otros pasos (auditar, verificar, investigar de punta a punta)? → **agente**.
- ¿Falta contenido en una skill que ya existe (una sección, una plantilla, una regla)? → **extender esa skill**, no crear otra.
- ¿Falta un cálculo repetitivo dentro de una skill que ya existe? → **script dentro de esa skill**, no una skill nueva.
- ¿Es un pedido puntual de una sola vez? → se resuelve sin crear nada. No todo merece una skill.

Cuando dos criterios chocan (por ejemplo, "ya hay skills de datos y análisis" vs. "no existe el formato ficha"), manda el **entregable**: si la persona va a recibir un artefacto nuevo y repetible, la skill es nueva y delgada. La cobertura temática del 70% no alcanza para justificar extender si el formato de salida no existe.

**Umbral para escribir un script** (si no, es un comando suelto en el SKILL.md): dos o más pasos de cálculo encadenados, o el mismo cálculo reutilizado por otra skill, o un resultado que tiene que dar idéntico siempre. Dividir precio por peso una vez no lo justifica; armar la escalera EXW→CIF con retenciones, sí.

## Pieza 1: crear una skill

Una skill es una carpeta con un `SKILL.md`. La estructura del pack:

```
comex-pack/skills/<id-en-kebab-case>/
├── SKILL.md            → siempre; el cuerpo son las instrucciones
├── references/         → docs largos que se leen solo cuando hacen falta
├── scripts/            → código para lo repetitivo/determinístico (probado antes de incluir)
└── assets/             → plantillas de salida si hace falta
```

**El SKILL.md** (frontmatter + cuerpo):

```markdown
---
name: nombre-de-la-carpeta
description: Qué hace Y CUÁNDO usarla, con las palabras que la persona va a escribir
  ("cotizar", "presupuesto", "landed cost"...). El description es el gatillo: si el
  modelo no lo asocia con lo que le pidieron, la skill no se carga. Específico y algo
  "insistente" mejora el disparo: mencionar "usar SIEMPRE que..." con sinónimos reales.
---

# Nombre Legible de la Skill

Cuerpo: procedimiento en imperativo, corto (idealmente <250 líneas).
```

**Reglas duras del `name` (si se rompen, la skill NO se carga y no hay error visible):**
- `name` va en minúsculas, con guiones simples: `^[a-z0-9]+(-[a-z0-9]+)*$`.
- `name` debe ser **idéntico al nombre de la carpeta** que contiene el `SKILL.md`.
- El nombre legible ("Cotización de Exportación") va como título `#` del cuerpo, no en el frontmatter.
- `description`: entre 1 y 1024 caracteres. Si te pasás, la skill se descarta.

Antes de instalar, corré `python3 scripts/validar.py` desde la raíz del repo del pack: verifica estas reglas en todas las piezas y dice exactamente qué corregir. (Si estás trabajando en un workspace suelto y no tenés el repo, pedile al agente que revise a mano: `name` kebab igual a la carpeta y `description` de 1 a 1024 caracteres).

Reglas del cuerpo:
- Escribí el **porqué** de cada regla, no solo la orden: una instrucción entendida se aplica bien a casos nuevos; una "MUST" sin explicación se rompe al primer caso borde.
- Los ejemplos concretos valen más que diez abstracciones: uno de entrada/salida típica (producto argentino real, si podés).
- Lo largo va a `references/` con una línea que diga cuándo leerlo; lo determinístico (cálculos, conversiones) va a `scripts/` probado con datos reales.
- Toda skill del pack enlaza con las demás: si tu tema toca datos, citá `datos-comex`; si entrega documentos, `documento-docx`/`planilla-xlsx`; si es para la U, `informe-academico` e `investigacion-con-fuentes`.

**Convenciones de nombre y carpetas** (las que ya usa el pack, para no inventar una distinta en cada skill):
- `description` siempre en castellano y con el gatillo explícito: "Usar SIEMPRE que…" + los sinónimos que escribiría una estudiante ("cotizar", "presupuesto", "landed cost"). Es lo que hace que la skill se cargue sola.
- `references/` = material de consulta largo (metodología, normativa, trampas de datos). `assets/` = plantillas que se copian tal cual para producir el entregable. Si dudás: ¿se lee o se completa? Se lee → `references/`; se completa → `assets/`.
- Los ejemplos ejecutados y las pruebas van en `pruebas/` del pack (fuera de la skill), no dentro de `assets/`: así la skill queda liviana y el historial de pruebas se conserva.

**Prueba antes de dar por buena la skill** (no es burocracia: es lo que separa una skill útil de una que interfiere):

1. Escribí 3 pedidos reales como los diría ella (coloquiales, con datos concretos: "tengo que cotizar 1000 cajas de peras a Brasil"), incluyendo al menos un caso borde (sin datos, producto raro, mercado chico) y un pedido compuesto ("fichas de 3 países y decime por cuál arranco").
2. Resolvelos con la skill cargada. Si no se puede instalar o no hay red, hacé una **prueba en seco**: seguí el SKILL.md paso por paso como si fueras el agente, con datos de ejemplo: los de `pruebas/casos/` si tenés el repo del pack, o un caso mínimo inventado y guardado como archivo de prueba. La prueba en seco es válida y se registra como tal; lo que NO vale es decir "funcionaría" sin recorrer el procedimiento.
3. Puntuá cada caso con esta grilla (las tres columnas tienen que dar "sí" para aprobar):

| Criterio | Aprueba si… | Falla si… |
|---|---|---|
| **Disparo** | el pedido hace cargar la skill sin que la persona la nombre | el agente improvisa o usa otra skill |
| **Procedimiento** | el orden de pasos se puede seguir sin decisiones inventadas | hay que rellenar un paso que la skill no dice |
| **Entregable** | sale el artefacto prometido (tabla, ficha, informe) y los números se pueden verificar | falta una parte, o un número no se puede reconstruir |

4. Un fallo → corregí la skill generalizando la corrección (no parchees el ejemplo). Un aprobado con salvedades se registra como **condicional** y se re-testea antes de instalar.
5. Para el criterio "Entregable" usá los agentes del propio pack: `revisor-exigente` audita el artefacto y `verificador-de-fuentes` controla cada cifra. El taller no necesita inventar un tribunal aparte.
6. Con los 3 casos aprobados (o 2 aprobados + 1 condicional cerrado), se instala.

**Interfaces entre skills** (esto evita el choque más común): antes de publicar, escribí en el SKILL.md con qué skills se encadena y con qué palabras se dispara cada una. Si dos skills se activan con el mismo pedido y dan criterios distintos, no es un problema del modelo: es una interfaz sin definir. Resolvelo diciendo cuál manda y cuál aporta insumos.

**Instalar**: copiar la carpeta a `~/.config/opencode/skills/` (global) o `./.opencode/skills/` (un proyecto), o al pack y correr `bash instalar.sh`. OpenCode detecta cambios sin reiniciar. El nombre de la carpeta es el identificador de la skill y debe ser igual al `name`; para enlazar skills entre sí, usá siempre el nombre de carpeta, no el título legible.

## Pieza 2: crear un agente

Un agente es un archivo `.md` en `comex-pack/agents/`:

```markdown
---
description: Rol y cuándo usarlo (esto lo ve el modelo para delegar).
mode: subagent            # subagent: lo llama el orquestador | primary: ella lo selecciona | all: ambos
permission:               # opcional y en singular: mapa, no lista
  edit: deny
  bash: allow
---

Cuerpo = el system prompt: quién es, cómo trabaja, qué entrega, qué NO hace.
```

**Ojo con el frontmatter del agente**: el campo es `permission:` (singular) y su valor es un mapa (`edit: deny`). Si escribís `permissions:` con una lista de `action/resource/effect`, OpenCode lo ignora en silencio y el agente termina con permisos completos — el "auditor que no puede editar" edita igual. `scripts/validar.py` detecta ese error.

- El agente **no repite el contenido de las skills**: dice cuándo cargarlas. Si un agente y una skill cuentan la misma metodología, una va a quedar desactualizada.
- Definí su entrega concreta (tabla de hallazgos, informe, borrador) y sus límites (qué no toca). Los roles sin límites se pisán entre ellos.
- `mode: subagent` para roles de un paso (auditar, verificar); `primary/all` para los que ella selecciona para charlar.
- Instalar en `~/.config/opencode/agents/` (global) o `./.opencode/agents/`.

## Pieza 3: scripts

Si la skill tiene script, tres reglas:
- **Python estándar primero** (como `comtrade.py`, `cotizacion.py`) o librerías que ya trae el pack (`python-docx`, `openpyxl` vía `instalar.sh`). Nada de dependencias que la skill tenga que instalar ella sola.
- El script se **prueba contra datos reales** antes de incluirlo (una query real, un CSV real), y el SKILL.md muestra el comando exacto ya probado.
- Los scripts que generan entregables se reabren al final para verificarse a sí mismos (así hacen `informe_docx.py` y `tabla_xlsx.py`).

## Cuando una skill existente quedó corta

- El síntoma típico: la persona tiene que explicar cada vez lo mismo, o el agente improvisa una parte que debería ser estándar.
- Se agrega al SKILL.md de esa skill (una sección, una plantilla, una pregunta de entrevista). Solo se parte en dos skills si son temas que disparan en situaciones claramente distintas; si siempre van juntas, siguen juntas.
- Después de tocar una skill: re-testear sus ejemplos conocidos (los de arriba) para ver que no se rompió el disparo ni el flujo.

## Nota meta: el taller se audita con sus propias reglas

Esta misma skill se audita con su propio criterio: si un día `crear-agentes` se usa menos que `extender-skills`, no hay que partir la skill — hay que revisar si el pack está creciendo sano.

## Si no vas a editar nada: cómo juzgar lo que te devuelve el agente

No hace falta entender el formato interno para saber si una skill nueva sirve. Si le pediste "armame una ficha de mercado" y la respuesta no convence, mirá estas cinco cosas y pedí el ajuste en castellano, sin hablar de archivos:

1. **¿Te hizo las preguntas del caso?** Producto, unidad (kg, cajas, toneladas), mercado, fecha y para qué materia. Si arrancó a escribir sin preguntar, pedile que primero cierre esos datos.
2. **¿Cada cifra tiene fuente y fecha?** Si dice "el mercado creció 8%" sin decir de dónde, pedile la fuente o que marque el dato como estimación propia.
3. **¿La unidad es la misma de punta a punta?** Si mezcla cajas con kg, pedile la tabla de conversión (es el error más común en cotizaciones).
4. **¿El entregable tiene la forma prometida?** La ficha con sus campos, la tabla con sus columnas, el informe con sus secciones. Si falta una parte, decí cuál.
5. **¿Te dice qué NO pudo verificar?** Una skill honesta deja los huecos a la vista; una que inventa se ve prolija y es la más peligrosa.

Si falla siempre en el mismo punto, ese es el pedido para mejorar la skill: "siempre que armes una ficha, poné la unidad en el encabezado". El agente lo convierte en regla y lo prueba de nuevo.
