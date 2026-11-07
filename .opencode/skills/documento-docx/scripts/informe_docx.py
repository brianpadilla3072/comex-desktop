#!/usr/bin/env python3
"""
informe_docx.py — Convierte un informe en Markdown a un .docx con formato académico.

Pensado para trabajos de Comercio Exterior: portada, índice opcional, títulos,
tablas con numeración, figuras con pie de figura y notas de fuente. Formato base:
A4, márgenes 2.5 cm, tipografía configurables (default Times New Roman 12, 1.5).

Uso:
  python3 informe_docx.py informe.md -o informe.docx
  python3 informe_docx.py informe.md -o informe.docx --toc --font "Arial" --size 11

Formato del Markdown (además del estándar):
  - Front matter entre --- al inicio: titulo, subtitulo, autor, materia,
    institucion, fecha, tutor (todo opcional salvo titulo).
  - # / ## / ###  → Títulos 1/2/3
  - - o *  → viñetas (indentar 2 espacios para subniveles)
  - 1.  → lista numerada
  - > texto  → párrafo en cursiva (usar para notas "Fuente: ...")
  - | a | b |  → tablas (fila de encabezado + fila de separación)
  - ![pie de figura](ruta/imagen.png)  → figura centrada con pie numerado
  - ---  → línea horizontal
  - **negrita**, *cursiva*, `código` dentro de párrafos

Requiere: python-docx (se instala con: bash instalar.sh)
"""

import argparse
import os
import re
import sys
from pathlib import Path


def _bootstrap():
    """Garantiza python-docx; si falta, reintenta con el venv del pack."""
    try:
        import docx  # noqa: F401
        return
    except ImportError:
        pass
    is_win = os.name == "nt"
    venv_root = Path(os.environ.get("COMEX_PACK_HOME", Path.home() / ".comex-pack")) / "venv"
    venv_py = venv_root / ("Scripts/python.exe" if is_win else "bin/python")
    if venv_py.exists() and Path(sys.prefix).resolve() != venv_root.resolve():
        os.execv(str(venv_py), [str(venv_py), __file__, *sys.argv[1:]])
    sys.exit("Falta la librería python-docx. Prepará el entorno privado con "
             "'python scripts/documents.py setup' (o 'bash instalar.sh' en el pack).")


_bootstrap()

from docx import Document  # noqa: E402
from docx.enum.text import WD_ALIGN_PARAGRAPH  # noqa: E402
from docx.enum.table import WD_TABLE_ALIGNMENT  # noqa: E402
from docx.shared import Pt, Cm, Mm, RGBColor  # noqa: E402
from docx.oxml.ns import qn  # noqa: E402
from docx.oxml import OxmlElement  # noqa: E402

NUM_RE = re.compile(r"^[-+]?\$?\s?[\d.,]+%?$")
INLINE_RE = re.compile(r"(\*\*.+?\*\*|\*.+?\*|`.+?`)")


def parse_front_matter(lines):
    fm, rest = {}, lines
    if lines and lines[0].strip() == "---":
        for i in range(1, len(lines)):
            if lines[i].strip() == "---":
                rest = lines[i + 1:]
                break
            if ":" in lines[i]:
                k, v = lines[i].split(":", 1)
                fm[k.strip().lower()] = v.strip().strip('"')
    return fm, rest


def add_runs(par, text):
    """Parsea **negrita**, *cursiva* y `código` en runs."""
    for chunk in INLINE_RE.split(text):
        if not chunk:
            continue
        if chunk.startswith("**") and chunk.endswith("**"):
            par.add_run(chunk[2:-2]).bold = True
        elif chunk.startswith("*") and chunk.endswith("*") and len(chunk) > 2:
            par.add_run(chunk[1:-1]).italic = True
        elif chunk.startswith("`") and chunk.endswith("`"):
            run = par.add_run(chunk[1:-1])
            run.font.name = "Consolas"
            run.font.size = Pt(10)
        else:
            par.add_run(chunk)


def shade(cell, hex_fill):
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:fill"), hex_fill)
    cell._tc.get_or_add_tcPr().append(shd)


def bottom_border(par):
    pPr = par._p.get_or_add_pPr()
    borders = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "6")
    bottom.set(qn("w:color"), "999999")
    borders.append(bottom)
    pPr.append(borders)


def add_field(par, instr, preview=None):
    fld = OxmlElement("w:fldSimple")
    fld.set(qn("w:instr"), instr)
    # Cached field results keep previews useful before Word recalculates fields.
    for index, label in enumerate(preview or []):
        run = OxmlElement("w:r")
        if index:
            run.append(OxmlElement("w:br"))
        text = OxmlElement("w:t")
        text.text = label
        run.append(text)
        fld.append(run)
    par._p.append(fld)


def style_document(doc, font, size):
    normal = doc.styles["Normal"]
    normal.font.name = font
    normal.font.size = Pt(size)
    normal.paragraph_format.line_spacing = 1.5
    normal.paragraph_format.space_after = Pt(6)
    for name, s_size, bold in (("Heading 1", 16, True), ("Heading 2", 14, True), ("Heading 3", 12, True)):
        st = doc.styles[name]
        st.font.name = font
        st.font.size = Pt(s_size)
        st.font.bold = bold
        st.font.color.rgb = RGBColor(0, 0, 0)
        st.paragraph_format.space_before = Pt(12)
        st.paragraph_format.space_after = Pt(6)


def add_cover(doc, fm):
    for _ in range(4):
        doc.add_paragraph()
    t = doc.add_paragraph()
    t.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = t.add_run(fm.get("titulo", "Sin título"))
    r.bold = True
    r.font.size = Pt(22)
    if fm.get("subtitulo"):
        st = doc.add_paragraph()
        st.alignment = WD_ALIGN_PARAGRAPH.CENTER
        sr = st.add_run(fm["subtitulo"])
        sr.font.size = Pt(16)
        sr.italic = True
    doc.add_paragraph()
    for key in ("autor", "materia", "institucion", "tutor", "fecha"):
        if fm.get(key):
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            label = {"autor": "Autor/a", "materia": "Materia", "institucion": "Institución",
                     "tutor": "Tutor/a", "fecha": "Fecha"}[key]
            p.add_run(f"{label}: ").bold = True
            p.add_run(fm[key])
    doc.add_page_break()


def is_number(s):
    s = s.strip().replace("$", "").replace(" ", "")
    if not s or not NUM_RE.match(s):
        return False
    if re.fullmatch(r"\d{1,3}(\.\d{3})+(,\d+)?%?", s):
        return True  # formato 92.969.426 (punto = millares)
    try:
        v = s.rstrip("%")
        float(v.replace(".", "").replace(",", ".")) if "," in v else float(v)
        return True
    except ValueError:
        return False


def add_table(doc, rows, table_no):
    header, body = rows[0], rows[1:]
    n_cols = max(len(r) for r in rows)
    rows = [r + [""] * (n_cols - len(r)) for r in rows]

    cap = doc.add_paragraph()
    cap.paragraph_format.space_after = Pt(2)
    cap.add_run(f"Tabla {table_no}.").bold = True

    table = doc.add_table(rows=len(rows), cols=n_cols)
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    for j, text in enumerate(header):
        cell = table.rows[0].cells[j]
        cell.text = ""
        p = cell.paragraphs[0]
        run = p.add_run(text.strip())
        run.bold = True
        shade(cell, "D9E2E3")
    for i, row in enumerate(body, start=1):
        for j, text in enumerate(row):
            cell = table.rows[i].cells[j]
            cell.text = ""
            p = cell.paragraphs[0]
            add_runs(p, text.strip())
            if is_number(text):
                p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    doc.add_paragraph().paragraph_format.space_after = Pt(0)
    return table_no + 1


def add_figure(doc, alt, path, fig_no):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    if path and Path(path).exists():
        try:
            p.add_run().add_picture(path, width=Cm(14))
        except Exception as e:
            p.add_run(f"[No se pudo insertar la imagen {path}: {e}]")
    else:
        p.add_run(f"[Imagen no encontrada: {path}]")
    cap = doc.add_paragraph()
    cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
    cap.add_run(f"Figura {fig_no}: ").bold = True
    cap.add_run(alt or Path(path).stem).italic = True
    return fig_no + 1


def convert(md_path, out_path, toc, font, size):
    text = Path(md_path).read_text(encoding="utf-8")
    fm, lines = parse_front_matter(text.splitlines())
    base_dir = Path(md_path).resolve().parent

    doc = Document()
    sec = doc.sections[0]
    sec.page_width, sec.page_height = Mm(210), Mm(297)
    for attr in ("top_margin", "bottom_margin", "left_margin", "right_margin"):
        setattr(sec, attr, Cm(2.5))
    style_document(doc, font, size)

    # pie de página con número de página
    footer_p = sec.footer.paragraphs[0]
    footer_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    add_field(footer_p, "PAGE")

    add_cover(doc, fm)

    if toc:
        p = doc.add_paragraph()
        p.add_run("Índice").bold = True
        outline = [line.strip().lstrip("# ").strip() for line in lines if line.strip().startswith("#")]
        add_field(doc.add_paragraph(), 'TOC \\o "1-3" \\h \\z \\u', preview=outline)
        note = doc.add_paragraph()
        note.add_run("Para completar los números de página en Word, actualizá este índice.").italic = True
        doc.add_page_break()

    table_no, fig_no = 1, 1
    i, n = 0, len(lines)
    while i < n:
        line = lines[i]
        s = line.strip()

        if not s:
            i += 1
            continue

        m = re.match(r"!\[(.*?)\]\((.*?)\)", s)
        if m:
            img = m.group(2)
            if img and not Path(img).is_absolute():
                img = str(base_dir / img)
            fig_no = add_figure(doc, m.group(1), img, fig_no)
            i += 1
            continue

        if s.startswith("|"):
            rows = []
            while i < n and lines[i].strip().startswith("|"):
                cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                if not all(re.fullmatch(r":?-{2,}:?", c) for c in cells if c):
                    rows.append(cells)
                i += 1
            if rows:
                table_no = add_table(doc, rows, table_no)
            continue

        if s.startswith("#"):
            level = len(s) - len(s.lstrip("#"))
            doc.add_heading(s.lstrip("# ").strip(), level=min(level, 3))
            i += 1
            continue

        if s == "---":
            bottom_border(doc.add_paragraph())
            i += 1
            continue

        m = re.match(r"^[-*]\s+(.*)", s)
        if m:
            indent = (len(line) - len(line.lstrip())) // 2
            style = "List Bullet" if indent == 0 else f"List Bullet {min(indent + 1, 3)}"
            par = doc.add_paragraph(style=style)
            add_runs(par, m.group(1))
            i += 1
            continue

        m = re.match(r"^\d+[.)]\s+(.*)", s)
        if m:
            par = doc.add_paragraph(style="List Number")
            add_runs(par, m.group(1))
            i += 1
            continue

        if s.startswith(">"):
            par = doc.add_paragraph()
            par.paragraph_format.left_indent = Cm(1)
            run = par.add_run(s.lstrip("> ").strip())
            run.italic = True
            run.font.size = Pt(size - 1)
            i += 1
            continue

        # párrafo común (une líneas consecutivas)
        buf = [s]
        i += 1
        while i < n and lines[i].strip() and not re.match(r"^(#|[-*]\s|\d+[.)]\s|>|\||!\[|---)", lines[i].strip()):
            buf.append(lines[i].strip())
            i += 1
        add_runs(doc.add_paragraph(), " ".join(buf))

    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    doc.save(out_path)

    # verificación: reabrir y resumir
    check = Document(out_path)
    print(f"OK: {out_path}")
    print(f"  párrafos: {len(check.paragraphs)} | tablas: {len(check.tables)} | "
          f"estilos usados: {len({p.style.name for p in check.paragraphs})}")
    if toc:
        print("  recordá actualizar el índice dentro de Word (clic derecho → Actualizar campo).")


def main():
    ap = argparse.ArgumentParser(description="Convierte un informe Markdown a .docx académico.")
    ap.add_argument("entrada", help="Archivo .md con el informe")
    ap.add_argument("-o", "--out", help="Archivo .docx de salida (default: mismo nombre con .docx)")
    ap.add_argument("--toc", action="store_true", help="Insertar índice (se actualiza en Word)")
    ap.add_argument("--font", default="Times New Roman", help="Tipografía (default: Times New Roman)")
    ap.add_argument("--size", type=int, default=12, help="Tamaño de letra (default: 12)")
    args = ap.parse_args()

    out = args.out or str(Path(args.entrada).with_suffix(".docx"))
    convert(args.entrada, out, args.toc, args.font, args.size)


if __name__ == "__main__":
    main()
