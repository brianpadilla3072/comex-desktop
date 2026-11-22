---
name: describir-imagen-sin-vision
description: Describe imágenes cuando el modelo actual no puede verlas, usando OCR o un modelo con visión y devolviendo solo texto al orquestador. Viene instalada por defecto; multiplataforma (Linux/macOS/Windows); pide permiso al usuario antes de instalar el fallback de visión con diálogo nativo del SO.
---

# Describir imagen sin visión (fallback)

Usar esta skill cuando:
- El usuario adjuntó una imagen pero el modelo actual no soporta entrada de imagen (error tipo "this model does not support image input").
- Hay que "leer" o entender una captura, diagrama, foto o UI y no hay visión disponible en el modelo activo.

**Objetivo:** obtener una descripción textual útil, minimizar tokens del orquestador y liberar memoria si se usó un modelo local.

**Estado:** skill instalada por defecto en el sistema y **multiplataforma (Linux, macOS, Windows)**. **Nunca instala nada por su cuenta**: solo detecta y, si falta el fallback de visión, **le pregunta al usuario** si quiere instalarlo. La elevación de privilegios usa siempre el **diálogo nativo del SO**; la contraseña nunca pasa por el chat ni por la skill.

## Entrada
- Ruta del archivo de imagen (idealmente la copia en workspace, ej. `.openwork/inbox/chat-attachments/.../image.png`). Si el usuario solo pegó/adjuntó sin ruta clara, buscá el adjunto más reciente en `.openwork/inbox/chat-attachments/`.

## Setup (detección automática, sin instalar)
Esta skill trae scripts junto a este archivo. **Antes de aplicar el flujo**, ejecutá el detector (barato, idempotente, multiplataforma):

```bash
# Ruta = carpeta donde vive este SKILL.md (.opencode/skills/describir-imagen-sin-vision/)
bash "<SKILL_DIR>/setup.sh"
```

- `setup.sh` **solo detecta** SO, RAM (`MemAvailable`), `tesseract`, `ollama` y `moondream`; escribe `.setup-status` con un `mode`:
  - `ocr-only` → RAM < 3 GB: usar solo OCR (paso 2); NO cargar modelos locales de visión.
  - `ocr+vision` / `vision` → hay RAM para visión local bajo demanda (paso 3).
  - `manual-text` → ni OCR ni visión: pedir texto/alternativas (paso 4).
- Si algo falta, el script imprime los comandos sugeridos **para el SO detectado**, pero **no los ejecuta**.
- **Pedir permiso antes de instalar:** si hace falta visión y `ollama`/`moondream` están ausentes, preguntar: *"¿Querés instalar el fallback de visión (ollama + moondream, ~1.7 GB)? Se pedirá tu contraseña en el diálogo del sistema."* Solo si dice que sí, ejecutar los comandos. Nunca instalar sin consentimiento.

## Instalación multiplataforma (solo con permiso del usuario)

### Elevación con diálogo nativo (la contraseña NUNCA pasa por el chat)
| SO | Helper incluido | Diálogo |
|----|-----------------|---------|
| Linux | `bash "<SKILL_DIR>/elevate.sh" <comando>` | polkit (GNOME/KDE), o `sudo` en terminal si no hay sesión gráfica |
| macOS | `bash "<SKILL_DIR>/elevate.sh" <comando>` | `osascript ... with administrator privileges` |
| Windows | `powershell -ExecutionPolicy Bypass -File "<SKILL_DIR>/elevate.ps1" <comando>` | UAC (`Start-Process -Verb RunAs`) |

- **Nunca** pedir la contraseña por chat ni guardarla en archivos: se introduce en el diálogo del sistema.

### Comandos de instalación por SO (los imprime `setup.sh`)
- **Linux / WSL:** OCR `sudo apt install tesseract-ocr tesseract-ocr-spa` (dnf/pacman en otras distros); visión `curl -fsSL https://ollama.com/install.sh | sh`; modelo `ollama pull moondream`. Para que la contraseña aparezca en diálogo: `bash "<SKILL_DIR>/elevate.sh" bash -c 'curl -fsSL https://ollama.com/install.sh | sh'`.
- **macOS:** OCR `brew install tesseract tesseract-lang`; visión `brew install ollama` (o Ollama.app desde ollama.com); modelo `ollama pull moondream`.
- **Windows:** OCR `winget install UB-Mannheim.TesseractOCR`; visión `winget install Ollama.Ollama`; modelo `ollama pull moondream`. Para UAC: `powershell -ExecutionPolicy Bypass -File "<SKILL_DIR>/elevate.ps1" winget ...`.

## Flujo recomendado (en orden)

### 1) Intentar delegar a un modelo con visión de OpenCode (preferido)
Sirve para no cargar modelos locales y para "describir y volver al orquestador".

1. Buscar modelos con capacidad de visión disponibles:
   - En Code Mode: `tools.opencode.models({ query: "vision" })` y/o `tools.opencode.models({})` y revisar nombres/IDs que indiquen visión (p. ej. vision, multimodal, gpt-4o, claude con imagen, gemini, llava, moondream, nemotron vl, etc. según proveedor).
   - Si está disponible, también `tools["vaultwarden-ops"].list_chat_models()` para ver opciones del runtime.
2. Elegir el modelo de visión de **menor costo pero buena respuesta** entre los disponibles (priorizar menor costo/tamaño y que soporte bien OCR/UI/texto; en duda, preferir el más liviano habilitado del mismo entorno).
3. Lanzar un subagente **solo para describir** (no para razonar la tarea completa):
   - `subagent` con `agent: "general"` (o el más simple disponible) y `model: "<provider/model>"` elegido.
   - Prompt claro y acotado, por ejemplo:
     - "Describe con precisión y de forma concisa la imagen en esta ruta: `<RUTA>`. Incluí: texto visible (transcríbelo), elementos UI, errores/mensajes, datos relevantes y contexto. No des consejos ni hagas tareas adicionales; devolvé solo la descripción."
   - Pedí respuesta breve y estructurada.
4. Tomar la descripción devuelta, **no cambiar el modelo del chat principal** (no usar `set_chat_model` salvo que el usuario lo pida). El orquestador continúa con ese texto.

> Nota: si ningún modelo con visión está habilitado/disponible o falla (p. ej. cuota), pasar al siguiente paso.

### 2) OCR rápido/local de muy bajo costo (si aplica)
Para capturas con texto legible (UI, formularios, errores, código, documentos), probar OCR antes de cargar un modelo de visión pesado.

1. Verificar si hay OCR disponible: `tesseract --version` (o `which tesseract`).
2. Si está disponible, ejecutar (proceso one-shot, impacto de RAM casi nulo):
   - `tesseract "<RUTA>" stdout -l spa+eng` (ajustar idiomas según contenido; usar ruta absoluta si hay dudas).
   - (Opcional) medir memoria antes/después con `free -h` / `grep MemAvailable /proc/meminfo` para confirmar.
3. Evaluar resultado:
   - Si el texto extraído es suficiente para la tarea, devolverlo al orquestador (puede incluirse una nota breve de que proviene de OCR).
   - Si la imagen es principalmente visual (foto, diagrama sin texto útil) o el OCR es pobre/incompleto, continuar con el fallback de modelo de visión.

### 3) Fallback: modelo local de visión en memoria (solo si hace falta y el usuario aceptó instalarlo)
Usar solo cuando no haya modelo de visión accesible por OpenCode, el OCR no sea suficiente **y** haya visión local disponible (instalada con consentimiento del usuario). La idea es **verificar memoria disponible**, cargar, describir y **liberar memoria**.

#### Modelo recomendado (mejor balance costo/respuesta)
- **Por defecto: `moondream` (Moondream2, p. ej. tag `moondream` en Ollama)** — muy liviano (~1.6B), ~1.5–3 GB de RAM en uso, descarga ~1.7 GB aprox., rápido y con buena calidad para descripción general, capturas/UI y texto visible. Es la opción de menor costo que suele responder mejor en equipos modestos.
- **Si se necesita más calidad** y hay RAM de sobra: `minicpm-v` (~8B, ~5–6 GB) o `llama3.2-vision` pequeño; usar solo si `moondream` no alcanza.
- **Evitar por costo** modelos grandes (7B–11B+) salvo necesidad clara.

#### Pasos
1. **Verificar memoria disponible (obligatorio antes de cargar):**
   - Linux: `free -h` y/o `grep MemAvailable /proc/meminfo`; macOS: `memory_pressure`; Windows: `Get-Counter '\Memory\Available MBytes'` o Administrador de tareas.
   - Comparar con el requerimiento estimado del modelo elegido:
     - `moondream`: ideal ≥ **3 GB** disponibles (mínimo razonable ~2 GB, con riesgo de swap/lentitud si hay menos).
     - `minicpm-v`/visiones pequeñas: ≥ **6 GB** disponibles.
   - Si la memoria disponible es insuficiente: **no cargar** el modelo; avisar al usuario, sugerir cerrar procesos, elegir un modelo más chico o usar alternativas (pegar texto/OCR). Si hay margen justo, advertir posible lentitud/swap.
   - (Opcional) Registrar un snapshot antes: `free -h` para comparar después.

2. **Detectar herramientas locales** (en orden de preferencia):
   - `ollama` instalado: `ollama list` → ver si ya hay un modelo de visión (priorizar `moondream` si está).
   - Otros CLIs locales de visión si existen (p. ej. `llama-mtmd-cli`).

3. **Elegir modelo:**
   - Si ya hay uno liviano instalado y cabe en memoria, usarlo.
   - Si no hay ninguno, **preguntar al usuario** si quiere instalar `moondream` (informar tamaño ~1.7 GB y RAM ~1.5–3 GB) y esperar confirmación antes de `ollama pull moondream`.

4. **Ejecutar descripción** y capturar salida a texto (timeout prudente). Ejemplo con Ollama, **forzando liberación al terminar**:
   - `OLLAMA_KEEP_ALIVE=0 ollama run moondream "Describe con precisión y de forma concisa esta imagen. Transcribe todo el texto visible. Menciona UI, errores y datos relevantes." <RUTA>`

5. **Liberar memoria (obligatorio al terminar) y verificar:**
   - `OLLAMA_KEEP_ALIVE=0` evita que el servicio mantenga el modelo cargado tras responder (Ollama por defecto puede retenerlo ~5 min).
   - Si por alguna razón quedó cargado, detenerlo explícitamente si es seguro: `ollama stop moondream`.
   - Confirmar que no quede el runner cargado: `ollama ps` (debería estar vacío o sin el modelo) y/o verificar que el proceso terminó.
   - **Verificar memoria liberada:** ejecutar `free -h` (o equivalente del SO) y comparar con el snapshot previo; la memoria disponible debería recuperarse de forma apreciable tras la descarga del modelo.
   - Con CLIs one-shot (proceso único), la RAM se libera al terminar el proceso; aun así conviene verificar si hubo dudas de swap.

6. Entregar la descripción textual al orquestador y continuar la tarea original.

### 4) Si no hay ninguna opción viable
- Informar claramente: modelo sin visión, sin OCR útil/disponible y sin runtime local de visión (o RAM insuficiente).
- Ofrecer alternativas: pegar/transcribir el contenido, instalar OCR (según SO), habilitar un modelo con visión en OpenCode, o instalar `ollama` + `moondream` **si el usuario lo autoriza** y hay memoria suficiente.

## Criterios de calidad de la descripción
- Transcribir **texto visible** tal cual cuando sea relevante (errores, labels, código).
- Mencionar layout/UI si es captura (botones, campos, estado, alertas).
- Ser conciso pero completo para que el orquestador no necesite "ver" la imagen.
- No inventar detalles no visibles; indicar incertidumbre si algo no se distingue.

## Ahorro de tokens y recursos
- Delegar a subagente/modelo de visión **solo la descripción** y devolver un resumen corto.
- No repetir la imagen ni el análisis largo en el hilo principal; pasar únicamente el texto resultante.
- **Setup = solo detección:** ejecutar `setup.sh` al usar la skill y respetar el `mode` resultante.
- **Instalar el fallback solo con permiso:** si falta ollama/moondream, preguntar al usuario antes de instalar; nunca hacerlo automáticamente.
- **Elevación multiplataforma con diálogo nativo:** `elevate.sh` (Linux/macOS) y `elevate.ps1` (Windows UAC); la contraseña nunca pasa por el chat ni se guarda.
- **Probar OCR (Tesseract) primero** en imágenes con texto/UI: costo de RAM casi nulo y proceso one-shot.
- **Antes de cargar un modelo local:** verificar memoria disponible; no ejecutar si no hay RAM suficiente.
- Preferir `moondream` + `OLLAMA_KEEP_ALIVE=0` como fallback de visión por defecto (menor costo/RAM con buena respuesta).
- **Después de usar modelo local:** detener/descargar el modelo (`ollama stop` si aplica) y verificar que la memoria se liberó.
- Volver al modelo/orquestador original para el razonamiento y la respuesta final.
