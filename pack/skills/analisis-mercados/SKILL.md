---
name: analisis-mercados
description: "Herramientas de análisis para estudios de comercio exterior — matriz de preselección de mercados, PESTEL, DOFA, indicadores de comercio (TCAC, cuotas de mercado, valores unitarios, VCA), ranking de competidores y dimensionamiento de la demanda. Usar SIEMPRE que haya que analizar datos de un estudio de mercado, comparar o rankear países/mercados, armar una matriz de preselección, hacer un análisis PESTEL o DAFO/DOFA, calcular indicadores de crecimiento o participación, estimar el tamaño de un mercado, o cuando ya se descargaron datos de Comtrade/Trade Map y hay que convertirlos en conclusiones."
---

# Análisis de Mercados

Es la fase 5 del estudio (skill `estudio-mercado-internacional`): convertir datos en conclusiones defendibles. Dos principios antes de cualquier herramienta:

1. **Solo se aplica la herramienta que responde una pregunta del brief.** Usar PESTEL+DOFA+matriz por costumbre es decoración, no análisis.
2. **Ningún puntaje o calificación sin un dato de respaldo.** En cada matriz, la fila tiene que poder leerse hacia atrás hasta una fuente en `fuentes.md`.

Las matrices se trabajan en Excel (skill `planilla-xlsx`, una hoja por matriz) y el texto del análisis va al `informe.md`.

## Matriz de preselección de mercados

Para elegir entre países candidatos (o justificar por qué el elegido):

1. **Criterios** — el set clásico, ajustable al caso:
   - Atractivo del mercado: tamaño de las importaciones, crecimiento (TCAC), tendencia.
   - Acceso: arancel aplicado, acuerdos/preferencias vigentes, barreras no arancelarias.
   - Competencia: concentración de proveedores, participación de la competencia.
   - Factibilidad operativa: distancia/logística, idioma, normativa de calidad, capacidad exportadora propia.
2. **Escala** (1-5) con regla explícita de asignación escrita antes de puntuar. Ejemplo: 5 = arancel ≤5%; 4 = ≤10%; 3 = ≤20%; 2 = ≤35%; 1 = >35%.
3. **Ponderación** que sume 100%. Punto de partida razonable: atractivo 40, acceso 30, competencia 15, factibilidad 15. Ajustar según el objetivo del estudio y **declarar el criterio elegido y por qué**.
4. **Puntaje** = Σ (nota × peso). Tabla completa en el informe, nunca solo el resultado.
5. **Análisis de sensibilidad**: re-puntuar cambiando las ponderaciones ±20%. Si el ranking se invierte, decirlo explícitamente ("la elección es sensible al peso del arancel") — eso es rigor, no debilidad.

## PESTEL del mercado meta

Una tabla: factor | hallazgo concreto (con dato) | implicancia para la exportación | fuente.

Dónde buscar cada factor:
- **P**olítico: estabilidad, relaciones bilaterales con Argentina, tratados vigentes (Ministerio de Relaciones, CEPAL).
- **E**conómico: PIB, ingreso per cápita, tipo de cambio, poder de compra del producto (FMI/Banco Mundial/CEPAL).
- **S**ocial: demografía, hábitos de consumo, tamaño del segmento objetivo (institutos de estadística del país, estudios de cámaras).
- **T**ecnológico: canales digitales, infraestructura logística, certificaciones exigibles.
- **E**cológico: clima/estacionalidad relevante al producto, tendencias de sustentabilidad.
- **L**egal: normas técnicas, etiquetado, requisitos sanitarios (senasica/anvisa/equivalente), régimen de importación.

Criterio de calidad: si un factor no tiene ni un dato ni una fuente, es una opinión; va al análisis cualitativo como tal o no va.

## DOFA (DAFO/SWOT)

Se hace **después** de los análisis previos, como cruce, no como origen:
- Debilidades/Fortalezas ← lo que se encontró del exportador (capacidad, costos, certificaciones).
- Oportunidades/Amenazas ← PESTEL + competencia + acceso.
- Cada ítem cita la sección del informe que lo sustenta.
- El valor está en las estrategias cruzadas: FO (usar fortaleza A para aprovechar oportunidad B), DD (mitigar). Sin cruces, la DOFA es una lista de deseos.

## Indicadores de comercio

Fórmulas para las series descargadas (skill `datos-comex`). Cuidado: los valores de Comtrade están en USD corrientes — para hablar de "crecimiento real" o comparar años, aclarar que es nominal.

- **TCAC** (tasa compuesta de crecimiento anual) = (V_final / V_inicial)^(1/n) − 1, con n = cantidad de años entre los dos valores.
- **Cuota de mercado** de un proveedor = importaciones desde ese proveedor / importaciones totales del producto en ese mercado. Con los datos de Comtrade usando `--reporter <mercado> --partner WORLD`, el denominador es la columna del total; los proveedores salen de la misma query por socio.
- **Valor unitario** (proxy de precio) = valor / peso neto (USD/kg). Mezcla calidades: llamarlo "valor unitario", nunca "precio".
- **Ventaja Comparativa Revelada (VCA)** de un país en un producto = (exp PRODUCTO_país / exp TOTAL_país) ÷ (exp PRODUCTO_mundo / exp TOTAL_mundo). VCA > 1 indica especialización exportadora. Para "¿puede Argentina ser competitiva aquí?".
- **Concentración de proveedores**: CR3 (suma de las 3 cuotas mayores) o HHI (suma de cuotas al cuadrado, sobre 10.000). Alta concentración = barrera de entrada para un nuevo proveedor.

## Dimensionamiento del mercado (market sizing)

- **Top-down**: importaciones totales del producto en el mercado meta (dato oficial) = proxy de la demanda cubierta con producción extranjera. Agregarle la producción local estimada si el mercado también produce (declarar el ajuste).
- **Bottom-up** (cuando hay datos de canal): nº de compradores potenciales × frecuencia × ticket promedio. Solo con supuestos escritos y verificables.
- En ambos casos: tabla de supuestos visible (cada supuesto con su fuente o su justificación) — es lo que el tribunal pregunta primero.

## Cierre del análisis

Cada herramienta termina con 2-4 líneas de "¿qué significa esto para las preguntas del brief?". El informe no concluye sobre datos: concluye sobre el significado de los datos.
