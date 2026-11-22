---
name: fact-check-html
description: "Generar informes de fact-check en HTML con el mismo estilo que los informes de los videos de 'The Forgotten Jesus' (Towards Eternity): veredicto afirmación por afirmación (Exacta / Con matices / Engañosa), cifras clave (KPI), falacias, contradicciones internas, doble estándar, verdad objetiva y fuentes verificables. Usar SIEMPRE que se pida fact-checkear, verificar afirmaciones de un video, artículo, libro o persona, o armar un informe de verificación de hechos con formato visual. También cuando se pida 'auditar' o 're-verificar' un informe ya hecho. Requiere la skill borrador-html para la plantilla y validación."
---

# Fact-check HTML (informes de verificación de hechos)

Produce un informe de fact-check navegable en HTML, con el diseño preestablecido de
`borrador-html`, siguiendo la estructura probada en `transcripciones/fact-check-biblia.html`
y `transcripciones/fact-check-jesus-dios.html`. El modelo redacta el contenido; el diseño
ya existe.

## Principio rector

**La verdad objetiva, no la apologética.** El informe no adopta el lado del video ni el
del cristianismo. Se chequean solo afirmaciones históricas/textuales verificables; las
afirmaciones de fe de cualquier lado (que la Biblia es o no Palabra de Dios, que el Corán
está preservado, que el mensaje original se perdió) quedan fuera o se etiquetan como
"artículo de fe (no verificable)".

## Flujo obligatorio

1. **Obtener la transcripción real** (skill `youtube-transcripcion` si es video de YouTube).
   Nunca resumir de memoria: citar minutos exactos.
2. **Guardar la transcripción** en `transcripciones/<slug>.md` (con timestamps).
3. **Leer toda la transcripción** antes de redactar. Extraer cada afirmación factual
   con su minuto.
4. **Verificar cada afirmación** contra fuentes académicas mainstream (críticas Y
   conservadoras), con links verificables.
5. **Armar el HTML** copiando `comex-pack/skills/borrador-html/templates/base-informe.html`,
   escribiendo SOLO dentro de `<main>`, completando los `data-*` del `<header>`.
6. **Validar**: `python3 comex-pack/skills/borrador-html/scripts/validar_html.py <archivo>`.
7. **Auditoría final obligatoria**: re-leer el informe entero buscando errores
   propios (datos inventados, citas mal atribuidas, números sin fuente, anacronismos).
   Corregir todo lo que no se sostenga con la fuente citada. Ver sección "Auditoría".
8. **Mostrar** el path del HTML al usuario (lo abre en el navegador). No exportar a
   Word salvo pedido explícito.

## Estructura del informe (orden fijo)

El `<main>` debe contener, en este orden, estos bloques:

1. **Párrafo introductorio** — qué se audita, cuántos minutos, qué referencia.
2. **Callout "Qué se evalúa y qué no"** (`.callout`).
3. **Callout--alerta "Resumen en una línea"** — la tesis del informe en un párrafo.
4. **`<h2>Cifras clave</h2>` + `.kpi-grid`** con 4 KPIs: afirmaciones verificadas,
   exactas, con matices, engañosas. Los números deben coincidir EXACTAMENTE con las
   filas de la tabla de veredictos (contar las filas).
5. **`<h2>El patrón general</h2>`** — qué acierta el video, en qué capas falla.
6. **`<h2>Veredicto afirmación por afirmación</h2>`** con bloques `<h3>` por tema y
   una tabla `tabla-datos` por bloque. Columnas: Afirmación del video (con minuto) /
   Veredicto (badge) / Qué dice la evidencia.
7. **`<h2>Los silencios que cambian la película</h2>`** (o "Los silencios") — 5-7
   omisiones decisivas del video, en `<ol>`.
8. **`<h2>Estructura retórica: las falacias del video</h2>`** — tabla de 8-10
   falacias con minuto y explicación.
9. **`<h2>Contradicciones internas del video</h2>`** — 6-8 puntos, en `<ol>`.
10. **`<h2>El doble estándar: la auditoría que el video no aplica a su propio lado</h2>`**
    — tabla de criterio-exigido vs. lo que muestra el lado propio.
11. **`<h2>La verdad objetiva: qué se sabe, qué se debate, qué es fe</h2>`** — tabla
    de 5-6 temas × 3 columnas (Establecido / En debate / Artículo de fe).
12. **`<h2>Imprecisiones menores (bonus)</h2>`** — lista de errores menores no
    computados como engañosos.
13. **`<h2>Conclusión</h2>`** — síntesis final + callout de transparencia metodológica.
14. **`<h2>Fuentes principales</h2>`** — lista `<ul>` con cada fuente, año y link
    verificable.

## Categorías de veredicto

- **Exacta** (badge verde): el dato y su sentido se sostienen en la academia.
- **Con matices** (badge amarillo): el dato es real pero el video lo usa mal, o el
  número es aproximado, o la exégesis es discutible.
- **Engañosa** (badge rojo): el dato es falso, inventado, o la conclusión no se
  sigue de las premisas. Incluye "atribución falsa" y "cifra inflada".

Regla: una afirmación de fe (ej. "el mensaje fue corrompido") no es "mentira" por
ser fe: se etiqueta como **Con matices** o **Engañosa** según si se presenta como
conclusión de la evidencia (engaño) o como creencia (matices).

## Fuentes: reglas de oro

- Citar SIEMPRE con link verificable cuando exista (sunnah.com, STEP Bible, JETS
  PDFs, fortresspress PDFs, sefaria.org, ccel.org, Wikipedia).
- Para libros: autor, título, editorial, año, capítulo/página.
- Para hadices: colección + número + link a sunnah.com.
- Para manuscritos: siglum + siglo + lugar de conservación si aplica.
- **NUNCA inventar una cita, un número o una atribución.** Si un dato no tiene
  fuente, decirlo ("no tiene fuente precisa") en vez de inventarla.
- Verificar las fechas antes de escribirlas (ej. el diálogo Ehrman-Wallace es de
  2011, no 2012; Izhar al-Haqq es árabe 1867, no 1854).

## Auditoría final (OBLIGATORIA antes de entregar)

Después de armar el HTML, re-leer el informe entero buscando errores propios:

1. **Datos que afirmé sin fuente** (ej. "2,7 % de incertidumbre", "Wilson como
   conservador") → quitar o atar.
2. **Atribuciones invertidas** (ej. "ningún manuscrito termina en 16:8" cuando los
   dos más antiguos sí lo hacen) → corregir.
3. **Anacronismos** (ej. "el Imperio romano en los años 30-110").
4. **Citas en latín/inventadas** → traducir o eliminar.
5. **Números que no cuadran** con la literatura (ej. "270 citas de Justino" →
   "entre 65 y 270 según el método de conteo").
6. **Entrevistados no identificados** → no inventar nombres; decir "formulaciones
   que coinciden con Ehrman, sin nombre en pantalla".
7. **KPI vs filas**: contar las filas de la tabla y verificar que el KPI diga lo
   mismo.

Corregir TODO lo que no se sostenga con la fuente citada. La credibilidad del
informe depende de que el autor no cometa los mismos errores que el video.

## Reglas de redacción

- Español rioplatense, tono objetivo, sin celebrar ni al video ni al cristianismo.
- Cada afirmación del video va con su minuto entre corchetes: `[07:24]`.
- Las citas bíblicas se cotejan contra texto (NRSV/RVR); las coránicas, contra
  mushaf estándar; los hadices, contra sunnah.com con número.
- No usar anglicismos innecesarios ni "claim", "theseus", "emperor", etc.
- Los KPI deben ser consistentes con las filas (verificar con `grep`).

## Output

- Archivo HTML en `transcripciones/fact-check-<slug>.html`.
- Transcripción en `transcripciones/<slug>.md` (si es video).
- No exportar a Word salvo pedido explícito (usar `html_a_docx.py`).

## Componentes disponibles

Ver `comex-pack/skills/borrador-html/references/componentes.md` para la lista
cerrada de clases (`.badge`, `.kpi-grid`, `.tabla-datos`, `.callout`, `.callout--alerta`,
`<details>`, `.tabs`, etc.). Prohibido inventar clases o usar `style=""`.
Validar siempre con `validar_html.py` antes de mostrar.
