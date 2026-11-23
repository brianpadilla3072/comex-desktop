# Visor Markdown/MDX para páginas del chat

Visores para las páginas del chat (pestañas de recurso `page`). No tienen flag:
están siempre disponibles y se usan solo si se quiere.

## Qué hace

La cabecera del editor de página muestra un conmutador **Editar / Vista previa**:

- `.md`, `.markdown` y `.mmd` se renderizan con el mismo `MarkdownPreview` que
  los artifacts (incluye Mermaid y matemáticas del renderer compartido).
- `.mdx` se renderiza con `MdxPreview`: se compila con `@mdx-js/mdx` en el
  navegador y se muestra en un iframe con `sandbox="allow-scripts"` (sin
  `allow-same-origin`, igual que el visor de artifacts). Si la compilación falla,
  el componente muestra el error y el contenido como Markdown.

El editor sigue siendo el modo inicial. `resourcePagePath` respeta `.mdx`,
`.markdown` y `.mmd` en vez de agregar `.md`, para que «Guardar página» conserve
la extensión elegida. El nombre por defecto de una página nueva sigue siendo
`paginas/Sin título.md`.

## Cómo usarlo

1. En una conversación, abrir `+` → Nueva página.
2. Escribir contenido Markdown y usar **Vista previa**: se ve el render.
3. Cambiar la ruta a `paginas/Prueba.mdx`, escribir MDX y usar **Vista previa**:
   se compila y renderiza.
4. Volver a **Editar**: el borrador se conserva sin cambios. Guardar escribe el
   archivo con la extensión indicada en la ruta.

## Límites

- El renderer MDX resuelve importaciones del documento desde `esm.sh`, por lo
  que requiere red para esos módulos; Markdown puro funciona sin red.
- El visor no valida que el `.mdx` sea seguro más allá del sandbox del iframe:
  el código del documento se ejecuta con `allow-scripts` en un origen opaco.
- Verificación hecha: `pnpm typecheck`, tests de estado de pestañas y un test de
  componente que comprueba el toggle y el renderer de Markdown/MDX. La
  comprobación visual en la app queda pendiente hasta el próximo reinicio.
