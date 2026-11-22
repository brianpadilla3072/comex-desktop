# Funcionalidad — Capa de estilos/temas transversal tipo Claude Design

**Título sugerido:** `[Feature] Sistema de temas/estilos para artefactos (tokens propios, sin copiar Claude)`
**Labels sugeridas:** `feature`, `ux`, `design-system`, `comex`, `needs-design-review`
**Depende de:** nada (fundacional; los otros issues la consumen)
**Estimación sugerida:** 1 semana

> **✅ Decisión (2026-11-17, publicada en el issue):** **tokens propios + tipografía del sistema**, sin librerías de pago ni externas. Ejecutar primero. Ver `../matriz-decisiones.md`.

---

## Contexto (qué hace Claude Design)

Fuente: `../investigacion-web-funcionalidades.md` §7, captura `data-estilos.jpg`.

- Existe como capacidad oficial integrada en Claude/Artifacts (chat + lienzo), no como app separada hoy.
- **Sistemas de diseño / brand kit**: importar desde GitHub, archivos o código; extraer paleta, escala tipográfica, componentes y patrones; verificación/corrección contra el sistema; gobernanza en equipos/Enterprise.
- Aplica consistencia visual a Docs, Slides, Dashboards y Motion; exporta PDF/PPTX/HTML y hace handoff a otras herramientas.
- UI observada en Data: panel lateral `Design` con `Page color`, `Font`, `Corners`, `Text size` (dropdowns/campo numérico) y tarjetas de formato (`Dashboard`, `Scrollyteller`, `Visual short`, `Visual analysis`). **No hay sliders reales** en el video.

## Problema en Comex hoy

- Hay valores de color hardcodeados en componentes (p. ej. `library-dialog.tsx:673` y `:688`), Ancho fijo `max-w-2xl` (`:62`) y cajas `max-h-80` (`:783`).
- No hay una forma declarativa de aplicar un tema coherente a salidas y paneles.

## Objetivo

Definir una capa de estilos/tokens propios que cualquier artefacto pueda consumir, sin copiar la identidad visual de Claude, y exponerla en un panel simple de selección.

## Alcance

### Incluye
- Tokens de tema (color de superficie/texto/borde/acento, radios, escala tipográfica, espaciado) basados en el sistema de Comex/`DESIGN.md`.
- Un `ThemeProvider` o utilidad equivalente que aplique el tema al shell de artefacto y a los renderers (Docs/Slides/Sheets/Whiteboard/Data).
- Panel `Design` declarativo con: selección de tema, tamaño de texto, radios y **formato de salida** por tipo de artefacto.
- Un tema por defecto obligatorio (tipografía del sistema) y al menos un tema alternativo para validar el cambio en caliente.
- Migración de los hex hardcodeados detectados a tokens, sin cambiar el comportamiento.
- Flag `comex.artifacts.themes`.

### No incluye
- Importar brand kits desde GitHub/Enterprise en el MVP.
- Copiar la paleta oscura cálida o las tipografías de Claude (decisión explícita de la investigación).
- Sliders (no existen en la referencia).

## Criterios de aceptación

- [ ] Cambiar el tema desde el panel se refleja **en todos** los artefactos abiertos sin recargar.
- [ ] No quedan colores hardcodeados en los archivos citados (`library-dialog.tsx:673/688`) ni en los componentes nuevos.
- [ ] El tema por defecto usa tipografía del sistema y cumple contraste según `DESIGN.md`.
- [ ] El panel `Design` usa dropdowns/campos/tarjetas (no sliders) y es accesible por teclado.
- [ ] La selección de formato (`Dashboard`, `Scrollyteller`, etc.) cambia el render del artefacto Data sin perder datos.
- [ ] Flag, tests visuales/headless, screenshots y reglas de `DESIGN.md` citadas en el PR.

## Notas técnicas

- Integrar con Tailwind tokens / CSS variables y el design system existente (`apps/app/src/react-app/design-system`).
- Seguir `DESIGN.md` y citar ids de regla en el PR; usar el skill opcional `.warden/skills/design-spec-review` si está disponible.
- Definir el esquema `Theme` en el modelo de artefacto del épico `00` para que se persista por artefacto.
- Panel declarativo/JSON, sin lógica propia en el render (coherente con las reglas de paneles de la app especialista).

## Dependencias

- Épico `00` (modelo de artefacto). Consumido por `01`, `02`, `03`, `04`, `05`.

## Referencias

- `../investigacion.md` §9 (reglas de traducción), §11 (anti-patrones: no copiar paleta).
- Captura: `data-estilos.jpg`.
- Fuente web: https://claude.com/product/design
- https://support.claude.com/en/articles/14604397-set-up-your-design-system-in-claude-design

## Definition of Done

- [ ] Tokens documentados y aplicados en los 5 artefactos.
- [ ] Screenshots antes/después del cambio de tema.
- [ ] Typecheck y tests en verde.
