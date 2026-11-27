# Seguimiento — Completar y verificar la suite de artefactos tipo Office

**Título sugerido:** `[Feature] Completar y verificar la suite de artefactos tipo Office (P1-P4 + test E2E)`
**Labels sugeridas:** `feature`, `ux`, `comex`, `artifact`, `needs-design-review`
**Depende de:** `00-epico-artefactos-oficina`

> **Estado real (2026-11-24): P0–P4 INTEGRADOS; E2E Y CIERRE PENDIENTES.**
>
> El cuerpo original de este issue decía que solo P0 estaba fusionado. El comentario posterior
> registró P1–P4, y desde entonces se avanzó en Sheets, Docs y apertura desde Resultados. Este
> archivo sustituye ese estado viejo.

## Lo que ya está integrado

- [x] **P0 — Flag:** `comexArtifacts`, activo por defecto en self-hosted, apagado en cloud y
  bloqueable por el operador.
- [x] **P1 — Modelo y persistencia:** unión Zod `doc | slides | sheet | board | data`,
  `proyecto/artefactos/`, versiones inmutables, deduplicación, reversión y auditoría en metadatos.
- [x] **P2 — Shell:** header, cuerpo, acciones, visor Docs y visor Data. El dock inferior se
  eliminó y las acciones viven en el header.
- [x] **P3 — Integración:** pestaña `studio` persistida, apertura desde Resultados y auto-apertura
  de salidas `table` nuevas como hoja lateral.
- [x] **P4 — Split/foco:** `Maximizar artefacto` / `Mostrar chat` y restauración del ratio.
- [x] **Data:** resolución viva de paneles sobre el snapshot más reciente.
- [x] **Sheets:** Jspreadsheet CE, barra `fx`, pestañas, crecimiento, menús, CSV/JSON, fórmulas y
  14 herramientas del agente.
- [x] **Docs:** visor nativo MD/MDX y 15 herramientas `specialist_doc_*` registradas. Cubre
  bloques, formato, importación, renombre, archivo/borrado, comentarios, fuentes/citas, exportación
  Markdown/HTML/Word/PDF, versiones y control completo del visor.

## Lo que falta

- [ ] Ejecutar la guía E2E completa con `comexArtifacts` activo: crear → abrir → editar → guardar
  versión → descartar → exportar → cerrar/reabrir → recargar y verificar persistencia.
- [ ] Repetir el recorrido para `doc`, `slides`, `sheet`, `board` y `data`.
- [ ] Adjuntar capturas del shell con flag on/off y citar reglas de `DESIGN.md`.
- [ ] Completar los criterios de #2–#7; ninguno debe cerrarse solo por existencia del renderer.
- [ ] Revalidar la desviación de Sheets a Jspreadsheet CE y su licencia/paridad.
- [ ] Publicar `dev` cuando la verificación esté completa y el usuario lo autorice.

## Comando de verificación

```bash
pnpm --filter @openwork/app typecheck
pnpm --filter openwork-server typecheck
pnpm features:check
pnpm test:comex
```

La verificación visual debe usar la build self-host y una sesión aislada; no se debe abrir la
ventana del usuario para una prueba.

## Criterios de aceptación

- [ ] Apagado del flag sin pérdida de datos ni deploy.
- [x] Persistencia con versiones y auditoría de citas.
- [x] Doble gate cliente/servidor.
- [x] Pestaña `studio` y apertura de artefactos.
- [x] Split/foco y renderers por tipo funcionando a nivel base.
- [ ] Guía E2E ejecutada de punta a punta con evidencia adjunta.

## Verificación (2026-11-24)

- Ampliación Docs: 23 tests de server y 17 tests de app en verde; typechecks de app/server y
  build del servidor aprobados.
- Sesión Electron aislada: visor, edición, búsqueda, pantalla completa, comentarios, fuentes/citas
  y descargas reales de PDF/Word verificados. Capturas en `../doc-tools-controls.png` y
  `../doc-tools-comments.png`.
- Cuerpos de GitHub #1–#8 comparados con las especificaciones locales: sincronizados.
- `pnpm features:check` sigue fallando por `values.yaml` desactualizado; un control limpio en
  `HEAD` reproduce el mismo fallo. Es preexistente y no se modificó en este tramo.

## Referencias

- `00-epico-artefactos-oficina.md`
- `../diseno-artefactos.md`
- `../../../../proyecto/estado.md`
