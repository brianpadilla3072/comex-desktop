# Elevación de privilegios en Windows con UAC (diálogo NATIVO).
# La contraseña se introduce en el diálogo de Windows; NUNCA pasa por el chat ni por este script.
# Uso: powershell -ExecutionPolicy Bypass -File elevate.ps1 <comando> [args...]
# Sin bloque param: los args que empiezan con "-" (p. ej. --accept-source-agreements)
# llegan a $args en vez de ser interpretados como parámetros del script.

if ($args.Count -eq 0) {
  Write-Error "uso: elevate.ps1 <comando> [args...]"
  exit 2
}

$exe = $args[0]
$rest = if ($args.Count -gt 1) { $args[1..($args.Count - 1)] } else { @() }

# Comillas explícitas por argumento: preserva espacios y caracteres especiales.
$argString = ($rest | ForEach-Object { '"' + ($_ -replace '"', '\"') + '"' }) -join ' '

try {
  $proc = Start-Process -FilePath $exe -ArgumentList $argString -Verb RunAs -Wait -PassThru
  exit $proc.ExitCode
} catch {
  Write-Error "No se pudo elevar (UAC cancelado o sin permisos): $($_.Exception.Message)"
  exit 1
}
