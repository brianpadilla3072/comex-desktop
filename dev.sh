#!/usr/bin/env bash
# Levanta OpenWork (comex-desktop) en modo desarrollo con los datos de ayer.
set -e
cd "$(dirname "$0")"
export PATH="/home/brian/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
export OPENWORK_DATA_DIR="/home/brian/.config/com.differentai.openwork.dev/openwork-dev-data"
export PORT=0
# Cerrar instancia previa si existe
for pid in $(pgrep -f "main.mjs" 2>/dev/null); do kill "$pid" 2>/dev/null || true; done
sleep 3
pnpm dev
