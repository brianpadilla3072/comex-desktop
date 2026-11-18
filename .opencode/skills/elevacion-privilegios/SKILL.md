---
name: elevacion-privilegios
description: Elevación de privilegios multiplataforma (Linux/macOS/Windows) con diálogo nativo del SO. Usar cuando haya que instalar paquetes/modelos o ejecutar comandos con sudo/admin. Incluye elevate.sh y elevate.ps1.
---

# Elevación de privilegios multiplataforma

Usar esta skill cuando una tarea necesite **privilegios de administrador** (instalar paquetes del sistema, modelos, servicios, etc.) en Linux, macOS o Windows.

**Regla de oro:** la contraseña **siempre se introduce en el diálogo nativo del SO**. Nunca pedirla por chat, nunca pasarla por `sudo -S`/stdin, nunca guardarla en archivos ni en memoria del proyecto.

## Helpers incluidos
Copiá estos archivos junto a tu skill (o invocalos desde aquí):

| SO | Helper | Diálogo |
|----|--------|---------|
| Linux | `bash "<SKILL_DIR>/elevate.sh" <comando> [args...]` | polkit (GNOME/KDE) vía `pkexec`; si no hay sesión gráfica, `sudo` en terminal |
| macOS | `bash "<SKILL_DIR>/elevate.sh" <comando> [args...]` | `osascript ... with administrator privileges` |
| Windows | `powershell -ExecutionPolicy Bypass -File "<SKILL_DIR>/elevate.ps1" <comando> [args...]` | UAC (`Start-Process -Verb RunAs`) |

## Procedimiento

1. **Detectar el SO** (`uname -s`: `Linux`, `Darwin`, `MINGW*`/`MSYS*`/`CYGWIN*`; WSL: `grep -qi microsoft /proc/version`).
2. **Pedir consentimiento al usuario** antes de cualquier instalación: explicar qué se instala, el tamaño aproximado y que se le pedirá la contraseña en el diálogo del sistema. **No instalar sin ese "sí"**.
3. **Ejecutar con el helper correspondiente:**
   ```bash
   # Linux / macOS
   bash "<SKILL_DIR>/elevate.sh" apt install -y tesseract-ocr tesseract-ocr-spa
   bash "<SKILL_DIR>/elevate.sh" bash -c 'curl -fsSL https://ollama.com/install.sh | sh'
   # Windows
   powershell -ExecutionPolicy Bypass -File "<SKILL_DIR>/elevate.ps1" winget install Ollama.Ollama
   ```
4. **Verificar el resultado** (comando de chequeo, p. ej. `command -v <bin>` o `<bin> --version`) y reportar éxito o error. Nunca asumir que funcionó.

## Comandos de instalación comunes por SO
- **Tesseract (OCR):** Linux `apt install tesseract-ocr tesseract-ocr-spa` (dnf/pacman en otras); macOS `brew install tesseract tesseract-lang`; Windows `winget install UB-Mannheim.TesseractOCR`.
- **Ollama (modelos locales):** Linux `curl -fsSL https://ollama.com/install.sh | sh`; macOS `brew install ollama` o descargar Ollama.app; Windows `winget install Ollama.Ollama`. Luego `ollama pull <modelo>` (no requiere admin).

## Qué NO hacer
- No pedir la contraseña en el chat ni por `question`.
- No usar `zenity --password` + `sudo -S` (la credencial pasaría por el proceso y podría quedar en logs).
- No guardar la contraseña en `credentials.json`, variables de entorno ni archivos temporales.
- No ejecutar instalaciones "por si acaso": siempre con consentimiento explícito.

## Notas
- Si no hay sesión gráfica en Linux, `elevate.sh` cae a `sudo` (el usuario escribirá en su terminal).
- En macOS, el diálogo de `osascript` es el nativo de autorización del sistema.
- En Windows, UAC puede pedir "Sí" o credenciales de administrador según la configuración.