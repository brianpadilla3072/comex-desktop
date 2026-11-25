#!/usr/bin/env python3
"""Voz rápida en CPU con Kokoro (sin clonar). Requiere kokoro-onnx + modelos."""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


def fail(message: str) -> "None":
    print(json.dumps({"ok": False, "error": message}))
    raise SystemExit(1)


def default_model_dir() -> Path:
    home = os.environ.get("TTS_HOME")
    if home:
        return Path(home) / "kokoro"
    if os.name == "nt":
        return Path(os.environ.get("LOCALAPPDATA", Path.home())) / "openwork-tts" / "kokoro"
    return Path.home() / ".openwork-tts" / "kokoro"


def main() -> None:
    parser = argparse.ArgumentParser(description="Kokoro TTS local (sin clonar)")
    parser.add_argument("--text")
    parser.add_argument("--lines", help="JSON [{id,text}] para batch")
    parser.add_argument("--out")
    parser.add_argument("--outdir", default="assets/audio/voice")
    parser.add_argument("--voice", default="ef_dora", help="Voz Kokoro (es_* / ef_*)")
    parser.add_argument("--lang", default="es")
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--model-dir")
    parser.add_argument("--model", help="kokoro-v1.0.onnx")
    parser.add_argument("--voices", help="voices-v1.0.bin")
    args = parser.parse_args()

    if bool(args.text) == bool(args.lines):
        fail("Pasá --text o --lines, no ambos ni ninguno.")

    try:
        from kokoro_onnx import Kokoro
        import soundfile as sf
    except ImportError:
        fail("Falta Kokoro. Instalá: python -m pip install kokoro-onnx soundfile")

    model_dir = Path(args.model_dir) if args.model_dir else default_model_dir()
    model = Path(args.model) if args.model else model_dir / "kokoro-v1.0.onnx"
    voices = Path(args.voices) if args.voices else model_dir / "voices-v1.0.bin"
    if not model.is_file() or not voices.is_file():
        fail(f"Faltan los modelos en {model_dir}: kokoro-v1.0.onnx y voices-v1.0.bin")

    engine = Kokoro(str(model), str(voices))

    def synthesize(text: str, out: Path) -> float:
        samples, sample_rate = engine.create(text, voice=args.voice, lang=args.lang, speed=args.speed)
        out.parent.mkdir(parents=True, exist_ok=True)
        sf.write(str(out), samples, sample_rate)
        return round(len(samples) / float(sample_rate), 3)

    if args.lines:
        source = Path(args.lines)
        if not source.is_file():
            fail(f"No existe el JSON de líneas: {source}")
        try:
            lines = json.loads(source.read_text(encoding="utf-8-sig"))
        except json.JSONDecodeError as error:
            fail(f"JSON inválido: {error}")
        if not isinstance(lines, list) or not lines:
            fail("lines.json debe ser una lista no vacía")
        outdir = Path(args.outdir)
        output_lines = []
        for index, line in enumerate(lines, start=1):
            if not isinstance(line, dict) or not isinstance(line.get("text"), str) or not line["text"].strip():
                fail(f"Línea {index} sin text")
            line_id = str(line.get("id") or f"l{index}")
            target = outdir / f"{line_id}.wav"
            seconds = synthesize(line["text"].strip(), target)
            output_lines.append({
                "id": line_id,
                "file": str(target),
                "text": line["text"].strip(),
                "durationSeconds": seconds,
            })
            print(json.dumps({"ok": True, "line": line_id, "file": str(target)}), flush=True)
        total = round(sum(item["durationSeconds"] for item in output_lines), 3)
        durations = outdir / "durations.json"
        durations.write_text(f"{json.dumps({'engine': 'kokoro', 'voice': args.voice, 'language': args.lang, 'lines': output_lines, 'totalSeconds': total}, indent=2)}\n", encoding="utf-8")
        print(json.dumps({"ok": True, "output": str(durations), "lines": len(output_lines), "totalSeconds": total}))
        return

    if not args.out:
        fail("Con --text indicá --out")
    seconds = synthesize(args.text.strip(), Path(args.out))
    print(json.dumps({"ok": True, "output": args.out, "durationSeconds": seconds, "engine": "kokoro", "voice": args.voice}))


if __name__ == "__main__":
    main()
