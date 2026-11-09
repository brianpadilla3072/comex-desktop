import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateTaskBudget } from "../src/specialists/tasks.js";

test("the run budget is honest math over schedule and prompt length", () => {
  const interval = estimateTaskBudget({ prompt: "x".repeat(400), schedule: { kind: "interval", everyMinutes: 20 } });
  assert.equal(interval.runsPerDay, 72);
  assert.equal(interval.estTokensPerRun, Math.round((400 / 4) * 8));
  assert.equal(interval.estTokensPerDay, interval.estTokensPerRun * 72);
  assert.ok(interval.estSnapshotsMBPerDay > 0);
  assert.match(interval.note, /72 corridas\/día/);

  const daily = estimateTaskBudget({ prompt: "y".repeat(40), schedule: { kind: "daily", hour: 8, minute: 0 } });
  assert.equal(daily.runsPerDay, 1);
  assert.match(daily.note, /1 corridas\/día|1 corridas/);

  const weekly = estimateTaskBudget({ prompt: "y".repeat(40), schedule: { kind: "weekly", daysOfWeek: [1], hour: 8, minute: 0 } });
  assert.equal(weekly.runsPerDay, Math.round((1 / 7) * 100) / 100);

  const once = estimateTaskBudget({ prompt: "y".repeat(40), schedule: { kind: "once", at: 1_700_000_000 } });
  assert.equal(once.runsPerDay, 0);
  assert.match(once.note, /Una sola corrida/);
});
