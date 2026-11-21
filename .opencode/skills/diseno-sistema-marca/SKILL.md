---
name: diseno-sistema-marca
description: Crear, actualizar y exportar un sistema de diseño de marca con el estudio de diseño (kind "system") — tokens con temas y usage, tipografía y fonts, componentes con README/preview/tipos, assets, tokens.css y docs api, y el paquete exportable. Usar SIEMPRE que la persona pida armar, revisar o exportar un sistema de diseño / identidad de marca, o cuando el agente trabaje sobre un diseño de kind "system" (tokens.json, componentes de marca, paletas, tipografías). También disparar con frases como "hacé esta página siguiendo esto", "cambia el estilo a…", "crea un doc como…" o "exportá el diseño".
---

# Sistema de diseño de marca (estudio de diseño, kind `system`)

Un "sistema de diseño" en esta app es un diseño de **kind `system`** que vive como
archivos locales en el proyecto (`proyecto/diseno/<id>/`). Es la **fuente de verdad**
de la identidad: los demás diseños (slides, mockups) lo siguen y reciben su contexto.

La referencia del formato completo y exportable es el paquete **Noctyx**
(`/home/brian/Descargas/Noctyx`): tokens con temas, componentes ricos, docs api,
`tokens.css`, fonts y un `manifest.json` de paquete. El modelo de datos de la app es
más simple hoy (ver "Modelo actual" abajo), pero el objetivo es acercarse a ese
estándar y **exportar igual**.

## Prompt de contexto (lo que el agente debe saber)

> Un sistema de diseño de marca describe la identidad en tokens, no en pantallas:
> **color con temas** (claro/oscuro) y un `usage` por token; **tipografía** con
> familias, archivos de font y estilos (headline/title/body/label/mono) con su uso;
> **espaciado, radios, sombras, degradados y layout** con valores y notas; y
> **componentes** como entidades ricas: nombre, grupo, resumen, README largo
> (cuándo usarlo / qué provee / qué NO), preview estática y tipos. El sistema se
> guarda en `tokens.json` + `components/` + `fonts/` + `assets/` + `README.md`, y
> deriva artefactos: `tokens.css`, `api/*.md`, `components/index.d.ts`,
> `components/bundle.css`. Los valores viajan con su variable y su uso; nunca un
> hex suelto. Al guardar, los derivados se regeneran. Se exporta como un paquete
> zip con manifiesto, y se vuelve a importar.

## Flujo cuando la persona lo pide

1. **Entender la marca** (si no hay contexto): nombre, rubro, tono, referencias,
   paleta si existe. Si el proyecto ya tiene `README.md` / `DESIGN.md` / una web,
   leerlos antes de proponer.
2. **Proponer el sistema en tokens**: temas (claro + oscuro), paleta con `usage`,
   tipografía (familias + estilos), espaciado/radios/sombras/degradados/layout.
   No inventes valores: si no hay referencia, usá una escala neutra y marcala como
   pendiente de validación con la persona.
3. **Escribir el sistema** en el diseño `system` del proyecto:
   - `tokens.json` (format `openwork.design-tokens`, version 1, ver modelo actual).
   - `components/<X>/README.md` + `preview.html` (preview estática, autocontenida,
     sin scripts ni red; `@dsCard` con group/height si el formato lo pide).
   - `fonts/` (woff2) y `assets/` (logos, isotipos) referenciados con rutas
     relativas a la carpeta del diseño.
   - `README.md` largo con las guías de marca y contenido (voz, color, tipografía,
     layout, movimiento, iconografía, logos, componentes).
4. **Coherencia**: mantienen las páginas de muestra (`pages/*.html`) alineadas a
   los tokens; los demás diseños que siguen el sistema usan sus variables.
5. **Iterar por sección**: la persona puede pedir cambios por sección
   ("cambiá la paleta oscura", "agregá el componente X", "ajustá los radios").
   Editar el archivo correspondiente y refrescar la vista (la página ya recarga por
   `revision`).
6. **Exportar**: el paquete debe poder exportarse como zip con el mismo layout
   (ver "Export").

## Modelo actual (comex-desktop)

`tokens.json` (`openwork.design-tokens` v1, `packages/types/src/designs.ts`):
`overview`, `content`, `colors[{name,value,role?,group?}]`,
`typography[{name,family,size,weight,lineHeight?,sample?}]`,
`spacing[]/radii[]/shadows[]/gradients[]/layout[]` ( `{name,value,note?}` ),
`components[{name,file,description?}]`, `assets[{name,file}]`.

**Pendiente para el modelo completo** (Noctyx): `color.themes[]` con
`value:{light,dark}` y `usage`; `type.fonts[]/families/groups[]`; `note` por grupo;
`meta` de procedencia; componentes con `group`/`summary`/README/tipos. Ver el plan
F1–F5 en la conversación de diseño.

## Reglas de marca (aplicar siempre)

- Un **tema** por token (claro y oscuro), con contraste verificado (≥4,5:1 cuerpo,
  ≥3:1 textos grandes y controles).
- Cada token tiene **`usage`**: qué es y dónde se usa. Sin usage, no es un token.
- Colores semánticos separados (éxito/aviso/error) y **la lavanda o acentos de marca
  no se usan en acciones ni fondos de sección** salvo que el sistema lo diga.
- Un solo degradé de marca, reservado (login / card destacada).
- **Nunca un hex suelto en el código**: se usa la variable.
- Los componentes reales usan el tema del sistema; las previews son rendiciones
  estáticas (HTML/CSS) que replican el aspecto, no el comportamiento.
- "No sé" no es "cero" en datos (si el sistema modela datos).

## Export

Hoy `html-archive.ts` exporta la carpeta del diseño + un `index.html` que lista
páginas. El objetivo es exportar el **paquete de sistema**: `manifest.json`
(manifestVersion 3, name, namespace, files, components, assetGroups, storage),
`tokens.json`, `tokens.css`, `README.md`, `components/` (preview + README +
bundle.css + index.d.ts), `api/`, `assets/`, `fonts/` — y poder **importarlo** de
vuelta (round-trip).

## Referencias en el repo

- Modelo: `packages/types/src/designs.ts` (`designTokensSchema`).
- Editor: `apps/app/src/react-app/domains/design/editors/system-editor.tsx`,
  `system-model.ts`, `system-sections.tsx`, `system-files.tsx`.
- Contexto al agente: `apps/server/src/designs/guidance.ts`, `system-context.ts`.
- Template inicial: `apps/server/src/designs/templates.ts` (`systemTokens`).
- Export: `apps/server/src/designs/html-archive.ts`, `routes.ts`.
- Reglas de UI: `DESIGN.md`.
- Formato de referencia: `/home/brian/Descargas/Noctyx`.

## Límites

- El modelo de datos no se reescribe sin el plan F1–F5 aprobado.
- No toques otros diseños salvo que la persona lo pida.
- Si el flag `designStudio` está off, el estudio no está disponible; decilo.
