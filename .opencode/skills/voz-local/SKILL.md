---
name: voz-local
description: "Generar voz con TTS local y clonar una voz propia para narraciones de video. Usar SIEMPRE que se pida 'cloná mi voz', 'generá la voz', 'narración con IA', 'voice over', 'TTS local', 'poné esta voz', 'decí este texto con mi voz' o cuando video-studio necesite las líneas de voz de un storyboard. Incluye perfil de voz, consentimiento, generación por línea y normalización de audio."
---

# Voz local

TTS local con clonación. La voz se genera **por línea**, se mide y se normaliza;
el video se arma después con esas duraciones reales.

## Motor

| Motor | Licencia | Clonación | CPU | Estado |
|---|---|---|---|---|
| **Kokoro-82M** | Apache 2.0 | No | Sí, rápido | Voz rápida sin clonar |
| **Chatterbox Multilingual V3** | MIT | ~10 s | Sí, lento | Recomendado para clonar |
| ZONOS3-Mini | Apache 2.0 | hasta 60 s | Probar | Alternativa |
| Qwen3-TTS | Apache 2.0 | ~3 s | Necesita GPU | Si hay GPU |
| XTTS-v2 / F5-TTS | No comercial | Sí | — | No usar si se vende |

Chatterbox incrusta un watermark PerTh en cada salida. Es una marca de
procedencia: no se oculta.

## Requisitos

- Python 3.12 con `torch`, `torchaudio` y `chatterbox-tts`.
- `ffmpeg` y `ffprobe` en el PATH (normalización y duración).
- Modelos en `TTS_HOME` (por defecto `%LOCALAPPDATA%\openwork-tts` en Windows,
  `~/.openwork-tts` en Linux/macOS).

Verificá sin instalar nada:

```bash
python .opencode/skills/voz-local/scripts/check_env.py
```

Si falta algo, el script imprime el comando exacto. No sigas con `ready: false`.

## Perfil de voz

```
voices/<nombre>/
├── referencia.wav     # 10–30 s, una persona, sin música
├── referencia.txt     # transcripción (si el motor la pide)
├── consentimiento.md  # firmado por la persona
└── perfil.json
```

- Grabá en lugar silencioso, sin reverberación, a 30–40 cm del micrófono.
- Normalizá la referencia: mono, 48 kHz, `loudnorm`.
- Sin `consentimiento.md` no se genera nada. No se clonan voces de terceros.

## Voz rápida sin clonar (Kokoro)

Cuando no hace falta clonar, Kokoro es mucho más rápido en CPU. Instalación:
`pip install kokoro-onnx soundfile` + `kokoro-v1.0.onnx` y `voices-v1.0.bin`.
Para español instalá `espeak-ng` (G2P); si falta, pronuncia mal.

```bash
python .opencode/skills/voz-local/scripts/kokoro.py \
  --text "Texto de prueba." \
  --voice ef_dora \
  --lang es \
  --out voz.wav
```

Batch:

```bash
python .opencode/skills/voz-local/scripts/kokoro.py \
  --lines assets/audio/lines.json \
  --outdir assets/audio/voice
```

Los modelos se buscan en `TTS_HOME/kokoro` (`%LOCALAPPDATA%\openwork-tts\kokoro` en
Windows); podés pasar `--model-dir`, `--model` y `--voices`.

Elegí una voz `es_*` del listado de Kokoro. Kokoro **no clona**: para clonar usá
Chatterbox con `referencia.wav`. En ambos casos, generá por línea y medí
duraciones antes de fijar las escenas.

## Generar una línea

```bash
python .opencode/skills/voz-local/scripts/tts.py \
  --voice voices/erik/referencia.wav \
  --text "Hola, esto es una prueba de mi voz clonada." \
  --out assets/audio/voice/l1.wav \
  --lang es
```

## Generar un storyboard completo

`lines.json`:

```json
[
  { "id": "l1", "text": "Primera línea.", "exaggeration": 0.5 },
  { "id": "l2", "text": "Segunda línea.", "exaggeration": 0.7 }
]
```

```bash
python .opencode/skills/voz-local/scripts/tts.py \
  --profile voices/erik/perfil.json \
  --lines lines.json \
  --outdir assets/audio/voice
```

Genera `l1.wav`, `l2.wav` y `durations.json` con `{ id, file, durationSeconds,
hash }` y el total. Cargá el modelo una sola vez.

- `--profile` toma `engine`, `language`, `reference`, `exaggeration` y
  `cfgWeight` del `perfil.json`; podés pisarlos con los flags.
- Exige `consentimiento.md` junto a la referencia (o `--consent <ruta>`).
- Cachea por hash: si el texto, la voz y los parámetros no cambian, salta la
  línea. `--force` regenera todo.

## Grabación desde la app

El botón **Grabar referencia de voz** del menú “+” del compositor guarda
`voices/<nombre>/referencia.webm` + `consentimiento.md`. Para dejarla lista:

```bash
python .opencode/skills/voz-local/scripts/import_recording.py \
  --input voices/<nombre>/referencia.webm
```

Convierte a WAV 48 kHz mono, normaliza a −16 LUFS, verifica la duración (8–40 s)
y crea `perfil.json` si falta. Si no existe `consentimiento.md`, falla: no se
importa una voz sin permiso.

## Normalizar

```bash
python .opencode/skills/voz-local/scripts/normalize.py \
  --in assets/audio/voice/l1.wav \
  --out assets/audio/voice/l1-norm.wav \
  --lufs -16
```

Objetivo de voz: −16 LUFS, true peak −1.5 dBTP, mono 48 kHz. Música: −20 LUFS.
La música se duckea bajo la voz.

## QA

1. `durations.json`: suma y comparación con la duración del video.
2. Loudness dentro del objetivo (si hay `ffmpeg`, `ebur128`).
3. Escuchar una línea al azar: pronunciación, cortes, respiración.
4. Confirmar que no se clonó a nadie sin consentimiento.

### Verificar sin oír (ASR)

Cuando el agente no puede escuchar, no alcanza con mirar la duración: una línea
puede quedar truncada o decir otra cosa y el número no lo delata. Transcribí y
compará con el guion:

```powershell
ffmpeg -y -v error -i assets/audio/voice/b2.wav -ar 16000 -ac 1 qa/asr/b2.wav
whisper-cli -m <ruta>\ggml-base.bin -l es -nt -np -f qa/asr/b2.wav
```

- El WAV **tiene que ser 16 kHz mono**: whisper.cpp no lee 48 kHz.
- `ggml-base` alcanza para detectar una palabra faltante; para acentos
  regionales conviene `ggml-medium`. El modelo no es el mismo en todas las
  máquinas: `check_env.py` muestra si hay whisper y dónde.
- Si el ASR devuelve una frase incompleta, la línea está truncada: regenerala
  con `--force` y volvé a medir.
- El ASR no valida pronunciación ni intención, solo contenido. Una voz que dice
  el texto correcto puede sonar plana: eso lo decide la persona.

## Límites

- En CPU (Ryzen 5700G, sin NVIDIA) Chatterbox multilingual es lento: generá por
  línea, cacheá y no rehagas todo por un cambio de texto.
- No imita emociones de una referencia; el control es `exaggeration` + el texto.
- No separa voces de una grabación con música; la referencia debe ser limpia.
- No reemplaza a un actor para una marca registrada sin autorización.

## Encadenamiento

- `video-studio` → consume `durations.json` y los WAV.
- `captura-y-documenta` → no; esa es para capturas.
- `documento-docx` → si además hay guion escrito.
