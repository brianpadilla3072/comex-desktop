import { test } from "node:test";
import assert from "node:assert/strict";
import { compareInventory, reviewUpstream } from "./fork-maintenance.mjs";
test("inventory detects additions and removals without attributing authorship", () => {
  assert.deepEqual(compareInventory(["a", "b"], ["b", "c"]), { unrecorded: ["c"], removed: ["a"] });
});
test("upstream review reports overlaps and truncation but cannot merge or execute", async () => {
  const reads = [];
  const result = await reviewUpstream({ upstreamBase: "abc", files: ["local.ts"] }, async path => {
    reads.push(path);
    return path === "releases/latest" ? { tag_name: "v1", html_url: "https://github.com/example/release" } : { total_commits: 10, files: [{ filename: "local.ts" }, { filename: "other.ts" }] };
  });
  assert.deepEqual(result.overlap, ["local.ts"]);
  assert.equal(result.merged, false);
  assert.equal(result.fileListMayBeTruncated, false);
  assert.equal(reads.length, 2);
});
