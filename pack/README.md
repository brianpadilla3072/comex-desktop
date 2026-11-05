# Pack Comercio Exterior — agentes y skills para estudios de mercado

Este pack le da a OpenCode (app de escritorio o terminal) las herramientas para ayudarte con los estudios de mercado, investigaciones y trabajos finales de la carrera de Comercio Exterior. No hace falta saber programación: se instala una vez y después se usa escribiendo en castellano.

## Instalación (una sola vez)

1. Si no tenés OpenCode instalado, descargá la app de escritorio desde <https://opencode.ai/v2/docs/> (sección "Desktop").
2. Abrí una terminal en esta carpeta y ejecutá:

   ```bash
   bash instalar.sh
   ```

Eso instala las skills y el agente en tu usuario. Sirve en cualquier carpeta donde trabajes.

## Cómo se usa

1. Abrí OpenCode y elegí el agente **investigador-mercados** en el selector de agentes.
2. Contale el trabajo como se lo contarías a un compañero. Por ejemplo:

   > Necesito un estudio de mercado de aceite de oliva argentino para exportar. Me interesa Brasil o Chile y tengo que entregarlo en 3 semanas para la materia X.

3. Él te va a hacer unas preguntas (producto, mercado, objetivo) y después trabaja por fases: consigue los datos oficiales, arma el análisis y te entrega el informe con las fuentes cargadas. Te muestra avances por fase para que vayas siguiendo el trabajo. Cuando lo necesites, el informe sale en **Word** y las tablas y datos en **Excel**, listos para entregar.

Lo que te devuelve vive en carpetas (brief, fuentes, datos, análisis, informe): todo queda guardado y ordenado para entregar o para explicar.

## Qué hay adentro

| Pieza | Qué hace |
|---|---|
| Agente `investigador-mercados` | El que usás: conduce el estudio completo de principio a fin. |
| Agente `arquitecto-de-agentes` | Crea skills y agentes nuevos cuando aparece una tarea que se va a repetir. |
| Agente `revisor-exigente` | Audita el borrador como un tribunal antes de entregarlo. |
| Agente `verificador-de-fuentes` | Rastrea cada cifra hasta su fuente antes de entregarlo. |
| Skill `estudio-mercado-internacional` | La metodología en 6 fases y la estructura del informe. |
| Skill `datos-comex` | Dónde y cómo bajar datos oficiales (UN Comtrade, Trade Map, WITS, OMC, OEC) + script que consulta Comtrade + fuentes argentinas (INDEC, Aduana, ALADI, CEPAL...). |
| Skill `analisis-mercados` | Matriz de preselección, PESTEL, DOFA, indicadores (TCAC, cuotas, VCA), dimensionamiento. |
| Skill `cotizacion-exportacion` | Incoterms, precios FOB/CFR/CIF, landed cost + calculadora. |
| Skill `investigacion-con-fuentes` | Reglas de citación y verificación: todo dato lleva fuente, nada se inventa. |
| Skill `informe-academico` | Estructura de TFI/monografía, contenido por capítulo, APA 7 completo. |
| Skill `documento-docx` | Genera los documentos de Word: tapa, índice, tablas y figuras numeradas. |
| Skill `planilla-xlsx` | Genera planillas de Excel: datos, matrices, tablas con gráficos. |
| Skill `taller-de-agentes` | Cómo crear nuevas skills y agentes (la base para que el pack crezca solo). |
| Skill `encuestas-y-entrevistas` | Cuestionario, muestra, plan de campo y análisis de respuestas reales; distingue diseño de encuesta realizada. |
| Skill `logistica-transporte` | Cadena logística, operadores y elección de modo e Incoterm por producto y destino. |
| Skill `presentacion-defensa` | Guion de exposición, apoyo visual y práctica de preguntas con evidencias del informe. No genera PowerPoint por sí sola. |

## Consigna del profesor como caso de aceptación

El TP 1 de 2026 de Investigación de Mercados Externos es la referencia concreta del pack: dos productos nacionales, destinos diferentes, perfiles técnicos y arancelarios, selección con estadísticas, barreras, encuesta realizada, competencia, canales, logística, Incoterm, informe y defensa. El agente usa la [matriz de requisitos](skills/estudio-mercado-internacional/references/tp1-2026.md) y registra la evidencia por requisito en `cumplimiento.md` del estudio.

La guía `ESTUDIO DE MERCADO INTERNACIONAL.docx` aporta el esquema de desarrollo (PESTEL, demanda, 4 Ps, FODA y anexos). El agente distingue esa guía de los requisitos explícitos del PDF y no inventa extensión, muestra mínima ni datos para llenar capítulos.

La aplicación real de la encuesta corresponde a la persona. El agente prepara el instrumento y analiza las respuestas recibidas. Si el campo obligatorio está pendiente, entrega un borrador incompleto con esa limitación visible. Las nuevas instrucciones deben evaluarse con el [caso de aceptación](../docs/comex/aceptacion-tp1-2026.md) antes de anunciar el flujo completo como probado.

El instalador también prepara un entorno de Python con las librerías que usan los scripts (`python-docx` y `openpyxl`). No hace falta instalar nada más a mano.

## Cuentas gratuitas que conviene crear (opcional pero recomendable)

- **UN Comtrade** (comtradeplus.un.org): registro gratis para descargar datos.
- **Trade Map** (trademap.org): registro gratis; tablas de mercados muy útiles para los estudios.

## Reglas que el pack sigue (y que también te sirven a vos)

- Todo dato lleva fuente y fecha de consulta; lo que no se puede verificar, no entra en el trabajo.
- Los datos estimados (espejo, proxies de precio) se declaran como estimados.
- Las decisiones del estudio son tuyas: el agente trae opciones y datos, vos decidís y defendés el trabajo.

## Próximas piezas (roadmap)

1. ✅ Skills de dominio + agente orquestador.
2. ✅ Entregables: `documento-docx` (Word) y `planilla-xlsx` (Excel).
3. ✅ Lote "ya": `analisis-mercados`, `cotizacion-exportacion`, `informe-academico`, `revisor-exigente`, `verificador-de-fuentes`.
4. ✅ Capa meta: `taller-de-agentes` + `arquitecto-de-agentes` — con esto ella puede crear sus propias skills cuando aparezcan materias nuevas.
5. Instrucciones agregadas para encuesta, logística y defensa; pendiente la prueba completa contra el TP del profesor con respuestas reales y entregables revisados.
6. ⬜ Opcionales según el uso real: generación de slides, `operativa-aduanera` (documentación de exportación), agentes `analista-datos-comex` / `explorador-fuentes` separados, `ingles-comercial`.
