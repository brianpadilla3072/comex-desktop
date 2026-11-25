# Herramientas del video local

Windows, CPU, sin nube. Verificá con `scripts/check_env.mjs`; si falta algo, se
dice y se instala. No se reemplaza con placeholders.

## Instalación (una vez)

```powershell
# Base
winget install Gyan.FFmpeg
winget install OpenJS.NodeJS.LTS

# Subtítulos: whisper.cpp (MIT). Bajar whisper-bin-x64.zip y el modelo
# https://github.com/ggml-org/whisper.cpp/releases
# https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin
# v1.6 usa main.exe; builds nuevas, whisper-cli.exe. Pasá --whisper si no está en PATH.

# Assets vectoriales
pip install vtracer
cargo install resvg --locked   # queda en %USERPROFILE%\.cargo\bin\resvg.exe
# override: OPENWORK_RESVG

# Recorte de fondos (u2net; el modelo por defecto pide licencia paga)
pip install "rembg[cpu,cli]"
# Si Chatterbox comparte este Python, rembg sube numpy y lo rompe: usá un venv
# aparte y el script lo detecta solo (override: OPENWORK_REMBG).
python -m venv %LOCALAPPDATA%\openwork-tts\rembg-venv
%LOCALAPPDATA%\openwork-tts\rembg-venv\Scripts\python -m pip install "rembg[cpu,cli]"

# Voz rápida sin clonar (Kokoro, Apache-2.0)
pip install kokoro-onnx soundfile
# kokoro-v1.0.onnx + voices-v1.0.bin de github.com/thewh1teagle/kokoro-onnx/releases
# Español: instalar espeak-ng (G2P); si no, pronuncia mal.
```

Opcional, solo con GPU o mucha paciencia: `stable-diffusion.cpp` (SD1.5 + LCM;
SD3/Flux en CPU son horas).

## Comandos

```powershell
# Subtítulos desde un video/audio
ffmpeg -i entrada.mp4 -vn -ac 1 -ar 16000 audio.wav
whisper-cli -m ggml-medium.bin -l es -osrt -f audio.wav

# Assets
rembg i -m u2net foto.png recorte.png
vtracer --input recorte.png --output recorte.svg --preset poster
resvg recorte.svg recorte-2x.png -z 2

# Voz rápida (sin clonar)
python -c "from kokoro_onnx import Kokoro; k=Kokoro('kokoro-v1.0.onnx','voices-v1.0.bin'); s, sr = k.create('Texto de prueba.', voice='ef_dora', lang='es'); import soundfile as sf; sf.write('voz.wav', s, sr)"

# Render
cd remotion
npm run still
npm run render

# QA
ffprobe -v error -show_entries format=duration:stream=width,height,r_frame_rate -of json ..\renders\final.mp4
ffmpeg -i ..\renders\final.mp4 -af ebur128 -f null - 2>&1 | Select-String "I:"
```

## Licencias

| Tema | Regla |
|---|---|
| Remotion | Gratis para individuo o empresa de ≤3 empleados; 4+ requiere licencia |
| rembg | Código MIT; el modelo `bria-rmbg` pide licencia comercial: usar `-m u2net` |
| MusicGen | Pesos CC-BY-NC: no usar si el video se vende |
| Piper | GPL-3.0 desde 2025 |
| Voz clonada | Solo la propia, con `consentimiento.md` |
| Contenido ajeno | Se copia gramática (ritmo, color, estructura), nunca personaje, guion ni audio |

## Problemas típicos

| Síntoma | Causa y salida |
|---|---|
| `whisper-cli` no arranca | Falta el `.bin` o el `.dll` junto al `.exe`: bajar el zip completo |
| Kokoro pronuncia mal el español | Falta `espeak-ng` (G2P) |
| rembg cambia el resultado | Está usando `bria-rmbg`: fijar `-m u2net` |
| `resvg` no encuentra fuentes | No soporta fuentes embebidas: instalar las fuentes en Windows |
| SD en CPU tarda horas | Bajar a SD1.5 + LCM o esperar GPU |
| Render lento | Sin GPU es CPU puro: bajar resolución de prueba, no la final |
| El video no engancha | Comparar cortes/min, cambios de texto y SFX contra `style.json` |

## Qué NO promete

- Video generativo (Sora/Veo/Kling): no existe local.
- 3D con física o live action.
- Música con IA sin GPU (ACE-Step pide ~4 GB de VRAM).
- Animación expresiva cuadro a cuadro: Remotion compone capas, no actúa.
