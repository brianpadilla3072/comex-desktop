import { afterAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const ownsDom = !GlobalRegistrator.isRegistered;
if (ownsDom) GlobalRegistrator.register({ url: "http://localhost/" });
const { designPickerRuntime } = await import("../src/react-app/domains/design/design-picker-runtime");
const { DESIGN_PICKER_SCRIPT, attachDesignPicker, detectDesignPickerTransport, withDesignPickerScript } = await import("../src/react-app/domains/design/design-picker-transport");
afterAll(async () => { if (ownsDom) await GlobalRegistrator.unregister(); });

const runtime = designPickerRuntime();
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
function element(doc: Document, selector: string): Element {
  const found = doc.querySelector(selector);
  if (!found) throw new Error(`Missing ${selector}`);
  return found;
}

const PAGE = `<!doctype html><html><head><title>Portada</title></head><body>
<main>
  <section><h2>Uno</h2><p>Primero</p><p>Segundo</p></section>
  <section id="precios"><ul><li>A</li><li>B</li><li data-id="plan-pro">C</li></ul></section>
  <section data-section="cierre"><p>Gracias</p></section>
  <div id="dup"><span>x</span></div><div id="dup"><span>y</span></div>
  <div id="3d"><b>raro</b></div>
</main></body></html>`;

describe("selector generation", () => {
  const doc = parse(PAGE);

  test("every element in the body gets a selector that matches only itself", () => {
    for (const node of Array.from(doc.body.querySelectorAll("*"))) {
      const selector = runtime.selectorFor(node);
      const matches = doc.querySelectorAll(selector);
      expect(matches.length).toBe(1);
      expect(matches[0]).toBe(node);
    }
  });

  test("prefers a unique id, then stable data attributes, then an nth-of-type chain", () => {
    expect(runtime.selectorFor(element(doc, "#precios"))).toBe("#precios");
    expect(runtime.selectorFor(element(doc, "#precios li:nth-of-type(2)"))).toBe("#precios > ul > li:nth-of-type(2)");
    expect(runtime.selectorFor(element(doc, "[data-id=plan-pro]"))).toBe("#precios > ul > li[data-id=\"plan-pro\"]");
    expect(runtime.selectorFor(element(doc, "[data-section=cierre] p"))).toBe("body > main > section[data-section=\"cierre\"] > p");
    expect(runtime.selectorFor(element(doc, "main > section:first-of-type > p:nth-of-type(2)"))).toBe("body > main > section:nth-of-type(1) > p:nth-of-type(2)");
  });

  test("duplicated ids fall back to position and odd ids are escaped", () => {
    const second = doc.querySelectorAll("[id=dup] span")[1];
    if (!second) throw new Error("missing");
    expect(runtime.selectorFor(second)).toBe("body > main > div:nth-of-type(2) > span");
    // "#\33 d" where the engine supports CSS escapes, the positional chain otherwise; unique either way.
    const odd = element(doc, "[id='3d'] b");
    expect(["#\\33 d > b", "body > main > div:nth-of-type(3) > b"]).toContain(runtime.selectorFor(odd));
  });

  test("the same page always yields the same selectors", () => {
    const again = parse(PAGE);
    const first = Array.from(doc.body.querySelectorAll("*")).map(node => runtime.selectorFor(node));
    const second = Array.from(again.body.querySelectorAll("*")).map(node => runtime.selectorFor(node));
    expect(second).toEqual(first);
  });

  test("describes the element with its tag, collapsed visible text and box", () => {
    const spaced = parse("<body><section>\n  <h2>Uno</h2>\n  <p>Primero   y\n segundo</p>\n</section></body>");
    const target = runtime.describe(element(spaced, "section"));
    expect(target.tag).toBe("section");
    expect(target.selector).toBe("body > section");
    expect(target.text).toBe("Uno Primero y segundo");
    expect(Object.keys(target.box).sort()).toEqual(["height", "width", "x", "y"]);
  });

  test("only leaf text elements are editable", () => {
    expect(runtime.editable(element(doc, "h2"))).toBe(true);
    expect(runtime.editable(element(doc, "main > section:first-of-type"))).toBe(false);
  });
});

describe("transports", () => {
  test("the sandbox decides the transport", () => {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-same-origin");
    expect(detectDesignPickerTransport(frame)).toBe("same-origin");
    frame.setAttribute("sandbox", "allow-scripts");
    expect(detectDesignPickerTransport(frame)).toBe("post-message");
    frame.setAttribute("sandbox", "");
    expect(detectDesignPickerTransport(frame)).toBe("post-message");
  });

  test("the parent accepts only valid picker messages from its own frame", async () => {
    const frame = document.createElement("iframe");
    // happy-dom gives an opaque-origin frame no contentWindow, so the frame here is plain and the
    // transport is forced; a real browser hands out the WindowProxy either way.
    frame.srcdoc = "<p>Hola</p>";
    document.body.append(frame);
    await new Promise(resolve => setTimeout(resolve, 30));
    const received: unknown[] = [];
    const transport = attachDesignPicker(frame, event => received.push(event), "post-message");
    expect(transport.kind).toBe("post-message");
    const target = { selector: "body > h1", tag: "h1", text: "Hola", box: { x: 0, y: 0, width: 10, height: 10 }, client: { x: 0, y: 0, width: 10, height: 10 } };
    const send = (source: Window | null, data: unknown) => window.dispatchEvent(new MessageEvent("message", { source, data }));
    send(frame.contentWindow, { channel: "openwork-design-picker", type: "select", target });
    send(window, { channel: "openwork-design-picker", type: "select", target });
    send(frame.contentWindow, { channel: "other", type: "select", target });
    send(frame.contentWindow, { channel: "openwork-design-picker", type: "select", target: { ...target, selector: 42 } });
    send(frame.contentWindow, { channel: "openwork-design-picker", type: "edit", target, before: "Hola", text: "<b>x</b>" });
    expect(received).toEqual([{ type: "select", target }, { type: "edit", target, before: "Hola", text: "<b>x</b>" }]);
    transport.dispose();
    send(frame.contentWindow, { channel: "openwork-design-picker", type: "escape" });
    expect(received).toHaveLength(2);
    frame.remove();
  });

  test("the injected script is self-contained and talks only over the picker channel", () => {
    const html = withDesignPickerScript("<html><body><h1>Hola</h1></body></html>");
    expect(html.indexOf("<script>")).toBeLessThan(html.indexOf("</body>"));
    const doc = parse("<html><body><h1>Hola</h1></body></html>");
    const posted: unknown[] = [];
    type FakeMessage = { source: unknown; data: unknown };
    const listeners: Array<(event: FakeMessage) => void> = [];
    const parentWindow = { postMessage: (message: unknown) => posted.push(message) };
    const frameWindow = { parent: parentWindow, document: doc, addEventListener: (_: string, listener: (event: FakeMessage) => void) => listeners.push(listener) };
    // Runs the exact string the frame would run, with only `window` in scope.
    new Function("window", DESIGN_PICKER_SCRIPT)(frameWindow);
    expect(posted).toEqual([{ channel: "openwork-design-picker", type: "ready" }]);
    const heading = element(doc, "h1");

    // A message that does not come from the parent window is ignored: the mode stays "view".
    for (const listener of listeners) listener({ source: null, data: { channel: "openwork-design-picker", type: "mode", mode: "comment" } });
    heading.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(posted).toHaveLength(1);

    for (const listener of listeners) listener({ source: parentWindow, data: { channel: "openwork-design-picker", type: "mode", mode: "comment" } });
    heading.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(posted[1]).toMatchObject({ channel: "openwork-design-picker", type: "select", target: { selector: "body > h1", tag: "h1", text: "Hola" } });
  });
});
