#!/usr/bin/env python3
"""Normaliza un WAV de voz a un objetivo de loudness con ffmpeg."""
from __future__ import annotations

import argparse
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
    parser = argparse.ArgumentParser(description="Normalizador de voz (loudnorm)")
    parser.add_argument("--in", dest="input", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--lufs", type=float, default=-16.0)
    parser.add_argument("--tp", type=float, default=-1.5)
    parser.add_argument("--lra", type=float, default=11.0)
    args = parser.parse_args()

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        fail("Falta ffmpeg. Instalá: winget install Gyan.FFmpeg")

    source = Path(args.input)
    if not source.is_file():
        fail(f"No existe el archivo: {source}")
    target = Path(args.out)
    target.parent.mkdir(parents=True, exist_ok=True)

    filter_spec = f"loudnorm=I={args.lufs}:TP={args.tp}:LRA={args.lra}"
    command = [
        ffmpeg, "-y", "-i", str(source),
        "-af", filter_spec, "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le",
        str(target),
    ]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        fail(result.stderr.strip().splitlines()[-1] if result.stderr else "ffmpeg falló")
    if not target.is_file() or target.stat().st_size == 0:
        fail("ffmpeg no generó una salida válida")

    print(json.dumps({
        "ok": True,
        "input": str(source),
        "output": str(target),
        "durationSeconds": duration(target),
        "lufs": args.lufs,
        "truePeak": args.tp,
        "bytes": target.stat().st_size,
    }))


if __name__ == "__main__":
    main()
