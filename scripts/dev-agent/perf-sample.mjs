#!/usr/bin/env node
// Memory and CPU sampler for one dev-agent session (Linux /proc only).
//
//   node scripts/dev-agent/perf-sample.mjs record --session perf --out tmp/dev-agent/perf.jsonl \
//        [--interval 2] [--stop-below-mb 3072] [--phase-file tmp/dev-agent/perf.phase]
//   node scripts/dev-agent/perf-sample.mjs summary tmp/dev-agent/perf.jsonl
//
// `record` samples every process the session started (the Electron launcher tree and the fake
// model server; never anything else) and appends one JSON line per tick: RSS, PSS and CPU per
// process, plus MemAvailable. The current contents of --phase-file label each sample, so a
// driver script can mark scenarios. When MemAvailable drops under --stop-below-mb the sampler
// runs `devtool down` for that session and exits 3 (the out-of-memory watchdog).
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classify, cpuPercent, descendants, parseStat, readKb, summarize } from "./lib/perf.mjs";
import { readSession, sessionName } from "./lib/session.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const read = path => { try { return readFileSync(path, "utf8"); } catch { return null; } };

function parseArgs(argv) {
  const options = {};
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index].startsWith("--")) { options[argv[index].slice(2)] = argv[index + 1]; index += 1; }
    else positional.push(argv[index]);
  }
  return { options, positional };
}

function processTable() {
  const parents = new Map();
  const ticks = new Map();
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    const stat = parseStat(read(`/proc/${entry}/stat`) ?? "");
    if (!stat) continue;
    parents.set(Number(entry), stat.ppid);
    ticks.set(Number(entry), stat.ticks);
  }
  return { parents, ticks };
}

async function record(options) {
  const name = sessionName(options.session ?? "default");
  const out = resolve(options.out ?? join(here, "..", "..", "tmp", "dev-agent", `${name}-perf.jsonl`));
  const intervalMs = Number(options.interval ?? 2) * 1000;
  const stopBelowKb = Number(options["stop-below-mb"] ?? 3072) * 1024;
  const ticksPerSecond = Number(spawnSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).stdout.trim()) || 100;
  let previous = new Map();
  let previousAt = Date.now();
  console.log(`sampling session "${name}" every ${intervalMs / 1000}s into ${out} (watchdog under ${stopBelowKb / 1024} MB available)`);
  for (;;) {
    const session = readSession(name);
    if (!session || session.stoppedAt) { console.log("session gone; sampler stops"); return 0; }
    const { parents, ticks } = processTable();
    const roots = [session.pid, session.fakeModelPid, session.watcherPid].filter(Number.isInteger);
    const now = Date.now();
    const processes = descendants(parents, roots).map(pid => {
      const status = read(`/proc/${pid}/status`) ?? "";
      const rollup = read(`/proc/${pid}/smaps_rollup`) ?? "";
      return {
        pid, ppid: parents.get(pid), role: classify(read(`/proc/${pid}/cmdline`) ?? ""),
        rssKb: readKb(status, "VmRSS") ?? 0, pssKb: readKb(rollup, "Pss") ?? readKb(status, "VmRSS") ?? 0,
        cpu: Math.round(cpuPercent(previous.get(pid), ticks.get(pid), now - previousAt, ticksPerSecond) * 10) / 10,
      };
    });
    previous = new Map(processes.map(process => [process.pid, ticks.get(process.pid)]));
    previousAt = now;
    const memAvailableKb = readKb(read("/proc/meminfo") ?? "", "MemAvailable");
    const phase = options["phase-file"] && existsSync(options["phase-file"]) ? (read(options["phase-file"]) ?? "").trim() : undefined;
    appendFileSync(out, `${JSON.stringify({ t: now, phase, memAvailableKb, processes })}\n`);
    if (memAvailableKb !== null && memAvailableKb < stopBelowKb) {
      appendFileSync(out, `${JSON.stringify({ t: Date.now(), event: "watchdog", memAvailableKb })}\n`);
      console.error(`MemAvailable ${Math.round(memAvailableKb / 1024)} MB < ${stopBelowKb / 1024} MB: stopping session "${name}"`);
      spawnSync(process.execPath, [join(here, "devtool.mjs"), "down", "--session", name], { stdio: "inherit" });
      return 3;
    }
    await new Promise(resolveTick => setTimeout(resolveTick, intervalMs));
  }
}

function summary(file) {
  const samples = readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)).filter(sample => Array.isArray(sample.processes));
  return JSON.stringify(summarize(samples), null, 2);
}

const [command, ...argv] = process.argv.slice(2);
const { options, positional } = parseArgs(argv);
if (process.platform !== "linux") { console.error("perf-sample reads /proc and runs on Linux only."); process.exit(1); }
if (command === "record") process.exit(await record(options));
else if (command === "summary" && positional[0]) console.log(summary(positional[0]));
else { console.error("Use: perf-sample.mjs record --session <name> [--out f.jsonl] [--interval s] [--stop-below-mb n] [--phase-file f] | summary <f.jsonl>"); process.exit(1); }
