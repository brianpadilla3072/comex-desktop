import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDocBlockOperation, docBlocks, formatDocSelection, outputToMarkdown } from "../src/specialists/doc-blocks.js";

const SAMPLE = [
  "# Informe",
  "",
  "Párrafo con **datos**.",
  "",
  "## Ventas",
  "",
  "- Soja",
  "- Trigo",
  "",
  "| Producto | Valor |",
  "| --- | --- |",
  "| Soja | 10 |",
  "",
  "```ts",
  "const total = 10;",
  "```",
  "",
  "![Mapa](https://example.test/mapa.png)",
].join("\n");

test("Markdown blocks expose stable positional ids and source ranges", () => {
  const blocks = docBlocks(SAMPLE);
  assert.deepEqual(blocks.map(block => block.type), ["heading", "paragraph", "heading", "list", "table", "code", "image"]);
  assert.equal(blocks[0]!.id, "b1");
  assert.equal(blocks[5]!.text, "```ts\nconst total = 10;\n```");
  assert.equal(blocks[6]!.startLine, 18);
});

test("block insert, update, duplicate, move and delete preserve Markdown", () => {
  const inserted = applyDocBlockOperation(SAMPLE, { action: "insert", position: "after", targetBlockId: "b2", content: "Nota nueva." });
  assert.match(inserted.content, /Párrafo con \*\*datos\*\*\.\n\nNota nueva\./);

  const updated = applyDocBlockOperation(SAMPLE, { action: "update", blockId: "b4", content: "Soja y maíz" });
  assert.match(updated.content, /- Soja y maíz/);

  const duplicated = applyDocBlockOperation(SAMPLE, { action: "duplicate", blockId: "b4" });
  assert.equal(duplicated.content.match(/- Soja/g)?.length, 2);

  const moved = applyDocBlockOperation(SAMPLE, { action: "move", blockId: "b4", targetBlockId: "b1", position: "before" });
  assert.ok(moved.content.indexOf("- Soja") < moved.content.indexOf("# Informe"));

  const deleted = applyDocBlockOperation(SAMPLE, { action: "delete", blockId: "b6" });
  assert.doesNotMatch(deleted.content, /const total/);
  assert.equal(docBlocks(deleted.content).some(block => block.type === "code"), false);
});

test("selection formatting is literal, reversible and validates links", () => {
  const bold = formatDocSelection(SAMPLE, "Soja", "bold");
  assert.equal(bold.replaced, 1);
  assert.match(bold.content, /\*\*Soja\*\*/);
  const all = formatDocSelection(SAMPLE, "Soja", "italic", undefined, true);
  assert.equal(all.replaced, 2);
  const link = formatDocSelection(SAMPLE, "Mapa", "link", "https://example.test");
  assert.match(link.content, /\[Mapa\]\(https:\/\/example\.test\)/);
  const cleared = formatDocSelection(link.content, "[Mapa](https://example.test)", "clear");
  assert.match(cleared.content, /Mapa/);
  assert.doesNotMatch(cleared.content, /\[Mapa\]\(https:\/\/example\.test\)/);
});

test("mini-Studio outputs convert into document-shaped Markdown", () => {
  assert.match(outputToMarkdown("table", JSON.stringify([{ Producto: "Soja", Valor: 10 }])), /\| Producto \| Valor \|/);
  assert.match(outputToMarkdown("flashcards", JSON.stringify([{ front: "¿FOB?", back: "Franco a bordo." }])), /## 1\. ¿FOB\?/);
  assert.match(outputToMarkdown("quiz", JSON.stringify([{ question: "¿Capital?", options: ["Roma", "Oslo"], answer: 1 }])), /✅ Oslo/);
});
