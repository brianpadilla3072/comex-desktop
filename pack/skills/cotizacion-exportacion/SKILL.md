---
name: cotizacion-exportacion
description: "Formación de precios de exportación e importación — Incoterms 2020, precios FOB/CFR/CIF, landed cost (costo de destino), aranceles de importación, retenciones, cálculo de presupuestos comerciales de exportación. Usar SIEMPRE que se hable de cotizar, presupuestar o pricing de un producto exportable/importable, de Incoterms (EXW, FOB, CIF, DDP...), de \"¿a qué precio puedo vender en el mercado X?\", landed cost, costo de destino, margen exportador, arancel aplicado, retenciones, o cuando un caso práctico de comercio exterior pida armar el presupuesto comercial o la planilla de costos. También cuando haya que comparar competitividad de precios entre mercados o proveedores."
---

# Cotización de Exportación

El presupuesto de exportación es la parte del estudio donde los números tienen que cerrar al centavo: es lo primero que revisa un profesor (o un importador real). Toda cotización declara sus supuestos y su fecha: los fletes y aranceles cambian todo el tiempo.

## Incoterms 2020 — el marco que ordena los costos

El Incoterm define en qué punto del viaje el comprador asume costos y riesgos, y por lo tanto **qué costos van en el precio de cada uno**. Los que importan en un presupuesto marítimo/fluvial:

| Incoterm | Vendedor paga hasta | Comprador paga desde |
|---|---|---|
| **EXW** | puerta de su planta | todo el resto del viaje |
| **FCA** | entrega al transportista en origen | flete internacional+ |
| **FOB** | carga a bordo en puerto de origen | flete marítimo + seguro + destino |
| **CFR** | carga a bordo + flete marítimo | seguro + destino |
| **CIF** | carga a bordo + flete + seguro | destino (descarga, despacho, interno) |
| **DAP/DPU** | puerto/punto de destino | despacho e interno de destino (DPU también descarga) |
| **DDP** | todo, impuestos de destino incluidos | nada (el más riesgoso para el vendedor) |

Regla práctica: en comercio marítimo solo EXW/FOB/CFR/CIF son "marítimos puros"; para contenedor de puerta a puerta suele convenir FCA/CIP/DAP — decirlo en el trabajo suma criterio.

## Paso 0 — Declarar la unidad de cálculo antes de tocar un número

Todo el presupuesto se arma en **una sola unidad** y el informe lo dice en la primera línea de la tabla: "Valores por kg", "Valores por caja de 20 kg", "Valores por unidad". El error más caro del ejercicio es mezclar unidades: el costo de la mercadería viene por caja, el flete por contenedor y el precio de mercado por kg. Antes de calcular, escribí:

| Concepto | Unidad en que viene el dato | Conversión a la unidad de cálculo |
|---|---|---|
| costo EXW | por caja de 20 kg, 900 cajas | ÷ 18.000 kg = por kg |
| flete internacional | USD 2.600 por contenedor | ÷ 18.000 kg = por kg |
| precio de mercado | por kg | ya está |

Regla: si el caso trae dos unidades (cajas y kg), elegí la que use el precio de mercado en destino y convertí todo lo demás. Nunca promedies ni "ajustes a ojo": mostrá la conversión. El script imprime el tamaño del lote y las columnas por unidad y por lote; el nombre de la unidad (kg, caja, tonelada) lo ponés vos en la tabla del informe.

## La escalera de costos (formación del precio)

Costo por unidad, origen → destino:

```
EXW (mercadería)
+ embalaje/palletizado/marcado
+ flete interno a puerto
+ gastos aduaneros de exportación (despacho, inspecciones)
+ tasas portuarias / manipulación
+ derechos de exportación (retenciones, AR)     ← se paga sobre el valor FOB
= COSTO FOB  →  precio FOB = costo × (1+margen) / (1−retención)
+ flete internacional (marítimo/aéreo, por unidad o por lote prorrateado)
= PRECIO CFR
+ seguro de la carga (valor absoluto o % del CFR)
= PRECIO CIF
```

La retención no se suma al costo: se calcula sobre el **precio FOB**, que es mayor que el costo. Por eso el precio se despeja dividiendo por `(1 − retención)`, no multiplicando. Con costo FOB 100, margen 15% y retención 4,5%: `100 × 1,15 / 0,955 = 120,42`, no `115 × 1,045 = 120,18`. La diferencia parece chica pero es la que hace que la retención que figura en el despacho coincida con la del presupuesto.

Lado del importador (landed cost, lo que determina si el precio "es competitivo"):

```
CIF
+ derecho de importación (% sobre CIF)
+ tasas (estadística/% según país)
+ despacho aduanero destino + flete interno destino
= LANDED COST sin IVA  ← esta es la base para comparar contra el precio de mercado
```

El script incluido hace todo esto con los números del caso:

```bash
python3 scripts/cotizacion.py --exw 100 --embalaje 3 --flete-interno 12 --aduana 8 \
  --portuarios 6 --flete-internacional 18 --seguro 2 --margen-pct 25 --unidades 1000 \
  --arancel-pct 14 --iva-pct 21 --tasostad-pct 3 --flete-destino 5 --despacho-destino 300 \
  --precio-mercado 200
```

Opciones que resuelven los casos reales (no prorratear a mano):

- `--flete-internacional-lote 2600`: el flete viene por contenedor/lote; el script lo divide por `--unidades`. Es excluyente con `--flete-internacional` (por unidad).
- `--seguro-pct 0.3`: seguro como porcentaje del valor CFR, en vez de un valor absoluto (`--seguro`).
- `--despacho-destino 250`: gasto por partida, se prorratea solo.
- `--decimales 4`: para comparar "al centavo" o auditar el redondeo.
- `--precio-mercado 0` es error: si no hay referencia, no pases el parámetro.

Imprime la escalera FOB/CFR/CIF, el landed cost y la comparación contra el precio de referencia del mercado (con diagnóstico si no cierra). `--help` lista todas las opciones.

**Del script al Excel del trabajo** (sin copiar números a mano):

```bash
python3 scripts/cotizacion.py ... --csv cotizacion.csv
python3 ../planilla-xlsx/scripts/tabla_xlsx.py cotizacion.csv -o cotizacion.xlsx \
  --title "Cotización de exportación — [producto] a [mercado]" \
  --fuente "Elaboración propia con supuestos del caso (consulta: nov-2026)"
```

El CSV trae concepto, valor por unidad y valor por lote: la planilla queda lista para editar y para pegar como anexo. Si el trabajo pide la tabla dentro del informe, se pasa a `documento-docx` como tabla, pero los números salen siempre del mismo CSV.

## De dónde sale cada número (fuente por línea)

| Componente | Fuente legítima |
|---|---|
| EXW / costo de mercadería | presupuesto del productor o costo de producción del caso |
| Flete internacional | cotas de forwarders/navieras; referencia pública: índices de flete (Drewry WCI, Freightos) o el anexo arancelario del caso |
| Gastos aduaneros y portuarios | tasas oficiales de la Aduana/puerto; en AR: tasas de servicio y conceptos portuarios |
| Seguro | tasa típica 0,2–0,5% del valor CIF + gastos, o cotización real — declarar |
| Arancel de importación | MACMap/WITS para el país destino; verificar NCM/código local del destino |
| Retenciones (AR) | normativa vigente al día de la cotización, con fecha |
| Flete interno | cotización o referencia pública; estimar y decir "estimado" |

Nunca poner un costo "de memoria" o "típico" sin marcarlo como supuesto. La tabla de supuestos (componente, valor, fuente, fecha) va en el informe como anexo: es lo que sostiene la cotización.

## Comparación con el mercado (competitividad)

El ejercicio que pide cualquier caso: "¿mi precio CIF + landed cost me deja vender a precio competitivo en destino?".

1. Precio de referencia en destino: valor unitario de las importaciones del producto desde proveedores principales (Trade Map / Comtrade, skill `datos-comex`), o precio relevado del canal.
2. Restar: landed cost. El resultado es el margen del importador: un importador no compra con margen <10-15% (declarar ese umbral como supuesto).
3. Sensibilidad tipo de cambio: la cotización se expresa en USD; el costo en pesos se convierte con un tipo de cambio declarado ("cotización a USD X al dd/mm/aaaa"), y conviene una tabla con tipo de cambio ±10%.

## Errores típicos que penalizan

- Mezclar base de cálculo del arancel (se aplica sobre CIF, no sobre FOB) o el IVA (sobre landed total).
- Olvidar que el flete va por contenedor/lote: prorratear contra `--unidades` y mostrar el prorrateo.
- Cotizar sin fecha: fletes y aranceles del año anterior ya no valen.
- Confundir precio de exportación con precio competitivo: lo que decide la compra es el landed cost del importador, no el FOB.
- Incoterms usados de adorno: el Incoterm elegido tiene que coincidir con qué costos incluyó en el precio (FOB ≠ "precio puerto" con flete adentro).

## Entregable

La cotización se presenta como tabla (el output del script se vuelca a Excel con `planilla-xlsx` para editarla, o como tabla del informe vía `documento-docx`), siempre con: supuestos al pie, fecha de cotización, moneda y validez de la oferta ("sujeta a confirmación de fletes y aranceles").
