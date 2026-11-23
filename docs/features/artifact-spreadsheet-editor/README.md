# Editor de hojas de cálculo de artefactos

Los artefactos de tipo `sheet` se abren siempre en una hoja de cálculo tipo Excel con
**Jspreadsheet CE** (MIT), en lugar de la grilla HTML de solo lectura. No hay flag: es el
único renderizador de hojas.

## Qué hace

Celdas editables, navegación por teclado, copiar/pegar desde Excel, fórmulas (`=SUM(...)`),
redimensionado de columnas, varias hojas y una barra de herramientas. El nombre del archivo y
el contenido se guardan como una nueva versión del artefacto.

## Cómo probarlo

1. Abrí una conversación con un artefacto `sheet` (p. ej. «Exportaciones de ejemplo (demo)»).
2. Editá una celda, agregá una fila o pegá un rango desde Excel. Los cambios se guardan en el
   artefacto.

## Antigua key de flag

`artifactSpreadsheetEditor` existió brevemente y ya no existe: está en `RETIRED_FEATURE_KEYS`
para que clients y overrides viejos se ignoren sin efecto. El editor siempre está activo.

## Captura

Pendiente de capturar en una máquina con display usable (el sandbox de desarrollo no tiene GPU
para Electron). La mejora es visual: la hoja pasa de grilla estática a hoja interactiva.
