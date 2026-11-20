#!/usr/bin/env python3
"""validar_html.py — Guarda del vocabulario cerrado de borrador-html.

Chequea que un borrador HTML use solo los componentes permitidos (references/
componentes.md) y que la cabeza congelada no fue tocada. Salida estilo linter:
línea, regla, mensaje. Exit 1 si hay errores.

Uso:
  python3 scripts/validar_html.py borrador.html
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _minihtml import parse, VOID  # noqa: E402

# ---- vocabulario: etiquetas permitidas y clases por etiqueta ----
ALLOWED_TAGS = {
    "html", "head", "meta", "title", "style", "body", "header", "main",
    "footer", "section", "article", "nav", "h1", "h2", "h3", "h4", "p",
    "ul", "ol", "li", "table", "thead", "tbody", "tr", "th", "td", "div",
    "span", "a", "strong", "em", "code", "pre", "figure", "figcaption",
    "details", "summary", "button", "br", "hr", "img", "svg", "path",
    "rect", "circle", "line", "text", "g", "script",
}

ALLOWED_CLASSES = {
    "doc-header", "portada-meta", "doc-footer",
    "tabla-datos", "num",
    "callout", "callout--info", "callout--alerta", "callout--fuente",
    "kpi-grid", "kpi", "kpi--valor", "kpi--etiqueta",
    "tabs", "tabs-nav", "tab", "tab-panel", "activo",
    "codigo", "figura", "badge", "acciones", "copiar",
}

# Clases que solo tienen sentido dentro de su componente contenedor.
CLASS_CONTEXT = {
    "num": {"td"},
    "tab": {"button"},
    "tab-panel": {"div"},
    "tabs-nav": {"div"},
    "kpi--valor": {"div"},
    "kpi--etiqueta": {"div"},
    "copiar": {"button"},
}

ALLOWED_DATA = {"data-titulo", "data-subtitulo", "data-autor", "data-materia",
                "data-institucion", "data-tutor", "data-fecha", "data-destino"}


def validar(path):
    errs, warns = [], []
    text = Path(path).read_text(encoding="utf-8")
    root, parse_errors = parse(text)
    for e in parse_errors:
        errs.append(("estructura", e))

    head = (root.first("html") or root).first("head")
    body = (root.first("html") or root).first("body")
    if not head or not body:
        errs.append(("estructura", "el documento debe tener <head> y <body>"))
        return errs, warns

    # --- cabeza congelada: sin <link>, sin fuentes externas, sin CDN ---
    if list(head.find_all("link")):
        errs.append(("cabeza", "hay <link> en el <head>: la plantilla no los usa (ni frameworks, ni Google Fonts)"))
    for sc in body.find_all("script"):
        if sc.get("src"):
            errs.append(("dependencias", f"<script src=\"{sc.get('src')}\"> prohibido: nada de CDN, el JS del template es local"))
    for n in [head] + list(root.find_all("img")) + list(root.find_all("svg")):
        url = n.get("src") or n.get("href") or ""
        if url.startswith(("http:", "https:", "//")):
            errs.append(("dependencias", f"recurso externo {url[:60]}: las imágenes van en archivos locales relativos"))

    # --- atributos prohibidos ---
    def walk(node):
        for c in node.children:
            if c.tag is None:
                continue
            if "style" in c.attrs:
                errs.append((f"linea {getattr(c, 'line', '?')}", f"style=\"\" inline en <{c.tag}>: usá los componentes del vocabulario"))
            if c.tag not in ALLOWED_TAGS:
                errs.append(("vocabulario", f"etiqueta <{c.tag}> no permitida"))
            for cl in c.classes():
                if cl not in ALLOWED_CLASSES:
                    errs.append(("vocabulario", f"clase .{cl} desconocida en <{c.tag}> (ver references/componentes.md)"))
                esperado = CLASS_CONTEXT.get(cl)
                if esperado and c.tag not in esperado:
                    errs.append(("vocabulario", f"clase .{cl} solo va en {sorted(esperado)}, no en <{c.tag}>"))
            for k in c.attrs:
                if k.startswith("data-") and k not in ALLOWED_DATA:
                    warns.append(("atributos", f"{k} no es un data-* conocido"))
            if c.tag == "a" and (c.get("target") == "_blank"):
                pass
            walk(c)

    # anotar líneas aproximadas para el mensaje
    try:
        _annotate(text, root)
    except Exception:
        pass
    walk(body)

    # --- portada ---
    headers = list(body.find_all("header"))
    if len(headers) != 1 or "doc-header" not in headers[0].classes():
        errs.append(("portada", "debe haber exactamente un <header class=\"doc-header\">"))
    else:
        if not headers[0].get("data-titulo").strip():
            errs.append(("portada", "el <header> necesita data-titulo (obligatorio para la tapa de Word)"))
    h1s = [n for n in body.find_all("h1")]
    if len(h1s) > 1:
        errs.append(("estructura", f"{len(h1s)} <h1>: el único va en la portada"))

    # --- main ---
    if not body.first("main"):
        errs.append(("estructura", "falta <main> (el contenido va adentro, no en <body> directo)"))

    # --- pestañas balanceadas ---
    for tabs in body.find_all("div"):
        if "tabs" not in tabs.classes():
            continue
        navs = [c for c in tabs.element_children() if "tabs-nav" in c.classes()]
        paneles = [c for c in tabs.element_children() if "tab-panel" in c.classes()]
        botones = [c for c in (navs[0].find_all("button") if navs else [])]
        if not navs or len(botones) != len(paneles) or not paneles:
            errs.append(("tabs", f"pestañas desbalanceadas: {len(botones)} botones vs {len(paneles)} paneles"))
        if paneles and not any("activo" in p.classes() for p in paneles):
            warns.append(("tabs", "ningún .tab-panel tiene class=\"activo\": al abrir no se ve nada"))

    # --- details/summary ---
    for d in body.find_all("details"):
        if not d.first("summary"):
            errs.append(("details", "un <details> sin <summary> no se puede abrir"))

    return errs, warns


def _annotate(text, root):
    """Atribuye a cada Node su línea (búsqueda binaria por orden de aparición)."""
    nodos = []
    def collect(n):
        for c in n.children:
            if c.tag is not None:
                nodos.append(c)
                collect(c)
    collect(root)
    lines = text.splitlines()
    idx = 0
    for node in nodos:
        pat = "<" + node.tag
        for j in range(idx, len(lines)):
            if pat in lines[j].lower():
                node.line = j + 1
                idx = j
                break


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    errs, warns = validar(sys.argv[1])
    for w in warns:
        print(f"  AVISO  [{w[0]}] {w[1]}")
    for e in errs:
        print(f"  ERROR  [{e[0]}] {e[1]}")
    if not errs and not warns:
        print("OK: el borrador usa solo componentes del vocabulario.")
    sys.exit(1 if errs else 0)


if __name__ == "__main__":
    main()
