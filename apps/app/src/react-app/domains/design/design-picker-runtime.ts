/**
 * The picker that runs against a design page's document (Comentar / Editar).
 *
 * `designPickerRuntime` is fully self-contained: no imports and no reference to anything outside
 * its own body. The same-origin transport calls it directly on `iframe.contentDocument`; the
 * postMessage transport serializes it with `Function.prototype.toString` into a tiny script that
 * the frame runs (see `DESIGN_PICKER_SCRIPT` in design-picker-transport.ts). Keep it that way:
 * adding an import or a module-level helper here breaks the injected script.
 *
 * It only reads the page and toggles inline outline styles and `contenteditable` on the live
 * document. It never serializes the live document: saving splices the source file
 * (design-picker-edit.ts), so these temporary attributes can never reach disk.
 */

export type DesignPickerMode = "view" | "comment" | "edit";

export interface DesignPickerRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What the person pointed at, as the frame sees it. */
export interface DesignPickerTarget {
  /** Unique CSS selector in the page document (ids, stable data attributes, nth-of-type chain). */
  selector: string;
  tag: string;
  /** Visible text, whitespace collapsed and trimmed, capped. */
  text: string;
  /** Box in page coordinates (CSS px from the document's top-left). */
  box: DesignPickerRect;
  /** Box relative to the frame's viewport, used to anchor UI next to it. */
  client: DesignPickerRect;
}

export type DesignPickerEvent =
  | { type: "ready" }
  | { type: "select"; target: DesignPickerTarget }
  | { type: "edit"; target: DesignPickerTarget; before: string; text: string }
  | { type: "edit-cancel" }
  | { type: "edit-unavailable"; target: DesignPickerTarget }
  | { type: "escape" }
  | { type: "undo" };

export interface DesignPickerHandle {
  setMode(mode: DesignPickerMode): void;
  clearSelection(): void;
  dispose(): void;
}

export const DESIGN_PICKER_CHANNEL = "openwork-design-picker";

export function designPickerRuntime() {
  const CHANNEL = "openwork-design-picker";
  const STABLE_DATA_ATTRIBUTES = ["data-id", "data-ow-id", "data-testid", "data-name", "data-key", "data-section", "data-component", "data-slot"];
  const NOT_PICKABLE = new Set(["html", "head", "body", "script", "style", "template", "noscript", "meta", "link", "title", "base"]);
  const NOT_EDITABLE = new Set(["textarea", "input", "select", "option", "iframe", "object", "embed", "svg", "math", "canvas", "video", "audio", "img", "xmp", "plaintext", "noembed", "noframes"]);
  const XHTML = "http://www.w3.org/1999/xhtml";
  const TEXT_LIMIT = 280;
  // A concrete blue: the page is the person's design, so app tokens do not exist in there.
  const OUTLINE_COLOR = "rgb(37, 99, 235)";
  const HOVER_OUTLINE = "dashed";
  const SELECTED_OUTLINE = "solid";

  function cssIdent(value: string): string {
    let out = "";
    for (let index = 0; index < value.length; index += 1) {
      const char = value.charAt(index);
      const code = value.charCodeAt(index);
      if (code === 0) out += "\uFFFD";
      else if ((code >= 1 && code <= 31) || code === 127 || (index === 0 && code >= 48 && code <= 57) || (index === 1 && code >= 48 && code <= 57 && value.charAt(0) === "-")) out += "\\" + code.toString(16) + " ";
      else if (index === 0 && char === "-" && value.length === 1) out += "\\-";
      else if (code >= 128 || char === "-" || char === "_" || (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)) out += char;
      else out += "\\" + char;
    }
    return out;
  }

  function cssString(value: string): string {
    return "\"" + value.replace(/[\\"]/g, match => "\\" + match).replace(/[\n\r\f]/g, match => "\\" + match.charCodeAt(0).toString(16) + " ") + "\"";
  }

  function matchesOnlyItself(doc: Document, selector: string, element: Element): boolean {
    try {
      const found = doc.querySelectorAll(selector);
      return found.length === 1 && found[0] === element;
    } catch {
      return false;
    }
  }

  function siblingSegment(element: Element): string {
    const tag = element.localName;
    const parent = element.parentElement;
    if (!parent) return tag;
    const siblings = Array.from(parent.children);
    for (const name of STABLE_DATA_ATTRIBUTES) {
      const value = element.getAttribute(name);
      if (!value || value.length > 80) continue;
      const candidate = tag + "[" + name + "=" + cssString(value) + "]";
      try {
        if (siblings.filter(sibling => sibling.matches(candidate)).length === 1) return candidate;
      } catch {
        // An odd value: fall through to the positional segment.
      }
    }
    const sameTag = siblings.filter(sibling => sibling.localName === tag);
    if (sameTag.length === 1) return tag;
    return tag + ":nth-of-type(" + (sameTag.indexOf(element) + 1) + ")";
  }

  /** A selector that matches exactly this element, anchored at the nearest unique id or at body. */
  function selectorFor(element: Element): string {
    const doc = element.ownerDocument;
    const parts: string[] = [];
    let current: Element | null = element;
    while (current) {
      const tag = current.localName;
      if (tag === "body" || tag === "html") {
        parts.unshift(tag);
        break;
      }
      const id = current.getAttribute("id");
      if (id) {
        const byId = "#" + cssIdent(id);
        if (matchesOnlyItself(doc, byId, current)) {
          parts.unshift(byId);
          break;
        }
      }
      parts.unshift(siblingSegment(current));
      current = current.parentElement;
    }
    return parts.join(" > ");
  }

  function visibleText(element: Element): string {
    // innerText follows the rendering (hidden text left out, blocks separated); textContent is the
    // fallback for elements without it (SVG).
    const raw = "innerText" in element && typeof element.innerText === "string" ? element.innerText : element.textContent || "";
    const text = raw.replace(/\s+/g, " ").trim();
    return text.length > TEXT_LIMIT ? text.slice(0, TEXT_LIMIT - 1) + "…" : text;
  }

  function describe(element: Element): DesignPickerTarget {
    const rect = element.getBoundingClientRect();
    const view = element.ownerDocument.defaultView;
    const scrollX = view ? view.scrollX : 0;
    const scrollY = view ? view.scrollY : 0;
    const round = (value: number) => Math.round(value * 10) / 10;
    return {
      selector: selectorFor(element),
      tag: element.localName,
      text: visibleText(element),
      box: { x: round(rect.left + scrollX), y: round(rect.top + scrollY), width: round(rect.width), height: round(rect.height) },
      client: { x: round(rect.left), y: round(rect.top), width: round(rect.width), height: round(rect.height) },
    };
  }

  // Duck-typed guards: in the same-origin transport the nodes come from the frame's realm, where
  // the parent's `Node` / `HTMLElement` constructors would fail an `instanceof` check.
  function isNode(value: unknown): value is Node {
    return typeof value === "object" && value !== null && "nodeType" in value && typeof value.nodeType === "number" && "parentNode" in value;
  }
  function isElement(value: unknown): value is Element {
    return isNode(value) && value.nodeType === 1;
  }
  function isStyled(value: unknown): value is Element & ElementCSSInlineStyle {
    return isElement(value) && "style" in value && typeof value.style === "object" && value.style !== null;
  }
  function isHtmlElement(value: unknown): value is HTMLElement {
    return isStyled(value) && value.namespaceURI === XHTML && "isContentEditable" in value;
  }

  /** The element a pointer event is about, or null when it is outside the page body. */
  function pickable(node: EventTarget | null): (Element & ElementCSSInlineStyle) | null {
    let current: Node | null = isNode(node) ? node : null;
    if (current && current.nodeType !== 1) current = current.parentNode;
    if (!isElement(current)) return null;
    // Inside SVG or MathML, the outer root is what a person points at.
    const element = current.namespaceURI === XHTML ? current : current.closest("svg") || current.closest("math") || current;
    const body = element.ownerDocument.body;
    if (!body || element === body || !body.contains(element)) return null;
    if (NOT_PICKABLE.has(element.localName)) return null;
    return isStyled(element) ? element : null;
  }

  function editable(element: Element): boolean {
    if (element.namespaceURI !== XHTML || NOT_EDITABLE.has(element.localName) || NOT_PICKABLE.has(element.localName)) return false;
    if (element.children.length > 0) return false;
    return (element.textContent || "").trim().length > 0;
  }

  type StyledElement = Element & ElementCSSInlineStyle;

  function install(doc: Document, emit: (event: DesignPickerEvent) => void): DesignPickerHandle {
    let mode: DesignPickerMode = "view";
    let hovered: StyledElement | null = null;
    let selected: StyledElement | null = null;
    let editing: { element: HTMLElement; before: string; editableAttr: string | null; spellcheckAttr: string | null; target: DesignPickerTarget } | null = null;
    const savedStyles = new Map<StyledElement, string | null>();

    function outline(element: StyledElement, value: string | null) {
      if (value === null) {
        if (!savedStyles.has(element)) return;
        const original = savedStyles.get(element);
        savedStyles.delete(element);
        if (original === null || original === undefined) element.removeAttribute("style");
        else element.setAttribute("style", original);
        return;
      }
      if (!savedStyles.has(element)) savedStyles.set(element, element.getAttribute("style"));
      element.style.setProperty("outline-style", value, "important");
      element.style.setProperty("outline-width", "2px", "important");
      element.style.setProperty("outline-color", OUTLINE_COLOR, "important");
      element.style.setProperty("outline-offset", "2px", "important");
      element.style.setProperty("cursor", mode === "edit" ? "text" : "crosshair", "important");
    }

    function setHovered(element: StyledElement | null) {
      if (hovered === element) return;
      if (hovered && hovered !== selected) outline(hovered, null);
      hovered = element;
      if (hovered && hovered !== selected) outline(hovered, HOVER_OUTLINE);
    }

    function setSelected(element: StyledElement | null) {
      if (selected && selected !== element) outline(selected, null);
      selected = element;
      if (selected) outline(selected, SELECTED_OUTLINE);
    }

    function finishEdit(commit: boolean) {
      const current = editing;
      if (!current) return;
      editing = null;
      const element = current.element;
      const text = (element.textContent || "").replace(/[\r\n]+/g, " ");
      if (current.editableAttr === null) element.removeAttribute("contenteditable");
      else element.setAttribute("contenteditable", current.editableAttr);
      if (current.spellcheckAttr === null) element.removeAttribute("spellcheck");
      else element.setAttribute("spellcheck", current.spellcheckAttr);
      outline(element, null);
      if (!commit || text === current.before) {
        if (!commit) element.textContent = current.before;
        emit({ type: "edit-cancel" });
        return;
      }
      emit({ type: "edit", target: current.target, before: current.before, text });
    }

    function startEdit(element: HTMLElement) {
      finishEdit(true);
      setHovered(null);
      editing = {
        element,
        before: element.textContent || "",
        editableAttr: element.getAttribute("contenteditable"),
        spellcheckAttr: element.getAttribute("spellcheck"),
        target: describe(element),
      };
      element.setAttribute("contenteditable", "plaintext-only");
      if (!element.isContentEditable) element.setAttribute("contenteditable", "true");
      element.setAttribute("spellcheck", "false");
      outline(element, SELECTED_OUTLINE);
      element.focus();
      const selection = doc.getSelection();
      if (selection) selection.selectAllChildren(element);
    }

    function insideEditing(node: EventTarget | null): boolean {
      return Boolean(editing && isNode(node) && editing.element.contains(node));
    }

    const onOver = (event: Event) => {
      if (mode === "view" || editing) return;
      const element = pickable(event.target);
      setHovered(element && (mode === "comment" || editable(element)) ? element : null);
    };
    const onLeave = () => setHovered(null);
    const onClick = (event: Event) => {
      if (mode === "view") return;
      if (insideEditing(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      if (mode !== "comment") return;
      const element = pickable(event.target);
      if (!element) return;
      setSelected(element);
      emit({ type: "select", target: describe(element) });
    };
    const onDoubleClick = (event: Event) => {
      if (mode !== "edit" || insideEditing(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      const element = pickable(event.target);
      if (!element) return;
      if (!isHtmlElement(element) || !editable(element)) {
        emit({ type: "edit-unavailable", target: describe(element) });
        return;
      }
      startEdit(element);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (mode === "view") return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (editing) finishEdit(false);
        else {
          setSelected(null);
          emit({ type: "escape" });
        }
        return;
      }
      if (editing && event.key === "Enter") {
        event.preventDefault();
        finishEdit(true);
        return;
      }
      if (!editing && mode === "edit" && (event.ctrlKey || event.metaKey) && !event.shiftKey && (event.key === "z" || event.key === "Z")) {
        event.preventDefault();
        emit({ type: "undo" });
      }
    };
    const onFocusOut = (event: Event) => {
      if (editing && event.target === editing.element) finishEdit(true);
    };
    // Text only: pasted or dropped content never brings markup with it.
    const onPaste = (event: ClipboardEvent) => {
      if (!insideEditing(event.target)) return;
      event.preventDefault();
      const text = (event.clipboardData ? event.clipboardData.getData("text/plain") : "").replace(/[\r\n]+/g, " ");
      const selection = doc.getSelection();
      if (!selection || selection.rangeCount === 0 || !text) return;
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const node = doc.createTextNode(text);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    };
    const onDrop = (event: Event) => {
      if (insideEditing(event.target)) event.preventDefault();
    };

    doc.addEventListener("mouseover", onOver, true);
    doc.addEventListener("mouseleave", onLeave, true);
    doc.addEventListener("click", onClick, true);
    doc.addEventListener("dblclick", onDoubleClick, true);
    doc.addEventListener("keydown", onKeyDown, true);
    doc.addEventListener("focusout", onFocusOut, true);
    doc.addEventListener("paste", onPaste, true);
    doc.addEventListener("drop", onDrop, true);

    return {
      setMode(next: DesignPickerMode) {
        if (next === mode) return;
        finishEdit(true);
        setHovered(null);
        setSelected(null);
        mode = next;
      },
      clearSelection() {
        setSelected(null);
      },
      dispose() {
        finishEdit(false);
        setHovered(null);
        setSelected(null);
        for (const element of Array.from(savedStyles.keys())) outline(element, null);
        doc.removeEventListener("mouseover", onOver, true);
        doc.removeEventListener("mouseleave", onLeave, true);
        doc.removeEventListener("click", onClick, true);
        doc.removeEventListener("dblclick", onDoubleClick, true);
        doc.removeEventListener("keydown", onKeyDown, true);
        doc.removeEventListener("focusout", onFocusOut, true);
        doc.removeEventListener("paste", onPaste, true);
        doc.removeEventListener("drop", onDrop, true);
      },
    };
  }

  /** Inside a frame without same-origin: talk to the parent over postMessage. */
  function bridge(win: Window) {
    const parentWindow = win.parent;
    const post = (event: DesignPickerEvent) => parentWindow.postMessage(Object.assign({ channel: CHANNEL }, event), "*");
    const handle = install(win.document, post);
    win.addEventListener("message", (message: MessageEvent) => {
      if (message.source !== parentWindow) return;
      const data: unknown = message.data;
      if (!data || typeof data !== "object" || !("channel" in data) || data.channel !== CHANNEL || !("type" in data)) return;
      if (data.type === "mode" && "mode" in data && (data.mode === "view" || data.mode === "comment" || data.mode === "edit")) handle.setMode(data.mode);
      else if (data.type === "clear") handle.clearSelection();
    });
    post({ type: "ready" });
  }

  return { selectorFor, describe, editable, install, bridge };
}
