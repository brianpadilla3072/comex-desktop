---
name: documento-docx
description: "Crear, editar y entregar documentos de Microsoft Word (.docx) — informes académicos, trabajos finales, cartas, presupuestos y documentos formales de comercio exterior. Usar SIEMPRE que se pida un archivo de Word, un .docx, un informe para entregar en la universidad, un trabajo final, un documento \"para imprimir\", \"con tapa\", \"en Word\", o cuando el entregable de un estudio de mercado o investigación tenga que ser un documento (no un markdown). También para convertir un informe existente a Word o para editar un .docx recibido."
---

# Documentos Word (docx)

Los trabajos universitarios y los entregables profesionales se entregan en Word, no en Markdown. El flujo del pack es: el informe se escribe una vez en Markdown (el `informe.md` de la carpeta del estudio) y se convierte a `.docx` con formato académico con el script incluido.

## Crear un documento nuevo

1. Escribir el contenido en Markdown (ver "Formato soportado" abajo). Si es un estudio del pack, usar el `informe.md` que ya genera la skill `estudio-mercado-internacional`.
2. Convertir:

   ```bash
   python3 scripts/informe_docx.py informe.md -o informe.docx --toc
   ```

3. Verificar el resultado (el script reabre el archivo y resume su contenido). Si hay LibreOffice disponible, se puede convertir a PDF para mirarlo: `soffice --headless --convert-to pdf informe.docx`.
4. Entregar el `.docx` (o el PDF si piden PDF: en Word, "Guardar como → PDF").

El script produce: tapa con título/autor/materia/institución/fecha, índice opcional (se actualiza en Word con clic derecho → Actualizar campo), títulos jerárquicos, tablas numeradas con encabezado resaltado, figuras con pie numerado, listas, notas "Fuente:" en cursiva, números alineados a la derecha y numeración de páginas. Formato base: A4, márgenes 2.5 cm, Times New Roman 12, interlineado 1.5 (configurable con `--font` y `--size`).

## Formato Markdown soportado

```markdown
---
titulo: Estudio de Mercado del Aceite de Oliva
subtitulo: Análisis de oportunidades en Brasil y Chile
autor: María Pérez
materia: Estudios de Mercados Internacionales
institucion: Universidad Ejemplo
tutor: Prof. Juan Gómez
fecha: Noviembre 2026
---

# Introducción            → Título 1
## Objetivos              → Título 2
Párrafos con **negrita**, *cursiva* y `código`.
- viñetas (2 espacios de indentación = subnivel)
1. listas numeradas
> Fuente: UN Comtrade (consulta: nov-2026)   → cursiva, para notas de fuente
| Año | Exportaciones (USD) |   → tablas (encabezado + fila de ---)
|---|---|
| 2023 | 218.261.682 |
![Pie de la figura](ruta/imagen.png)  → figura centrada con pie numerado
---                            → línea horizontal
```

El front matter (entre `---` al inicio) genera la tapa. Todo es opcional excepto `titulo`.

## Editar un documento existente

Para cambios chicos sobre un `.docx` que ya existe (agregar un párrafo, corregir un texto):

```python
from docx import Document
doc = Document("existente.docx")
doc.paragraphs[3].text = "texto corregido"   # o editar runs para conservar formato
doc.add_paragraph("Párrafo nuevo al final")
doc.save("existente.docx")
```

Para buscar texto en un docx complejo, recordar que Word parte el texto en muchos runs: leer `p.text` (texto completo del párrafo) en vez de buscar en el XML.

## PDF

- Si el destino es entregar/imprimir, el PDF se genera desde Word ("Guardar como → PDF") o con `soffice --headless --convert-to pdf archivo.docx` si hay LibreOffice.
- Si se necesita armar un PDF que no viene de un Word (formularios, PDFs combinados), eso es otro caso de uso: pedirlo explícitamente.

## Errores comunes a evitar

- No meter saltos de línea dentro de un párrafo: cada línea del Markdown genera un párrafo separado (así lo espera Word).
- Las imágenes: rutas relativas al archivo Markdown; verificar que existan antes de convertir (el script avisa si falta alguna).
- Toda tabla del documento conserva la nota "Fuente:" como párrafo debajo (regla de `investigacion-con-fuentes`): no quitarla.
- Un `.docx` de Word no es un archivo de texto: para leerlo usá `python-docx` o `pandoc -t markdown archivo.docx`, nunca `cat`.

## Entorno y control de entrega

En un proyecto Comex, el launcher está en `.opencode/scripts/documents.py`.
Si trabajás desde el pack original, usá `scripts/documents.py`.
En Windows el ejecutable puede ser `py -3` o `python`; en Linux/macOS, `python3`.

```bash
python3 .opencode/scripts/documents.py doctor
python3 .opencode/scripts/documents.py setup
python3 .opencode/scripts/documents.py run word -- informe.md -o informe.docx --toc
python3 .opencode/scripts/documents.py verify informe.docx
```

`setup` prepara un entorno privado en `~/.comex-pack/venv` con versiones fijadas;
`COMEX_PACK_HOME` permite elegir otra carpeta. No modifica Python del sistema.
La primera preparación requiere Python 3.10+, venv/pip y acceso a PyPI; con
`setup --wheelhouse CARPETA` usa exclusivamente wheels locales, sin red.
Si la app configura `COMEX_DOCUMENTS_PYTHON`, usar ese intérprete incluido: doctor
indica `pythonBundled=true` tras validar imports y versiones, y setup no modifica
ese runtime. Sin sidecar se necesita un Python disponible para el entorno privado.
No anunciar instalación Windows comprobada solo por pasar pruebas en Linux.

`verify` comprueba ZIP/XML, reabre el archivo, rechaza entregables vacíos y emite
SHA-256. La revisión visual sigue pendiente hasta renderizar o abrir el archivo.
No afirmar que el formato fue revisado visualmente solo porque `verify` pasó.
Las fórmulas de Excel requieren recálculo con Excel/LibreOffice; openpyxl no las calcula.
