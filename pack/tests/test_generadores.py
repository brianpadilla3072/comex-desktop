"""Regresiones de las herramientas del pack con datos de prueba explícitos."""
import csv
import importlib.util
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from docx import Document
from openpyxl import load_workbook

PACK = Path(__file__).resolve().parents[1]


def load(name, relative):
    spec = importlib.util.spec_from_file_location(name, PACK / relative)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


sheet = load("comex_sheet_test", "skills/planilla-xlsx/scripts/tabla_xlsx.py")


class Generadores(unittest.TestCase):
    def test_decimales_y_codigos_trazables(self):
        for text in ("1.234,56", "1,234.56"):
            self.assertAlmostEqual(sheet.coerce(text)[0], 1234.56)
        self.assertEqual(sheet.coerce("080450", "cmdCode"), ("080450", "@"))
        self.assertEqual(sheet.coerce("032", "reporterCode"), ("032", "@"))
        self.assertEqual(sheet.coerce("12,5%", "Cuota"), (0.125, "0.0%"))
        for text in ("NaN", "Infinity", "-Infinity", "s/d"):
            self.assertEqual(sheet.coerce(text)[0], text)

    def test_excel_desde_csv_con_fuente_grafico_y_texto_literal(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, output = Path(tmp) / "datos.csv", Path(tmp) / "tabla.xlsx"
            source.write_text('cmdCode;Valor USD;Respuesta\n080450;1.234,56;=HYPERLINK("https://example.invalid","x")\n090111;2.345,67;Sin respuestas reales\n', encoding="utf-8")
            sheet.build(source, output, "Prueba de integración", "Datos sintéticos, no usar como evidencia", "Datos", "bar", "cmdCode", "Valor USD", ";", True)
            wb = load_workbook(output)
            ws = wb["Datos"]
            self.assertEqual(ws["A4"].value, "080450")
            self.assertAlmostEqual(ws["B4"].value, 1234.56)
            self.assertEqual(ws["C4"].data_type, "s")
            self.assertTrue(ws["C4"].value.startswith("=HYPERLINK"))
            self.assertEqual(ws.freeze_panes, "A4")
            self.assertEqual(len(ws._charts), 1)
            self.assertIn("Datos sintéticos", " ".join(str(c.value) for row in ws for c in row if c.value))
            wb.close()

    def test_csv_con_respuestas_multilinea_no_altera_la_evidencia(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "respuestas.csv"
            source.write_text('Pregunta;Respuesta\nCanal;"Primera línea\nSegunda línea"\n', encoding="utf-8")
            headers, rows = sheet.load_rows(source, ";")
            self.assertEqual(rows[0][1], "Primera línea\nSegunda línea")

    def test_word_desde_markdown_con_portada_tabla_fuente_y_campo_pendiente(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, output = Path(tmp) / "informe.md", Path(tmp) / "informe.docx"
            source.write_text('---\ntitulo: Prueba de integración Comex\nautor: Estudiante de prueba\n---\n\n# Metodología\nDocumento de prueba, sin investigación realizada.\n\n## Campo\nEncuesta pendiente; no hay respuestas reales.\n\n| Requisito | Estado |\n| --- | --- |\n| Fuentes | Pendiente |\n\n> Fuente: prueba local; sin datos de mercado.\n', encoding="utf-8")
            subprocess.run([sys.executable, str(PACK / "skills/documento-docx/scripts/informe_docx.py"), str(source), "-o", str(output), "--toc"], check=True, capture_output=True, text=True)
            doc = Document(output)
            text = "\n".join(p.text for p in doc.paragraphs)
            self.assertIn("Prueba de integración Comex", text)
            self.assertIn("no hay respuestas reales", text)
            self.assertIn("Fuente: prueba local", text)
            self.assertEqual(len(doc.tables), 1)
            self.assertEqual(doc.tables[0].cell(1, 1).text, "Pendiente")
            self.assertAlmostEqual(doc.sections[0].page_width.cm, 21, places=1)
            self.assertAlmostEqual(doc.sections[0].left_margin.cm, 2.5, places=1)

    def test_cotizacion_prorratea_flete_y_rechaza_unidades_cero(self):
        script = str(PACK / "skills/cotizacion-exportacion/scripts/cotizacion.py")
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "cotizacion.csv"
            run = subprocess.run([sys.executable, script, "--exw", "100", "--margen-pct", "0", "--unidades", "100", "--flete-internacional-lote", "1000", "--seguro", "2", "--csv", str(output)], check=True, capture_output=True, text=True)
            self.assertIn("112.00", run.stdout)
            self.assertTrue(output.exists())
            invalid = subprocess.run([sys.executable, script, "--exw", "100", "--unidades", "0"], capture_output=True, text=True)
            self.assertNotEqual(invalid.returncode, 0)
            self.assertIn("unidades debe ser 1", invalid.stderr)

    def test_cotizacion_rechaza_costos_negativos_y_valores_no_finitos(self):
        script = str(PACK / "skills/cotizacion-exportacion/scripts/cotizacion.py")
        for value in ("nan", "inf", "-1"):
            run = subprocess.run([sys.executable, script, "--exw", value], capture_output=True, text=True)
            self.assertNotEqual(run.returncode, 0)
            self.assertNotIn("Formación del precio", run.stdout)


if __name__ == "__main__":
    unittest.main()
