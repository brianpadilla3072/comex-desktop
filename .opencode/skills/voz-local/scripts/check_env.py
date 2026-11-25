#!/usr/bin/env python3
"""Verifica el entorno de voz local sin instalar nada."""
from __future__ import annotations

import importlib.util
import json
import os
import platform
import shutil
import sys
from pathlib import Path

MODULES = ["torch", "torchaudio", "chatterbox", "zonos", "qwen_tts", "soundfile", "numpy"]
BINARIES = ["ffmpeg", "ffprobe"]


def module_state(name: str) -> bool:
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


def main() -> None:
    tts_home = os.environ.get("TTS_HOME") or (
        str(Path(os.environ.get("LOCALAPPDATA", Path.home())) / "openwork-tts")
        if platform.system() == "Windows"
        else str(Path.home() / ".openwork-tts")
    )
    modules = {name: module_state(name) for name in MODULES}
    binaries = {name: shutil.which(name) for name in BINARIES}

    gpu = None
    if modules["torch"]:
        try:
            import torch

            gpu = {
                "cuda": bool(torch.cuda.is_available()),
                "device": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
                "version": torch.__version__,
            }
        except Exception as error:  # noqa: BLE001
            gpu = {"error": str(error)}

    hints = []
    if sys.version_info < (3, 10):
        hints.append("Actualizá a Python 3.10+ (3.12 recomendado).")
    if not modules["torch"]:
        hints.append("Instalá PyTorch: https://pytorch.org/get-started/locally/")
    if not modules["chatterbox"]:
        hints.append("Instalá Chatterbox: python -m pip install chatterbox-tts")
    for name, path in binaries.items():
        if not path:
            hints.append(f"Instalá {name} y agregalo al PATH (winget install Gyan.FFmpeg).")

    ready = bool(modules["torch"] and modules["torchaudio"] and modules["chatterbox"]
                 and binaries["ffmpeg"] and binaries["ffprobe"])
    print(json.dumps({
        "ok": True,
        "ready": ready,
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "ttsHome": tts_home,
        "modules": modules,
        "binaries": binaries,
        "gpu": gpu,
        "hints": hints,
    }, indent=2))
    if not ready:
        sys.exit(2)


if __name__ == "__main__":
    main()
