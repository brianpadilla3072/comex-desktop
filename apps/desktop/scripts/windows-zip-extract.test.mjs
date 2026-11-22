import assert from "node:assert/strict";
import { test } from "node:test";
import { windowsZipExtractScript } from "./windows-zip-extract.mjs";

// Port of different-ai/openwork#7436 (sidecar part only): from PowerShell 7,
// Expand-Archive in the powershell 5.1 child loads the wrong Archive module.
test("unzips with .NET ZipFile instead of Expand-Archive", () => {
  const script = windowsZipExtractScript("C:\\Temp\\opencode.zip", "C:\\Temp\\opencode-1");
  assert.doesNotMatch(script, /Expand-Archive/);
  assert.doesNotMatch(script, /LoadWithPartialName/);
  assert.match(script, /^\$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System\.IO\.Compression\.FileSystem; /);
  assert.match(script, /\[System\.IO\.Compression\.ZipFile\]::ExtractToDirectory\('C:\\Temp\\opencode\.zip', 'C:\\Temp\\opencode-1'\)$/);
});

test("clears a leftover extract folder first, because ZipFile does not overwrite", () => {
  const script = windowsZipExtractScript("a.zip", "out");
  assert.ok(script.indexOf("Remove-Item -LiteralPath 'out'") < script.indexOf("ExtractToDirectory"));
});

test("quotes single quotes in paths for PowerShell", () => {
  const script = windowsZipExtractScript("C:\\Users\\o'neil\\a.zip", "C:\\Users\\o'neil\\out");
  assert.match(script, /ExtractToDirectory\('C:\\Users\\o''neil\\a\.zip', 'C:\\Users\\o''neil\\out'\)/);
});

test("prepare-sidecar uses it for the Windows unzip", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./prepare-sidecar.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Expand-Archive/);
  assert.match(source, /windowsZipExtractScript\(archivePath, extractDir\)/);
});
