# Visor Markdown/MDX para páginas del chat (`chatPageMdMdxViewer`)

- **Flag:** `chatPageMdMdxViewer`
- **Deployments:** `self_hosted`
- **Default:** apagado (`false`)
- **Autor:** `brianpadilla3072`

## Qué cambia

Las pestañas de recurso tipo «página» del chat (`+` → Nueva página) siguen siendo
un editor de texto, pero con el flag encendido muestran un conmutador
**Editar / Vista previa** en la cabecera:

- `.md`, `.markdown` y `.mmd` se renderizan con el mismo `MarkdownPreview` que
  los artifacts (incluye Mermaid y matemáticas del renderer compartido).
- `.mdx` se renderiza con `MdxPreview`: se compila con `@mdx-js/mdx` en el
  navegador y se muestra en un iframe con `sandbox="allow-scripts"` (sin
  `allow-same-origin`, igual que el visor de artifacts). Si la compilación falla,
  el componente muestra el error y el contenido como Markdown.

Además, `resourcePagePath` ya no agrega `.md` a una ruta que termina en
`.mdx` (ni en `.markdown`/`.mmd`), para que «Guardar página» respete la
extensión elegida. El nombre por defecto de una página nueva sigue siendo
`paginas/Sin título.md`.

## Cómo probarlo

1. Encender el flag en el self-hosted: variable de operador
   `DEN_FEATURE_CHAT_PAGE_MD_MDX_VIEWER=true` al arrancar el servidor, o el
   botón correspondiente en `/admin` › Features.
2. En una conversación, abrir `+` → Nueva página.
3. Escribir contenido Markdown y usar **Vista previa**: se ve el render.
4. Cambiar la ruta a `paginas/Prueba.mdx`, escribir MDX (por ejemplo encabezados
   y un componente JSX simple) y usar **Vista previa**: se compila y renderiza.
5. Volver a **Editar**: el borrador se conserva sin cambios. Guardar escribe el
   archivo con la extensión indicada en la ruta.

## Apagado y seguridad del revert

Con el flag apagado no se agrega el conmutador y la página sigue siendo
solamente el editor de texto de antes: no hay cambio de comportamiento para
quien no lo enciende. No hay datos nuevos ni migraciones; una página guardada
como `.mdx` sigue siendo un archivo de texto plano y se puede editar con cualquier
herramienta. El visor MDX es de solo lectura: el iframe no tiene acceso al
origen de la app ni al puente de escritorio.

## Límites

- El renderer MDX resuelve importaciones del documento desde `esm.sh`, por lo
  que requiere red para esos módulos; Markdown puro funciona sin red.
- El visor no valida que el `.mdx` sea seguro más allá del sandbox del iframe:
  el código del documento se ejecuta con `allow-scripts` en un origen opaco.
- Verificación hecha: `pnpm typecheck`, `pnpm features:check`, pruebas de estado
  de pestañas y un test de componente que comprueba el toggle y el renderer de
  Markdown/MDX con el flag dentro y fuera. La comprobación visual en la app con
  el flag encendido queda pendiente hasta que el operador lo active; sin el flag
  el comportamiento es el de antes por diseño.
