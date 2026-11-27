# Épico — Superficies tipo "Office" para las salidas de Comex

**Título sugerido:** `[Epic] Visor/editor de artefactos tipo Office para salidas del mini-Studio`
**Labels sugeridas:** `epic`, `feature`, `ux`, `comex`, `needs-design-review`
**Depende de:** nada
**Dependencias de:** issues 01–06

> **Estado real (2026-11-24): BASE IMPLEMENTADA, ÉPICO ABIERTO.**
>
> **Implementado**
> - Esquema Zod y unión `doc | slides | sheet | board | data`.
> - Persistencia en `proyecto/artefactos/`, versiones inmutables, deduplicación y reversión.
> - Shell común en pestaña `studio`, split chat/artefacto y modo foco.
> - Apertura de artefactos desde Resultados y auto-apertura de salidas `table` nuevas como hoja.
> - Visor Data sobre el resolver determinista de paneles.
> - `comexArtifacts` activo por defecto en self-hosted; cloud sigue apagado y el operador puede bloquearlo.
>
> **Pendiente**
> - Completar los sub-issues y sus criterios de aceptación.
> - Ejecutar el E2E completo con evidencia, capturas y revisión de `DESIGN.md`.
> - Cerrar la brecha de temas, Slides, Whiteboard y paridad de Sheets.

---

## Contexto

El video de EDteam y la investigación web (ver `../investigacion-web-funcionalidades.md`) muestran que el cambio de fondo en Claude no es estético: un documento, una hoja o un tablero dejan de ser texto en el chat y pasan a ser **artefactos con shell propio** (header, cuerpo, acciones, barra flotante), con el chat al lado. Comex, en cambio, muestra las salidas del mini-Studio dentro de un `Dialog` de configuración de 672 px (`apps/app/src/react-app/domains/specialists/library-dialog.tsx:62`) y las lee en cajas de 320 px (`:783`). Ese es el problema más caro de arreglar y el más simple de explicar.

La recomendación de la investigación: construir primero un **visor de artefacto** y un **render editorial de paneles**, antes de tocar split view o home.

## Objetivo del épico

Dotar a Comex de un modelo de **artefacto de primer nivel** y de un shell reutilizable sobre el cual se apoyen las seis funcionalidades (Docs, Slides, Sheets, Whiteboard, Data y capa Design), de forma incremental y con bajo riesgo.

## Alcance

### Incluye
- Modelo de datos de artefacto (tipo, título, estado `Draft`, fuentes, versiones, metadatos).
- Shell visual común: header compacto, cuerpo dominante, acciones (compartir/exportar), dock/barra contextual.
- Coexistencia chat ↔ artefacto: split redimensionable y modo foco con `Mostrar chat`.
- Esquemas JSON canónicos por tipo de artefacto y herramientas del agente para producirlos.
- Feature flag global que permita desactivar toda la experiencia sin deploy.
- Métricas y telemetría de uso (apertura, edición, exportación).

### No incluye
- Paridad 1:1 con la suite de Claude (ver anti-patrones en `../investigacion.md` §11).
- Copiar paleta/tipografías de Claude: se usan tokens propios y tipografía del sistema.
- Colaboración multiusuario en la primera entrega (se habilita por tipo en fases posteriores).

## Criterios de aceptación del épico

- [x] Existe un tipo `Artifact` con esquema versionado y persistencia en el workspace de Comex.
- [x] El shell común se reutiliza en al menos dos funcionalidades (p. ej. Docs y Data).
- [x] El usuario puede abrir una salida, verla con más espacio que el diálogo actual y volver al chat sin perder el objeto.
- [ ] Toda superficie nueva está detrás de feature flag y pasa revisión de `DESIGN.md` con screenshots.
- [ ] Cada sub-issue tiene criterios de aceptación verificables y tests headless correspondientes.
- [ ] Los esquemas JSON y las herramientas están documentados para que otro agente pueda continuar.

## Notas técnicas

- Stack: React + TS + Vite, Tailwind + shadcn/base-ui, `react-resizable-panels` ya disponible.
- Integrar con dominios existentes: `apps/app/src/react-app/domains/specialists`, `session/panel`, `apps`.
- Ver `apps/app/src/react-app/domains/session/panel/panel-tab-store.ts` para tipos de pestañas y `artifact-panel.tsx` para el panel actual.
- Las vistas repetitivas van en paneles deterministas sobre datasets; este épico es la excepción de edición rica, no reemplaza a los paneles.
- Seguir `AGENTS.md`: feature flag para todo comportamiento visible, `DESIGN.md` para UI, verificación headless (`pnpm world up dev-app-web --detach -- --browser`, `seed.appWeb`).

## Desglose (sub-issues)

1. `01` — Visor/editor de documentos (Docs)
2. `02` — Presentaciones (Slides)
3. `03` — Hoja de cálculo verificable (Sheets)
4. `04` — Pizarra infinita (Whiteboard)
5. `05` — Paneles de datos con narrativa y trazabilidad (Data)
6. `06` — Sistema de temas/estilos transversal (Design)

## Referencias

- `../investigacion.md` (resumen ejecutivo, §5 patrones, §9 reglas, §10 fases)
- `../investigacion-web-funcionalidades.md` (§1 modelo común, §9 guía de replicación)
- `../analisis-repos-tecnologias.md` (opciones, licencias, roadmap)
- `../frames/` (29 capturas)

## Estimación

Épico: 8–12 semanas repartidas en los sub-issues. Orden sugerido: 06 (temas) → 01 (Docs) → 05 (Data) → 04 (Whiteboard) → 03 (Sheets) → 02 (Slides).
