# Issues propuestos — Suite tipo Office para Comex

Cada archivo es el cuerpo completo de un issue de GitHub, listo para publicar con `gh issue create --body-file`. Incluye contexto investigado, problema actual, objetivo, alcance, criterios de aceptación, notas técnicas, dependencias, referencias a capturas/fuentes y Definition of Done.

## Orden y dependencias

| Archivo | Título | Depende de | Estimación |
|---|---|---|---|
| `00-epico-artefactos-oficina.md` | Épico: visor/editor de artefactos | — | 8–12 sem (parciales) |
| `01-docs.md` | Artefacto Docs | 00 | 2–3 sem |
| `02-slides.md` | Artefacto Slides | 01, 06 | 2–3 sem + 2 sem |
| `03-sheets.md` | Artefacto Sheets | 00 + decisión de licencia | 3–4 sem |
| `04-whiteboard.md` | Artefacto Whiteboard | 00, 06 + decisión de licencia | 1–2 sem |
| `05-data.md` | Artefacto Data | 00, 06 | 2 sem |
| `06-temas.md` | Sistema de temas/estilos | 00 | 1 sem |

## Issues publicados (2026-11-17)

Repo: `brianpadilla3072/comex-desktop` (se habilitaron los Issues antes de publicar).

| # | Issue | URL |
|---|---|---|
| 1 | Épico artefactos | https://github.com/brianpadilla3072/comex-desktop/issues/1 |
| 2 | Docs | https://github.com/brianpadilla3072/comex-desktop/issues/2 |
| 3 | Slides | https://github.com/brianpadilla3072/comex-desktop/issues/3 |
| 4 | Sheets | https://github.com/brianpadilla3072/comex-desktop/issues/4 |
| 5 | Whiteboard | https://github.com/brianpadilla3072/comex-desktop/issues/5 |
| 6 | Data | https://github.com/brianpadilla3072/comex-desktop/issues/6 |
| 7 | Temas/estilos | https://github.com/brianpadilla3072/comex-desktop/issues/7 |

Cada issue tiene un comentario de cross-link con el épico y el orden sugerido. Las URLs también están en `created-issues.txt`.

Orden sugerido de ejecución: **06 → 01 → 05 → 04 → 03 → 02** (el épico `00` se crea como paraguas, no como bloqueante de todo).

## Decisiones bloqueantes documentadas en los issues

Contexto completo para elegir (precios verificados, licencias, riesgos y recomendación): [`../matriz-decisiones.md`](../matriz-decisiones.md).

**Resueltas el 2026-11-17 (restricción: 100% OSS, sin pago, embebible):**
- #4 Sheets → **Univer core (Apache-2.0)** + SheetJS CE/exceljs para XLSX + gráficos propios. Plan B: FortuneSheet (MIT).
- #5 Whiteboard → **Excalidraw (MIT)** (confirmado por el usuario).
- #7 Temas → tokens propios + tipografía del sistema.

Las decisiones están publicadas como comentarios en los issues de GitHub y al inicio de los archivos `.md` correspondientes.

## Avance 2026-11-17 (agentes lanzados)

- **Spikes ejecutados y documentados** en `../spikes/`: Univer core 1.5.2 (build limpio, fórmulas/CF/snapshot validados en navegador, bundle ~1,65 MB gzip) y Excalidraw 0.18.1 (embed, generación por código, export PNG/SVG, JSON, 0 requests externos con fuentes self-host).
- **Issue #7 (parcial)**: tokens en `apps/app/src/react-app/design-system/comex-theme.ts` + migración de 2 hex en `library-dialog.tsx` + 3 tests. Typecheck y tests en verde. **Sin cambio visible** (mismos colores) → no requiere flag. Queda pendiente el flag `comex.artifacts.themes`, el `ThemeProvider`, el panel `Design` y el cambio en caliente.
- **Issue #1**: diseño técnico listo en `../diseno-artefactos.md` (modelo, shell, flag `comexArtifacts`, plan P0–P5, tests). Falta implementarlo.

- `03-sheets.md`: elegir **Univer (core vs Pro)** o **FortuneSheet** según licencia/funcionalidad.
- `04-whiteboard.md`: elegir **Excalidraw (MIT)** o **tldraw (licencia en producción)**.
- `06-temas.md`: confirmar tokens propios y tipografía del sistema (no copiar Claude).

## Publicación

Ya ejecutado. El repo tenía los Issues deshabilitados; se habilitaron con
`gh api -X PATCH repos/brianpadilla3072/comex-desktop -f has_issues=true` y se publicaron los 7 issues.

Para volver a usar el script (p. ej. en otro repo):

```bash
gh auth login -h github.com            # si hace falta
DRY_RUN=1 bash docs/features/comex-office-reference/issues/publish.sh   # ver comandos
bash docs/features/comex-office-reference/issues/publish.sh             # publicar
```

El script crea labels si faltan, crea los issues en `origin` y guarda las URLs en `created-issues.txt`.

## Verificación posterior

- [x] Los 7 issues existen y tienen labels.
- [x] El épico referencia a los 6 hijos y estos referencian al épico (comentarios de cross-link).
- [x] Se linkean desde este README.
- [ ] Registrar las URLs en la memoria del proyecto al cerrar el tramo.
