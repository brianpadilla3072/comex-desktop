const psQuote = (value) => `'${value.replace(/'/g, "''")}'`;

/**
 * PowerShell script that unzips a sidecar archive on Windows.
 *
 * `Expand-Archive` fails when the build is started from PowerShell 7: the
 * `powershell` (5.1) child inherits PowerShell 7's PSModulePath, loads its
 * `Microsoft.PowerShell.Archive` module, and that module calls an
 * `ExtractToDirectory` overload .NET Framework does not have. Calling .NET's
 * ZipFile directly works from PowerShell 7, Windows PowerShell 5.1 and cmd.
 * ZipFile does not overwrite, so a leftover extract folder is removed first.
 */
export function windowsZipExtractScript(archivePath, extractDir) {
  return [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.IO.Compression.FileSystem",
    `if (Test-Path -LiteralPath ${psQuote(extractDir)}) { Remove-Item -LiteralPath ${psQuote(extractDir)} -Recurse -Force }`,
    `[System.IO.Compression.ZipFile]::ExtractToDirectory(${psQuote(archivePath)}, ${psQuote(extractDir)})`,
  ].join("; ");
}
