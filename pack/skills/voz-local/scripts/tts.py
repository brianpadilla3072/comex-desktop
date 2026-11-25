#!/usr/bin/env python3
"""Genera voz con Chatterbox (local). Una línea o un storyboard completo.

No instala nada: si falta el motor, falla con el comando exacto.
"""
from __future__ import annotations

import argparse
import hashlib
import inspect
import json
import sys
import wave
from pathlib import Path


def fail(message: str) -> "None":
    print(json.dumps({"ok": False, "error": message}))
    raise SystemExit(1)


def wav_duration(path: Path) -> float | None:
    try:
        import soundfile as sf

        return round(float(sf.info(str(path)).duration), 3)
    except Exception:  # noqa: BLE001
        pass
    try:
        with wave.open(str(path), "rb") as handle:
            return round(handle.getnframes() / float(handle.getframerate()), 3)
    except Exception:  # noqa: BLE001
        return None


def resolve_device(requested: str) -> str:
    if requested != "auto":
        return requested
    import torch

    return "cuda" if torch.cuda.is_available() else "cpu"


def load_model(engine: str, device: str):
    if engine != "chatterbox":
        fail(f"Motor '{engine}' no implementado todavía. Usá --engine chatterbox o probá ZONOS3 con su propio script.")
    try:
        import torch
        import torchaudio  # noqa: F401
    except ImportError:
        fail("Falta PyTorch/torchaudio. Corré check_env.py y seguí las instrucciones.")
    try:
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS as Model

        multilingual = True
    except ImportError:
        try:
            from chatterbox.tts import ChatterboxTTS as Model

            multilingual = False
        except ImportError:
            fail("Falta chatterbox-tts. Instalá: python -m pip install chatterbox-tts")
    # Los checkpoints de Chatterbox se guardaron en CUDA; en CPU hay que forzar
    # map_location o torch.load falla al deserializar.
    original_load = torch.load

    def cpu_load(*args, **kwargs):
        if kwargs.get("map_location") is None:
            kwargs["map_location"] = torch.device("cpu")
        return original_load(*args, **kwargs)

    if device == "cpu":
        torch.load = cpu_load
    try:
        model = Model.from_pretrained(device=torch.device(device))
    finally:
        torch.load = original_load
    return model, multilingual


def synthesize(model, multilingual: bool, text: str, voice: Path | None, lang: str,
               exaggeration: float | None, cfg: float | None, seed: int | None) -> tuple:
    import torch

    if seed is not None:
        torch.manual_seed(seed)

    candidates: dict[str, object] = {}
    if voice is not None:
        candidates["audio_prompt_path"] = str(voice)
    if multilingual:
        candidates["language_id"] = lang
    if exaggeration is not None:
        candidates["exaggeration"] = exaggeration
    if cfg is not None:
        candidates["cfg_weight"] = cfg

    params = inspect.signature(model.generate).parameters
    kwargs = {key: value for key, value in candidates.items() if key in params}
    wav = model.generate(text, **kwargs)
    return wav, model.sr


def save_wav(wav, sample_rate: int, out: Path) -> None:
    import torchaudio

    tensor = wav
    if hasattr(tensor, "dim") and tensor.dim() == 1:
        tensor = tensor.unsqueeze(0)
    out.parent.mkdir(parents=True, exist_ok=True)
    torchaudio.save(str(out), tensor.cpu(), sample_rate)


def main() -> None:
    parser = argparse.ArgumentParser(description="TTS local con clonación (Chatterbox)")
    parser.add_argument("--profile", help="voices/<nombre>/perfil.json")
    parser.add_argument("--engine", default=None, choices=["chatterbox", "zonos", "qwen"])
    parser.add_argument("--voice", help="WAV de referencia para clonar")
    parser.add_argument("--text")
    parser.add_argument("--lines", help="JSON [{id,text,exaggeration?}] para batch")
    parser.add_argument("--out", help="WAV de salida (una línea)")
    parser.add_argument("--outdir", default="assets/audio/voice", help="Carpeta para batch")
    parser.add_argument("--lang", default=None)
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    parser.add_argument("--exaggeration", type=float)
    parser.add_argument("--cfg", type=float, help="cfg_weight de Chatterbox")
    parser.add_argument("--seed", type=int)
    parser.add_argument("--consent", help="consentimiento.md si no está junto a la referencia")
    parser.add_argument("--force", action="store_true", help="Ignora el caché de líneas")
    args = parser.parse_args()

    profile: dict = {}
    if args.profile:
        profile_path = Path(args.profile).resolve()
        if not profile_path.is_file():
            fail(f"No existe el perfil: {profile_path}")
        try:
            profile = json.loads(profile_path.read_text(encoding="utf-8-sig"))
        except json.JSONDecodeError as error:
            fail(f"perfil.json inválido: {error}")
        base = profile_path.parent
        args.engine = args.engine or profile.get("engine") or "chatterbox"
        args.lang = args.lang or profile.get("language") or "es"
        if not args.voice and isinstance(profile.get("reference"), str):
            args.voice = str(base / profile["reference"])
        if args.exaggeration is None and isinstance(profile.get("exaggeration"), (int, float)):
            args.exaggeration = float(profile["exaggeration"])
        if args.cfg is None and isinstance(profile.get("cfgWeight"), (int, float)):
            args.cfg = float(profile["cfgWeight"])
    args.engine = args.engine or "chatterbox"
    args.lang = args.lang or "es"

    if bool(args.text) == bool(args.lines):
        fail("Pasá --text o --lines, no ambos ni ninguno.")

    voice = Path(args.voice).resolve() if args.voice else None
    if voice is not None:
        if not voice.is_file():
            fail(f"No existe la voz de referencia: {voice}")
        consent = Path(args.consent).resolve() if args.consent else voice.parent / "consentimiento.md"
        if not consent.is_file():
            fail(f"Falta {consent}. No se clona una voz sin consentimiento; pasá --consent si está en otro lado.")

    if args.engine == "chatterbox":
        from pathlib import Path as _Path  # noqa: F401

        # La descarga del modelo la maneja chatterbox-tts en su caché estándar.
        pass

    device = resolve_device(args.device)
    model, multilingual = load_model(args.engine, device)

    if args.lines:
        lines_path = Path(args.lines)
        if not lines_path.is_file():
            fail(f"No existe el JSON de líneas: {lines_path}")
        try:
            lines = json.loads(lines_path.read_text(encoding="utf-8-sig"))
        except json.JSONDecodeError as error:
            fail(f"JSON inválido: {error}")
        if not isinstance(lines, list) or not lines:
            fail("lines.json debe ser una lista no vacía")

        outdir = Path(args.outdir)
        durations_path = outdir / "durations.json"
        previous: dict[str, dict] = {}
        if durations_path.is_file() and not args.force:
            try:
                previous_data = json.loads(durations_path.read_text(encoding="utf-8-sig"))
                previous = {
                    str(item.get("id")): item
                    for item in previous_data.get("lines", [])
                    if isinstance(item, dict) and item.get("id")
                }
            except Exception:  # noqa: BLE001
                previous = {}

        output_lines = []
        skipped = 0
        for index, line in enumerate(lines, start=1):
            if not isinstance(line, dict) or not isinstance(line.get("text"), str) or not line["text"].strip():
                fail(f"Línea {index} sin text")
            line_id = str(line.get("id") or f"l{index}")
            text = line["text"].strip()
            target = outdir / f"{line_id}.wav"
            payload = json.dumps({
                "engine": args.engine,
                "voice": str(voice) if voice else None,
                "lang": args.lang,
                "exaggeration": line.get("exaggeration", args.exaggeration),
                "cfg": line.get("cfg", args.cfg),
                "text": text,
            }, sort_keys=True)
            digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]
            cached = previous.get(line_id)
            if cached and cached.get("hash") == digest and isinstance(cached.get("file"), str) and Path(cached["file"]).is_file():
                output_lines.append({**cached, "text": text})
                skipped += 1
                print(json.dumps({"ok": True, "line": line_id, "skipped": True, "file": cached["file"]}), flush=True)
                continue

            wav, sample_rate = synthesize(
                model, multilingual, text, voice, args.lang,
                line.get("exaggeration", args.exaggeration),
                line.get("cfg", args.cfg), args.seed,
            )
            save_wav(wav, sample_rate, target)
            output_lines.append({
                "id": line_id,
                "file": str(target),
                "text": text,
                "durationSeconds": wav_duration(target),
                "hash": digest,
            })
            print(json.dumps({"ok": True, "line": line_id, "file": str(target)}), flush=True)

        total = round(sum(item["durationSeconds"] or 0 for item in output_lines), 3)
        durations = {
            "voice": str(voice) if voice else None,
            "engine": args.engine,
            "language": args.lang,
            "lines": output_lines,
            "totalSeconds": total,
            "skipped": skipped,
        }
        durations_path.write_text(f"{json.dumps(durations, indent=2)}\n", encoding="utf-8")
        print(json.dumps({
            "ok": True,
            "output": str(durations_path),
            "lines": len(output_lines),
            "skipped": skipped,
            "totalSeconds": total,
        }))
        return

    if not args.out:
        fail("Con --text indicá --out")
    target = Path(args.out)
    wav, sample_rate = synthesize(
        model, multilingual, args.text.strip(), voice, args.lang, args.exaggeration, args.cfg, args.seed,
    )
    save_wav(wav, sample_rate, target)
    print(json.dumps({
        "ok": True,
        "output": str(target),
        "durationSeconds": wav_duration(target),
        "engine": args.engine,
        "device": device,
        "voice": str(voice) if voice else None,
    }))


if __name__ == "__main__":
    main()
