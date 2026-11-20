import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, cpuPercent, descendants, parseStat, readKb, summarize } from "./lib/perf.mjs";

test("/proc stat parsing survives spaces and parentheses in the command name", () => {
  const fields = ["S", "42", "7", "7", "0", "-1", "0", "0", "0", "0", "0", "150", "50", "0", "0", "20", "0", "1", "0", "100"];
  assert.deepEqual(parseStat(`123 (my (odd) name) ${fields.join(" ")}`), { ppid: 42, ticks: 200 });
  assert.equal(parseStat("garbage"), null);
});

test("kB values come from status, smaps_rollup and meminfo text", () => {
  assert.equal(readKb("Name:\tx\nVmRSS:\t  20480 kB\n", "VmRSS"), 20480);
  assert.equal(readKb("Rss:  10 kB\nPss:   7 kB\n", "Pss"), 7);
  assert.equal(readKb("MemTotal: 1 kB\n", "MemAvailable"), null);
});

test("the session tree holds only descendants of its own roots", () => {
  const parents = new Map([[1, 0], [10, 1], [11, 10], [12, 11], [20, 1], [21, 20], [30, 1]]);
  assert.deepEqual(descendants(parents, [10, 30]).sort((a, b) => a - b), [10, 11, 12, 30]);
  assert.deepEqual(descendants(parents, [99]), []);
});

test("processes get a role from their command line", () => {
  const argv = (...parts) => parts.join("\0");
  assert.equal(classify(argv("/x/electron/dist/electron", "--type=renderer", "--foo")), "electron-renderer");
  assert.equal(classify(argv("/x/electron", "--type=gpu-process")), "electron-gpu");
  assert.equal(classify(argv("/x/electron", "--type=utility", "--utility-sub-type=network.mojom.NetworkService")), "electron-network");
  assert.equal(classify(argv("/x/electron/dist/electron", "--no-sandbox", "./electron/main.mjs")), "electron-main");
  // Electron may rewrite its title into one argument with spaces (paths with spaces too).
  assert.equal(classify("/a b/node_modules/electron/dist/electron --no-sandbox ./electron/main.mjs"), "electron-main");
  assert.equal(classify(argv("/r/sidecars/opencode2", "serve")), "opencode-engine-v2");
  assert.equal(classify(argv("/r/sidecars/opencode", "serve")), "opencode-engine-v1");
  assert.equal(classify(argv("node", "/r/fault-server.mjs")), "fake-model");
  assert.equal(classify(argv("node", "/r/scripts/dev-agent/devtool.mjs watch", "--session", "x")), "devtool-watcher");
  assert.equal(classify(argv("node", "/r/node_modules/vite/bin/vite.js")), "vite-dev-server");
  assert.equal(classify(argv("/s/@pnpm/exe/pnpm", "-w", "dev:ui")), "launcher");
});

test("CPU percent is per core over the elapsed wall time", () => {
  assert.equal(cpuPercent(undefined, 500, 2000), 0);
  assert.equal(cpuPercent(100, 300, 2000, 100), 100);
  assert.equal(cpuPercent(100, 150, 2000, 100), 25);
});

test("summaries give mean and peak per phase and role", () => {
  const sample = (t, phase, renderer, engine, cpu) => ({ t, phase, memAvailableKb: 4096 * 1024, processes: [
    { pid: 1, role: "electron-renderer", pssKb: renderer * 1024, cpu },
    { pid: 2, role: "opencode-engine-v2", pssKb: engine * 1024, cpu: 0 },
  ] });
  const [idle, busy] = summarize([sample(0, "idle", 100, 200, 0), sample(2000, "idle", 300, 200, 10), sample(4000, "busy", 500, 400, 50)]);
  assert.equal(idle.phase, "idle");
  assert.equal(idle.seconds, 2);
  assert.deepEqual(idle.totalPssMb, { first: 300, last: 500, mean: 400, peak: 500 });
  assert.deepEqual(idle.roles["electron-renderer"], { count: 1, pssMeanMb: 200, pssPeakMb: 300, cpuMean: 5, cpuPeak: 10 });
  assert.equal(busy.totalPssMb.peak, 900);
  assert.equal(busy.memAvailableMinMb, 4096);
});
