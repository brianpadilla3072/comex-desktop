---
name: estudio-mercado-internacional
description: Metodología completa para hacer estudios de mercado internacionales, planes de internacionalización, selección de mercados y casos de exportación. Usar SIEMPRE que se pida un estudio de mercado, un análisis de mercado exterior, una investigación de mercados, un plan de exportación/internacionalización, la selección de un país o mercado meta, un caso práctico de comercio exterior o un trabajo final de la carrera de Comercio Exterior, aunque no se mencione la metodología. También cuando se analice la viabilidad de exportar o importar un producto.
---

# Estudio de Mercado Internacional

Guía el flujo completo de un estudio de mercado internacional. El trabajo tiene 6 fases; no las saltees: un estudio que salta directo al análisis sin definir objetivos pierde coherencia, y los profesores lo notan. Cada fase termina con un entregable concreto que se suma a la carpeta del estudio.

## Estructura de la carpeta del estudio

Cada estudio vive en su propia carpeta. Esto hace el trabajo reproducible y fácil de corregir:

```
estudio-<producto>-<mercado>/
├── brief.md          # Fase 1: objetivos y alcance
├── fuentes.md        # Inventario de fuentes consultadas (ver skill investigacion-con-fuentes)
├── datos/            # Series descargadas y scripts usados
├── analisis/         # Matrices: preselección, PESTEL, DOFA, competencia, precios
└── informe.md        # Trabajo final armado por fases
```

## Fase 1 — Brief y objetivos

Antes de buscar nada, dejar por escrito:

- **Producto o servicio**: qué se exporta (o importa), con su código NCM/HS si se conoce.
- **Mercado**: un país, una región o "hay que elegir entre varios".
- **Objetivo del estudio**: validar una oportunidad, comparar mercados, armar un plan de exportación, completar una materia.
- **Preguntas que el estudio debe responder** (3 a 5, concretas). Ej.: "¿Cuánto creció la demanda mundial de este producto en los últimos 5 años?", "¿Qué arancel enfrenta en el mercado meta?", "¿Quiénes son los principales competidores?".
- **Fecha de entrega y formato exigido** (si es un trabajo académico, pedir la consigna original).

Entregable: `brief.md`. Si falta información esencial (ej. no se sabe qué producto), preguntar antes de avanzar.

## Fase 2 — Diseño de investigación

Definir qué tipo de datos necesita cada pregunta y de dónde saldrán:

| Tipo | Cuándo usarlo | De dónde sale |
|---|---|---|
| Secundaria (casi siempre la mayor parte) | Flujos comerciales, aranceles, entorno del país, competencia | Bases oficiales: ver skill `datos-comex` |
| Primaria | Percepción de compradores, precios reales, canales | Encuestas y entrevistas: la persona hace el trabajo de campo, el agente diseña los instrumentos |

Explicitar las hipótesis del estudio ("Brasil es el mercado más atractivo porque..."). La hipótesis se puede corregir con los datos; lo importante es que exista antes de mirarlos, para no racionalizar conclusiones a posteriori.

## Fase 3 — Recolección de datos

1. Consultar la skill `datos-comex` y bajar las series que respondan las preguntas (comercio, aranceles, entorno).
2. Registrar cada fuente en `fuentes.md` (formato en la skill `investigacion-con-fuentes`).
3. Guardar los datos crudos en `datos/` con nombre claro (`comtrade_exportaciones_aceite_oliva_2015-2025.csv`) y conservar el script o el procedimiento exacto de descarga.

Regla de calidad: preferir datos oficiales y recientes a datos agregados por terceros. Si dos fuentes se contradicen, no promediar: anotar la diferencia y explicarla en el informe.

## Fase 4 — Investigación primaria (si aplica)

La mayoría de los trabajos de la carrera se resuelven con secundaria + instrumentos diseñados. Si hace falta campo:

- **Encuesta** (cuantitativa): diseñar el cuestionario, definir la muestra (población, tamaño, criterios de selección) y cómo se va a aplicar.
- **Entrevista en profundidad** (cualitativa): guía de preguntas abiertas para compradores, importadores o agentes comerciales.
- **Observación de competencia**: precios publicados, catálogos, ferias, marketplaces (Alibaba, directorios de cámaras).

El agente diseña los instrumentos y analiza los resultados cargados; la recolección real la hace la persona. Nunca inventar respuestas de encuestas: si no se hizo el campo, el informe declara que el estudio se basa en fuentes secundarias.

## Fase 5 — Análisis

Aplicar, en este orden, las herramientas que aporten algo para las preguntas del brief (usar todas por costumbre es ruido, no rigor):

1. **Serie histórica y tendencia**: evolución de exportaciones/importaciones mundiales y del mercado meta (5-10 años), TCAC, cuota de mercado.
2. **Matriz de preselección de mercados** (si hay que comparar países): criterios ponderados — atractivo del mercado (tamaño, crecimiento), acceso (arancel, acuerdos comerciales, barreras), competencia (concentración de proveedores), dificultad operativa (logística, distancia, requisitos). Calificar 1-5 por criterio, ponderar, y mostrar la tabla completa.
3. **PESTEL del país meta**: político, económico, social, tecnológico, ecológico, legal. Dos o tres líneas por factor con dato o fuente; sin fuentes, no ponerlo.
4. **Análisis de la competencia**: principales países proveedores al mercado meta, valores unitarios como proxy de precio de referencia, empresas identificables.
5. **DOFA**: recién después del análisis, cruzando lo anterior. La DOFA sin datos detrás es decoración.
6. **Precios y costos de acceso**: derechos de importación, valor unitario de referencia, costos logísticos estimados (FOB/CIF si hay datos).

## Fase 6 — Informe

Estructura estándar del trabajo:

1. **Portada y resumen** (200-300 palabras: objetivo, método, hallazgos principales).
2. **Introducción**: problema, objetivos, justificación.
3. **Marco teórico**: conceptos usados (investigación de mercados, internacionalización, aranceles) citando fuentes académicas.
4. **Metodología**: qué datos se usaron, de qué fuentes, período, y limitaciones (ej. datos espejo, años con información incompleta).
5. **Análisis**: las secciones del punto anterior, con tablas y gráficos que tengan nota de fuente.
6. **Conclusiones y recomendaciones**: respondiendo una por una las preguntas de la fase 1.
7. **Bibliografía** (APA 7) y **anexos** (instrumentos, scripts, datos).

Cada tabla y figura lleva debajo: `Fuente: <base> (consulta: <mes-año>)`. Toda cifra citada en el texto tiene que poder rastrearse a `fuentes.md`.

## Calidad: chequeo final antes de entregar

- [ ] El informe responde las preguntas del brief, una por una.
- [ ] Toda cifra tiene fuente, fecha de consulta y período de referencia.
- [ ] Las limitaciones del dato están declaradas (espejo, incompletitud, antigüedad).
- [ ] Las conclusiones se sostienen con el análisis mostrado (nada "aparece" solo al final).
- [ ] La bibliografía sigue un solo formato consistente.
- [ ] El trabajo se puede defender oralmente: cada tabla se puede explicar de dónde salió.
