# Propuesta: Pack de Agentes y Skills para Comercio Exterior

> Para: amiga estudiante de Comercio Exterior (etapa final: estudios de mercado, investigaciones y trabajo final)
> Objetivo: que ella pueda (a) hacer sus trabajos de investigación con apoyo agéntico y (b) crear sus propios agentes y skills cuando aparezcan tareas nuevas.

---

## 1. Qué necesita resolver

Los trabajos finales de Comercio Exterior (TFI, casos de internacionalización, estudios de mercado internacionales) siguen siempre el mismo esqueleto:

1. Definir objetivos e hipótesis del estudio.
2. Investigación secundaria: datos de comercio internacional, aranceles, entorno del país (PESTEL).
3. Investigación primaria: encuestas, entrevistas, análisis de competencia.
4. Análisis: selección de mercados (matriz de preselección), DOFA, precios, demanda.
5. Informe: estructura académica, citas, tablas, gráficos, conclusiones.

Las fases 2–5 son altamente repetitivas y documentales → terreno ideal para skills.
La fase 1 y las excepciones de cada trabajo → terreno para un agente que crea skills nuevas.

---

## 2. Arquitectura propuesta (3 capas)

```
┌──────────────────────────────────────────────┐
│ CAPA META — Taller de agentes                │
│  · arquitecto-de-agentes (agente)            │
│  · taller-de-agentes (skill)                 │
│  · plantillas-comex (skill)                  │
├──────────────────────────────────────────────┤
│ CAPA DOMINIO — Skills base de Comercio Ext.  │
│  · estudio-mercado-internacional             │
│  · datos-comex                               │
│  · analisis-mercados                         │
│  · investigacion-con-fuentes                 │
│  · encuestas-y-entrevistas                   │
│  · informe-academico                         │
├──────────────────────────────────────────────┤
│ CAPA EJECUCIÓN — Agentes especializados      │
│  · investigador-mercados (orquestador)       │
│  · analista-datos-comex                      │
│  · explorador-fuentes                        │
│  · redactor-tfi                              │
│  · revisor-exigente                          │
│  · verificador-de-fuentes                    │
└──────────────────────────────────────────────┘
```

### Capa meta: el "taller" que ella usa para crear más agentes

| Pieza | Tipo | Qué hace |
|---|---|---|
| `arquitecto-de-agentes` | agente | Recibe una tarea nueva ("tengo que armar una matriz de aranceles comparada"), la descompone y decide: ¿skill nueva, agente nuevo o prompt simple? Genera los archivos, los prueba con un caso real y documenta cómo invocarlos. |
| `taller-de-agentes` | skill | El procedimiento paso a paso para crear skills (estructura SKILL.md, cuándo incluir scripts, cómo testear). Es la skill que hace que ella no dependa de nosotros para crecer. |
| `plantillas-comex` | skill | Biblioteca de plantillas reutilizables: brief de estudio de mercado, matriz de preselección de países, guía de entrevista, checklist documental de exportación, tabla de costos export (FOB/CIF), formato de ficha de mercado. |

### Capa dominio: las skills de Comercio Exterior

| Skill | Contenido clave |
|---|---|
| `estudio-mercado-internacional` | Flujo completo en 6 fases (objetivos → diseño → fuentes → recolección → análisis → informe) con checklist por fase y criterios de calidad. Metodología basada en los estándares de ITC/PromPerú/CAMEX y textos de investigación de mercados (Kinnear & Taylor). |
| `datos-comex` | Cómo obtener datos oficiales: **Trade Map (ITC)** — 230+ economías, 5.300 productos HS, series desde 2001; **UN Comtrade** — API pública sin key (preview) y key gratuita (500 llamadas/día, 100K registros/llamada); **WITS/Banco Mundial** — aranceles (TRAINS) y datos espejo; **OMC Stats** — aranceles consolidados/aplicados y medidas no arancelarias; **OEC (Harvard)** — complejidad económica, PCI/ECI; **Market Access Map (ITC)** — aranceles preferenciales; fuentes nacionales (INDEC, aduanas locales, ALADI, SELA, CEPAL). Incluye script Python base para la API de Comtrade y mapa de códigos HS. |
| `analisis-mercados` | Herramientas con plantillas listas: PESTEL por país, DOFA, matriz de preselección de mercados con criterios ponderados (atractividad del mercado, acceso, competencia, barreras), análisis de competidores, cálculo de valores unitarios como proxy de precio, TCAC y cuotas de mercado, detección de nichos. |
| `investigacion-con-fuentes` | Disciplina de citación: toda cifra lleva fuente + fecha de consulta + URL; distinguir dato oficial de estimación (mirror data); mantener archivo de fuentes/bibliografía; nunca presentar como oficial un dato que no lo es. |
| `encuestas-y-entrevistas` | Investigación primaria: diseño de cuestionarios (preguntas abiertas/cerradas, escalas), guía de entrevistas en profundidad, definición de muestra, guía de focus group. |
| `informe-academico` | Estructura canónica de TFI/caso de internacionalización: portada, resumen, introducción, marco teórico, metodología (secundaria + primaria), análisis, conclusiones y recomendaciones, bibliografía (APA 7), anexos. Convenciones para tablas y gráficos con nota de fuente. |

### Capa ejecución: los agentes que hacen el trabajo

| Agente | Rol |
|---|---|
| `investigador-mercados` | **Orquestador.** Recibe un brief ("¿dónde exportar aceite de oliva argentino?") y coordina al resto: fuentes → datos → análisis → borrador. Es el agente con el que ella conversa. |
| `analista-datos-comex` | Baja y procesa series de Comtrade/Trade Map (Python/pandas): crecimiento, cuotas, valores unitarios, ranking de mercados. Entrega tablas y gráficos reproducibles (el script queda guardado como anexo del trabajo). |
| `explorador-fuentes` | Barrido web de fuentes oficiales e informes (cámaras exportadoras, ITC, CEPAL, organismos). Devuelve un inventario de fuentes con URL y qué aporta cada una. |
| `redactor-tfi` | Convierte hallazgos en borradores de capítulos con citas en APA, tono académico, y marca en qué se apoya cada afirmación. |
| `revisor-exigente` | Audita el borrador como si fuera el tribunal de la tesis: coherencia metodológica, rigor de las fuentes, redacción, formato. Devuelve una lista priorizada de correcciones. |
| `verificador-de-fuentes` | Anti-alucinación: recorre cada cifra y afirmación del borrador, exige la fuente y la contrasta. Lo que no se puede verificar, se marca o se elimina. |

---

## 3. Flujo de trabajo ejemplo

**Pedido:** "Necesito un estudio de mercado de [producto] en [mercado/región] para la materia X"

1. `investigador-mercados` arma el brief y, si el enfoque es nuevo, llama a `arquitecto-de-agentes` para crear la skill que falte (ej. "matriz de acceso arancelario comparado").
2. `explorador-fuentes` + `analista-datos-comex` trabajan en paralelo: uno junta fuentes cualitativas, el otro baja las series de comercio.
3. `analisis-mercados` (skill) aplica la matriz de preselección y el PESTEL sobre esos datos.
4. `redactor-tfi` produce el borrador del informe con citas.
5. `revisor-exigente` audita → loop de correcciones.
6. `verificador-de-fuentes` hace el chequeo final de cifras y citas.
7. Ella revisa, decide y defiende. El criterio final es siempre humano (y académicamente es lo correcto: el trabajo es suyo).

---

## 4. Notas prácticas

- **Cuentas gratuitas necesarias**: UN Comtrade (registro gratis → API key, 500 llamadas/día), Trade Map (registro gratis; las funciones core son gratuitas), WITS (gratis con registro), OEC (50% descuento académico).
- **Mirror data**: cuando el país socio no reporta, las bases usan datos espejo. Hay que declararlo en la metodología del trabajo — es un punto que los profesores valoran.
- **Reproducibilidad**: los scripts de descarga de datos se guardan como anexo. Convierte un trabajo "a mano" en un trabajo defendible.
- **Honestidad académica**: los agentes aceleran la investigación y la redacción, pero las decisiones, el análisis y la defensa son de ella. La skill de fuentes existe justamente para que nada inventado llegue al trabajo final.

---

## 5. Roadmap sugerido

1. **Semana 1**: skills de dominio (`estudio-mercado-internacional`, `datos-comex`, `investigacion-con-fuentes`) + agente `investigador-mercados`. Ya sirve para el primer trabajo real.
2. **Semana 2**: `analista-datos-comex` con script de Comtrade + `analisis-mercados` + `redactor-tfi`.
3. **Semana 3**: capa meta completa (`arquitecto-de-agentes`, `taller-de-agentes`, `plantillas-comex`) + `revisor-exigente` y `verificador-de-fuentes`.
4. **Después**: cada trabajo real que haga alimenta el taller → nacen skills nuevas (aranceles, logística, negociación intercultural, etc.).
