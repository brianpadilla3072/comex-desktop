#!/usr/bin/env bash
# Instala el pack de Comercio Exterior en OpenCode (ámbito global: sirve en cualquier carpeta)
# y prepara el entorno de Python que usan los scripts de Word/Excel/Comtrade.
# Uso: bash instalar.sh
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_DEST="${HOME}/.config/opencode/skills"
AGENTS_DEST="${HOME}/.config/opencode/agents"
echo "== 1/2 Dependencias privadas de Python (Word y Excel) =="
if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: se necesita Python 3.10 o posterior. Instalá Python y reintentá."
  exit 1
fi
python3 "$DIR/scripts/documents.py" setup

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

mkdir -p "$SKILLS_DEST" "$AGENTS_DEST" "${HOME}/.config/opencode/scripts"
cp "$DIR/scripts/documents.py" "$DIR/scripts/requirements.lock.txt" "${HOME}/.config/opencode/scripts/"

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
