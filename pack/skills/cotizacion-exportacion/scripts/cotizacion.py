#!/usr/bin/env python3
"""
cotizacion.py — Formación de precios de exportación (escalera EXW→FOB→CFR→CIF)
y costo de destino (landed cost) del importador. Solo Python estándar.

Uso (valores por unidad en USD, excepto donde se indique lo contrario):

  python3 cotizacion.py --exw 100 --embalaje 3 --flete-interno 12 \
    --aduana 8 --portuarios 6 --flete-internacional 18 --seguro 2 \
    --margen-pct 25 --unidades 1000 --retencion-pct 0 \
    --arancel-pct 14 --iva-pct 21 --tasostad-pct 3 --flete-destino 5 \
    --despacho-destino 300 --precio-mercado 200

Costos que en la vida real vienen por lote (no por unidad):
  --flete-internacional-lote 2600   # se divide por --unidades
  --despacho-destino 250            # ya es por partida (se prorratea)
  --seguro-pct 0.3                  # seguro como % del valor CFR (alternativa a --seguro)

Salidas:
  --decimales 4        más precisión en pantalla (default 2)
  --csv cotizacion.csv escalera completa en CSV, para pasar directo a tabla_xlsx.py

Los porcentajes se expresan en número (25 = 25%, 4.5 = 4.5%).
Mostrá los supuestos en el informe: este script no adivina costos, los suma.
"""

import argparse
import csv
import sys


def main():
    ap = argparse.ArgumentParser(description="Cotización de exportación y landed cost.")
    g = ap.add_argument_group("origen (por unidad, salvo los 'lote')")
    g.add_argument("--exw", type=float, required=True, help="costo de la mercadería (EXW)")
    g.add_argument("--embalaje", type=float, default=0, help="embalaje/palletizado/marketing")
    g.add_argument("--flete-interno", type=float, default=0, help="flete hasta puerto/aeropuerto")
    g.add_argument("--aduana", type=float, default=0, help="gastos aduaneros de exportación (despacho, inspecciones)")
    g.add_argument("--portuarios", type=float, default=0, help="tasas portuarias y manipulación en origen")
    g.add_argument("--flete-internacional", type=float, default=0, help="flete internacional POR UNIDAD")
    g.add_argument("--flete-internacional-lote", type=float, default=None,
                   help="flete internacional por lote/contenedor (se prorratea entre --unidades)")
    g.add_argument("--seguro", type=float, default=0, help="seguro de la carga por unidad (valor absoluto)")
    g.add_argument("--seguro-pct", type=float, default=None,
                   help="seguro como %% del valor CFR (ej. 0.3). Se suma a --seguro si se pasan ambos.")
    g.add_argument("--otros-origen", type=float, default=0, help="otros costos de origen")
    ap.add_argument("--margen-pct", type=float, default=20, help="margen deseado sobre costos (default 20)")
    ap.add_argument("--retencion-pct", type=float, default=0,
                    help="derechos de exportación sobre el precio FOB (AR)")
    ap.add_argument("--unidades", type=int, default=1, help="unidades del lote (misma unidad para todos los costos)")
    d = ap.add_argument_group("destino (para landed cost)")
    d.add_argument("--arancel-pct", type=float, default=0, help="derecho de importación sobre CIF")
    d.add_argument("--tasostad-pct", type=float, default=0, help="tasa de estadística sobre CIF")
    d.add_argument("--iva-pct", type=float, default=0, help="IVA interno del país de destino")
    d.add_argument("--flete-destino", type=float, default=0, help="flete interno destino por unidad")
    d.add_argument("--despacho-destino", type=float, default=0, help="gastos aduaneros destino (por partida)")
    ap.add_argument("--precio-mercado", type=float, default=None,
                    help="precio de referencia del producto en destino (por unidad)")
    ap.add_argument("--moneda", default="USD", help="etiqueta de moneda (default USD)")
    ap.add_argument("--decimales", type=int, default=2, help="decimales en pantalla (default 2; usar 4 para 'al centavo')")
    ap.add_argument("--csv", metavar="ARCHIVO", help="exportar la escalera completa a CSV (para tabla_xlsx.py)")
    args = ap.parse_args()

    if args.unidades < 1:
        ap.error("--unidades debe ser 1 o más (es la cantidad de unidades del lote)")
    if args.retencion_pct >= 100:
        ap.error("--retencion-pct debe ser menor a 100")
    if args.margen_pct <= -100:
        ap.error("--margen-pct debe ser mayor a -100")
    if args.flete_internacional and args.flete_internacional_lote is not None:
        ap.error("elegí uno: --flete-internacional (por unidad) o --flete-internacional-lote (por lote)")
    if args.precio_mercado is not None and args.precio_mercado <= 0:
        ap.error("--precio-mercado debe ser mayor a 0 (si no tenés referencia, no pases el parámetro)")

    m = args.margen_pct / 100.0
    ret = args.retencion_pct / 100.0
    n = args.unidades
    dec = max(args.decimales, 0)

    def fmt(x, signed=False):
        patron = f"{{:,.{dec}f}}"
        return patron.format(x)

    flete_int_uni = args.flete_internacional if args.flete_internacional_lote is None \
        else args.flete_internacional_lote / n

    costo_fob = args.exw + args.embalaje + args.flete_interno + args.aduana + args.portuarios + args.otros_origen
    # La retención se paga sobre el PRECIO FOB, no sobre el costo: por eso se
    # despeja dividiendo por (1 - ret), no sumando ret * costo.
    precio_fob = costo_fob * (1 + m) / (1 - ret)
    precio_cfr = precio_fob + flete_int_uni
    seguro_uni = args.seguro + (precio_cfr * args.seguro_pct / 100.0 if args.seguro_pct is not None else 0.0)
    precio_cif = precio_cfr + seguro_uni

    arancel = precio_cif * args.arancel_pct / 100.0
    tasostad = precio_cif * args.tasostad_pct / 100.0
    despacho_uni = args.despacho_destino / n
    landed_sin_iva = precio_cif + arancel + tasostad + args.flete_destino + despacho_uni
    iva = landed_sin_iva * args.iva_pct / 100.0
    landed_con_iva = landed_sin_iva + iva

    M = args.moneda
    fila = "{:<46}{:>16}"
    seccion = "origen"

    print(f"=== Formación del precio de exportación (por unidad, {M}) ===")
    print(f"Unidad de cálculo: 1 unidad | lote: {n:,} unidades")
    print(fila.format("Costo EXW (mercadería)", fmt(args.exw)))
    print(fila.format("+ Embalaje/palletizado", fmt(args.embalaje)))
    print(fila.format("+ Flete interno a puerto", fmt(args.flete_interno)))
    print(fila.format("+ Gastos aduaneros de exportación", fmt(args.aduana)))
    print(fila.format("+ Tasas portuarias", fmt(args.portuarios)))
    if args.otros_origen:
        print(fila.format("+ Otros costos de origen", fmt(args.otros_origen)))
    print(fila.format("= Costo base FOB", fmt(costo_fob)))
    if ret:
        print(fila.format(f"Margen {args.margen_pct:g}% + retención {args.retencion_pct:g}% sobre FOB",
                          fmt(precio_fob - costo_fob)))
    else:
        print(fila.format(f"Margen {args.margen_pct:g}%", fmt(precio_fob - costo_fob)))
    print(fila.format("PRECIO FOB", fmt(precio_fob)))
    if args.flete_internacional_lote is not None:
        print(fila.format("+ Flete internacional (lote prorrateado)",
                          fmt(flete_int_uni)))
    else:
        print(fila.format("+ Flete internacional", fmt(flete_int_uni)))
    print(fila.format("= PRECIO CFR", fmt(precio_cfr)))
    print(fila.format("+ Seguro", fmt(seguro_uni)))
    print(fila.format("= PRECIO CIF", fmt(precio_cif)))
    print(f"\nLote: {n:,} unidades → FOB total {M} {fmt(precio_fob * n)} | CIF total {M} {fmt(precio_cif * n)}")

    print(f"\n=== Costo de destino del importador (por unidad, {M}) ===")
    print(fila.format("Valor CIF", fmt(precio_cif)))
    print(fila.format(f"+ Derecho de importación ({args.arancel_pct:g}%)", fmt(arancel)))
    print(fila.format(f"+ Tasa de estadística ({args.tasostad_pct:g}%)", fmt(tasostad)))
    print(fila.format("+ Flete interno destino", fmt(args.flete_destino)))
    print(fila.format("+ Despacho aduanero destino (prorrateo)", fmt(despacho_uni)))
    print(fila.format("= LANDED COST (sin IVA, base competitiva)", fmt(landed_sin_iva)))
    print(fila.format(f"+ IVA ({args.iva_pct:g}%)", fmt(iva)))
    print(fila.format("= Costo total puesto (con IVA recuperable)", fmt(landed_con_iva)))

    margen = None
    if args.precio_mercado is not None:
        margen = args.precio_mercado - landed_sin_iva
        pct = margen / landed_sin_iva * 100 if landed_sin_iva else 0
        print(f"\n=== Competitividad en destino ===")
        print(fila.format("Precio de referencia del mercado", fmt(args.precio_mercado)))
        print(fila.format("Landed cost (sin IVA)", fmt(landed_sin_iva)))
        etiqueta = "Margen importador vs. mercado" if margen >= 0 else "DÉFICIT vs. precio de mercado"
        print(fila.format(etiqueta, f"{fmt(margen)} ({pct:+.1f}%)"))
        if margen < 0:
            print("\nSugerencia: revisar costo EXW, margen propio, modo de transporte o Incoterm;")
            print("o documentar por qué el producto justifica un precio superior (diferenciación).")

    if args.csv:
        filas = [
            ("EXW (mercadería)", args.exw),
            ("Embalaje/palletizado", args.embalaje),
            ("Flete interno a puerto", args.flete_interno),
            ("Gastos aduaneros de exportación", args.aduana),
            ("Tasas portuarias", args.portuarios),
            ("Otros costos de origen", args.otros_origen),
            ("Costo base FOB", costo_fob),
            ("PRECIO FOB", precio_fob),
            ("Flete internacional", flete_int_uni),
            ("PRECIO CFR", precio_cfr),
            ("Seguro", seguro_uni),
            ("PRECIO CIF", precio_cif),
            ("Derecho de importación", arancel),
            ("Tasa de estadística", tasostad),
            ("Flete interno destino", args.flete_destino),
            ("Despacho aduanero destino", despacho_uni),
            ("LANDED COST (sin IVA)", landed_sin_iva),
            ("IVA", iva),
            ("Costo total puesto (con IVA)", landed_con_iva),
        ]
        if args.precio_mercado is not None:
            filas.append(("Precio de referencia del mercado", args.precio_mercado))
        with open(args.csv, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(["concepto", f"{M}/unidad", f"{M}/lote"])
            for concepto, valor in filas:
                w.writerow([concepto, f"{valor:.6f}", f"{valor * n:.2f}"])
        print(f"\nEscalera exportada a: {args.csv}  (para planilla-xlsx / tabla_xlsx.py)")


if __name__ == "__main__":
    sys.exit(main())
