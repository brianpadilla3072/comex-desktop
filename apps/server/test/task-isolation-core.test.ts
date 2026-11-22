import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { classifyChange, isDiffableText, lineDiff, relativePathProblem, splitLines, type DiffHunk, type FileState } from "../src/specialists/isolation/core.js";

// contracts/task-isolation/v1 (docs/rust-readiness.md, R5): the path rules, the change
// classification and the line diff another implementation must reproduce.
const vectors = z.object({
  contract: z.literal("openwork.task-isolation"),
  version: z.literal(1),
  paths: z.array(z.object({ path: z.string(), problem: z.enum(["path_invalid", "path_excluded"]).nullable() })),
  classify: z.array(z.object({
    name: z.string(), base: z.string().nullable(), copy: z.string().nullable(), project: z.string().nullable(),
    change: z.enum(["added", "modified", "deleted"]).nullable(), conflict: z.boolean(), alreadyApplied: z.boolean(),
  })),
  text: z.array(z.object({ bytes: z.string(), text: z.boolean() })),
  diff: z.array(z.object({
    name: z.string(), before: z.string(), after: z.string(),
    hunks: z.array(z.object({
      oldStart: z.number(), oldLines: z.number(), newStart: z.number(), newLines: z.number(),
      lines: z.array(z.tuple([z.enum(["context", "removed", "added"]), z.string()])),
    })),
  })),
}).parse(JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "..", "contracts", "task-isolation", "v1", "vectors.json"), "utf8")));

/** Vector shorthand: a letter is a file with that content, null is absent, "other" a link. */
const state = (value: string | null): FileState => value === null ? { kind: "absent" } : value === "other" ? { kind: "other" } : { kind: "file", sha256: value.repeat(64).slice(0, 64).toLowerCase().replace(/[^a-f0-9]/g, "c"), size: 1 };

test("path rules match the contract", () => {
  for (const vector of vectors.paths) assert.equal(relativePathProblem(vector.path), vector.problem, JSON.stringify(vector.path));
});

test("change classification matches the contract", () => {
  for (const vector of vectors.classify) {
    assert.deepEqual(classifyChange(state(vector.base), state(vector.copy), state(vector.project)), { change: vector.change, conflict: vector.conflict, alreadyApplied: vector.alreadyApplied }, vector.name);
  }
});

test("text detection matches the contract", () => {
  for (const vector of vectors.text) {
    const bytes = Uint8Array.from(vector.bytes.split(" ").filter(Boolean).map(byte => Number.parseInt(byte, 16)));
    assert.equal(isDiffableText(bytes), vector.text, vector.bytes);
  }
});

test("line diffs match the contract", () => {
  for (const vector of vectors.diff) {
    const expected: DiffHunk[] = vector.hunks.map(hunk => ({ ...hunk, lines: hunk.lines.map(([kind, text]) => ({ kind, text })) }));
    assert.deepEqual(lineDiff(vector.before, vector.after), { hunks: expected, truncated: false }, vector.name);
  }
});

/** Apply hunks to `before`'s lines; context and removals must match exactly. */
function patch(before: string, hunks: DiffHunk[]): string[] {
  const source = splitLines(before);
  const out: string[] = [];
  let position = 0;
  for (const hunk of hunks) {
    const start = hunk.oldLines ? hunk.oldStart - 1 : hunk.oldStart;
    while (position < start) out.push(source[position++] ?? "");
    for (const line of hunk.lines) {
      if (line.kind === "added") { out.push(line.text); continue; }
      assert.equal(source[position], line.text);
      position++;
      if (line.kind === "context") out.push(line.text);
    }
  }
  while (position < source.length) out.push(source[position++] ?? "");
  return out;
}

test("every diff rebuilds the new version from the old one (seeded fuzz)", () => {
  let seed = 7;
  const random = () => { seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648; return seed / 2_147_483_648; };
  const text = () => Array.from({ length: Math.floor(random() * 14) }, () => "abcd"[Math.floor(random() * 4)]).join("\n");
  for (let round = 0; round < 2_000; round++) {
    const before = text();
    const after = text();
    const diff = lineDiff(before, after, 100_000);
    assert.deepEqual(patch(before, diff.hunks), splitLines(after), JSON.stringify({ before, after }));
  }
});

test("long diffs are truncated instead of returned whole", () => {
  const before = Array.from({ length: 300 }, (_, index) => `línea ${index}`).join("\n");
  const after = Array.from({ length: 300 }, (_, index) => `fila ${index}`).join("\n");
  const diff = lineDiff(before, after, 100);
  assert.equal(diff.truncated, true);
  assert.equal(diff.hunks.length, 0);
});
