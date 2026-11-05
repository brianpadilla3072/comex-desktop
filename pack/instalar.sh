#!/usr/bin/env bash
# Instala el pack de Comercio Exterior en OpenCode (ámbito global: sirve en cualquier carpeta)
# y prepara el entorno de Python que usan los scripts de Word/Excel/Comtrade.
# Uso: bash instalar.sh
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_DEST="${HOME}/.config/opencode/skills"
AGENTS_DEST="${HOME}/.config/opencode/agents"
VENV="${HOME}/.comex-pack/venv"

echo "== 1/2 Dependencias de Python (para generar Word, Excel y bajar datos) =="
if ! command -v python3 >/dev/null 2>&1; then
  echo "AVISO: no se encontró python3. Los scripts del pack lo necesitan."
  echo "       Instalá Python 3 (python.org) y volvé a correr este instalador."
else
  echo "Python encontrado: $(python3 --version 2>&1)"
  DEPS="python-docx openpyxl"
  INSTALADO=no

  venv_py() {
    if [ -x "$VENV/Scripts/python.exe" ]; then echo "$VENV/Scripts/python.exe"; else echo "$VENV/bin/python"; fi
  }

  # 1) Entorno del pack: preferido, no toca el Python del sistema
  if [ "$(venv_py)" ] && [ -x "$(venv_py)" ] && "$(venv_py)" -c "import docx, openpyxl" 2>/dev/null; then
    INSTALADO=venv
  else
    rm -rf "$VENV"
    if python3 -m venv "$VENV" >/dev/null 2>&1 && [ -x "$(venv_py)" ]; then
      if "$(venv_py)" -m pip install --quiet --upgrade pip >/dev/null 2>&1; then
        "$(venv_py)" -m pip install --quiet $DEPS >/dev/null 2>&1 || true
      fi
      if "$(venv_py)" -c "import docx, openpyxl" 2>/dev/null; then
        INSTALADO=venv
      fi
    fi
    [ "$INSTALADO" = "venv" ] || rm -rf "$VENV"
  fi

  # 2) Fallback: instalar en el usuario de Python
  if [ "$INSTALADO" = "no" ] && python3 -m pip --version >/dev/null 2>&1; then
    python3 -m pip install --user --quiet $DEPS >/dev/null 2>&1 \
      || python3 -m pip install --user --break-system-packages --quiet $DEPS >/dev/null 2>&1 || true
    if python3 -c "import docx, openpyxl" 2>/dev/null; then
      INSTALADO=usuario
    fi
  fi

  case "$INSTALADO" in
    venv)    echo "Librerías listas en: $VENV" ;;
    usuario) echo "Librerías listas en el usuario de Python (pip --user)" ;;
    *)       echo "AVISO: no se pudieron instalar python-docx y openpyxl automáticamente."
             echo "       Opción A (recomendada):  sudo apt install python3-venv python3-pip   (Debian/Ubuntu)"
             echo "       Opción B:  python3 -m pip install --user python-docx openpyxl"
             echo "       y después volvé a correr este instalador." ;;
  esac
fi

echo ""
echo "== 2/2 Skills y agentes en OpenCode =="

# Validación previa: una skill con name que no coincide con su carpeta, o un
# agente con 'permissions:' (plural), NO se cargan y no avisan. Mejor frenar acá.
if command -v python3 >/dev/null 2>&1; then
  if ! python3 "$DIR/scripts/validar.py"; then
    echo ""
    echo "Instalación cancelada: corregí los errores de arriba y volvé a intentar."
    exit 1
  fi
fi

mkdir -p "$SKILLS_DEST" "$AGENTS_DEST"

for skill in "$DIR"/skills/*/; do
  name="$(basename "$skill")"
  rm -rf "${SKILLS_DEST:?}/$name"
  cp -r "$skill" "$SKILLS_DEST/$name"
  echo "skill instalada: $name"
done

for agent in "$DIR"/agents/*.md; do
  name="$(basename "$agent")"
  cp "$agent" "$AGENTS_DEST/$name"
  echo "agente instalado: ${name%.md}"
done

echo ""
echo "Listo. Abrí OpenCode (app de escritorio o terminal) y elegí el agente 'investigador-mercados'."
