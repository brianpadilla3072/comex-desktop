# Vocabulario de componentes (cerrado)

Regla de oro: dentro de `<main>` solo se usan estos componentes, copiando el snippet
tal cual y cambiando el contenido. Nada de `style="..."`, `<link>`, `<script>` propios,
CDN ni clases inventadas. Lo que no está acá, no existe. Cada componente indica cómo
degrada al exportar a Word (`.docx`), para que sepas qué va a quedar bien.

## Texto base

```html
<p>Párrafo con <strong>negrita</strong>, <em>cursiva</em> y <code>código</code>.</p>
<h2>Sección</h2> <h3>Subsección</h3> <h4>Sub-subsección</h4>
<ul><li>ítem</li></ul>          <!-- anidar con <ul> dentro del <li> -->
<ol><li>ítem numerado</li></ol>
<a href="https://ejemplo.org">texto del enlace</a>   <!-- se exporta como "texto (url)" -->
<span class="badge">Etiqueta</span>
<hr>
```
**Word:** títulos, listas, negritas y badges en negrita se mapean directo. El `<hr>` es línea horizontal.

## Tabla de datos — `.tabla-datos`

Reemplaza a las tablas ASCII de Markdown. Celdas numéricas con `class="num"` (alineado a la derecha).

```html
<table class="tabla-datos">
  <thead><tr><th>Año</th><th>Exportaciones (USD)</th></tr></thead>
  <tbody>
    <tr><td class="num">2023</td><td class="num">218.261.682</td></tr>
  </tbody>
</table>
```
**Word:** Tabla con encabezado sombreado, numerada ("Tabla N."), números a la derecha.

## Callouts — `.callout` (3 variantes)

```html
<div class="callout"><p><strong>Contexto:</strong> explicación breve.</p></div>
<div class="callout callout--alerta"><p>⚠ Riesgo detectado: verificar fuente.</p></div>
<div class="callout callout--fuente"><p>Fuente: UN Comtrade (consulta: nov-2026).</p></div>
```
**Word:** párrafos con sangría en cursiva (como las notas `Fuente:` actuales).

## KPIs — `.kpi-grid` (cifras clave arriba de todo)

```html
<div class="kpi-grid">
  <div class="kpi"><div class="kpi--valor">USD 218 M</div><div class="kpi--etiqueta">Exportaciones 2023</div></div>
  <div class="kpi"><div class="kpi--valor">+12,4 %</div><div class="kpi--etiqueta">Variación interanual</div></div>
</div>
```
**Word:** se exporta como tabla "Indicador | Valor".

## Pestañas — `.tabs` (comparar opciones/escenarios)

El caso estrella: N enfoques lado a lado sin scroll infinito. El número de `.tab`
en `.tabs-nav` debe coincidir con el de `.tab-panel` (mismo orden). El primer
`.tab` y el primer `.tab-panel` llevan `class="tab activo"` / `tab-panel activo`.

```html
<div class="tabs">
  <div class="tabs-nav">
    <button class="tab activo">Opción A</button>
    <button class="tab">Opción B</button>
  </div>
  <div class="tab-panel activo"><p>Ventajas de A…</p></div>
  <div class="tab-panel"><p>Ventajas de B…</p></div>
</div>
```
**Word:** cada pestaña se convierte en subsección "### Opción A", todo desplegado.

## Colapsables — `<details>` (material secundario largo)

```html
<details><summary>Metodología y supuestos</summary>
  <p>Detalle largo que no se quiere ver de entrada…</p>
</details>
```
**Word:** el `summary` pasa a título y el contenido queda desplegado.

## Código — `.codigo`

```html
<pre class="codigo">SELECT SUM(valor) FROM exportaciones WHERE año = 2023;</pre>
```
**Word:** líneas en tipografía monoespaciada.

## Figuras — `.figura` (imagen o SVG)

```html
<figure class="figura">
  <img src="grafico.png" alt="Descripción">
  <figcaption>Pie descriptivo de la figura</figcaption>
</figure>
```
SVGs simples (barras, paletas de color) van inline dentro del `<figure>`; Word no
conserva SVG → para exportar, convertir el gráfico a PNG primero.

**Word:** imagen centrada con "Figura N: pie" (solo con `<img>`; figcaption se pierde con SVG inline).

## Botón copiar-como-prompt — `.acciones` (interacción bidireccional)

Para tableros de parámetros: el usuario ajusta y se lleva el estado como prompt.

```html
<div id="estado"><p>Configuración actual: velocidad 120 px/s, tono #0b5c6b.</p></div>
<div class="acciones"><button class="copiar" data-destino="#estado">Copiar selección como prompt</button></div>
```
**Word:** se ignora (no tiene equivalente).

## Portada

No se toca el `<header class="doc-header">`: solo completar los atributos
`data-titulo`, `data-subtitulo`, `data-autor`, `data-materia`, `data-institucion`,
`data-tutor`, `data-fecha` (el `data-titulo` es obligatorio) y el texto del `<h1>`.

**Word:** genera la tapa del documento con esos campos.
