# Prompt de análisis de referencias

Adaptado del prompt que Blinsky Tech publica en el comentario fijado de
“Cómo hacer VIDEOS con Claude | TUTORIAL”
(https://www.youtube.com/watch?v=yKSe25rx6gA). Los cambios son de este pack:
rutas, salida `style.json` y la exigencia de declarar el método real usado.

Se usa **un video por agente**. Si hay N referencias, se lanzan N análisis en
paralelo y después se consolida.

---

Analizá el video adjunto como referencia para planear un video animado
original. En esta etapa analizá la referencia: no escribas ni modifiques el
proyecto de animación, no generes imágenes, voz ni video.

## Antes de analizar

Comprobá primero si podés leer el video completo, interpretar imágenes cuadro
por cuadro y transcribir el audio. No instales nada si ya contás con esas
capacidades.

Herramientas de referencia, solo si hace falta cubrir una capacidad:

- **Lectura del archivo, metadatos y extracción de cuadros/audio**: FFmpeg con
  ffprobe, o equivalente local.
- **Interpretación visual**: un modelo o herramienta con visión que revise las
  imágenes extraídas en secuencia. FFmpeg extrae y convierte, no interpreta.
- **Transcripción de voz**: reconocimiento integrado, o Whisper local, si el
  video tiene narración y no podés transcribirla.
- **OCR**: Tesseract u otro equivalente solo si no podés leer con fiabilidad los
  textos en pantalla.

Revisá qué está instalado y qué capacidades ya tenés. Si falta algo, indicá la
herramienta mínima, su función y dónde se instala; pedí autorización antes de
instalarla. Verificá cualquier instalación y no agregues herramientas opcionales
por defecto. No subas el video a servicios externos o de pago sin autorización.
Si no se puede instalar o no se autoriza, pedí acceso al video, a la secuencia
de cuadros o a la transcripción que falte. **No presentes un análisis parcial
como cuadro por cuadro.**

Hacé una inspección literal de la secuencia completa a su frecuencia original,
no un muestreo aproximado de un cuadro por segundo. Registrá frecuencia,
duración y método de inspección. Si tu método real es otro (por ejemplo,
detección automática de cortes + keyframes leídos con visión), decilo con esas
palabras en la sección de límites.

No inventes detalles que no se vean o escuchen. Separ­á observaciones directas
de inferencias y marcá la confianza cuando algo sea ambiguo.

## Entrega

### Ubicación de los informes

- Guardá cada informe en la misma carpeta que contiene el video de referencia.
- Nombre: `<nombre-del-video>-analisis.md`. No sobrescribas un archivo
  existente: si ya existe, agregá `-v2`, `-v3`.
- Si no tenés permiso de escritura en esa carpeta, avisá y esperá instrucciones.
- El consolidado del conjunto va en `inspiracion/analisis-comparativo.md`.

### 1. Datos y narración

- Duración, resolución y frecuencia de cuadros.
- Transcripción con marcas de tiempo; distinguí voz, música y efectos; señalá
  palabras dudosas.
- Resumen del gancho, introducción, desarrollo, transiciones y cierre, y cómo se
  conectan.

### 2. Registro visual cuadro por cuadro

- Recorré los cuadros en orden y registrá los cambios observables. Podés agrupar
  cuadros consecutivos solo cuando la imagen y la acción sean esencialmente
  iguales, indicando rango de cuadros y tiempo; detallá cada cuadro donde cambie
  algo.
- Por grupo: número de cuadro y tiempo, texto en pantalla (transcripción literal,
  ubicación, aparición y desaparición), escena y elementos visibles, acción/pose,
  composición, color/iluminación y cambios relevantes.
- Movimientos de personajes, objetos, fondos y gráficos: qué se mueve, dirección,
  inicio/fin y duración aproximada.

### 3. Cortes, transiciones y cámara

- Cada corte con cuadro y marca de tiempo de entrada. Contá por separado cortes
  entre planos y transiciones (fundido, barrido, otras). No cuentes cambios de
  luz, textura, texto o movimiento como corte sin evidencia de cambio de plano.
- Cada evento de cámara por separado: inicio/fin, duración, tipo y dirección
  (paneo, inclinación, zoom, travelling, órbita, fija). Aclará si es observado o
  inferido; no afirmes parámetros que el video no permita comprobar.
- Totales: cuadros inspeccionados, cortes, transiciones, movimientos de cámara.
  Explicá el criterio de conteo y sus límites.

### 4. Ritmo y guía de estilo

- Cambios de ritmo, pausas, sincronía entre narración y visuales, momentos
  visuales importantes.
- Rasgos generales de animación, composición, color, tipografía y cámara que
  podrían inspirar una pieza original. No propongas copiar planos, personajes,
  textos, diseños ni recursos.

### 5. Límites y resumen

- Qué no se pudo verificar y por qué.
- Cierre con una síntesis útil para planear un guion y storyboard originales.

No escribas el guion ni empieces la producción hasta que te lo pidan.

---

## Salida extra de este pack

Además del informe, el agente que consolida escribe `inspiracion/style.json` con
el esquema de `video-studio/templates/style.schema.json`. Cada análisis debe
dejar los números crudos que alimentan ese archivo:

- cortes totales, duración y cortes por minuto;
- duración media de plano y del pattern interrupt;
- paleta observada (hex aproximados, con el método usado);
- tipografía (familia estimada, peso, tamaño relativo, entrada/salida);
- SFX por minuto y BPM estimado si hay música;
- relación habla/silencio.
