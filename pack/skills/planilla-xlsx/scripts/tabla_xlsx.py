#!/usr/bin/env python3
"""
tabla_xlsx.py — Convierte un CSV (o JSON) a un .xlsx con formato académico/profesional.

Pensado para estudios de comercio exterior: datos de Comtrade/Trade Map, matrices
de análisis (preselección de mercados, PESTEL, DOFA) y tablas para el informe.
Título, encabezados con estilo, formatos numéricos, ancho automático, panel
inmovilizado y gráficos nativos de Excel.

Uso:
  python3 tabla_xlsx.py datos/comtrade_arg_1509.csv -o datos.xlsx --title "Exportaciones ARG de HS 1509" --fuente "UN Comtrade (consulta: nov-2026)"
  python3 tabla_xlsx.py datos.csv -o serie.xlsx --chart line --chart-x "refYear" --chart-cols "primaryValue"
  python3 tabla_xlsx.py matriz.json -o matriz.xlsx --sheet "Preselección"

Opciones útiles:
  --title TEXTO       fila de título arriba (negrita, tamaño 14)
  --fuente TEXTO      nota "Fuente:" al pie de la hoja
  --sheet NOMBRE      nombre de la hoja (default: Datos)
  --chart line|bar    agrega un gráfico nativo de Excel
  --chart-x COLUMNA   columna del eje X (default: la primera)
  --chart-cols A,B    columnas de datos del gráfico (default: todas las numéricas)
  --sep CARÁCTER      separador del CSV (default: se autodetecta , o ;)
  --no-freeze         no inmovilizar el encabezado

Requiere: openpyxl (se instala con: bash instalar.sh)
"""

import argparse
import csv
import json
import os
import sys
from pathlib import Path


def _bootstrap():
    """Garantiza openpyxl; si falta, reintenta con el venv del pack."""
    try:
        import openpyxl  # noqa: F401
        return
    except ImportError:
        pass
    is_win = os.name == "nt"
    venv_py = Path.home() / ".comex-pack" / "venv" / ("Scripts/python.exe" if is_win else "bin/python")
    if venv_py.exists() and Path(sys.executable).resolve() != venv_py.resolve():
        os.execv(str(venv_py), [str(venv_py), __file__, *sys.argv[1:]])
    sys.exit("Falta la librería openpyxl. Ejecutá 'bash instalar.sh' en la carpeta del pack "
             "(o 'python3 -m pip install --user openpyxl').")


_bootstrap()

from openpyxl import Workbook, load_workbook  # noqa: E402
from openpyxl.chart import BarChart, LineChart, Reference  # noqa: E402
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side  # noqa: E402
from openpyxl.utils import get_column_letter  # noqa: E402

HEADER_FILL = PatternFill("solid", fgColor="1F4E5F")
HEADER_FONT = Font(bold=True, color="FFFFFF", size=11)
THIN = Side(style="thin", color="B0B0B0")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

MONEY_HINTS = ("usd", "valor", "importe", "monto", "export", "import", "fob", "cif")
PCT_HINTS = ("pct", "%", "porcent", "variacion", "variación", "participacion", "participación", "cuota")


def detect_sep(sample):
    return ";" if sample.count(";") > sample.count(",") else ","


def coerce(value, header=""):
    """Convierte strings numéricos (es/ar y us) a número; devuelve el valor y su formato."""
    if value is None:
        return None, None
    s = str(value).strip()
    if s in ("", "-", "—", "n/a", "N/A", "s/d", "SD"):
        return s if s else None, None
    pct = s.endswith("%")
    core = s[:-1].strip() if pct else s
    core = core.replace("$", "").replace(" ", "")
    num = None
    try:
        if "," in core and "." in core:
            num = float(core.replace(".", "").replace(",", "."))
        elif "," in core:
            num = float(core.replace(",", "."))
        elif core.count(".") > 1:
            num = float(core.replace(".", ""))
        else:
            num = float(core)
    except ValueError:
        return s, None
    if num is None:
        return s, None
    if pct:
        return num / 100.0, "0.0%"
    if num == int(num) and "." not in core and "," not in core:
        return int(num), "#,##0"
    h = header.lower()
    if any(k in h for k in PCT_HINTS):
        fmt = "0.0%"
    elif any(k in h for k in MONEY_HINTS):
        fmt = "#,##0.00"
    else:
        fmt = "#,##0.00" if abs(num) < 1000 and num % 1 else "#,##0"
    return num, fmt


def load_rows(path, sep=None):
    p = Path(path)
    if p.suffix.lower() == ".json":
        data = json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(data, list) or not data:
            sys.exit("El JSON debe ser una lista de objetos.")
        headers = list(data[0].keys())
        return headers, [[row.get(h, "") for h in headers] for row in data]
    text = p.read_text(encoding="utf-8-sig")
    if sep is None:
        sep = detect_sep("\n".join(text.splitlines()[:5]))
    reader = csv.reader(text.splitlines(), delimiter=sep)
    rows = [r for r in reader if any(c.strip() for c in r)]
    if not rows:
        sys.exit("El CSV está vacío.")
    n_cols = max(len(r) for r in rows)
    rows = [r + [""] * (n_cols - len(r)) for r in rows]
    return rows[0], rows[1:]


def build(path, out, title, fuente, sheet, chart_kind, chart_x, chart_cols, sep, freeze):
    headers, raw_rows = load_rows(path, sep)
    wb = Workbook()
    ws = wb.active
    ws.title = sheet
    row = 1

    if title:
        ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=max(len(headers), 2))
        c = ws.cell(row=1, column=1, value=title)
        c.font = Font(bold=True, size=14)
        c.alignment = Alignment(horizontal="left")
        row = 2 + 1  # deja un blanco
    header_row = row

    for j, h in enumerate(headers, start=1):
        c = ws.cell(row=header_row, column=j, value=h)
        c.fill, c.font, c.border = HEADER_FILL, HEADER_FONT, BORDER
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

    fmts = {}
    for i, r in enumerate(raw_rows, start=header_row + 1):
        for j, (val, h) in enumerate(zip(r, headers), start=1):
            num, fmt = coerce(val, h)
            c = ws.cell(row=i, column=j, value=num)
            c.border = BORDER
            if fmt:
                c.number_format = fmt
                fmts[j] = fmt
                c.alignment = Alignment(horizontal="right")
            else:
                c.alignment = Alignment(horizontal="left")

    # anchos de columna por contenido
    for j, h in enumerate(headers, start=1):
        width = max([len(str(h))] + [len(str(r[j - 1])) for r in raw_rows[:200] if j - 1 < len(r)])
        ws.column_dimensions[get_column_letter(j)].width = min(max(width + 3, 10), 60)

    if freeze:
        ws.freeze_panes = ws.cell(row=header_row + 1, column=1)

    if fuente:
        frow = header_row + len(raw_rows) + 2
        c = ws.cell(row=frow, column=1, value=f"Fuente: {fuente}")
        c.font = Font(italic=True, size=9)

    if chart_kind:
        n_rows = len(raw_rows)
        x_idx = headers.index(chart_x) + 1 if chart_x else 1
        if chart_cols:
            s_idx = [headers.index(col.strip()) + 1 for col in chart_cols.split(",") if col.strip() in headers]
        else:
            s_idx = [j for j, h in enumerate(headers, start=1)
                     if j != x_idx and any(fmt.startswith(("#,##0", "0.0%")) for jj, fmt in fmts.items() if jj == j)]
        if not s_idx:
            print("Aviso: no se encontraron columnas numéricas para el gráfico; se omite.", file=sys.stderr)
        else:
            chart = LineChart() if chart_kind == "line" else BarChart()
            chart.title = title or Path(path).stem
            chart.style = 10
            chart.x_axis.title = headers[x_idx - 1]
            data_ref = Reference(ws, min_col=min(s_idx), max_col=max(s_idx),
                                 min_row=header_row, max_row=header_row + n_rows)
            cats = Reference(ws, min_col=x_idx, max_col=x_idx,
                             min_row=header_row + 1, max_row=header_row + n_rows)
            if max(s_idx) - min(s_idx) + 1 != len(s_idx):
                print("Aviso: para el gráfico usá columnas contiguas; se grafica el rango completo.",
                      file=sys.stderr)
            chart.add_data(data_ref, titles_from_data=True)
            chart.set_categories(cats)
            ws.add_chart(chart, f"{get_column_letter(len(headers) + 2)}{header_row}")

    Path(out).parent.mkdir(parents=True, exist_ok=True)
    wb.save(out)

    # verificación: reabrir
    check = load_workbook(out)
    ws2 = check[sheet]
    print(f"OK: {out}")
    print(f"  hoja '{sheet}': {ws2.max_row} filas x {ws2.max_column} columnas"
          + (f" | gráfico {chart_kind}" if chart_kind and s_idx else ""))


def main():
    ap = argparse.ArgumentParser(description="Convierte CSV/JSON a .xlsx con formato.")
    ap.add_argument("entrada", help="Archivo .csv o .json")
    ap.add_argument("-o", "--out", help="Archivo .xlsx de salida (default: mismo nombre con .xlsx)")
    ap.add_argument("--title", help="Título de la tabla")
    ap.add_argument("--fuente", help='Nota de fuente al pie (ej. "UN Comtrade (consulta: nov-2026)")')
    ap.add_argument("--sheet", default="Datos", help="Nombre de la hoja (default: Datos)")
    ap.add_argument("--chart", choices=["line", "bar"], help="Agrega un gráfico de líneas o barras")
    ap.add_argument("--chart-x", help="Columna del eje X del gráfico (default: primera)")
    ap.add_argument("--chart-cols", help="Columnas de datos del gráfico, separadas por coma")
    ap.add_argument("--sep", help="Separador del CSV (default: autodetecta)")
    ap.add_argument("--no-freeze", action="store_true", help="No inmovilizar el encabezado")
    args = ap.parse_args()

    out = args.out or str(Path(args.entrada).with_suffix(".xlsx"))
    build(args.entrada, out, args.title, args.fuente, args.sheet,
          args.chart, args.chart_x, args.chart_cols, args.sep, not args.no_freeze)


if __name__ == "__main__":
    main()
