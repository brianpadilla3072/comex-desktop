// Pure helpers for perf-sample.mjs: read /proc text, build the process tree of one dev-agent
// session, label each process and summarize the samples. No I/O here except the readers
// passed in, so the logic is testable with fixtures.

/** `/proc/<pid>/stat`: the command name sits in parentheses and may contain spaces. */
export function parseStat(text) {
  const close = text.lastIndexOf(")");
  if (close < 0) return null;
  const fields = text.slice(close + 2).trim().split(/\s+/);
  // fields[0] is state (field 3); utime/stime are fields 14/15, starttime field 22.
  const ppid = Number(fields[1]);
  const utime = Number(fields[11]);
  const stime = Number(fields[12]);
  if (![ppid, utime, stime].every(Number.isFinite)) return null;
  return { ppid, ticks: utime + stime };
}

/** kB value of one key in `/proc/<pid>/status`, `/proc/<pid>/smaps_rollup` or `/proc/meminfo`. */
export function readKb(text, key) {
  const match = text.match(new RegExp(`^${key}:\\s+(\\d+)\\s*kB`, "m"));
  return match ? Number(match[1]) : null;
}

/** Every descendant of the roots (roots included), from a pid → ppid map. */
export function descendants(parents, roots) {
  const children = new Map();
  for (const [pid, ppid] of parents) {
    if (!children.has(ppid)) children.set(ppid, []);
    children.get(ppid).push(pid);
  }
  const seen = new Set();
  const queue = roots.filter(pid => parents.has(pid));
  while (queue.length) {
    const pid = queue.shift();
    if (seen.has(pid)) continue;
    seen.add(pid);
    for (const child of children.get(pid) ?? []) queue.push(child);
  }
  return [...seen];
}

/** A short role for a process of the session, from its command line (NUL-separated argv). */
export function classify(cmdline) {
  const argv = cmdline.split("\0").filter(Boolean);
  const text = argv.join(" ");
  const type = text.match(/--type=([a-z-]+)/)?.[1];
  if (type) {
    if (type === "renderer") return "electron-renderer";
    if (type === "gpu-process") return "electron-gpu";
    if (type === "utility") return text.includes("network.mojom") ? "electron-network" : "electron-utility";
    if (type === "zygote") return "electron-zygote";
    return `electron-${type}`;
  }
  const exe = (argv[0] ?? "").split("/").pop() ?? "";
  // Electron's main process may rewrite its title into one space-joined argument.
  if (exe === "electron" || /\/electron\/dist\/electron(\s|$)/.test(text)) return "electron-main";
  if (exe === "opencode2" || exe.startsWith("opencode2-")) return "opencode-engine-v2";
  if (exe === "opencode" || exe.startsWith("opencode-")) return "opencode-engine-v1";
  if (/fault-server\.mjs/.test(text)) return "fake-model";
  if (/devtool\.mjs watch/.test(text)) return "devtool-watcher";
  if (/vite\/bin\/vite\.js/.test(text)) return "vite-dev-server";
  if (exe === "esbuild") return "esbuild";
  if (["pnpm", "node", "sh", "bash"].includes(exe)) return "launcher";
  return exe || "unknown";
}

/** CPU percent of one core between two tick readings. */
export function cpuPercent(previousTicks, ticks, elapsedMs, ticksPerSecond = 100) {
  if (previousTicks === undefined || elapsedMs <= 0) return 0;
  return Math.max(0, ((ticks - previousTicks) / ticksPerSecond) / (elapsedMs / 1000) * 100);
}

/** Totals per role for one sample: { role: { count, rssKb, pssKb, cpu } }. */
export function groupByRole(processes) {
  const roles = {};
  for (const process of processes) {
    const role = roles[process.role] ??= { count: 0, rssKb: 0, pssKb: 0, cpu: 0 };
    role.count += 1;
    role.rssKb += process.rssKb ?? 0;
    role.pssKb += process.pssKb ?? process.rssKb ?? 0;
    role.cpu += process.cpu ?? 0;
  }
  return roles;
}

const round = value => Math.round(value * 10) / 10;

/** Per-phase summary of JSONL samples: mean and peak PSS (MB) and CPU per role, plus the tree total. */
export function summarize(samples) {
  const phases = new Map();
  for (const sample of samples) {
    const phase = sample.phase ?? "unlabelled";
    if (!phases.has(phase)) phases.set(phase, []);
    phases.get(phase).push(sample);
  }
  const out = [];
  for (const [phase, list] of phases) {
    const roles = {};
    for (const sample of list) {
      const grouped = groupByRole(sample.processes);
      for (const [role, value] of Object.entries(grouped)) {
        const entry = roles[role] ??= { samples: 0, pssSum: 0, pssPeak: 0, cpuSum: 0, cpuPeak: 0, countPeak: 0 };
        entry.samples += 1;
        entry.pssSum += value.pssKb / 1024;
        entry.pssPeak = Math.max(entry.pssPeak, value.pssKb / 1024);
        entry.cpuSum += value.cpu;
        entry.cpuPeak = Math.max(entry.cpuPeak, value.cpu);
        entry.countPeak = Math.max(entry.countPeak, value.count);
      }
    }
    const totals = list.map(sample => sample.processes.reduce((sum, process) => sum + (process.pssKb ?? process.rssKb ?? 0), 0) / 1024);
    const cpuTotals = list.map(sample => sample.processes.reduce((sum, process) => sum + (process.cpu ?? 0), 0));
    const available = list.map(sample => sample.memAvailableKb / 1024).filter(Number.isFinite);
    out.push({
      phase,
      samples: list.length,
      seconds: list.length > 1 ? round((list.at(-1).t - list[0].t) / 1000) : 0,
      totalPssMb: { first: round(totals[0] ?? 0), last: round(totals.at(-1) ?? 0), mean: round(totals.reduce((a, b) => a + b, 0) / (totals.length || 1)), peak: round(Math.max(0, ...totals)) },
      totalCpu: { mean: round(cpuTotals.reduce((a, b) => a + b, 0) / (cpuTotals.length || 1)), peak: round(Math.max(0, ...cpuTotals)) },
      memAvailableMinMb: available.length ? round(Math.min(...available)) : null,
      roles: Object.fromEntries(Object.entries(roles).map(([role, entry]) => [role, {
        count: entry.countPeak, pssMeanMb: round(entry.pssSum / entry.samples), pssPeakMb: round(entry.pssPeak),
        cpuMean: round(entry.cpuSum / entry.samples), cpuPeak: round(entry.cpuPeak),
      }])),
    });
  }
  return out;
}
