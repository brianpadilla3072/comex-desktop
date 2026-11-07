"""Pruebas del runtime, archivos corruptos y recorrido reproducible sin investigación."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from zipfile import ZipFile, ZIP_DEFLATED

from docx import Document
from openpyxl import Workbook

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/documents.py"
spec = importlib.util.spec_from_file_location("comex_documents", SCRIPT)
documents = importlib.util.module_from_spec(spec)
spec.loader.exec_module(documents)


class RuntimeDocuments(unittest.TestCase):
    def test_doctor_no_confunde_python_sistema_con_entorno_preparado(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = dict(os.environ, COMEX_PACK_HOME=tmp, COMEX_DOCUMENTS_PYTHON="")
            result = subprocess.run([sys.executable, str(SCRIPT), "doctor"], env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            data = json.loads(result.stdout)
            self.assertFalse(data["ready"])
            self.assertFalse(data["pythonBundled"])
            self.assertIn("pending", data["visualVerification"])

    def test_runtime_incluido_es_inmutable_y_no_cae_al_venv(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {
            "COMEX_PACK_HOME": str(Path(tmp) / "private"),
            "COMEX_DOCUMENTS_PYTHON": str(Path(tmp) / "missing-python"),
        }):
            with self.assertRaisesRegex(ValueError, "setup no modifica"):
                documents.setup()
            self.assertEqual(documents.runtime_python(), Path(tmp) / "missing-python")
            self.assertFalse((Path(tmp) / "private").exists())

    def test_instalaciones_concurrentes_no_borran_entorno(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {"COMEX_PACK_HOME": tmp, "COMEX_DOCUMENTS_PYTHON": ""}):
            (Path(tmp) / "documents-setup.lock").touch()
            marker = Path(tmp) / "venv" / "personalizado.txt"
            marker.parent.mkdir()
            marker.write_text("conservar")
            with self.assertRaisesRegex(ValueError, "preparación activa"):
                documents.setup()
            self.assertEqual(marker.read_text(), "conservar")

    def test_rechaza_zip_falso_xml_roto_y_documentos_vacios(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            corrupt = root / "corrupto.docx"
            corrupt.write_text("no es un documento Office")
            with self.assertRaisesRegex(ValueError, "Office inválido"):
                documents.verify_file(corrupt)
            with ZipFile(corrupt, "w") as archive:
                archive.writestr("[Content_Types].xml", "<Types/>")
                archive.writestr("word/document.xml", "<xml roto")
            with self.assertRaisesRegex(ValueError, "Office inválido"):
                documents.verify_file(corrupt)
            empty_doc = root / "vacio.docx"
            Document().save(empty_doc)
            with self.assertRaisesRegex(ValueError, "vacío"):
                documents.verify_file(empty_doc)
            empty_sheet = root / "vacio.xlsx"
            Workbook().save(empty_sheet)
            with self.assertRaisesRegex(ValueError, "vacía"):
                documents.verify_file(empty_sheet)

    def test_smoke_entrega_evidencia_honesta_y_no_sobrescribe(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "resultados"
            # La suite existente acepta librerías del Python del desarrollador.
            # Producción ejecuta smoke mediante managed_worker con venv y -I.
            real_run = subprocess.run
            def run_with_test_dependencies(command, **kwargs):
                return real_run([part for part in command if part != "-I"], **kwargs)
            with patch.object(documents.subprocess, "run", side_effect=run_with_test_dependencies):
                self.assertEqual(documents.smoke(output), 0)
            evidence = json.loads((output / "evidence.json").read_text())
            self.assertEqual(evidence["status"], "passed")
            self.assertFalse(evidence["researchVerified"])
            self.assertFalse(evidence["surveysConducted"])
            self.assertEqual(evidence["visualVerification"], "pending")
            for artifact in evidence["artifacts"]:
                actual = documents.verify_file(output / artifact["path"])
                self.assertEqual(actual["sha256"], artifact["sha256"])
            with self.assertRaisesRegex(ValueError, "ya existe"):
                documents.smoke(output)

    def test_rechaza_contenido_expandido_y_dimensiones_excesivas(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "excesivo.docx"
            with ZipFile(path, "w", compression=ZIP_DEFLATED) as archive:
                archive.writestr("word/document.xml", b" " * (16 * 1024 * 1024 + 1))
            with self.assertRaisesRegex(ValueError, "límites seguros"):
                documents.verify_file(path)
            sheet = Path(tmp) / "excesivo.xlsx"
            book = Workbook()
            book.active["XFD1048576"] = "dimensión adversarial"
            book.save(sheet)
            with self.assertRaisesRegex(ValueError, "millón de celdas"):
                documents.verify_file(sheet)

    def test_doctor_runtime_colgado_devuelve_diagnostico(self):
        with tempfile.TemporaryDirectory() as tmp:
            executable = Path(tmp) / "python"
            executable.touch()
            with patch.object(documents.subprocess, "run", side_effect=subprocess.TimeoutExpired("python", 15)):
                result = documents.probe(executable)
            self.assertFalse(result["ready"])
            self.assertIn("15 segundos", result["error"])

    def test_verificacion_detecta_formulas_sin_afirmar_recalculo(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "formulas.xlsx"
            book = Workbook()
            book.active["A1"] = "=1+1"
            book.save(path)
            data = documents.verify_file(path)
            self.assertEqual(data["formulas"], 1)
            self.assertEqual(data["visualVerification"], "pending")


if __name__ == "__main__":
    unittest.main()
