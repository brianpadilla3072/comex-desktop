import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

const inventoryPath = "docs/maintenance/fork-patches.json";
const anchor = "7c2b45414b57d11e03994e5adbaed2a7cf8b3024";
const upstream = "different-ai/openwork";
export function changedFiles(base = anchor) {
  const read = args => execFileSync("git", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).split("\0").filter(Boolean);
  return [...new Set([...read(["diff", "--name-only", "-z", base, "--"]), ...read(["ls-files", "--others", "--exclude-standard", "-z"])])]
    .filter(path => !path.startsWith("docs/maintenance/") && path !== "apps/app/.ui-loop.config.ts")
    .sort();
}
export function compareInventory(known, current) {
  const recorded = new Set(known); const actual = new Set(current);
  return { unrecorded: current.filter(path => !recorded.has(path)), removed: known.filter(path => !actual.has(path)) };
}
async function github(path) {
  const response = await fetch(`https://api.github.com/repos/${upstream}/${path}`, { headers: { Accept: "application/vnd.github+json", ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) }, signal: AbortSignal.timeout(30000), redirect: "error" });
  if (!response.ok) throw new Error(`GitHub no respondió a la consulta (${response.status}).`);
  return response.json();
}
export async function reviewUpstream(inventory, get = github) {
  const release = await get("releases/latest");
  if (typeof release.tag_name !== "string" || release.draft || release.prerelease) throw new Error("No hay una release estable verificable.");
  const comparison = await get(`compare/${encodeURIComponent(inventory.upstreamBase)}...${encodeURIComponent(release.tag_name)}`);
  const paths = (comparison.files ?? []).flatMap(file => typeof file.filename === "string" ? [file.filename] : []);
  return { reviewedAt: new Date().toISOString(), upstream, release: release.tag_name, releaseUrl: release.html_url,
    upstreamBase: inventory.upstreamBase, comparisonUrl: comparison.html_url, commits: comparison.total_commits,
    filesReturned: paths.length, fileListMayBeTruncated: paths.length >= 300,
    overlap: paths.filter(path => inventory.files.includes(path)), files: paths,
    merged: false, note: "Propuesta de revisión. No se fusionó ni ejecutó código de upstream. La API puede limitar la lista; hacer diff Git completo antes de integrar." };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const command = process.argv[2] ?? "check";
    if (command === "inventory") {
      const files = changedFiles(); await mkdir(dirname(inventoryPath), { recursive: true });
      await writeFile(inventoryPath, JSON.stringify({ version: 1, upstream, upstreamBase: anchor, scope: "Diferencias respecto al ancla; no atribuye autoría ni distingue cambios heredados de upstream.", files }, null, 2) + "\n");
      console.log(`${files.length} rutas registradas.`);
    } else {
      const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
      if (command === "check") {
        const diff = compareInventory(inventory.files, changedFiles(inventory.upstreamBase));
        if (diff.unrecorded.length || diff.removed.length) { console.error(JSON.stringify(diff, null, 2)); process.exitCode = 1; }
        else console.log("Inventario del fork actualizado.");
      } else if (command === "review") {
        await mkdir("docs/maintenance", { recursive: true });
        await writeFile("docs/maintenance/upstream-review.json", JSON.stringify(await reviewUpstream(inventory), null, 2) + "\n");
        console.log("Revisión preparada; integración pendiente.");
      } else throw new Error("Uso: fork-maintenance.mjs inventory | check | review");
    }
  } catch { console.error("No se pudo completar la revisión del fork; no se modificó código de upstream."); process.exitCode = 1; }
}
