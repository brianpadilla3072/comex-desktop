import { test } from "node:test";
import assert from "node:assert/strict";
import { codeOnly, compare, findViolations } from "./check-rust-readiness.mjs";

const rules = source => findViolations(source).lines.map(entry => entry.rule);

test("escape hatches without a Rust equivalent are found", () => {
  assert.deepEqual(rules("const value: any = 1;"), ["R3-any"]);
  assert.deepEqual(rules("const value = input as any;"), ["R3-any"]);
  assert.deepEqual(rules("const config = raw as unknown as Config;"), ["R3-double-cast"]);
  assert.deepEqual(rules("eval(code); new Function('return 1');"), ["R3-eval"]);
  assert.deepEqual(rules("Array.prototype.last = function () {};"), ["R3-prototype-mutation"]);
});

test("JSON.parse must go straight into a schema or into unknown", () => {
  assert.deepEqual(rules("const data = JSON.parse(text);"), ["R2-unvalidated-json-parse"]);
  assert.deepEqual(rules("const data = Schema.parse(JSON.parse(text));"), []);
  assert.deepEqual(rules("const result = schema.safeParse(JSON.parse(text));"), []);
  assert.deepEqual(rules("const value: unknown = JSON.parse(text);"), []);
  assert.deepEqual(rules("const value: unknown = await JSON.parse(text);"), []);
  assert.deepEqual(rules("const value = read().then(text => JSON.parse(text) as unknown);"), []);
});

test("comments and string contents never count", () => {
  assert.deepEqual(rules("// value: any = JSON.parse(x)\nconst ok = 'as unknown as eval(';"), []);
  assert.deepEqual(rules("/* const x: any = 1;\n JSON.parse(y) */"), []);
  assert.equal(codeOnly("const a = \"eval(\";").includes("eval("), false);
  assert.deepEqual(rules("const companyName = 1; const anyway = 2;"), []);
});

test("only occurrences above the frozen baseline fail", () => {
  const report = { "a.ts": { counts: { "R3-double-cast": 2 }, lines: [{ rule: "R3-double-cast", line: 3 }, { rule: "R3-double-cast", line: 9 }] } };
  assert.deepEqual(compare(report, { "a.ts": { "R3-double-cast": 2 } }), []);
  assert.deepEqual(compare(report, { "a.ts": { "R3-double-cast": 1 } }).map(entry => [entry.file, entry.count, entry.allowed]), [["a.ts", 2, 1]]);
  assert.equal(compare(report, {}).length, 1);
});

test("a slash-star inside a string or a quote inside a comment hides nothing", () => {
  // Both used to blank out the code after them, hiding real violations from the check.
  assert.deepEqual(rules("const glob = \"src/**/*.ts\";\nconst data = JSON.parse(text);"), ["R2-unvalidated-json-parse"]);
  assert.deepEqual(rules("// keeps `.opencode/openwork.json`\nconst data = JSON.parse(text);"), ["R2-unvalidated-json-parse"]);
  assert.deepEqual(rules("const a = `multi\nline JSON.parse(x)`;\nconst b: any = 1;"), ["R3-any"]);
  assert.equal(codeOnly("a\n/* x\ny */\nb").split("\n").length, 4);
});
