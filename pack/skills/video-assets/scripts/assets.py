#!/usr/bin/env python3
"""Assets 2D para video: cutout, vectorize, rasterize y manifiesto."""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


def fail(message: str) -> "None":
    print(json.dumps({"ok": False, "error": message}))
    raise SystemExit(1)


def run(command: list[str]) -> None:
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        detail = result.stderr.strip().splitlines()[-1] if result.stderr.strip() else "comando falló"
        fail(detail)


def require(binary: str, hint: str) -> str:
    path = shutil.which(binary)
    if not path:
        fail(f"Falta {binary}. {hint}")
    return path


def require_output(path: Path) -> None:
    if not path.is_file() or path.stat().st_size == 0:
        fail(f"No se generó {path}")


def digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def manifest_path(project: Path) -> Path:
    return project / "assets" / "manifest.json"


def load_manifest(project: Path) -> dict:
    path = manifest_path(project)
    if not path.is_file():
        return {"assets": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except json.JSONDecodeError:
        return {"assets": []}
    if not isinstance(data.get("assets"), list):
        data["assets"] = []
    return data


def rembg_binary() -> str | None:
    override = os.environ.get("OPENWORK_REMBG")
    if override and Path(override).is_file():
        return override
    if os.name == "nt":
        candidate = Path(os.environ.get("LOCALAPPDATA", "")) / "openwork-tts" / "rembg-venv" / "Scripts" / "rembg.exe"
        if candidate.is_file():
            return str(candidate)
    return shutil.which("rembg")


def cmd_cutout(args: argparse.Namespace) -> None:
    rembg = rembg_binary()
    if not rembg:
        fail('Falta rembg. Instalá: pip install "rembg[cpu,cli]" o definí OPENWORK_REMBG')
    source = Path(args.input)
    if not source.is_file():
        fail(f"No existe {source}")
    target = Path(args.out)
    target.parent.mkdir(parents=True, exist_ok=True)
    run([rembg, "i", "-m", "u2net", str(source), str(target)])
    require_output(target)
    print(json.dumps({"ok": True, "command": "cutout", "output": str(target), "model": "u2net", "bytes": target.stat().st_size}))


def cmd_vectorize(args: argparse.Namespace) -> None:
    try:
        import vtracer
    except ImportError:
        fail("Falta vtracer. Instalá: pip install vtracer")
    source = Path(args.input)
    if not source.is_file():
        fail(f"No existe {source}")
    target = Path(args.out)
    target.parent.mkdir(parents=True, exist_ok=True)
    colormode = "binary" if args.preset == "bw" else "color"
    vtracer.convert_image_to_svg_py(
        str(source),
        str(target),
        colormode=colormode,
        hierarchical="stacked",
        mode="spline",
        filter_speckle=4,
        color_precision=6,
        layer_difference=16,
    )
    require_output(target)
    print(json.dumps({"ok": True, "command": "vectorize", "output": str(target), "preset": args.preset, "bytes": target.stat().st_size}))


def resvg_binary() -> str | None:
    override = os.environ.get("OPENWORK_RESVG")
    if override and Path(override).is_file():
        return override
    if os.name == "nt":
        candidate = Path(os.environ.get("USERPROFILE", "")) / ".cargo" / "bin" / "resvg.exe"
        if candidate.is_file():
            return str(candidate)
    return shutil.which("resvg")


def cmd_rasterize(args: argparse.Namespace) -> None:
    resvg = resvg_binary()
    if not resvg:
        fail("Falta resvg. Instalá: cargo install resvg --locked o bajá resvg.exe")
    source = Path(args.input)
    if not source.is_file():
        fail(f"No existe {source}")
    target = Path(args.out)
    target.parent.mkdir(parents=True, exist_ok=True)
    run([resvg, str(source), str(target), "-z", str(args.zoom)])
    require_output(target)
    print(json.dumps({"ok": True, "command": "rasterize", "output": str(target), "zoom": args.zoom, "bytes": target.stat().st_size}))


def cmd_add(args: argparse.Namespace) -> None:
    project = Path(args.project).resolve()
    asset = Path(args.path)
    full = asset if asset.is_absolute() else project / asset
    if not full.is_file():
        fail(f"No existe el asset: {full}")
    relative = str(full.relative_to(project)).replace("\\", "/") if full.is_relative_to(project) else str(full)
    data = load_manifest(project)
    entry = {
        "path": relative,
        "source": args.source,
        "license": args.license,
        "sha256": digest(full),
        "addedAt": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
    }
    data["assets"] = [item for item in data["assets"] if item.get("path") != relative]
    data["assets"].append(entry)
    path = manifest_path(project)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"{json.dumps(data, indent=2)}\n", encoding="utf-8")
    print(json.dumps({"ok": True, "command": "add", "manifest": str(path), "entry": entry}, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description="Assets 2D para video")
    sub = parser.add_subparsers(dest="command", required=True)

    cutout = sub.add_parser("cutout", help="Fondo transparente con u2net")
    cutout.add_argument("--in", dest="input", required=True)
    cutout.add_argument("--out", required=True)
    cutout.set_defaults(func=cmd_cutout)

    vectorize = sub.add_parser("vectorize", help="PNG -> SVG con vtracer")
    vectorize.add_argument("--in", dest="input", required=True)
    vectorize.add_argument("--out", required=True)
    vectorize.add_argument("--preset", default="poster")
    vectorize.set_defaults(func=cmd_vectorize)

    rasterize = sub.add_parser("rasterize", help="SVG -> PNG con resvg")
    rasterize.add_argument("--in", dest="input", required=True)
    rasterize.add_argument("--out", required=True)
    rasterize.add_argument("--zoom", type=float, default=2)
    rasterize.set_defaults(func=cmd_rasterize)

    add = sub.add_parser("add", help="Registrar en assets/manifest.json")
    add.add_argument("--project", default=".")
    add.add_argument("--path", required=True)
    add.add_argument("--source", required=True)
    add.add_argument("--license", required=True)
    add.set_defaults(func=cmd_add)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
