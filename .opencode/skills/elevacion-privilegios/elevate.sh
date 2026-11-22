#!/usr/bin/env bash
# Elevación de privilegios multiplataforma (Linux + macOS) con DIÁLOGO NATIVO del SO.
# La contraseña se introduce en el diálogo del sistema; NUNCA pasa por el chat ni por este script.
# Uso: bash elevate.sh <comando> [args...]
set -u
if [ $# -lt 1 ]; then
  echo "uso: elevate.sh <comando> [args...]" >&2
  exit 2
fi

case "$(uname -s 2>/dev/null)" in
  Darwin)
    # macOS: diálogo nativo de autorización (pide contraseña de administrador).
    # %q escapa cada arg (incluye espacios, comillas y |), preservando el comando.
    cmd=$(printf '%q ' "$@")
    esc=${cmd//\\/\\\\}
    esc=${esc//\"/\\\"}
    exec osascript -e "do shell script \"$esc\" with administrator privileges"
    ;;
  Linux)
    if command -v pkexec >/dev/null 2>&1 && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
      # Linux con sesión gráfica: diálogo polkit (GNOME/KDE).
      # Nota: el diálogo lo muestra el agente polkit de la SESIÓN del usuario (vía D-Bus),
      # no el proceso elevado; DISPLAY/XAUTHORITY se pasan para comandos GUI elevados.
      exec pkexec env "DISPLAY=${DISPLAY:-}" "XAUTHORITY=${XAUTHORITY:-}" "$@"
    elif command -v sudo >/dev/null 2>&1; then
      # Sin sesión gráfica: sudo pide la contraseña en la terminal del usuario.
      # ADVERTENCIA: desde un worker sin TTY esto falla; requiere terminal interactiva.
      exec sudo "$@"
    else
      echo "No hay pkexec ni sudo; ejecutá el comando manualmente con privilegios." >&2
      exit 1
    fi
    ;;
  *)
    echo "SO no soportado por elevate.sh. En Windows usá elevate.ps1." >&2
    exit 1
    ;;
esac
