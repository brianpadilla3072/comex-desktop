import { afterAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const ownsDom = !GlobalRegistrator.isRegistered;
if (ownsDom) GlobalRegistrator.register({ url: "http://localhost/" });
const { applyTextEdit, escapeHtmlText, sanitizeEditText } = await import("../src/react-app/domains/design/design-picker-edit");
afterAll(async () => { if (ownsDom) await GlobalRegistrator.unregister(); });

const SOURCE = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=1920">
  <style>h1 { color: #123; } /* <h1>no</h1> */</style>
</head>
<body class='slide'>
  <!-- <h1>comentario</h1> -->
  <h1 data-id="titulo">
    Resultados del trimestre
  </h1>
  <p>Ventas &amp; margen</p>
  <p>Segundo<br>párrafo</p>
  <img src="../assets/logo.svg" alt="Logo">
</body>
</html>
`;

describe("applyTextEdit", () => {
  test("splices only the edited text and keeps every other byte", () => {
    const result = applyTextEdit(SOURCE, { selector: "body > h1[data-id=\"titulo\"]", tag: "h1", before: "Resultados del trimestre", text: "Resultados del año" });
    expect(result).toEqual({ ok: true, method: "splice", html: SOURCE.replace("Resultados del trimestre", "Resultados del año") });
  });

  test("escapes entities in the new text", () => {
    const result = applyTextEdit(SOURCE, { selector: "body > p:nth-of-type(1)", tag: "p", before: "Ventas & margen", text: "Ventas & costos" });
    expect(result.ok && result.html).toBe(SOURCE.replace("Ventas &amp; margen", "Ventas &amp; costos"));
  });

  test("script and HTML typed or pasted by the person are stored as text", () => {
    for (const attack of ["<script>alert(1)</script>", "<img src=x onerror=alert(1)>", "</h1><script>alert(1)</script><h1>", "\"><svg onload=alert(1)>"]) {
      const result = applyTextEdit(SOURCE, { selector: "body > h1", tag: "h1", before: "Resultados del trimestre", text: attack });
      if (!result.ok) throw new Error("edit failed");
      const doc = new DOMParser().parseFromString(result.html, "text/html");
      expect(doc.querySelectorAll("script").length).toBe(0);
      expect(doc.querySelectorAll("[onerror],[onload]").length).toBe(0);
      expect(doc.querySelector("h1")?.textContent?.trim()).toBe(attack);
      expect(doc.querySelectorAll("img").length).toBe(1);
    }
  });

  test("line breaks and control characters are flattened", () => {
    expect(sanitizeEditText("uno\r\ndos\u0007 tres")).toBe("uno dos tres");
    expect(escapeHtmlText("a<b>&c")).toBe("a&lt;b&gt;&amp;c");
  });

  test("refuses when the element is gone, holds markup, or its text changed meanwhile", () => {
    expect(applyTextEdit(SOURCE, { selector: "body > h2", tag: "h2", before: "x", text: "y" })).toEqual({ ok: false, reason: "not_found" });
    expect(applyTextEdit(SOURCE, { selector: "body > p:nth-of-type(2)", tag: "p", before: "Segundopárrafo", text: "y" })).toEqual({ ok: false, reason: "not_text" });
    expect(applyTextEdit(SOURCE, { selector: "body > h1", tag: "h1", before: "Otro título", text: "y" })).toEqual({ ok: false, reason: "changed" });
    expect(applyTextEdit(SOURCE, { selector: "body > h1", tag: "p", before: "Resultados del trimestre", text: "y" })).toEqual({ ok: false, reason: "not_found" });
    expect(applyTextEdit(SOURCE, { selector: "}{", tag: "h1", before: "", text: "y" })).toEqual({ ok: false, reason: "not_found" });
  });

  test("falls back to serializing the document when the source cannot be spliced safely", () => {
    // An unclosed <p> before the target: the parser and the raw scan disagree on where it ends.
    const source = "<!doctype html><html><body><p>Uno<p>Dos</body></html>";
    const result = applyTextEdit(source, { selector: "body > p:nth-of-type(2)", tag: "p", before: "Dos", text: "Tres" });
    if (!result.ok) throw new Error("edit failed");
    const doc = new DOMParser().parseFromString(result.html, "text/html");
    expect(Array.from(doc.querySelectorAll("p")).map(node => node.textContent)).toEqual(["Uno", "Tres"]);
    expect(result.method).toBe("serialize");
    expect(result.html.startsWith("<!doctype html>")).toBe(true);
  });
});
