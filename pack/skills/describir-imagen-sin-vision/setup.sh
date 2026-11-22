#!/usr/bin/env bash
# Setup de describir-imagen-sin-vision (SOLO DETECCIÓN, sin instalar nada).
# Multiplataforma: Linux / macOS / Windows (Git Bash / MSYS / WSL).
# Idempotente, barato y no destructivo. NUNCA instala: la decisión es del usuario.
set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATUS="$DIR/.setup-status"

have() { command -v "$1" >/dev/null 2>&1; }
kb=$(awk '/^MemAvailable:/{print $2}' /proc/meminfo 2>/dev/null || echo 0)
gb=$((kb / 1024 / 1024))

# Detección de SO
case "$(uname -s 2>/dev/null)" in
  Darwin) os="macos" ;;
  MINGW*|MSYS*|CYGWIN*) os="windows" ;;
  Linux)
    if grep -qi microsoft /proc/version 2>/dev/null; then os="wsl"; else os="linux"; fi ;;
  *) os="unknown" ;;
esac

ocr="missing"; ollama="missing"; model="missing"
have tesseract && ocr="ok"
if have ollama; then
  ollama="ok"
  ollama list 2>/dev/null | grep -qi moondream && model="ok"
fi

# Decisión según RAM. moondream necesita ~3GB disponibles para correr.
if [ "$gb" -ge 3 ]; then
  [ "$ocr" = "ok" ] && mode="ocr+vision" || mode="vision"
  note="RAM suficiente (${gb}GB): visión local bajo demanda (previa confirmación)."
else
  mode="ocr-only"
  note="RAM baja (${gb}GB < 3GB): NO cargar modelo local de visión. Usar OCR/Tesseract."
fi

# Comandos de instalación sugeridos, por SO. El usuario decide si los ejecuta.
install_cmds=""
case "$os" in
  linux|wsl)
    [ "$ocr" != "ok" ] && install_cmds="${install_cmds}\n  OCR:      sudo apt install tesseract-ocr tesseract-ocr-spa   (Debian/Ubuntu; dnf/pacman en otras)"
    if [ "$ollama" != "ok" ] || [ "$model" != "ok" ]; then
      install_cmds="${install_cmds}\n  Visión:   curl -fsSL https://ollama.com/install.sh | sh"
      install_cmds="${install_cmds}\n  Modelo:   ollama pull moondream"
    fi
    install_cmds="${install_cmds}\n  Elevación con diálogo nativo: bash \"<SKILL_DIR>/elevate.sh\" <comando>"
    ;;
  macos)
    [ "$ocr" != "ok" ] && install_cmds="${install_cmds}\n  OCR:      brew install tesseract tesseract-lang"
    if [ "$ollama" != "ok" ] || [ "$model" != "ok" ]; then
      install_cmds="${install_cmds}\n  Visión:   brew install ollama   (o descargar Ollama.app de ollama.com)"
      install_cmds="${install_cmds}\n  Modelo:   ollama pull moondream"
    fi
    install_cmds="${install_cmds}\n  Elevación con diálogo nativo (si hace falta): bash \"<SKILL_DIR>/elevate.sh\" <comando>"
    ;;
  windows)
    [ "$ocr" != "ok" ] && install_cmds="${install_cmds}\n  OCR:      winget install UB-Mannheim.TesseractOCR"
    if [ "$ollama" != "ok" ] || [ "$model" != "ok" ]; then
      install_cmds="${install_cmds}\n  Visión:   winget install Ollama.Ollama"
      install_cmds="${install_cmds}\n  Modelo:   ollama pull moondream"
    fi
    install_cmds="${install_cmds}\n  Elevación con UAC: powershell -ExecutionPolicy Bypass -File \"<SKILL_DIR>/elevate.ps1\" <comando>"
    ;;
  *)
    install_cmds="${install_cmds}\n  SO no detectado: instalá tesseract y ollama+moondream manualmente."
    ;;
esac

cat > "$STATUS" <<EOF
setup_at=$(date -Iseconds 2>/dev/null || date)
os=$os
mem_available_gb=$gb
ocr_tesseract=$ocr
ollama=$ollama
moondream=$model
mode=$mode
note=$note
EOF

echo "[setup] describir-imagen-sin-vision (solo detección; no instala nada)"
echo "[setup] SO detectado: $os"
echo "[setup] RAM disponible: ${gb} GB"
echo "[setup] OCR (tesseract): $ocr"
echo "[setup] ollama: $ollama | moondream: $model"
echo "[setup] modo seleccionado: $mode"
echo "[setup] nota: $note"
if [ -n "$install_cmds" ]; then
  echo "[setup] fallback disponible si el usuario lo solicita:"
  printf "%b\n" "$install_cmds"
fi
echo "[setup] estado guardado en: $STATUS"
