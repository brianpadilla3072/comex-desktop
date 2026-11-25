#!/usr/bin/env python3
"""Transcribe con whisper.cpp y quema subtítulos con ffmpeg."""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import tempfile
import wave
from pathlib import Path

TIMECODE = re.compile(r"(\d{2}):(\d{2}):(\d{2}),(\d{3})")


def fail(message: str) -> "None":
    print(json.dumps({"ok": False, "error": message}))
    raise SystemExit(1)


def run(command: list[str], cwd: Path | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(command, capture_output=True, text=True, cwd=str(cwd) if cwd else None)


def require(binary: str, hint: str) -> str:
    path = shutil.which(binary)
    if not path:
        fail(f"Falta {binary}. {hint}")
    return path


def validate_srt(path: Path) -> list[str]:
    if not path.is_file() or path.stat().st_size == 0:
        fail(f"No se generó {path}")
    text = path.read_text(encoding="utf-8-sig", errors="replace")
    if not text.strip():
        fail("El .srt está vacío")
    warnings = []
    previous = -1.0
    for match in TIMECODE.finditer(text):
        hours, minutes, seconds, millis = (int(value) for value in match.groups())
        value = hours * 3600 + minutes * 60 + seconds + millis / 1000
        if value < previous:
            warnings.append("Hay timecodes fuera de orden")
            break
        previous = value
    if "\n\n\n" in text:
        warnings.append("Hay líneas vacías de más")
    return warnings


def cmd_transcribe(args: argparse.Namespace) -> None:
    ffmpeg = require("ffmpeg", "Instalá: winget install Gyan.FFmpeg")
    whisper = args.whisper or shutil.which("whisper-cli") or shutil.which("main")
    if not whisper:
        fail("Falta whisper-cli (o main en builds viejas). Bajá whisper-bin-x64 de whisper.cpp y pasá --whisper")
    model = Path(args.model)
    if not model.is_file():
        fail(f"No existe el modelo: {model}")

    source = Path(args.input)
    if not source.is_file():
        fail(f"No existe el input: {source}")
    target = Path(args.out)
    target.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="openwork-sub-") as temporary:
        audio = Path(temporary) / "audio.wav"
        extract = run([ffmpeg, "-y", "-i", str(source), "-vn", "-ac", "1", "-ar", "16000", str(audio)])
        if extract.returncode != 0:
            fail(extract.stderr.strip().splitlines()[-1] if extract.stderr.strip() else "ffmpeg no pudo extraer el audio")

        prefix = Path(temporary) / target.stem
        result = run([whisper, "-m", str(model), "-l", args.lang, "-osrt", "-of", str(prefix), str(audio)])
        generated = prefix.with_suffix(".srt")
        if not generated.is_file():
            detail = result.stderr.strip().splitlines()[-1] if result.stderr.strip() else "whisper-cli no generó .srt"
            fail(detail)
        shutil.copyfile(generated, target)

    warnings = validate_srt(target)
    print(json.dumps({
        "ok": True,
        "output": str(target),
        "language": args.lang,
        "model": str(model),
        "warnings": warnings,
    }, indent=2))


def cmd_burn(args: argparse.Namespace) -> None:
    ffmpeg = require("ffmpeg", "Instalá: winget install Gyan.FFmpeg")
    video = Path(args.video).resolve()
    srt = Path(args.srt).resolve()
    if not video.is_file():
        fail(f"No existe el video: {video}")
    if not srt.is_file():
        fail(f"No existe el .srt: {srt}")
    target = Path(args.out).resolve()
    target.parent.mkdir(parents=True, exist_ok=True)

    # Ruta relativa y cwd en la carpeta del .srt: evita el infierno de escapes
    # de Windows en el filtro subtitles.
    result = run([
        ffmpeg, "-y", "-i", str(video),
        "-vf", f"subtitles={srt.name}",
        "-c:v", "libx264", "-crf", "20", "-preset", "veryfast",
        "-c:a", "copy", str(target),
    ], cwd=srt.parent)
    if result.returncode != 0:
        fail(result.stderr.strip().splitlines()[-1] if result.stderr.strip() else "ffmpeg falló")
    if not target.is_file() or target.stat().st_size == 0:
        fail("ffmpeg no generó el video con subtítulos")
    print(json.dumps({"ok": True, "output": str(target), "bytes": target.stat().st_size}))


def main() -> None:
    parser = argparse.ArgumentParser(description="Subtítulos con whisper.cpp")
    sub = parser.add_subparsers(dest="command", required=True)

    transcribe = sub.add_parser("transcribe", help="Audio/video -> .srt")
    transcribe.add_argument("--input", required=True)
    transcribe.add_argument("--out", required=True)
    transcribe.add_argument("--lang", default="es")
    transcribe.add_argument("--model", required=True)
    transcribe.add_argument("--whisper")
    transcribe.set_defaults(func=cmd_transcribe)

    burn = sub.add_parser("burn", help="Quemar .srt en el video")
    burn.add_argument("--video", required=True)
    burn.add_argument("--srt", required=True)
    burn.add_argument("--out", required=True)
    burn.set_defaults(func=cmd_burn)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
