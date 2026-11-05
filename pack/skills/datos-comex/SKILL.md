---
name: datos-comex
description: "Cómo obtener datos oficiales de comercio internacional — estadísticas de exportaciones e importaciones, aranceles, flujos por país y producto, códigos HS/NCM — usando Trade Map, UN Comtrade, WITS, OMC, OEC, Market Access Map y fuentes argentinas. Usar SIEMPRE que hagan falta estadísticas de comercio exterior, datos de exportación o importación, aranceles, barreras, rankings de mercados o países proveedores, valores unitarios, o cuando se mencione UN Comtrade, Trade Map, NCM, código arancelario, aduana o retenciones, aunque no se pida explícitamente \"una base de datos\"."
---

# Datos de Comercio Exterior

Guía para conseguir datos oficiales sin inventar nada. La secuencia recomendada es: identificar el código del producto → bajar la serie de UN Comtrade o Trade Map → completar con aranceles y acceso a mercados → verificar con la fuente nacional cuando exista.

## 1. Identificar el producto: códigos HS y NCM

Los datos comerciales se organizan por código del **Sistema Armonizado (HS)**, estándar internacional de 2 a 6 dígitos. En Argentina se usa la **NCM (Nomenclatura Común del Mercosur)**, que extiende el HS a 8 dígitos. Para bases internacionales alcanza con el HS a 4 o 6 dígitos; para trámites argentinos hace falta la NCM.

- Si la persona no conoce el código, describir el producto y buscarlo en Trade Map (buscador por nombre) o en el listado de capítulos HS. Confirmar el código con la persona antes de descargar datos: un código equivocado invalida todo el análisis.
- Cuidado con las revisiones del HS (HS92, HS96, HS02, HS07, HS12, HS17, HS22): las series largas pueden requerir conversiones. Preferir una misma revisión para todo el estudio y declararlo.

## 2. Dónde están los datos (mapa de fuentes)

| Fuente | Qué da | Acceso | URL |
|---|---|---|---|
| **UN Comtrade** | La base más completa: ~200 países, series desde 1962, por producto y socio. API pública sin clave (preview) y key gratuita (500 llamadas/día, 100.000 registros por llamada) | Registro gratis en la web para la key | comtradeplus.un.org |
| **Trade Map (ITC)** | Tablas y gráficos amigables: 230+ economías, 5.300 productos HS, series desde 2001, indicadores (cuotas, crecimiento, valores unitarios), directorio de empresas | Registro gratis; funciones core gratuitas | trademap.org |
| **WITS (Banco Mundial)** | Comtrade + aranceles (base TRAINS): aranceles aplicados, preferenciales, acuerdos comerciales | Gratis con registro | wits.worldbank.org |
| **WTO Stats (OMC)** | Aranceles consolidados y aplicados, medidas no arancelarias, comercio de servicios | Gratis | data.wto.org |
| **Market Access Map (ITC)** | Aranceles preferenciales por acuerdo, reglas de origen, comparaciones país a país | Registro gratis (capacidades según plan) | macmap.org |
| **OEC (Harvard)** | Visualización de flujos, índices de complejidad económica (PCI/ECI), exploración por producto | Gratis (funciones avanzadas de pago; 50% descuento académico) | oec.world |
| **Fuentes argentinas** | Estadísticas nacionales, NCM, aranceles, regulación | Ver `references/fuentes-argentina.md` | — |

Regla: para cifras que vayan a un trabajo académico, citar siempre la **fuente primaria** (la base oficial), no un blog que la reproduce.

## 3. Workflow con UN Comtrade (script incluido)

El script `scripts/comtrade.py` consulta la API pública de Comtrade sin necesidad de instalar nada (solo Python 3):

```bash
# Exportaciones argentinas de aceite de oliva (HS 1509) al mundo, 2015-2024
python3 scripts/comtrade.py --reporter ARG --partner WORLD --product 1509 \
  --year 2015-2024 --flow X --out datos/comtrade_arg_1509.csv

# Importaciones brasileñas de ese producto desde Argentina
python3 scripts/comtrade.py --reporter BRA --partner ARG --product 1509 \
  --year 2020-2024 --flow M
```

- `--reporter` / `--partner` aceptan ISO3 (ARG, BRA, CHN...) o código M49. `--partner WORLD` = total al mundo.
- `--product` es código HS (2-6 dígitos) o `TOTAL`. `--flow X` exportaciones, `M` importaciones.
- La API pública preview limita la cantidad de registros por llamada y tiene rate limit (si responde 429, el script reintenta solo). Para series amplias, pedir por tramos.
- Con `--out` guarda CSV en `datos/`; sin él imprime un resumen por año en pantalla.

Después de descargar: verificar que los valores tengan sentido (orden de magnitud, años sin datos) y guardar SIEMPRE el CSV junto con una nota de qué query se usó. Ese CSV + script son el anexo de metodología del trabajo.

## 4. Trade Map (cuando se prefiere mirar antes que programar)

1. Registrarse (gratis) en trademap.org.
2. Buscar por producto (nombre o código HS) o por país.
3. Las vistas útiles para un estudio: **"Lista de mercados de importación"** (dónde se compra ese producto y cuánto crece), **"Lista de proveedores"** (de dónde viene la competencia), **"Evolución"** (serie 2001-hoy), **"Valores unitarios"** (proxy de precio).
4. Exportar a Excel y guardar en `datos/` con fecha de descarga en el nombre.

Trade Map y Comtrade comparten la misma base estadística subyacente: no hace falta bajar las dos para la misma cifra, pero sí conviene cruzar cuando una cifra sorprende.

## 5. Aranceles y acceso a mercados

- **WITS/TRAINS**: arancel aplicado por producto y socio (incluye preferencias por acuerdo). Útil para "¿qué derecho de importación paga este producto en el mercado meta?".
- **Market Access Map**: comparar aranceles entre mercados candidatos y ver el efecto de los acuerdos (Mercosur, TLCs).
- **OMC**: arancel consolidado (el techo comprometido) vs aplicado, y medidas no arancelarias (certificaciones, cuotas, fitosanitarios).
- Para Argentina como exportador: verificar derechos de exportación (retenciones) y regulaciones en las fuentes nacionales.

## 6. Calidad del dato: lo que hay que declarar

- **Datos espejo (mirror data)**: cuando el país importador no reporta, las bases estiman usando las exportaciones del socio declarante. Es una estimación, no un dato oficial del país. Declararlo en la metodología.
- **Años faltantes**: los países reportan con desfasajes; 2024-2025 pueden estar incompletos. Indicar "datos disponibles a la fecha de consulta".
- **Precios**: no existen "precios de exportación" oficiales por producto; el valor unitario (valor/peso) es un proxy que mezcla calidades. Nombrarlo como lo que es.
- **Unidades**: chequear si el valor está en USD corrientes y el peso en kg; no comparar series con distinta unidad.

## Checklist antes de citar una cifra

- [ ] ¿Sé de qué base salió y cuándo la consulté? (va en `fuentes.md`)
- [ ] ¿El período está claro (año de referencia, no año de publicación)?
- [ ] ¿Es dato oficial o estimación espejo?
- [ ] ¿El código de producto es el mismo que usé en el resto del análisis?
- [ ] ¿Puedo volver a descargarlo con el script o el procedimiento que guardé?
