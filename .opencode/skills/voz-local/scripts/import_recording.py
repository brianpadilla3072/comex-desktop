#!/usr/bin/env python3
"""Convierte una grabación de la app (webm/opus) en la referencia de voz.

Salida: voices/<nombre>/referencia.wav (48 kHz, mono, -16 LUFS) y perfil.json.
Exige consentimiento.md junto a la grabación.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import shutil
import subprocess
import wave
from pathlib import Path


def fail(message: str) -> "None":
    print(json.dumps({"ok": False, "error": message}))
    raise SystemExit(1)


def duration(path: Path) -> float | None:
    try:
        with wave.open(str(path), "rb") as handle:
            return round(handle.getnframes() / float(handle.getframerate()), 3)
    except Exception:  # noqa: BLE001
        return None


def main() -> None:
    parser = argparse.ArgumentParser(description="Importa una grabación de voz de la app")
    parser.add_argument("--input", required=True, help="voices/<nombre>/referencia.webm")
    parser.add_argument("--outdir", help="Por defecto, la carpeta del input")
    parser.add_argument("--name", help="Nombre del perfil; por defecto, el de la carpeta")
    parser.add_argument("--language", default="es")
    parser.add_argument("--engine", default="chatterbox")
    parser.add_argument("--force", action="store_true", help="Sobrescribe perfil.json")
    args = parser.parse_args()

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        fail("Falta ffmpeg. Instalá: winget install Gyan.FFmpeg")

    source = Path(args.input).resolve()
    if not source.is_file():
        fail(f"No existe la grabación: {source}")
    folder = Path(args.outdir).resolve() if args.outdir else source.parent
    name = (args.name or folder.name or "voz").strip()
    consent = folder / "consentimiento.md"
    if not consent.is_file():
        fail(f"Falta {consent}. No se importa una voz sin consentimiento.")

    target = folder / "referencia.wav"
    command = [
        ffmpeg, "-y", "-i", str(source),
        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
        "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", str(target),
    ]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        fail(result.stderr.strip().splitlines()[-1] if result.stderr else "ffmpeg falló")
    if not target.is_file() or target.stat().st_size == 0:
        fail("ffmpeg no generó referencia.wav")

    seconds = duration(target)
    warnings = []
    if seconds is not None and seconds < 8:
        warnings.append("La referencia dura menos de 8 s; la clonación puede salir inestable.")
    if seconds is not None and seconds > 40:
        warnings.append("La referencia dura más de 40 s; recortala a 20-30 s para mejor resultado.")

    profile_path = folder / "perfil.json"
    profile = {
        "name": name,
        "engine": args.engine,
        "language": args.language,
        "reference": "referencia.wav",
        "transcript": "",
        "exaggeration": 0.5,
        "cfgWeight": 0.5,
        "consent": "consentimiento.md",
        "createdAt": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
    }
    created = False
    if not profile_path.exists() or args.force:
        profile_path.write_text(f"{json.dumps(profile, indent=2)}\n", encoding="utf-8")
        created = True

    print(json.dumps({
        "ok": True,
        "input": str(source),
        "output": str(target),
        "durationSeconds": seconds,
        "profile": str(profile_path),
        "profileCreated": created,
        "warnings": warnings,
    }, indent=2))


if __name__ == "__main__":
    main()
