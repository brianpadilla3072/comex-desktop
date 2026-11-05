---
name: investigacion-con-fuentes
description: "Disciplina de citación, verificación de datos y honestidad académica para trabajos de investigación y estudios de mercado. Usar SIEMPRE que se redacte un trabajo académico, un informe o un estudio de mercado, que se citen datos o estadísticas, que se arme una bibliografía, o antes de entregar cualquier documento con cifras. También cuando se pida verificar información, chequear fuentes o detectar datos inventados."
---

# Investigación con Fuentes

Un trabajo de Comercio Exterior se aprueba o se cae por su credibilidad: una cifra sin fuente o un dato inventado desacredita todo el informe, incluso las partes correctas. Esta skill define las reglas que hacen que cada afirmación del trabajo sea defendible ante un profesor o un tribunal.

## Regla de oro

**Toda cifra y toda afirmación fáctica tiene fuente, fecha de consulta y período de referencia.** Si no se puede rastrear hasta una fuente, no entra en el trabajo.

Formato en el texto:

> Las exportaciones argentinas de aceite de oliva (HS 1509) alcanzaron USD 218 millones en 2023 (UN Comtrade, consulta: nov-2026).

Formato en tablas y figuras, siempre debajo:

> Fuente: ITC Trade Map (consulta: nov-2026). Datos de UN Comtrade.

## Jerarquía de fuentes

Preferir, en este orden:

1. **Fuente oficial primaria**: organismos de estadística y aduanas (INDEC, UN Comtrade, OMC, Banco Mundial), nomencladores y normativa oficial (Boletín Oficial, Nomenclador NCM).
2. **Fuente institucional**: informes de ITC, CEPAL, ALADI, bancos oficiales, cámaras sectoriales.
3. **Publicaciones académicas**: artículos, tesis, libros de texto (para el marco teórico).
4. **Prensa especializada**: solo para tendencias o hechos recientes, nunca para cifras oficiales.

Lo que **no** sirve como fuente de una cifra: blogs, portales que reproducen datos sin citar origen, redes sociales, IA generativa sin respaldo. Si el dato solo aparece en un sitio de ese tipo, buscar la fuente primaria que lo originó; si no existe, no usar el dato.

## Dato oficial vs estimación: declararlo

- **Mirror data (datos espejo)**: cuando un país no reporta, las bases estiman con el registro del socio comercial. Es una estimación. En la metodología: "cuando el país X no reporta, se utilizan datos espejo de Y".
- **Valores unitarios**: el "precio" derivado (valor/peso) mezcla calidades y formatos. Nombrarlo "valor unitario (proxy de precio)", nunca "precio de mercado".
- **Años incompletos**: los datos de los últimos 1-2 años pueden estar parciales. Escribir "datos disponibles a la fecha de consulta".
- **Dato recordado vs. dato verificado**: un número plausible que el modelo "sabe de memoria" (por ejemplo, un arancel de 8%) no es un dato: es una hipótesis. O se verifica en sesión con la fuente oficial y se cita, o se marca como "estimación a confirmar" y no se usa para decisiones ni conclusiones. Esto vale también cuando el número aparece a mitad de una descarga de datos: si no vino del archivo descargado, no vino de ningún lado.

## El archivo de fuentes

Cada estudio mantiene `fuentes.md` en su carpeta. Una entrada por fuente:

```markdown
## Fuentes
| # | Fuente | URL | Consulta | Para qué se usó |
|---|--------|-----|----------|-----------------|
| 1 | UN Comtrade — HS 1509, ARG→World, 2015-2023 | comtradeplus.un.org | 04/11/2026 | Figura 2, tabla 4 |
| 2 | ITC Trade Map — mercado importador de aceite de oliva | trademap.org | 04/11/2026 | Selección de mercados |
```

La columna "Para qué se usó" es la que permite auditar el trabajo: cada tabla del informe tiene que poder vincularse a una o más fuentes.

## Verificación: cómo comprobar una cifra

1. **Ir a la fuente primaria**, no al sitio que la reproduce.
2. **Contrastar con una segunda fuente** cuando la cifra sea central para una conclusión. Si discrepan, no promediar: citar la fuente elegida y explicar la diferencia (criterios FOB/CIF, año de registro, datos espejo).
3. **Sentido común numérico**: comparar órdenes de magnitud con magnitudes conocidas (PIB del país, exportaciones totales del sector). Un dato 100 veces mayor que lo esperado es un error de unidades o de código, casi siempre.
4. **Período claro**: distinguir año de referencia (el que mide el dato) de año de publicación.

Cuando un agente redacta: las cifras que generan los modelos de lenguaje sin venir de una descarga o de una fuente citada **son invenciones hasta que se demuestre lo contrario**. Nunca copiar una cifra de un texto generado sin verificarla contra la fuente.

## Honestidad académica

- Lo que la IA puede hacer: buscar fuentes, bajar datos, organizar análisis, proponer estructura, redactar borradores, corregir estilo.
- Lo que la IA no puede hacer: inventar datos, fabricar citas o bibliografía, inventar resultados de encuestas, plagiar textos ajenos (incluidos sus propios generados sin edición).
- **El criterio y la defensa son de la persona**: el trabajo es suyo, y debe poder explicar cada tabla de memoria. Si una parte no la entiende, no entregarla hasta entenderla.
- Si el trabajo usó herramientas de IA, seguir la política de la institución; si exige declaración, declararlo. Es mejor declararlo a que lo descubran.

## APA 7 — formato rápido para las fuentes habituales

- **Base de datos / sitio web**: Organismo. (Año). *Título del recurso*. URL
  > International Trade Centre. (2026). *Trade Map: Trade statistics for international business development*. https://www.trademap.org
- **Informe institucional**: Organismo. (Año). *Título del informe* (Nº de publicación, si hay). URL
- **Libro**: Autor, A. A. (Año). *Título del libro* (edición). Editorial.
- **Artículo**: Autor, A. A. (Año). Título del artículo. *Revista, vol*(núm), pp-pp. DOI

La bibliografía se arma al final con todas las entradas de `fuentes.md`, pero las entradas se van creando al momento de consultar cada fuente: reconstruir la bibliografía al final desde la memoria es como se cuelan las fuentes falsas.

## Checklist de entrega

- [ ] Cada cifra del texto tiene cita con fecha de consulta.
- [ ] Cada tabla/figura tiene nota de fuente debajo.
- [ ] `fuentes.md` está completo y cada tabla del informe es rastreable.
- [ ] Las estimaciones (espejo, proxies) están declaradas en la metodología.
- [ ] La bibliografía usa un solo formato consistente.
- [ ] Nada del texto es una cita textual de otra fuente sin comillas y referencia.
