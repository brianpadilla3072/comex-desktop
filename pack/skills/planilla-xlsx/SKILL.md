---
name: planilla-xlsx
description: "Crear y editar planillas de Excel (.xlsx) — datos de comercio exterior, series de exportaciones/importaciones, matrices de análisis (preselección de mercados, PESTEL, DOFA), tablas para el informe y cálculos. Usar SIEMPRE que se pida un archivo de Excel, una planilla, un .xlsx, \"una hoja de cálculo\", datos tabulados para trabajar o entregar, o cuando un dataset del estudio (CSV de Comtrade, Trade Map, encuestas) tenga que volcarse a Excel. También para leer, editar o calcular sobre un .xlsx existente."
---

# Hojas de cálculo (xlsx)

En un estudio de comercio exterior, Excel sirve para tres cosas: conservar los **datos crudos** descargados, trabajar las **matrices de análisis** (preselección, PESTEL, DOFA, costos) y producir las **tablas del informe**. El script incluido convierte CSV/JSON a un `.xlsx` con formato prolijo en un paso.

## Crear una planilla nueva

```bash
# Datos de Comtrade a Excel, con título, fuente y gráfico de tendencia
python3 scripts/tabla_xlsx.py datos/comtrade_arg_1509.csv -o datos/serie.xlsx \
  --title "Exportaciones argentinas de HS 1509 (2015-2023)" \
  --fuente "UN Comtrade (consulta: nov-2026)" \
  --chart line --chart-x refYear --chart-cols primaryValue

# Matriz de análisis desde un CSV con separador ;
python3 scripts/tabla_xlsx.py analisis/preseleccion.csv -o analisis/preseleccion.xlsx \
  --title "Matriz de preselección de mercados" --sheet "Preselección"
```

El script produce: fila de título, encabezados con color y negrita, formato numérico automático (miles, decimales, porcentajes), ancho de columnas, panel inmovilizado, gráfico nativo de Excel (`--chart line|bar`) y nota "Fuente:" al pie. Acepta CSV (`,` o `;`, se autodetecta) o JSON (lista de objetos). Ver `--help` para todas las opciones.

Los códigos de producto y país se conservan como texto (incluidos ceros iniciales). Los datos importados, incluso si empiezan con `=`, se guardan como texto literal: las fórmulas se agregan explícitamente después. Se reconocen números como `1.234,56` y `1,234.56`; un separador único se interpreta como decimal. Para porcentajes, usar `12,5%` o una fracción como `0.125`, indicando la unidad en el encabezado.

## Convenciones del pack (mantenerlas)

- **Datos crudos intactos**: la hoja con lo descargado de Comtrade/Trade Map no se edita a mano. Las transformaciones y promedios van en otra hoja o en otra planilla, para que el dato original sea auditable.
- **Toda planilla con datos citados lleva nota "Fuente:"** con base y fecha de consulta (usar `--fuente`). Es la misma regla que en los documentos.
- **Una hoja por conjunto de datos** (`--sheet`): "Datos", "Preselección", "PESTEL", "Costos".
- Los CSV descargados se conservan en `datos/` también como están: el `.xlsx` es para trabajar/entregar, el CSV es el anexo de metodología.

## Editar o calcular sobre un .xlsx existente

Para fórmulas, celdas específicas o combinaciones complejas, usar `openpyxl` directamente:

```python
from openpyxl import load_workbook
wb = load_workbook("datos.xlsx")
ws = wb["Datos"]
ws["F2"] = "=B2/C2"              # fórmulas: escribir el string con =
ws["F2"].number_format = "0.0%"
wb.save("datos.xlsx")
```

Gotchas:

- Las fórmulas se escriben como strings que empiezan con `=`; Excel las calcula al abrir. Si hay que mostrar el resultado sin abrir Excel, calcularlo en Python y escribir el valor.
- `load_workbook(..., data_only=True)` devuelve los valores calculados (si el archivo se guardó desde Excel); sin ese flag devuelve las fórmulas.
- `number_format` usa formato en-US: `#,##0.00`, `0.0%`. Los porcentajes se guardan como fracción (0.118 = 11.8%).
- Nombres de hoja: máximo 31 caracteres, sin `[]:*?/\`.
- Fechas: escribir objetos `date`/`datetime` de Python, no strings.

## Leer datos de un .xlsx o CSV

Para análisis (promedios, rankings, cruces), pandas es cómodo si está instalado; si no, `openpyxl` + `csv` del estándar alcanzan. Los datos que alimentan el informe siempre pasan por un cálculo visible: dejar el script o la celda de fórmula como evidencia.

## Entorno y control de entrega

En un proyecto Comex, el launcher está en `.opencode/scripts/documents.py`.
Si trabajás desde el pack original, usá `scripts/documents.py`.
En Windows el ejecutable puede ser `py -3` o `python`; en Linux/macOS, `python3`.

```bash
python3 .opencode/scripts/documents.py doctor
python3 .opencode/scripts/documents.py setup
python3 .opencode/scripts/documents.py run excel -- datos.csv -o datos.xlsx --fuente "Base y fecha reales de consulta"
python3 .opencode/scripts/documents.py verify datos.xlsx
```

`setup` prepara un entorno privado en `~/.comex-pack/venv` con versiones fijadas;
`COMEX_PACK_HOME` permite elegir otra carpeta. No modifica Python del sistema.
La primera preparación requiere Python 3.10+, venv/pip y acceso a PyPI; con
`setup --wheelhouse CARPETA` usa exclusivamente wheels locales, sin red.
Si la app configura `COMEX_DOCUMENTS_PYTHON`, usar ese intérprete incluido: doctor
indica `pythonBundled=true` tras validar imports y versiones, y setup no modifica
ese runtime. Sin sidecar se necesita un Python disponible para el entorno privado.
No anunciar instalación Windows comprobada solo por pasar pruebas en Linux.

`verify` comprueba ZIP/XML, reabre el archivo, rechaza entregables vacíos y emite
SHA-256. La revisión visual sigue pendiente hasta renderizar o abrir el archivo.
No afirmar que el formato fue revisado visualmente solo porque `verify` pasó.
Las fórmulas de Excel requieren recálculo con Excel/LibreOffice; openpyxl no las calcula.
