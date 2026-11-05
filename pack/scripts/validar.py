#!/usr/bin/env python3
"""
validar.py — Control de calidad del pack antes de instalar.
Solo Python estándar. Verifica las reglas que OpenCode/OpenWork exigen y que,
si se rompen, hacen que una skill o un agente NO se carguen (sin avisar).

Uso:
    python3 scripts/validar.py            # valida todo el pack
    python3 scripts/validar.py --quiet    # solo errores

Salida: 0 si está todo bien, 1 si hay errores.
"""

import argparse
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILL_NAME_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
MODES = {"primary", "subagent", "all"}
HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")

errors = []
warnings = []


def frontmatter(path):
    text = open(path, encoding="utf-8").read()
    m = re.match(r"^---\r?\n(.*?)\r?\n---", text, re.S)
    return (m.group(1) if m else None), text


def field(fm, key):
    """Valor de un campo simple del frontmatter (una línea, sin YAML completo)."""
    m = re.search(rf"^{key}:\s*(.+)$", fm, re.M)
    return m.group(1).strip().strip('"').strip("'") if m else None


def check_skills():
    skills_dir = os.path.join(ROOT, "skills")
    if not os.path.isdir(skills_dir):
        errors.append("no existe la carpeta skills/")
        return
    known_scripts = set()
    for base, _dirs, files in os.walk(os.path.join(ROOT)):
        if os.path.basename(base) == "scripts":
            known_scripts.update(f for f in files if f.endswith(".py"))
    for folder in sorted(os.listdir(skills_dir)):
        path = os.path.join(skills_dir, folder, "SKILL.md")
        if not os.path.isdir(os.path.join(skills_dir, folder)):
            continue
        if not os.path.isfile(path):
            errors.append(f"skills/{folder}: falta SKILL.md")
            continue
        fm, _ = frontmatter(path)
        if fm is None:
            errors.append(f"skills/{folder}: sin frontmatter (--- ... ---)")
            continue
        name = field(fm, "name")
        desc = field(fm, "description")
        if not name:
            errors.append(f"skills/{folder}: falta name")
        elif not SKILL_NAME_RE.match(name):
            errors.append(
                f"skills/{folder}: name '{name}' no es kebab-case "
                "(minúsculas, números y guiones simples)"
            )
        elif name != folder:
            errors.append(
                f"skills/{folder}: name '{name}' debe ser igual al nombre de la carpeta '{folder}'"
            )
        if not desc:
            errors.append(f"skills/{folder}: falta description")
        elif not (1 <= len(desc) <= 1024):
            errors.append(f"skills/{folder}: description tiene {len(desc)} caracteres (máximo 1024)")

        # Los scripts declarados en el SKILL.md deberían existir en alguna parte del pack
        # (pueden vivir en otra skill: por ejemplo informe_docx.py está en documento-docx).
        for rel in re.findall(r"scripts/([A-Za-z0-9_.\-]+\.py)", open(path, encoding="utf-8").read()):
            if rel not in known_scripts:
                warnings.append(f"skills/{folder}: el SKILL.md menciona scripts/{rel} y no existe en el pack")


def check_agents():
    agents_dir = os.path.join(ROOT, "agents")
    if not os.path.isdir(agents_dir):
        return
    for fname in sorted(os.listdir(agents_dir)):
        if not fname.endswith(".md"):
            continue
        path = os.path.join(agents_dir, fname)
        fm, _ = frontmatter(path)
        if fm is None:
            errors.append(f"agents/{fname}: sin frontmatter")
            continue
        desc = field(fm, "description")
        if not desc:
            errors.append(f"agents/{fname}: falta description (es obligatoria)")
        elif len(desc) > 1024:
            errors.append(f"agents/{fname}: description tiene {len(desc)} caracteres (máximo 1024)")

        mode = field(fm, "mode")
        if mode and mode not in MODES:
            errors.append(f"agents/{fname}: mode '{mode}' inválido (usar primary, subagent o all)")

        if re.search(r"^permissions:", fm, re.M):
            errors.append(
                f"agents/{fname}: 'permissions:' (plural, lista) no existe; "
                "usar 'permission:' (singular) con un mapa, ej. 'permission:\\n  edit: deny'"
            )

        color = field(fm, "color")
        if color and not (HEX_RE.match(color) or color in {"primary", "secondary", "accent", "success", "warning", "error", "info"}):
            warnings.append(f"agents/{fname}: color '{color}' no es hex #RRGGBB ni un color de tema")


def main():
    ap = argparse.ArgumentParser(description="Valida skills y agentes del pack.")
    ap.add_argument("--quiet", action="store_true", help="mostrar solo errores")
    args = ap.parse_args()

    check_skills()
    check_agents()

    if not args.quiet:
        total_skills = len([d for d in os.listdir(os.path.join(ROOT, "skills")) if os.path.isdir(os.path.join(ROOT, "skills", d))])
        total_agents = len([f for f in os.listdir(os.path.join(ROOT, "agents")) if f.endswith(".md")])
        print(f"Validando {total_skills} skills y {total_agents} agentes...")

    for w in warnings:
        print(f"AVISO: {w}")
    for e in errors:
        print(f"ERROR: {e}")

    if errors:
        print(f"\n{len(errors)} error(es). Corregí antes de instalar: si no, esas piezas no se cargan.")
        return 1
    if not args.quiet:
        print("Todo bien: las piezas cumplen el formato de OpenCode/OpenWork.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
