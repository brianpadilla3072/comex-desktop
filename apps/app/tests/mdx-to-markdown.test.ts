/** @jsxImportSource react */
import { expect, test } from "bun:test";

import { mdxToMarkdown } from "../src/react-app/domains/artifacts/views/mdx-to-markdown";

test("deja el Markdown común intacto en estructura", () => {
  const result = mdxToMarkdown("# Informe\n\n## Datos\n\n| País | Valor |\n| --- | --- |\n| Brasil | Alta |\n");
  expect(result).toContain("# Informe");
  expect(result).toContain("## Datos");
  expect(result).toContain("| País | Valor |");
  expect(result).toContain("| Brasil | Alta |");
});

test("quita ESM, desempaqueta JSX y muestra las expresiones como texto", () => {
  const result = mdxToMarkdown([
    "import { Algo } from 'libreria'",
    "export const x = 1",
    "",
    "# Demo",
    "",
    "<Nota destacado=\"true\">Contenido visible</Nota>",
    "",
    "{1 + 1}",
  ].join("\n"));
  expect(result).toContain("# Demo");
  expect(result).toContain("Contenido visible");
  expect(result).not.toContain("import { Algo }");
  expect(result).not.toContain("export const x = 1");
  expect(result).not.toContain("<Nota");
  expect(result).toContain("{1 + 1}");
});

test("conserva el bloque de código como texto, sin ejecutarlo", () => {
  const result = mdxToMarkdown("```js\nconst x = 1 + 1\n```");
  expect(result).toContain("```");
  expect(result).toContain("const x = 1 + 1");
});
