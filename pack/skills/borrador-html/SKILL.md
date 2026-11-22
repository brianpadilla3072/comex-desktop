---
name: borrador-html
description: "Borrador visual en HTML para todo contenido extenso antes de hacerlo documento final: informes, propuestas, comparaciones, análisis con tablas y KPIs. Usar SIEMPRE que se pida redactar algo largo o visual (informe, estudio, propuesta comercial, comparativa de opciones) ANTES de generar un .docx: el HTML se revisa en el navegador en segundos y se exporta a Word solo cuando el usuario esté conforme. No usar cuando el entregable sea un .md de trabajo, código, o algo corto que se responde en el chat."
---

# Borrador HTML (antes que Word)

Markdown de más de 100 líneas es pesado de leer y obliga a parches (diagramas ASCII,
tablas que desbordan). La técnica del pack: el contenido extenso se borra primero en
**HTML con diseño preestablecido** — una plantilla con el CSS congelado y un
vocabulario cerrado de componentes. El modelo solo redacta; el diseño ya existe.
Cuando el usuario confirma, se exporta a Word con el formato académico/profesional
ya probado (`documento-docx`).

## Flujo

1. **Crear el borrador**: copiar `templates/base-informe.html` a la carpeta del
   trabajo (ej. `estudio/borrador.html`) y escribir SOLO dentro de `<main>`,
   completando los `data-*` del `<header>` (portada).
   - Usar únicamente los componentes de `references/componentes.md`.
   - Prohibido: tocar `<head>`/`<style>`/`<script>` del template, atributos
     `style=""`, clases inventadas, `<link>`, CDNs, `http(s)` en imágenes.
2. **Validar antes de mostrar**: `python3 scripts/validar_html.py borrador.html`.
   Si falla, corregir con los componentes del vocabulario (no "parchar" con
   inline styles).
3. **Mostrar**: pasarle al usuario el path del HTML (lo abre en el navegador).
   Iterar los cambios sobre el mismo archivo — el diff es solo contenido.
4. **Exportar SOLO a pedido** ("pasalo a Word", "exportá", "está conforme"):
   ```bash
   python3 scripts/html_a_docx.py borrador.html -o final.docx --toc
   ```
   El Word sale con tapa, índice, tablas numeradas y fuentes en cursiva, con el
   formato de `documento-docx/scripts/informe_docx.py`. Requiere python-docx
   (`bash instalar.sh`).

## Qué elegir según el caso (del video → práctica)

- Comparar 2+ opciones/escenarios → `.tabs` (en Word se despliegan como subsecciones)
- Cifras clave → `.kpi-grid` arriba de todo
- Detalle secundario largo → `<details>` (metodología, apéndice)
- Nota "Fuente: ..." → `.callout--fuente` (cursiva en Word, como siempre)
- Advertencias → `.callout--alerta`
- Parámetros ajustables que el usuario devuelve como prompt → bloque `#estado`
  + botón `.copiar` (solo en HTML; no se exporta)

## Reglas anti-rotura

- El `<head>` es intocable: si el usuario pide "cambiá el color corporativo",
  se editan las variables de `:root` del template base, no del borrador.
- Lo que no está en `references/componentes.md` no se usa: el validador lo
  rechaza y el exportador no lo convertiría.
- Gráficos: SVG inline queda lindo en el navegador pero Word lo pierde → si el
  entregable final es .docx, generar la variante PNG (`<img src="grafico.png">`).
- El .md intermedio de la exportación se puede inspeccionar con `--keep-md`
  cuando el Word sale raro (diagnostica el mapeo, no el formato).
