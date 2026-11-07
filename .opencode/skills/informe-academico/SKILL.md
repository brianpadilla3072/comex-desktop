---
name: informe-academico
description: "Redacción y armado de trabajos finales, monografías, TFI, casos de internacionalización y trabajos prácticos universitarios — estructura por capítulo, contenido de cada sección, normas APA 7 completas, formato de entrega (portada, márgenes, interlineado), marco teórico y metodología. Usar SIEMPRE que se pida un trabajo para la universidad/colegio, un TFI, una monografía, un paper, un informe académico, \"hacer el trabajo final\", armar el marco teórico o la metodología, aplicar normas APA, o cuando un estudio de mercado (skill estudio-mercado-internacional) tenga que convertirse en el documento final para entregar. También para revisar formato y estructura de un borrador académico existente."
---

# Informe Académico

Cómo pasar del análisis de un estudio (skills `estudio-mercado-internacional` + `analisis-mercados`) a un documento entregable con estructura académica. La cita y la verificación de fuentes siguen las reglas de `investigacion-con-fuentes`; acá va el documento.

## Estructura por capítulo y qué va en cada uno

**1. Portada** — título (informativo: producto + mercado + enfoque, no "Trabajo Final"), autor/a, materia, institución, docente, fecha. En Argentina: A4; si la cátedra da un template propio, ese manda.

**2. Resumen (150-300 palabras)** — qué se investigó, cómo (método/fuentes), qué se encontró, qué se concluye. Se escribe al FINAL, aunque va primero. Palabras clave debajo (3-6).

**3. Introducción** — el problema/la oportunidad en 2 párrafos, objetivos (general + específicos, redactados con verbo observable: "analizar", "comparar", "determinar"), justificación breve, y el índice de lo que sigue por capítulo.

**4. Marco teórico** — SOLO los conceptos que el análisis usa después, cada uno con su autor/norma citada, y cerrando cada concepto con "cómo aplica a este caso". El error más corregido: marcos teóricos de tres páginas sobre teorías que no reaparecen en el análisis. Referencias típicas de la carrera: teorías del comercio (ventajas comparativas, dotación factor, competitividad de Porter), etapas de internacionalización (modelo de Uppsala), estudio de mercados (Kinnear & Taylor, ITC), Incoterms (ICC), formación de precios de exportación.

**5. Metodología** — tipo de investigación (descriptiva/exploratoria, cuantitativa/cualitativa), fuentes secundarias con nombre y fechas de consulta, instrumentos primarios si hubo (cuestionario, guía de entrevista, muestra), alcance y **limitaciones** (antigüedad del dato, mirror data, cobertura parcial). Un tribunal valora más limitaciones honestas que afirmaciones infladas.

**6. Análisis / resultados** — el desarrollo del estudio (matrices, indicadores, cotización). Cada tabla o figura: (a) introducida en el texto antes de mostrarla ("como se observa en la Tabla 3..."), (b) numerada y con título, (c) nota de fuente debajo, (d) seguida de 2-4 líneas interpretando qué significa. Nunca datos sin lectura.

**7. Conclusiones** — una por una, respondiendo los objetivos específicos; sin información nueva; separadas de las **recomendaciones** (acciones concretas con su fundamento).

**8. Bibliografía** — solo lo citado en el texto (no "bibliografía de adorno"), formato consistente, coherente con `fuentes.md` del estudio.

**9. Anexos** — instrumentos de campo, scripts y queries de datos (reproducibilidad), tablas extensas, cotizaciones completas.

## APA 7 — lo que más se usa (complementa a investigacion-con-fuentes)

**Citas en el texto:**
- Parentética: (INDEC, 2025) / narrative: "según el INDEC (2025), las exportaciones..."
- Dos autores: (Porter y Kramer, 2011); tres o más: (Kessler et al., 2020).
- Cita textual: comillas + página: (Kinnear & Taylor, 2006, p. 118). Más de 40 palabras: bloque aparte en sangría, sin comillas.
- Cita de segunda mano: "Porter (1990, como se citó en Rugman y Collinson, 2020)" — solo si el original es inaccesible; si es accesible, se lee y se cita directo.
- Sitio/web sin fecha: (ITC, s.f.).

**Referencias (lista final):** orden alfabético, sangría francesa. Formatos frecuentes en la carrera:
- Base de datos: ITC. (2026). *Trade Map: International trade statistics database*. https://www.trademap.org
- Informe institucional: CEPAL. (2025). *Comercio internacional y desarrollo en América Latina y el Caribe 2025*. Naciones Unidas. https://www.cepal.org/...
- Libro: Kinnear, T. C., & Taylor, J. R. (2006). *Investigación de mercados: una decisión estratégica*. Thompson.
- Norma/legal: Organización Mundial del Comercio. (2024). *Incoterms 2020* (ed. 2024, ICC). Cámara Internacional de Comercio. — En derecho argentino: "Ley 22.415, Código Aduanero [BO 07/04/1981]".
- Página web con datos específicos: se cita la página exacta de la query, con fecha de consulta: (UN Comtrade, 2026; consultado el 4 de noviembre de 2026).

## Formato de entrega

Se arma en Markdown y se convierte con la skill `documento-docx`:

```bash
python3 scripts/informe_docx.py informe.md -o trabajo_final.docx --toc
```

Base académica estándar: Times New Roman o Arial 12, interlineado 1.5-2.0, márgenes 2.5 cm, páginas numeradas, títulos numerados si lo pide la cátedra. **Siempre contra la consigna original**: si el docente dio formato propio (margen 3, fuente institucional, portada con logo), gana el formato de la cátedra — pedir la consigna antes de formatear.

## Lo que suelen corregir los tribunales (checklist final)

- [ ] Cada conclusión responde a un objetivo enunciado (nada de objetivos huérfanos ni conclusiones espontáneas).
- [ ] El marco teórico reaparece en el análisis (se usan los conceptos, no solo se citaron).
- [ ] Toda cifra con fuente + fecha de consulta; toda estimación declarada.
- [ ] Las tablas tienen título arriba, fuente abajo y están explicadas en el texto.
- [ ] La metodología permite reproducir el estudio con lo escrito.
- [ ] La bibliografía coincide con las citas del texto (sobran referencias = se coló adorno; faltan = cita fantasma).
- [ ] Redacción impersonal/tercera persona si es lo esperado ("se analizó", "el estudio muestra"), sin muletillas de relleno.

Pasar el borrador por los agentes `revisor-exigente` y `verificador-de-fuentes` antes de entregar: el primero audita estructura y argumentación, el segundo persigue cada número hasta su fuente.
