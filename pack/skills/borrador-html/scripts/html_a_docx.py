#!/usr/bin/env python3
"""html_a_docx.py — Exporta un borrador HTML del vocabulario cerrado a .docx.

Técnica: en vez de generar el Word desde cero, REDUCE el HTML al subconjunto de
Markdown que ya entiende documento-docx/scripts/informe_docx.py (tapa, índice,
tablas numeradas, figuras, notas de fuente). El formato de Word lo decide ese
script probado, no este. Los componentes interactivos degradan: pestañas y
colapsables se despliegan como subsecciones, los botones se ignoran.

Uso:
  python3 scripts/html_a_docx.py borrador.html -o final.docx [--toc]
  python3 scripts/html_a_docx.py borrador.html --keep-md   # debug: ver el .md intermedio

Requiere: python-docx (se instala con: bash instalar.sh del pack).
"""

import argparse
import importlib.util
import re
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _minihtml import parse  # noqa: E402

SKILL_DIR = Path(__file__).resolve().parents[1]
INFORME_DOCX = SKILL_DIR.parent / "documento-docx" / "scripts" / "informe_docx.py"

FM_KEYS = ("titulo", "subtitulo", "autor", "materia", "institucion", "tutor", "fecha")


def load_informe_docx():
    spec = importlib.util.spec_from_file_location("informe_docx", INFORME_DOCX)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ---------- inline ----------

def inline(node):
    """Texto de un nodo con marcado inline → Markdown."""
    out = []
    for c in node.children:
        if c.tag is None:
            out.append(c.attrs["_"])
            continue
        if c.tag == "strong" or ("badge" in c.classes() and c.tag == "span"):
            out.append("**" + inline(c).strip() + "**")
        elif c.tag == "em":
            out.append("*" + inline(c).strip() + "*")
        elif c.tag == "code":
            out.append("`" + inline(c).strip() + "`")
        elif c.tag == "br":
            out.append(" ")
        elif c.tag == "a":
            t, href = inline(c).strip(), c.get("href", "")
            out.append(f"{t} ({href})" if href else t)
        else:
            out.append(inline(c))
    txt = "".join(out)
    txt = re.sub(r"\s+", " ", txt).strip()
    return txt.replace("|", "\\|")


# ---------- bloques ----------

class Reducer:
    def __init__(self, base_dir):
        self.base = base_dir
        self.lines = []
        self.skip_next_heading_rule = False

    def emit(self, s=""):
        self.lines.append(s)

    def blank(self):
        if not self.lines or self.lines[-1] != "":
            self.emit("")

    def run(self, node):
        for c in node.element_children():
            self.block(c)

    def block(self, n):
        cls = n.classes()
        if n.tag == "h1":
            return  # el título vive en la portada → front matter; los h1 sueltos se ignoran
        if n.tag == "h2":
            self.blank(); self.emit("# " + inline(n)); self.blank()
        elif n.tag == "h3":
            self.blank(); self.emit("## " + inline(n)); self.blank()
        elif n.tag in ("h4",):
            self.blank(); self.emit("### " + inline(n)); self.blank()
        elif n.tag == "p":
            t = inline(n)
            if t:
                self.blank(); self.emit(t); self.blank()
        elif n.tag == "ul":
            self.lista(n, "- ", 0)
        elif n.tag == "ol":
            self.lista(n, "1. ", 0)
        elif n.tag == "table" or "tabla-datos" in cls:
            self.tabla(n)
        elif "callout" in cls:
            self.callout(n)
        elif "kpi-grid" in cls:
            self.kpis(n)
        elif "tabs" in cls:
            self.tabs(n)
        elif n.tag == "details":
            self.details(n)
        elif "codigo" in cls or n.tag == "pre":
            self.codigo(n)
        elif n.tag == "figure" or "figura" in cls:
            self.figura(n)
        elif n.tag == "hr":
            self.blank(); self.emit("---"); self.blank()
        elif n.tag in ("div", "section", "article") or n.tag == "nav":
            self.run(n)
        elif n.tag == "footer" or "doc-footer" in cls:
            pass
        elif n.tag == "blockquote":
            self.emit("> " + inline(n))
        elif "acciones" in cls:
            pass  # botones copiar-prompt: sin equivalente en Word
        else:
            self.run(n)

    def lista(self, node, marker, indent):
        n = 0
        for li in node.element_children():
            if li.tag != "li":
                continue
            n += 1
            txt = inline(li)
            self.emit("  " * indent + (f"{n}. " if marker == "1. " else marker) + txt)
            for sub in li.element_children():
                if sub.tag in ("ul", "ol"):
                    self.lista(sub, "- " if sub.tag == "ul" else "1. ", indent + 1)

    def tabla(self, node):
        filas = []
        thead = node.first("thead")
        if thead:
            for tr in thead.find_all("tr"):
                filas.append([inline(td) for td in tr.element_children() if td.tag in ("th", "td")])
        tbody = node.first("tbody") or node
        for tr in tbody.find_all("tr") if tbody is not node else []:
            filas.append([inline(td) for td in tr.element_children() if td.tag in ("th", "td")])
        if not filas:
            for tr in node.find_all("tr"):
                filas.append([inline(td) for td in tr.element_children() if td.tag in ("th", "td")])
        filas = [f for f in filas if f]
        if not filas:
            return
        cols = max(len(f) for f in filas)
        filas = [f + [""] * (cols - len(f)) for f in filas]
        self.blank()
        self.emit("| " + " | ".join(filas[0]) + " |")
        self.emit("|" + "|".join(["---"] * cols) + "|")
        for f in filas[1:]:
            self.emit("| " + " | ".join(f) + " |")
        self.blank()

    def callout(self, node):
        for p in node.element_children():
            t = inline(p)
            if t:
                self.emit("> " + t)
        self.blank()

    def kpis(self, node):
        self.blank()
        self.emit("| Indicador | Valor |")
        self.emit("|---|---|")
        for kpi in node.element_children():
            if "kpi" not in kpi.classes():
                continue
            valor = etiqueta = ""
            for c in kpi.element_children():
                if "kpi--valor" in c.classes():
                    valor = inline(c)
                elif "kpi--etiqueta" in c.classes():
                    etiqueta = inline(c)
            self.emit(f"| {etiqueta} | {valor} |")
        self.blank()

    def tabs(self, node):
        nav = next((c for c in node.element_children() if "tabs-nav" in c.classes()), None)
        nombres = [inline(b) for b in (nav.element_children() if nav else [])]
        paneles = [c for c in node.element_children() if "tab-panel" in c.classes()]
        for i, p in enumerate(paneles):
            titulo = nombres[i] if i < len(nombres) else f"Opción {i + 1}"
            self.blank(); self.emit("## " + titulo); self.blank()
            self.run(p)

    def details(self, node):
        s = node.first("summary")
        self.blank(); self.emit("## " + (inline(s) if s else "Detalle")); self.blank()
        for c in node.element_children():
            if c.tag != "summary":
                self.block(c)

    def codigo(self, node):
        raw = node.text()
        self.blank()
        for line in raw.splitlines():
            if line.strip():
                self.emit("`" + line.replace("`", "'") + "`")
            else:
                self.emit("")
        self.blank()

    def figura(self, node):
        img = node.first("img")
        cap = node.first("figcaption")
        if img:
            src = img.get("src", "")
            if src and not Path(src).is_absolute():
                src = str(self.base / src)
            self.blank()
            self.emit(f"![{inline(cap) if cap else img.get('alt', '')}]({src})")
            self.blank()
        else:
            self.run(node)  # svg inline: no se exporta, se advierte en validar


def reducir(html_path):
    text = Path(html_path).read_text(encoding="utf-8")
    root, errors = parse(text)
    if errors:
        sys.exit("HTML mal formado, no se exporta:\n  " + "\n  ".join(errors))

    body = (root.first("html") or root).first("body")
    header = next((h for h in body.find_all("header") if "doc-header" in h.classes()), None)
    main = body.first("main")
    if not main:
        sys.exit("no hay <main>: nada que exportar")

    # front matter desde la portada
    fm = ["---"]
    if header:
        for k in FM_KEYS:
            v = header.get(f"data-{k}", "").strip()
            if v:
                fm.append(f"{k}: {v}")
    fm.append("---")

    r = Reducer(Path(html_path).resolve().parent)
    r.run(main)
    md = "\n".join(fm + [""] + r.lines).rstrip() + "\n"
    return md


def main():
    ap = argparse.ArgumentParser(description="Exporta un borrador HTML (vocabulario cerrado) a .docx.")
    ap.add_argument("entrada", help="borrador.html")
    ap.add_argument("-o", "--out", help="salida .docx (default: mismo nombre)")
    ap.add_argument("--toc", action="store_true", help="incluir índice")
    ap.add_argument("--font", default="Times New Roman")
    ap.add_argument("--size", type=int, default=12)
    ap.add_argument("--keep-md", action="store_true", help="dejar el .md intermedio al lado del html (debug)")
    args = ap.parse_args()

    md = reducir(args.entrada)
    with tempfile.TemporaryDirectory() as tmp:
        md_path = Path(tmp) / "borrador.md"
        md_path.write_text(md, encoding="utf-8")
        if args.keep_md:
            Path(args.entrada).with_suffix(".md").write_text(md, encoding="utf-8")
        out = args.out or str(Path(args.entrada).with_suffix(".docx"))
        informe = load_informe_docx()
        informe.convert(str(md_path), out, args.toc, args.font, args.size)


if __name__ == "__main__":
    main()
