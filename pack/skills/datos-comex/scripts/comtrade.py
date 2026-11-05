#!/usr/bin/env python3
"""
comtrade.py — Consulta la API pública (preview) de UN Comtrade y guarda la serie en CSV.

No requiere dependencias externas (solo Python 3 estándar). No necesita API key:
usa el endpoint público de vista previa de https://comtradeplus.un.org/ApiDocs

Ejemplos:
  # Exportaciones argentinas de HS 1509 al mundo, 2015-2024
  python3 comtrade.py --reporter ARG --partner WORLD --product 1509 --year 2015-2024 --flow X --out salida.csv

  # Importaciones brasileñas de HS 1509 desde Argentina, 2023
  python3 comtrade.py --reporter BRA --partner ARG --product 1509 --year 2023 --flow M

Nota metodológica: cuando un país no reporta un flujo, Comtrade puede mostrar
datos espejo (estimados a partir del reporte del socio). Verificar las columnas
"isReported" y "legacyEstimationFlag" y declararlo en la metodología del trabajo.
"""

import argparse
import csv
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE_URL = "https://comtradeapi.un.org/public/v1/preview/C/A/HS"

# Códigos M49 (Naciones Unidas) para los países más consultados en estudios
# latinoamericanos. Los códigos numéricos M49 también se aceptan directamente.
M49 = {
    "WORLD": 0, "ARG": 32, "BOL": 68, "BRA": 76, "CHL": 152, "COL": 170,
    "CRI": 188, "ECU": 218, "SLV": 222, "GTM": 320, "HND": 340, "MEX": 484,
    "NIC": 558, "PAN": 591, "PRY": 600, "PER": 604, "DOM": 214, "URY": 858,
    "VEN": 862, "USA": 842, "CAN": 124, "CHN": 156, "JPN": 392, "KOR": 410,
    "IND": 356, "DEU": 276, "ESP": 724, "FRA": 250, "ITA": 380, "GBR": 826,
    "NLD": 528, "BEL": 56, "CHE": 756, "PRT": 620, "RUS": 643, "TUR": 792,
    "ARE": 784, "ZAF": 710, "AUS": 36, "NZL": 554, "SGP": 702, "MYS": 458,
    "IDN": 360, "THA": 764, "VNM": 704, "PHL": 608, "PAK": 586, "EGY": 818,
    "NGA": 566, "MAR": 504, "ISR": 376, "SAU": 682, "QAT": 634, "CHT": 158,
}

# Columnas que se exportan al CSV (las que suelen usarse en un estudio de mercado).
COLUMNS = [
    "refYear", "reporterDesc", "partnerDesc", "flowCode", "cmdCode", "cmdDesc",
    "primaryValue", "netWght", "qty", "qtyUnitAbbr",
    "cifvalue", "fobvalue", "isReported", "legacyEstimationFlag",
]


def resolve_code(value: str) -> int:
    """Acepta ISO3 ('ARG'), nombre corto ('WORLD') o código M49 ('032'/'32')."""
    v = value.strip().upper()
    if v in M49:
        return M49[v]
    if v.isdigit():
        return int(v)
    sys.exit(f"Error: país desconocido '{value}'. Usar ISO3 (ARG, BRA, CHN...) o código M49 numérico.")


def parse_years(spec: str) -> list:
    """'2023' → [2023]; '2015-2024' → [2015..2024]; '2020,2022' → [2020, 2022]."""
    years = []
    for part in spec.split(","):
        part = part.strip()
        if "-" in part:
            a, b = part.split("-", 1)
            years.extend(range(int(a), int(b) + 1))
        elif part:
            years.append(int(part))
    if not years:
        sys.exit("Error: especificar al menos un año con --year (ej. 2023 o 2015-2024).")
    return sorted(set(years))


def fetch_year(reporter: int, partner: int, product: str, flow: str, year: int) -> list:
    params = {
        "reporterCode": reporter,
        "partnerCode": partner,
        "period": year,
        "flowCode": flow.upper(),
        "cmdCode": product,
        "includeDesc": "true",
    }
    url = f"{BASE_URL}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": "comex-pack/1.0 (uso académico)"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            break
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 3:
                wait = 15 * (attempt + 1)
                print(f"  Rate limit (429) en {year}; reintento en {wait}s...", file=sys.stderr)
                time.sleep(wait)
                continue
            print(f"  Aviso: HTTP {e.code} para {year} — {e.reason}", file=sys.stderr)
            return []
        except urllib.error.URLError as e:
            sys.exit(f"Error de red: {e.reason}")
    data = payload.get("data") or []
    if not data and payload.get("error"):
        print(f"  Aviso: sin datos para {year} ({payload['error']})", file=sys.stderr)
    return data


def main() -> None:
    p = argparse.ArgumentParser(description="Descarga series de UN Comtrade (API pública) a CSV.")
    p.add_argument("--reporter", required=True, help="País reportante: ISO3 (ARG) o M49")
    p.add_argument("--partner", default="WORLD", help="País socio: ISO3, M49 o WORLD (default)")
    p.add_argument("--product", default="TOTAL", help="Código HS (2-6 dígitos) o TOTAL (default)")
    p.add_argument("--year", required=True, help="Año, rango o lista: 2023 | 2015-2024 | 2020,2022")
    p.add_argument("--flow", default="X", choices=["X", "M", "x", "m"], help="X exportaciones (default), M importaciones")
    p.add_argument("--out", help="Ruta del CSV de salida (si se omite, imprime resumen por año)")
    args = p.parse_args()

    reporter = resolve_code(args.reporter)
    partner = resolve_code(args.partner)
    years = parse_years(args.year)
    flow = args.flow.upper()

    rows = []
    for i, year in enumerate(years):
        print(f"Consultando {year} ({args.reporter} → {args.partner}, HS {args.product}, flujo {flow})...",
              file=sys.stderr)
        rows.extend(fetch_year(reporter, partner, args.product, flow, year))
        if i < len(years) - 1:
            time.sleep(1)  # cortesía con la API pública

    if not rows:
        sys.exit("Sin resultados. Revisar códigos de producto/país y disponibilidad de datos para esos años.")

    if args.out:
        with open(args.out, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=COLUMNS, extrasaction="ignore")
            writer.writeheader()
            for r in rows:
                writer.writerow({k: r.get(k, "") for k in COLUMNS})
        print(f"Listo: {len(rows)} registros guardados en {args.out}", file=sys.stderr)
    else:
        # Resumen por año: valor total (USD) y cantidad de registros
        totals = {}
        for r in rows:
            y = r.get("refYear", "?")
            totals.setdefault(y, {"value": 0.0, "n": 0})
            totals[y]["value"] += float(r.get("primaryValue") or 0)
            totals[y]["n"] += 1
        print(f"\n{'Año':<8}{'Valor USD':>20}{'Registros':>12}")
        for y in sorted(totals):
            print(f"{y:<8}{totals[y]['value']:>20,.0f}{totals[y]['n']:>12}")
        print("\nNota: 'isReported' y 'legacyEstimationFlag' marcan estimaciones/datos espejo. Usar --out para guardar el CSV completo.")


if __name__ == "__main__":
    main()
