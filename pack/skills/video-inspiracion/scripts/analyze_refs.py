#!/usr/bin/env python3
"""Mide referencias de video: duración, fps, cortes, frames y paleta.

No escribe style.json: el modelo lo completa mirando los frames y estas
métricas. Necesita ffmpeg y ffprobe en el PATH.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"}


def fail(message: str) -> "None":
    print(json.dumps({"ok": False, "error": message}))
    raise SystemExit(1)


def run(command: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(command, capture_output=True, text=True, errors="replace")


def probe(path: Path) -> dict:
    result = run([
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration:stream=width,height,r_frame_rate",
        "-of", "json", str(path),
    ])
    if result.returncode != 0:
        fail(f"ffprobe falló con {path.name}: {result.stderr.strip()[:200]}")
    data = json.loads(result.stdout or "{}")
    streams = data.get("streams") or [{}]
    video = next((item for item in streams if item.get("width")), streams[0])
    duration = float((data.get("format") or {}).get("duration") or 0)
    return {
        "duration": round(duration, 3),
        "width": video.get("width"),
        "height": video.get("height"),
        "fps": parse_rate(video.get("r_frame_rate")),
    }


def parse_rate(value: str | None) -> float | None:
    if not value:
        return None
    try:
        if "/" in value:
            numerator, denominator = value.split("/", 1)
            denominator_value = float(denominator)
            return round(float(numerator) / denominator_value, 2) if denominator_value else None
        return round(float(value), 2)
    except ValueError:
        return None


def scene_times(path: Path, threshold: float) -> list[float]:
    result = run([
        "ffmpeg", "-hide_banner", "-i", str(path),
        "-filter:v", f"select=gt(scene\\,{threshold}),showinfo",
        "-an", "-f", "null", "-",
    ])
    times = sorted({float(value) for value in re.findall(r"pts_time:([0-9.]+)", result.stderr)})
    return [value for value in times if value > 0.1]


def color_times(path: Path, threshold: float) -> list[float]:
    """Cortes por diferencia de color, no solo de luma.

    scdet/select comparan luma: un corte rojo→verde puede tener casi la misma
    luma y pasar desapercibido. Esto muestrea 4 fps a 32x18 y mide el cambio
    medio de RGB entre frames consecutivos.
    """
    result = subprocess.run([
        "ffmpeg", "-v", "error", "-i", str(path),
        "-vf", "fps=4,scale=32:18", "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
    ], capture_output=True)
    data = result.stdout
    frame_size = 32 * 18 * 3
    count = len(data) // frame_size
    if count < 2:
        return []
    cuts: list[float] = []
    previous: tuple[float, float, float] | None = None
    for index in range(count):
        frame = data[index * frame_size:(index + 1) * frame_size]
        red = sum(frame[0::3]) / (32 * 18)
        green = sum(frame[1::3]) / (32 * 18)
        blue = sum(frame[2::3]) / (32 * 18)
        current = (red, green, blue)
        if previous is not None:
            difference = (abs(current[0] - previous[0])
                          + abs(current[1] - previous[1])
                          + abs(current[2] - previous[2])) / 3
            if difference >= threshold:
                cuts.append(round(index / 4.0, 3))
        previous = current
    return cuts


def merge_times(times: list[float], window: float = 0.3) -> list[float]:
    merged: list[float] = []
    for value in sorted(times):
        if value <= 0.1:
            continue
        if not merged or value - merged[-1] > window:
            merged.append(round(value, 3))
    return merged


def extract_frame(path: Path, time: float, target: Path) -> bool:
    result = run([
        "ffmpeg", "-y", "-ss", f"{time:.3f}", "-i", str(path),
        "-frames:v", "1", "-q:v", "2", str(target),
    ])
    return result.returncode == 0 and target.is_file() and target.stat().st_size > 0


def palette(path: Path, target: Path) -> list[str]:
    result = run([
        "ffmpeg", "-y", "-i", str(path),
        "-vf", "fps=1/2,palettegen=max_colors=8", "-update", "1", str(target),
    ])
    if result.returncode != 0 or not target.is_file():
        return []
    try:
        from PIL import Image

        image = Image.open(target).convert("RGB")
        colors = image.getcolors(maxcolors=1_000_000) or []
        colors.sort(key=lambda item: item[0], reverse=True)
        return [f"#{red:02x}{green:02x}{blue:02x}" for _, (red, green, blue) in colors[:8]]
    except Exception:  # noqa: BLE001 - Pillow es opcional
        return []


def safe_stem(path: Path) -> str:
    return re.sub(r"[^a-z0-9]+", "-", path.stem.lower()).strip("-") or "ref"


def main() -> None:
    parser = argparse.ArgumentParser(description="Analiza referencias de video")
    parser.add_argument("--project", default=".", help="Carpeta del proyecto de video")
    parser.add_argument("--scene-threshold", "--threshold", dest="scene_threshold", type=float, default=0.3, help="Umbral de scdet (0-1)")
    parser.add_argument("--color-threshold", type=float, default=18.0, help="Diferencia media de RGB para un corte (0-255)")
    parser.add_argument("--max-frames", type=int, default=16)
    args = parser.parse_args()

    for binary in ("ffmpeg", "ffprobe"):
        if not shutil.which(binary):
            fail(f"Falta {binary}. Instalá: winget install Gyan.FFmpeg")

    project = Path(args.project).resolve()
    refs_dir = project / "inspiracion" / "refs"
    out_dir = project / "inspiracion"
    frames_dir = out_dir / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)

    if not refs_dir.is_dir():
        fail(f"No existe {refs_dir}; creá el proyecto con video-studio/scripts/init-project.mjs")
    refs = sorted(path for path in refs_dir.iterdir() if path.suffix.lower() in VIDEO_EXTENSIONS)
    if not refs:
        fail(f"No hay videos en {refs_dir}")

    results = []
    for ref in refs:
        info = probe(ref)
        cuts = merge_times(scene_times(ref, args.scene_threshold) + color_times(ref, args.color_threshold))
        cuts = cuts[: args.max_frames]
        if not cuts and info["duration"]:
            cuts = [round(info["duration"] * fraction, 3) for fraction in (0.0, 0.25, 0.5, 0.75)]

        stem = safe_stem(ref)
        frames = []
        for index, time in enumerate(cuts, start=1):
            target = frames_dir / f"{stem}-{index:02d}-{time:.1f}s.png"
            if extract_frame(ref, time, target):
                frames.append({"time": round(time, 3), "file": str(target.relative_to(project))})

        colors = palette(ref, out_dir / f"palette-{stem}.png")
        duration = info["duration"] or 0
        cuts_per_minute = round((len(cuts) / duration) * 60, 2) if duration else 0
        average_shot = round(duration / (len(cuts) + 1), 2) if duration else 0
        results.append({
            "file": ref.name,
            **info,
            "cutCount": len(cuts),
            "cuts": [round(value, 3) for value in cuts],
            "cutsPerMinute": cuts_per_minute,
            "averageShotSeconds": average_shot,
            "palette": colors,
            "frames": frames,
        })
        print(json.dumps({"ok": True, "ref": ref.name, "cuts": len(cuts), "frames": len(frames)}))

    durs = [item["duration"] for item in results if item["duration"]]
    total_duration = round(sum(durs), 3)
    first_cuts = [item["cuts"][0] for item in results if item["cuts"]]
    aggregate = {
        "refs": len(results),
        "totalDurationSeconds": total_duration,
        "averageCutsPerMinute": round(sum(item["cutsPerMinute"] for item in results) / len(results), 2),
        "averageShotSeconds": round(sum(item["averageShotSeconds"] for item in results) / len(results), 2),
        "hookSeconds": round(sorted(first_cuts)[len(first_cuts) // 2], 2) if first_cuts else 1.5,
        "palette": results[0]["palette"],
        "sceneThreshold": args.scene_threshold,
        "colorThreshold": args.color_threshold,
    }
    metrics = {
        "generatedAt": __import__("datetime").datetime.now().astimezone().isoformat(timespec="seconds"),
        "refs": results,
        "aggregate": aggregate,
    }
    target = out_dir / "metrics.json"
    target.write_text(f"{json.dumps(metrics, indent=2)}\n", encoding="utf-8")
    print(json.dumps({"ok": True, "output": str(target), "aggregate": aggregate}, indent=2))


if __name__ == "__main__":
    main()
