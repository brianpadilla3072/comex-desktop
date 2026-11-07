---
name: encuestas-y-entrevistas
description: "Diseñar encuestas y entrevistas para estudios de mercado y analizar respuestas reales aportadas por la persona. Usar cuando la consigna pide investigación primaria, muestra, cuestionario o tabulación; no sustituye la realización del trabajo de campo."
---

# Encuestas y entrevistas

Convertí la pregunta comercial en un instrumento aplicable y un análisis trazable. Primero distinguí entre diseñar una encuesta y realizarla: si la consigna exige campo, no cierres el estudio con un formulario vacío.

## Diseño y entrega para campo

Guardá en `campo/`:

- `plan-campo.md`: objetivo, pareja producto–destino cubierta, población, unidad de análisis, criterios de inclusión, idioma, modo de contacto, muestreo, tamaño previsto y calendario. Explicá quién aplicará el instrumento. No establezcas un mínimo arbitrario de respuestas como exigencia del profesor.
- `cuestionario.md`: introducción breve con participación voluntaria, filtro de elegibilidad y preguntas neutrales. Cubrí frecuencia y canal de compra, atributos valorados, origen y rangos de precio con moneda, unidad y presentación. Agregá “no sabe/no corresponde” cuando haga falta; evitá preguntas dobles o que presupongan una compra.
- `diccionario.csv`: variable, pregunta, tipo, valores permitidos, unidad y reglas para faltantes. Entregá `respuestas.csv` con cabeceras, sin filas inventadas, para que la persona cargue respuestas.
- `guia-entrevista.md` solo si hay entrevistas B2B: rol, criterios de selección, preguntas abiertas sobre compra, canales, certificaciones y logística. No mezcles testimonios con frecuencias de una encuesta.

Hacé un piloto pequeño para comprobar comprensión y registrá cambios antes de aplicar. No envíes ni publiques formularios ni contactes participantes sin la autorización correspondiente. Pedí únicamente datos necesarios; analizá identificadores anónimos y excluí correos, teléfonos y nombres de la entrega académica.

## Muestra e inferencia

Separá tamaño planeado y observado. Solo calculá margen de error y nivel de confianza como propiedades de la encuesta cuando el diseño probabilístico y sus supuestos lo permitan. Una muestra por conveniencia permite describir a quienes respondieron; no permite trasladar automáticamente los porcentajes a todos los consumidores del país. No uses una fórmula de tamaño muestral para legitimar una selección no probabilística.

Si los dos productos tienen destinos o compradores distintos, justificá módulos y submuestras o prepará instrumentos separados. Registrá qué pareja no está cubierta. No presentes opiniones locales como evidencia de consumidores extranjeros.

## Análisis de respuestas recibidas

1. Preservá el archivo original recibido y guardá una copia anonimizada. Registrá fechas, modo de aplicación y número observado. Si falta procedencia, marcá “procedencia no verificada” y pedí contexto; no certifiques trabajo de campo por recibir un CSV.
2. Controlá elegibilidad, duplicados e inconsistencias con criterios explícitos. Guardá exclusiones y datos limpios; no elimines respuestas para mejorar una conclusión.
3. Producí frecuencias con base válida por pregunta, conteos y porcentajes, faltantes y cruces útiles. En respuesta múltiple, aclará que los porcentajes pueden superar 100 %. No confundas cero con faltante.
4. Para disposición a pagar, conservá moneda, unidad y contexto. No conviertas un intervalo elegido en un precio exacto validado ni una intención declarada en demanda efectiva.
5. Guardá tablas, gráficos cuando aporten y `resultados-campo.md` con hallazgos, límites y efecto en producto, precio, plaza y promoción. Usá `planilla-xlsx` si se pide Excel.

Los datos sintéticos solo sirven para pruebas claramente rotuladas y separadas del estudio. Nunca se cuentan como respuestas reales. Si no se reciben respuestas, entregá el diseño y el análisis pendiente; seguí con las tareas secundarias disponibles y mantené el trabajo como borrador cuando el campo sea obligatorio.
