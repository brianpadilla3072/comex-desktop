"""Mini-DOM con la stdlib (html.parser). Sin dependencias externas.

Construye un árbol de nodos a partir de un HTML. Lo usan validar_html.py para
chequear el vocabulario cerrado y html_a_docx.py para reducir el documento a
Markdown. Un parseo estricto: si una etiqueta de cierre no cierra la que está
abierta, se registra el error (así un borrador mal formado no llega al export).
"""

from html.parser import HTMLParser

VOID = {"br", "hr", "img", "meta", "link", "input", "wbr", "source"}


class Node:
    __slots__ = ("tag", "attrs", "children", "parent")

    def __init__(self, tag, attrs=None, parent=None):
        self.tag = tag                      # None => nodo de texto
        self.attrs = dict(attrs or {})
        self.children = []
        self.parent = parent

    # --- acceso ---
    def classes(self):
        return {c for c in self.attrs.get("class", "").split() if c}

    def get(self, name, default=""):
        return self.attrs.get(name, default)

    def text(self):
        if self.tag is None:
            return self.attrs.get("_", "")
        return "".join(c.text() for c in self.children)

    def find_all(self, tag):
        for c in self.children:
            if c.tag is None:
                continue
            if c.tag == tag:
                yield c
            yield from c.find_all(tag)

    def element_children(self):
        return [c for c in self.children if c.tag is not None]

    def first(self, tag):
        for c in self.children:
            if c.tag == tag:
                return c
        return None


class _Builder(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node("#root")
        self.stack = [self.root]
        self.errors = []
        self._raw_depth = 0  # dentro de <script>/<style>: texto sin interpretar

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs, parent=self.stack[-1])
        self.stack[-1].children.append(node)
        if tag in ("script", "style"):
            node.children.append(Node(None, {"_": ""}))
            self._raw_depth += 1
        if tag not in VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        if tag in VOID:
            self.stack[-1].children.append(Node(tag, attrs, parent=self.stack[-1]))

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self._raw_depth = max(0, self._raw_depth - 1)
        if tag in VOID:
            return
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                if i != len(self.stack) - 1:
                    abiertas = [n.tag for n in self.stack[i + 1:]]
                    self.errors.append(f"<{tag}> cierra con abiertas dentro: {abiertas}")
                del self.stack[i:]
                return
        self.errors.append(f"</{tag}> sin apertura")

    def handle_data(self, data):
        if self._raw_depth:
            destino = None
            for n in reversed(self.stack):
                if n.tag in ("script", "style"):
                    destino = n
                    break
            if destino and destino.children and destino.children[0].tag is None:
                destino.children[0].attrs["_"] += data
                return
        self.stack[-1].children.append(Node(None, {"_": data}))


def parse(html_text):
    """Devuelve (root, errors). root es un Node '#root'."""
    b = _Builder()
    b.feed(html_text)
    b.close()
    if len(b.stack) > 1:
        b.errors.append("quedan etiquetas sin cerrar: " + ", ".join(
            f"<{n.tag}>" for n in b.stack[1:]))
    return b.root, b.errors
