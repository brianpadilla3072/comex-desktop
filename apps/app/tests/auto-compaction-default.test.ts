import { describe, expect, test } from "bun:test";
import { autoCompactionEnabled } from "../src/react-app/domains/settings/state/auto-compaction";

describe("auto compaction default", () => {
  test("on when the workspace has no compaction block or no auto field", () => {
    expect(autoCompactionEnabled(undefined)).toBe(true);
    expect(autoCompactionEnabled(null)).toBe(true);
    expect(autoCompactionEnabled({})).toBe(true);
    expect(autoCompactionEnabled({ keep: { tokens: 15_000 } })).toBe(true);
  });

  test("an explicit operator choice is respected", () => {
    expect(autoCompactionEnabled({ auto: false })).toBe(false);
    expect(autoCompactionEnabled({ auto: true })).toBe(true);
  });
});
