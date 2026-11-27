#!/usr/bin/env bash
# Publica los issues de la carpeta en el repo origin. Requiere gh autenticado.
# Uso: DRY_RUN=1 bash publish.sh   (solo imprime los comandos)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(git -C "$HERE" remote get-url origin | sed -E 's#^.*github\.com[:/](.+?)(/)?$#\1#; s#\.git$##')"
OUT="$HERE/created-issues.txt"

ISSUES=(
  "00-epico-artefactos-oficina.md|[Epic] Visor/editor de artefactos tipo Office para salidas del mini-Studio|epic,feature,ux,comex,needs-design-review"
  "01-docs.md|[Feature] Artefacto Docs: documento vivo con citas, comentarios y exportación|feature,ux,comex,artifact,needs-design-review"
  "02-slides.md|[Feature] Artefacto Slides: presentación estructurada, modo presentar y exportación|feature,ux,comex,artifact,needs-design-review"
  "03-sheets.md|[Feature] Artefacto Sheets: grilla con fórmulas visibles, formato condicional y export|feature,ux,comex,artifact,needs-design-review"
  "04-whiteboard.md|[Feature] Artefacto Whiteboard: lienzo infinito con formas, conectores y asistencia|feature,ux,comex,artifact,needs-design-review"
  "05-data.md|[Feature] Artefacto Data: KPIs, narrativa y nota metodológica sobre datasets de Comex|feature,ux,comex,artifact,panels,needs-design-review"
  "06-temas.md|[Feature] Sistema de temas/estilos para artefactos (tokens propios, sin copiar Claude)|feature,ux,design-system,comex,needs-design-review"
  "07-seguimiento-p1-p4.md|[Feature] Completar y verificar la suite de artefactos tipo Office (P1-P4 + test E2E)|feature,ux,comex,artifact,needs-design-review"
)

if [[ "${DRY_RUN:-0}" != "1" ]]; then
  if ! gh auth status >/dev/null 2>&1; then
    echo "ERROR: gh no está autenticado. Ejecutá: gh auth login -h github.com" >&2
    exit 1
  fi
fi

if [[ "${DRY_RUN:-0}" != "1" ]]; then
  : > "$OUT"
  for label in epic feature ux comex needs-design-review artifact panels design-system; do
    gh label create "$label" --repo "$REPO" --force >/dev/null 2>&1 || true
  done
fi

for entry in "${ISSUES[@]}"; do
  IFS='|' read -r file title labels <<<"$entry"
  body="$HERE/$file"
  if [[ ! -f "$body" ]]; then
    echo "ERROR: falta $body" >&2
    exit 1
  fi
  cmd=(gh issue create --repo "$REPO" --title "$title" --body-file "$body")
  IFS=',' read -ra label_array <<<"$labels"
  for label in "${label_array[@]}"; do
    cmd+=(--label "$label")
  done
  if [[ "${DRY_RUN:-0}" == "1" ]]; then
    printf '%q ' "${cmd[@]}"
    echo
  else
    echo "Creando: $title"
    url="$("${cmd[@]}")"
    echo "$url" | tee -a "$OUT"
  fi
done

echo "Listo. URLs guardadas en $OUT"
