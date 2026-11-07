#!/usr/bin/env python3
"""Entorno privado, generación y verificación estructural de entregables Comex.

No instala Python ni ejecuta investigación. ``smoke`` usa datos sintéticos.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from zipfile import ZipFile, BadZipFile
from xml.etree import ElementTree

PACK = Path(__file__).resolve().parents[1]
LOCK = Path(__file__).with_name("requirements.lock.txt")
TOOLS = {
    "word": PACK / "skills/documento-docx/scripts/informe_docx.py",
    "excel": PACK / "skills/planilla-xlsx/scripts/tabla_xlsx.py",
    "quote": PACK / "skills/cotizacion-exportacion/scripts/cotizacion.py",
}


def runtime_home():
    return Path(os.environ.get("COMEX_PACK_HOME", Path.home() / ".comex-pack"))


def runtime_python():
    if os.environ.get("COMEX_DOCUMENTS_PYTHON"):
        return Path(os.environ["COMEX_DOCUMENTS_PYTHON"])
    return runtime_home() / "venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def requirements():
    return dict(line.strip().split("==", 1) for line in LOCK.read_text().splitlines()
                if line.strip() and not line.lstrip().startswith("#"))


def probe(executable):
    expected = requirements()
    if not Path(executable).is_file():
        return {"ready": False, "python": str(executable), "error": "No existe el entorno privado; ejecutá setup."}
    code = """import json,sys
import docx,openpyxl
from lxml import etree
from importlib.metadata import version,PackageNotFoundError
expected=json.loads(sys.argv[1]); found={}
for name in expected:
 try: found[name]=version(name)
 except PackageNotFoundError: found[name]=None
print(json.dumps({'versions':found,'pythonVersion':list(sys.version_info[:3])}))
"""
    try:
        result = subprocess.run([str(executable), "-X", "utf8", "-I", "-c", code, json.dumps(expected)], capture_output=True, text=True, encoding="utf-8", timeout=15)
    except subprocess.TimeoutExpired:
        return {"ready": False, "python": str(executable), "error": "El diagnóstico de Python excedió 15 segundos."}
    if result.returncode:
        return {"ready": False, "python": str(executable), "error": result.stderr.strip() or "El entorno no arranca."}
    data = json.loads(result.stdout)
    data.update(python=str(executable), ready=data["versions"] == expected and data["pythonVersion"] >= [3, 10])
    return data


def doctor():
    report = probe(runtime_python())
    report.update(pythonBundled=bool(os.environ.get("COMEX_DOCUMENTS_PYTHON")) and report["ready"],
                  embeddedRequested=bool(os.environ.get("COMEX_DOCUMENTS_PYTHON")), requirements=str(LOCK),
                  lockSha256=hashlib.sha256(LOCK.read_bytes()).hexdigest(),
                  visualRenderer=shutil.which("soffice") or shutil.which("libreoffice"),
                  visualVerification="pending: verify valida estructura y contenido, no diseño visual")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["ready"] else 1


def setup(wheelhouse=None):
    if os.environ.get("COMEX_DOCUMENTS_PYTHON"):
        if not probe(runtime_python())["ready"]:
            raise ValueError("El runtime incluido está incompleto o no coincide con las dependencias. Repará o reinstalá la aplicación; setup no modifica el runtime incluido.")
        return doctor()
    home = runtime_home()
    home.mkdir(parents=True, exist_ok=True)
    lock_path = home / "documents-setup.lock"
    try:
        fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        raise ValueError(f"Ya hay una preparación activa ({lock_path}). Si terminó abruptamente, quitá el bloqueo y reintentá.")
    try:
        os.close(fd)
        python = runtime_python()
        if probe(python)["ready"]:
            return doctor()
        if not python.exists():
            subprocess.run([sys.executable, "-I", "-m", "venv", str(home / "venv")], check=True)
        command = [str(python), "-I", "-m", "pip", "install", "--disable-pip-version-check", "--only-binary=:all:", "-r", str(LOCK)]
        if wheelhouse:
            directory = Path(wheelhouse).resolve(strict=True)
            if not directory.is_dir():
                raise ValueError("--wheelhouse debe ser una carpeta de wheels.")
            command.extend(["--no-index", "--find-links", str(directory)])
        subprocess.run(command, check=True)
        if not probe(python)["ready"]:
            raise ValueError("Las dependencias no coinciden con el manifiesto tras instalar.")
        (home / "documents-runtime.json").write_text(json.dumps({
            "python": str(python), "lockSha256": hashlib.sha256(LOCK.read_bytes()).hexdigest(),
            "versions": requirements(), "pythonBundled": False,
        }, indent=2), encoding="utf-8")
        return doctor()
    finally:
        lock_path.unlink(missing_ok=True)


def verify_file(filename):
    path = Path(filename).resolve(strict=True)
    if path.suffix.lower() not in (".docx", ".xlsx"):
        raise ValueError(f"Formato no soportado: {path.suffix}. Usá .docx o .xlsx.")
    required = "word/document.xml" if path.suffix.lower() == ".docx" else "xl/workbook.xml"
    try:
        if path.stat().st_size > 32 * 1024 * 1024:
            raise ValueError("El archivo supera el límite de verificación de 32 MiB.")
        with ZipFile(path) as archive:
            members = archive.infolist()
            if (len(members) > 2_000 or sum(m.file_size for m in members) > 128 * 1024 * 1024
                    or any(m.file_size > 16 * 1024 * 1024 for m in members)):
                raise ValueError("El contenido Office supera los límites seguros de verificación.")
            if archive.testzip():
                raise ValueError(f"Archivo ZIP dañado: {path.name}")
            if required not in archive.namelist() or "[Content_Types].xml" not in archive.namelist():
                raise ValueError(f"Faltan partes Office obligatorias: {path.name}")
            # Parsear todo el XML descubre partes rotas, no solo el contenedor ZIP.
            for name in archive.namelist():
                if name.endswith((".xml", ".rels")):
                    ElementTree.fromstring(archive.read(name))
    except (BadZipFile, ElementTree.ParseError) as error:
        raise ValueError(f"Archivo Office inválido: {path.name}: {error}") from error
    if path.suffix.lower() == ".docx":
        from docx import Document
        doc = Document(path)
        paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
        cells = [c.text for t in doc.tables for row in t.rows for c in row.cells]
        if not paragraphs and not any(c.strip() for c in cells) and not doc.inline_shapes:
            raise ValueError(f"El documento está vacío: {path.name}")
        details = {"paragraphs": len(paragraphs), "tables": len(doc.tables), "images": len(doc.inline_shapes)}
    else:
        from openpyxl import load_workbook
        book = load_workbook(path, data_only=False, read_only=True)
        try:
            if sum((ws.max_row or 0) * (ws.max_column or 0) for ws in book) > 1_000_000:
                raise ValueError("La planilla supera el límite de un millón de celdas para verificación.")
            nonempty, formulas, visited = 0, 0, 0
            for ws in book:
                for row in ws:
                    for cell in row:
                        visited += 1
                        if visited > 1_000_000:
                            raise ValueError("La planilla supera el límite de un millón de celdas para verificación.")
                        if cell.value is not None:
                            nonempty += 1
                            formulas += cell.data_type == "f"
            if not nonempty:
                raise ValueError(f"La planilla está vacía: {path.name}")
            details = {"sheets": book.sheetnames, "nonemptyCells": nonempty, "formulas": formulas}
        finally:
            book.close()
    return {"path": str(path), "bytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "structuralVerification": "passed", "visualVerification": "pending", **details}


def require_runtime():
    python = runtime_python()
    if not probe(python)["ready"]:
        raise ValueError("Faltan dependencias o versiones del entorno privado. Ejecutá documents.py setup y doctor.")
    return python


def managed_worker(command, arguments):
    # El proceso worker usa exclusivamente el entorno privado (-I), sin módulos de usuario.
    # -X utf8 evita que stdout/stderr usen la página de códigos local (cp1252 en Windows).
    result = subprocess.run([str(require_runtime()), "-X", "utf8", "-I", str(Path(__file__).resolve()), command, *arguments])
    return result.returncode


def smoke(output):
    """Prueba sin red del recorrido cotización -> CSV -> Excel y Markdown -> Word."""
    target = Path(output).resolve()
    if target.exists():
        raise ValueError("La carpeta de smoke ya existe; elegí una nueva para no mezclar evidencia anterior.")
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="comex-smoke-", dir=target.parent) as temporary:
        root = Path(temporary)
        (root / "informe.md").write_text("""---
titulo: Prueba técnica de entregables Comex
autor: Datos de prueba
---
# Alcance
Datos sintéticos. No se realizó investigación de mercado ni encuestas.
# Estado de evidencia
Encuestas pendientes; no hay respuestas reales. Fuentes de mercado pendientes.
| Requisito | Estado |
| --- | --- |
| Investigación | Pendiente |
| Entregables técnicos | Generados |
> Fuente: fixture sintético local, sin evidencia de mercado.
""", encoding="utf-8")
        subprocess.run([sys.executable, "-X", "utf8", "-I", str(TOOLS["quote"]), "--exw", "100", "--margen-pct", "0", "--unidades", "100", "--flete-internacional-lote", "1000", "--seguro", "2", "--csv", str(root / "costos.csv")], check=True, capture_output=True, text=True, encoding="utf-8")
        subprocess.run([sys.executable, "-X", "utf8", "-I", str(TOOLS["excel"]), str(root / "costos.csv"), "-o", str(root / "costos.xlsx"), "--title", "Cotización sintética de prueba", "--fuente", "Supuestos sintéticos; no es cotización comercial."], check=True)
        subprocess.run([sys.executable, "-X", "utf8", "-I", str(TOOLS["word"]), str(root / "informe.md"), "-o", str(root / "informe.docx"), "--toc"], check=True)
        artifacts = [verify_file(root / name) for name in ("informe.docx", "costos.xlsx")]
        # Comprobar contenido del recorrido además de poder abrir los archivos.
        from docx import Document
        from openpyxl import load_workbook
        if not any("no hay respuestas reales" in p.text for p in Document(root / "informe.docx").paragraphs):
            raise ValueError("El documento perdió la declaración de evidencia pendiente.")
        book = load_workbook(root / "costos.xlsx", read_only=True, data_only=True)
        try:
            rows = list(book.active.values)
            if not any(row[0] == "PRECIO CIF" and row[1] == 112 for row in rows):
                raise ValueError("Falló el prorrateo de flete en el recorrido a Excel (CIF esperado 112).")
        finally:
            book.close()
        for artifact in artifacts:
            artifact["path"] = Path(artifact["path"]).name
        report = {"status": "passed", "scope": "generadores locales con datos sintéticos; no evalúa al modelo ni investigación",
                  "researchVerified": False, "surveysConducted": False,
                  "visualVerification": "pending", "versions": requirements(), "artifacts": artifacts}
        (root / "evidence.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        root.rename(target)
    print(json.dumps({"status": "passed", "evidence": str(target / "evidence.json")}, ensure_ascii=False))
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("doctor")
    prepare = sub.add_parser("setup")
    prepare.add_argument("--wheelhouse", help="Carpeta de wheels para instalación sin red")
    run = sub.add_parser("run")
    run.add_argument("tool", choices=TOOLS)
    run.add_argument("arguments", nargs=argparse.REMAINDER)
    check = sub.add_parser("verify")
    check.add_argument("files", nargs="+")
    sample = sub.add_parser("smoke")
    sample.add_argument("--out", required=True)
    # Operaciones internas invocadas por el mismo CLI, con el Python privado.
    worker_check = sub.add_parser("_verify", help=argparse.SUPPRESS)
    worker_check.add_argument("files", nargs="+")
    worker_smoke = sub.add_parser("_smoke", help=argparse.SUPPRESS)
    worker_smoke.add_argument("--out", required=True)
    args = parser.parse_args()
    if args.command == "doctor":
        return doctor()
    if args.command == "setup":
        return setup(args.wheelhouse)
    if args.command == "run":
        arguments = args.arguments[1:] if args.arguments[:1] == ["--"] else args.arguments
        return subprocess.run([str(require_runtime()), "-X", "utf8", "-I", str(TOOLS[args.tool]), *arguments]).returncode
    if args.command == "verify":
        return managed_worker("_verify", args.files)
    if args.command == "smoke":
        return managed_worker("_smoke", ["--out", args.out])
    if args.command == "_verify":
        print(json.dumps({"artifacts": [verify_file(f) for f in args.files]}, ensure_ascii=False, indent=2))
        return 0
    return smoke(args.out)


if __name__ == "__main__":
    try:
        if sys.version_info < (3, 10):
            raise ValueError("Se necesita Python 3.10 o posterior.")
        sys.exit(main())
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(1)
