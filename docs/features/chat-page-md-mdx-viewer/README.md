# Visor nativo de Markdown/MDX

Visores integrados para artefactos `doc`, páginas del chat y archivos `.md`,
`.mdx` y `.mmd` abiertos desde el workspace. No tienen flag: están siempre
disponibles y se usan solo si se quiere.

## Qué hace

Una sola vista, `DocView`, para los tres formatos. No usa iframe, `eval` ni
`esm.sh`: el Markdown se dibuja con el renderer compartido de la app y el MDX se
convierte primero a Markdown con `mdxToMarkdown` (parseo con `remark-parse` +
`remark-mdx`, serialización con `mdast-util-to-markdown`).

En MDX:

- se descartan `import`/`export` (código que requeriría ejecución y red);
- el contenido de los componentes JSX se desempaqueta y se muestra como texto;
- las expresiones se muestran como texto literal (`` `{1 + 1}` ``), nunca se
  evalúan.

La toolbar, en español, tiene Vista previa/Editar, alejar/zoom/acercar, ajustar
líneas, tema claro/oscuro, índice de títulos, buscar, restablecer, copiar,
descargar y pantalla completa. El tema del visor es propio: si la app está en
modo oscuro, un documento claro sigue siendo texto oscuro sobre fondo blanco
(`doc-view.css` fija `--foreground`, `--muted-foreground` y los colores de
Shiki dentro del contenedor).

## Herramientas del agente

La familia `specialist_doc_*` trabaja sobre artefactos `doc` con el mismo
modelo que `specialist_sheet_*`:

| Tool | Uso |
| --- | --- |
| `specialist_doc_list` | lista documentos del proyecto |
| `specialist_doc_create` | crea uno con título, contenido y formato `md`/`mdx` |
| `specialist_doc_read` | lee líneas y el índice de títulos |
| `specialist_doc_write` | reemplaza, inserta, repara o agrega líneas (nueva versión) |
| `specialist_doc_find` | busca texto o regex y devuelve línea y contenido |
| `specialist_doc_export` | exporta el texto completo con su formato |
| `specialist_doc_versions` | lista versiones o recupera una |
| `specialist_doc_view` | cambia tema, zoom, ajuste de líneas, índice o desplazamiento |

Los cambios de contenido guardan una versión nueva; los de vista viven en
`metadata.viewer` y no crean versión. La app refleja el estado de
`specialist_doc_view` al actualizar el artefacto (15 s como máximo).

## Cómo usarlo

1. En una conversación, abrir `+` → Nueva página.
2. Escribir Markdown y usar **Vista previa**: se ve el render.
3. Cambiar la ruta a `paginas/Prueba.mdx`, escribir MDX y usar **Vista previa**:
   se muestra el contenido, sin ejecutar componentes.
4. Volver a **Editar**: el borrador se conserva sin cambios. Guardar escribe el
   archivo con la extensión indicada en la ruta.

## Límites

- Los componentes MDX no se ejecutan: solo sobrevive su contenido textual. El
  código fuente completo se conserva en el archivo y en la descarga.
- El visor depende del renderer de Markdown de la app para Mermaid y
  matemáticas; no carga módulos externos.
- Verificado: `pnpm --filter @openwork/app typecheck`, tests de
  `mdx-to-markdown` y del toggle del chat, `bun test` de `doc-tools`, y
  comprobación visual en Electron: texto `rgb(30,41,59)` sobre
  `rgb(255,255,255)` en modo claro y `rgb(226,232,240)` sobre
  `rgb(15,23,42)` en modo oscuro, con la app en tema oscuro.
