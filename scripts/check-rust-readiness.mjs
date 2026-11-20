#!/usr/bin/env node
// Enforces docs/rust-readiness.md (R2, R3) on the Rust port targets. Existing occurrences are
// frozen in scripts/rust-readiness-baseline.json and can only shrink.
//   node scripts/check-rust-readiness.mjs            check
//   node scripts/check-rust-readiness.mjs --update   lower the baseline after removing occurrences
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = join(ROOT, "scripts", "rust-readiness-baseline.json");
const TARGETS = ["apps/server/src", "apps/desktop/electron"];
const SKIP = /(?:^|\/)(?:test|tests|__tests__|fixtures|node_modules|dist)(?:\/|$)|\.test\.|\.d\.ts$/;

/** Rule id → line test. Lines are checked after stripping comments and string contents. */
export const RULES = {
  "R3-any": line => /(?::\s*any\b(?!\w)|\bas\s+any\b|<any>)/.test(line),
  "R3-double-cast": line => /\bas\s+unknown\s+as\b/.test(line),
  "R3-eval": line => /\beval\s*\(|\bnew\s+Function\s*\(/.test(line),
  "R3-prototype-mutation": line => /\.prototype\.[A-Za-z_$][\w$]*\s*=(?!=)/.test(line),
  "R2-unvalidated-json-parse": line => /\bJSON\.parse\s*\(/.test(line)
    && !/\.(?:safeParse|parse)\(\s*JSON\.parse\s*\(/.test(line)
    && !/:\s*unknown\s*=\s*(?:await\s+)?JSON\.parse\s*\(/.test(line)
    && !/JSON\.parse\s*\([^;]*\)\s*as\s+unknown\b/.test(line),
};

/** Remove comments and the contents of string literals so text inside them never counts.
 *  One left-to-right pass: a string holding a slash-star (a glob) must not open a comment, and a
 *  comment holding a quote must not open a string. Line breaks are kept so line numbers hold. */
export function codeOnly(source) {
  let out = "";
  let state = "code";
  let quote = "";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (state === "code") {
      if (char === "/" && next === "/") { state = "line"; index += 1; continue; }
      if (char === "/" && next === "*") { state = "block"; out += "  "; index += 1; continue; }
      if (char === "\"" || char === "'" || char === "`") { state = "string"; quote = char; out += char; continue; }
      out += char;
    } else if (state === "line") {
      if (char === "\n") { state = "code"; out += char; }
    } else if (state === "block") {
      if (char === "*" && next === "/") { state = "code"; out += "  "; index += 1; continue; }
      out += char === "\n" ? char : " ";
    } else {
      if (char === "\\") { out += next === "\n" ? " \n" : "  "; index += 1; continue; }
      if (char === quote) { state = "code"; out += char; continue; }
      // A newline ends a broken ' or " string; template literals span lines.
      if (char === "\n") { if (quote !== "`") state = "code"; out += char; continue; }
      out += " ";
    }
  }
  return out;
}

export function findViolations(source) {
  const counts = {};
  const lines = [];
  codeOnly(source).split("\n").forEach((line, index) => {
    for (const [rule, test] of Object.entries(RULES)) {
      if (!test(line)) continue;
      counts[rule] = (counts[rule] ?? 0) + 1;
      lines.push({ rule, line: index + 1 });
    }
  });
  return { counts, lines };
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (SKIP.test(relative(ROOT, path))) return [];
    if (entry.isDirectory()) return walk(path);
    return /\.(?:ts|mts|mjs|js)$/.test(entry.name) ? [path] : [];
  });
}

export function scan(root = ROOT) {
  const report = {};
  for (const target of TARGETS) {
    for (const file of walk(join(root, target))) {
      const { counts, lines } = findViolations(readFileSync(file, "utf8"));
      if (Object.keys(counts).length) report[relative(root, file)] = { counts, lines };
    }
  }
  return report;
}

/** New occurrences beyond the frozen baseline, per file and rule. */
export function compare(report, baseline) {
  const regressions = [];
  for (const [file, { counts, lines }] of Object.entries(report)) {
    for (const [rule, count] of Object.entries(counts)) {
      const allowed = baseline[file]?.[rule] ?? 0;
      if (count > allowed) regressions.push({ file, rule, count, allowed, lines: lines.filter(entry => entry.rule === rule).map(entry => entry.line) });
    }
  }
  return regressions;
}

function main() {
  const report = scan();
  const current = Object.fromEntries(Object.entries(report).map(([file, { counts }]) => [file, counts]));
  if (process.argv.includes("--update")) {
    const previous = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};
    // Only ever lower: a rule can shrink or disappear, never grow through --update.
    const next = {};
    for (const [file, counts] of Object.entries(current)) {
      for (const [rule, count] of Object.entries(counts)) {
        const allowed = previous[file]?.[rule];
        if (allowed === undefined && Object.keys(previous).length) continue;
        (next[file] ??= {})[rule] = allowed === undefined ? count : Math.min(allowed, count);
      }
    }
    writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
    const total = Object.values(next).reduce((sum, counts) => sum + Object.values(counts).reduce((a, b) => a + b, 0), 0);
    console.log(`Rust readiness baseline written: ${total} frozen occurrence(s).`);
    return;
  }
  const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};
  const regressions = compare(report, baseline);
  const frozen = Object.values(baseline).reduce((sum, counts) => sum + Object.values(counts).reduce((a, b) => a + b, 0), 0);
  if (regressions.length) {
    console.error("Rust readiness: new violations of docs/rust-readiness.md:");
    for (const entry of regressions) console.error(`  ${entry.file}: ${entry.rule} ${entry.count} > baseline ${entry.allowed} (lines ${entry.lines.join(", ")})`);
    console.error("Fix them (validate with a schema, drop the cast or any). Do not raise the baseline.");
    process.exit(1);
  }
  console.log(`Rust readiness: 0 new violation(s); ${frozen} frozen occurrence(s) to burn down.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
