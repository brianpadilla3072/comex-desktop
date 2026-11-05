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
5. ⬜ Opcionales según el uso real: `presentacion-defensa` (slides para defender el TFI), `operativa-aduanera` (documentación de exportación), agentes `analista-datos-comex` / `explorador-fuentes` separados, `logistica-transporte`, `ingles-comercial`.
