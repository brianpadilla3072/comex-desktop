import { test } from "node:test";
import assert from "node:assert/strict";
import { diffSnapshots } from "../src/specialists/diffs.js";

test("row diffs speak by identity: added, removed, changed", () => {
  const before = [
    { pais: "China", arancel: 8, fecha: "2026-11-08" },
    { pais: "India", arancel: 10, fecha: "2026-11-08" },
    { pais: "Egipto", arancel: 6, fecha: "2026-11-08" },
  ];
  const after = [
    { pais: "China", arancel: 8, fecha: "2026-11-08" },
    { pais: "India", arancel: 12, fecha: "2026-11-08" },
    { pais: "Brasil", arancel: 9, fecha: "2026-11-08" },
  ];
  const diff = diffSnapshots(before, after);
  assert.equal(diff.kind, "rows");
  assert.equal(diff.added, 1);
  assert.equal(diff.removed, 1);
  assert.equal(diff.changed, 1);
  assert.match(diff.summary, /\+1 nuevo, −1 perdido, 1 modificado/);
  const changedRow = diff.sample.find(entry => entry.change === "changed");
  assert.equal(changedRow?.key, "pais=India");
  // Same data twice: honest "sin cambios", no noise.
  assert.equal(diffSnapshots(before, before).summary, "sin cambios");
  // Rows without a unique scalar field still compare (whole-row identity).
  const anon = [{ v: { a: 1 } }, { v: { a: 2 } }];
  const anonDiff = diffSnapshots(anon, [...anon, { v: { a: 3 } }]);
  assert.equal(anonDiff.added, 1);
});

test("scalar diffs report the movement, foreign shapes degrade honestly", () => {
  assert.equal(diffSnapshots({ precio: 310 }, { precio: 322 }).summary, "310 → 322");
  assert.equal(diffSnapshots("alpha", "alpha").summary, "sin cambios");
  const shape = diffSnapshots({ compleja: { a: [1, 2] } }, [1, 2, 3]);
  assert.equal(shape.kind, "shape");
  assert.equal(shape.changed, 1);
  assert.equal(diffSnapshots({ x: 1 }, { x: 1 }).changed, 0);
  // Nested arrays inside a payload are NOT treated as the row set (no rows → shape/scalar path).
  const nested = diffSnapshots({ results: [{ a: 1 }] }, { results: [{ a: 2 }] });
  assert.equal(nested.kind, "shape");
});
