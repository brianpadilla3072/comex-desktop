import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// Base UI button-like parts (Button, triggers, menu items, tabs, toggles)
// expect a native <button>. Rendering an <a>, <div> or <span> without
// `nativeButton={false}` drops button semantics and logs a console error, as
// the "Download Ollama" link in Settings did.

const SRC = join(import.meta.dir, "..", "src");
const PARTS = /<((?:Accordion|Collapsible|Dialog|AlertDialog|Menu|DropdownMenu|Popover|Select|Combobox|NavigationMenu|ContextMenu)Trigger|DialogClose|PopoverClose|DropdownMenuItem|MenuItem|Tab|Toggle|Switch|Button)\b([^>]*?)render=\{\s*<([A-Za-z.]+)/gs;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : files(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

test("button-like Base UI parts never render a non-button element without nativeButton={false}", () => {
  const offenders: string[] = [];
  for (const file of files(SRC)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(PARTS)) {
      const element = match[3] ?? "";
      // A native button, or our own *Button components, which render one.
      if (element === "button" || element.endsWith("Button")) continue;
      if ((match[2] ?? "").includes("nativeButton={false}")) continue;
      const line = source.slice(0, match.index).split("\n").length;
      offenders.push(`${relative(SRC, file)}:${line} <${match[1]} render={<${element}>}`);
    }
  }
  expect(offenders).toEqual([]);
});
