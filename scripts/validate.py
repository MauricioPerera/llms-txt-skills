#!/usr/bin/env python3
"""
validate.py

Validador de referencia para llms.txt skills.
Verifica que llms.txt tenga una seccion ## Skills bien formada
y que cada skill referenciada sea valida.

Uso:
    python validate.py ./llms.txt
    python validate.py https://ejemplo.com/llms.txt
"""

import argparse
import json
import os
import hashlib
import re
import sys
import urllib.parse
from pathlib import Path
from typing import Any

try:
    import urllib.request
except ImportError:
    urllib.request = None  # type: ignore


def fetch_content(source: str) -> str:
    if source.startswith(("http://", "https://")):
        if urllib.request is None:
            raise RuntimeError("urllib.request no disponible")
        with urllib.request.urlopen(source, timeout=15) as resp:  # type: ignore
            return resp.read().decode("utf-8", errors="replace")
    else:
        path = Path(source)
        if not path.exists():
            raise FileNotFoundError(f"Archivo no encontrado: {source}")
        return path.read_text(encoding="utf-8")


def resolve_skill_path(skill_url: str, source: str) -> str:
    """Resuelve la URL de una skill a una ruta absoluta del filesystem o URL completa."""
    if skill_url.startswith(("http://", "https://")):
        return skill_url
    if source.startswith(("http://", "https://")):
        return urllib.parse.urljoin(source, skill_url)
    # source es archivo local: resolver relativo al directorio del llms.txt
    base_dir = Path(source).parent
    resolved = base_dir / skill_url.lstrip("/")
    return str(resolved.resolve())


def parse_yaml_frontmatter(text: str) -> dict[str, Any] | None:
    """Extrae YAML frontmatter de un SKILL.md.
    Maneja key: value plano con valores que contienen dos puntos.
    No soporta listas, objetos anidados, ni multi-line strings (|, >).
    """
    if not text.startswith("---"):
        return None
    parts = text.split("---", 2)
    if len(parts) < 3:
        return None
    raw = parts[1].strip()
    result: dict[str, Any] = {}
    for line in raw.splitlines():
        m = re.match(r"^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$", line)
        if m:
            result[m.group(1)] = m.group(2).strip()
    return result

def validate_llms_txt(source: str, text: str) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    """Valida llms.txt y retorna (errores, warnings)."""
    errors: list[dict[str, str]] = []
    warnings: list[dict[str, str]] = []

    # 1. Buscar seccion ## Skills
    lines = text.splitlines()
    in_skills = False
    skill_lines: list[str] = []

    for line in lines:
        if re.match(r"^##\s+skills\s*$", line.strip(), re.IGNORECASE):
            in_skills = True
            continue
        if in_skills and re.match(r"^##\s+", line.strip(), re.IGNORECASE):
            break
        if in_skills:
            skill_lines.append(line)

    if not in_skills:
        errors.append({"file": source, "line": "", "message": "No se encontro la seccion ## Skills"})
        return errors, warnings

    if not skill_lines:
        warnings.append({"file": source, "line": "", "message": "La seccion ## Skills existe pero esta vacia"})

    # 2. Parsear cada item de skill
    current_item: list[str] = []
    items: list[list[str]] = []

    for line in skill_lines:
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("- "):
            if current_item:
                items.append(current_item)
            current_item = [stripped]
        else:
            if current_item:
                current_item.append(stripped)

    if current_item:
        items.append(current_item)

    if not items:
        warnings.append({"file": source, "line": "", "message": "No se encontraron items en ## Skills"})

    for item_lines in items:
        raw = " ".join(item_lines)
        m = re.match(
            r"^-\s*\[([^\]]+)\]\s*\(([^)]+)\)\s*:\s*(.+?)(?:\s*<!--\s*skill:\s*(\{.*?\})\s*-->)?$",
            raw, re.DOTALL | re.IGNORECASE,
        )
        if not m:
            errors.append({"file": source, "line": raw[:80], "message": "Formato invalido de skill entry"})
            continue

        title = m.group(1).strip()
        url = m.group(2).strip()
        desc = m.group(3).strip()
        meta_raw = m.group(4)
        meta_parsed = None

        # 3. Validar metadata inline
        if meta_raw:
            try:
                meta_parsed = json.loads(meta_raw)
                if "version" in meta_parsed and not re.match(r"^\d+\.\d+\.\d+$", str(meta_parsed["version"])):
                    warnings.append({"file": source, "line": raw[:80], "message": f"Version semantica invalida: {meta_parsed['version']}"})
                if "sha256" in meta_parsed and not re.match(r"^[a-fA-F0-9]{64}$", str(meta_parsed["sha256"])):
                    errors.append({"file": source, "line": raw[:80], "message": "SHA-256 invalido (debe ser 64 hex chars)"})
            except json.JSONDecodeError as e:
                errors.append({"file": source, "line": raw[:80], "message": f"Metadata JSON invalido: {e}"})

        # 4. Validar que la skill exista (si es local)
        resolved = resolve_skill_path(url, source)
        if not resolved.startswith(("http://", "https://")):
            skill_path = Path(resolved)
            if not skill_path.exists():
                errors.append({"file": source, "line": raw[:80], "message": f"Skill file no encontrado: {resolved}"})
            else:
                # 5. Validar YAML frontmatter
                skill_text = skill_path.read_text(encoding="utf-8")

                # 4b. Verificar sha256 si fue declarado
                if meta_parsed:
                    declared_hash = meta_parsed.get("sha256")
                    if declared_hash:
                        actual_hash = hashlib.sha256(skill_path.read_bytes().replace(b"\r\n", b"\n")).hexdigest()
                        if actual_hash != declared_hash:
                            errors.append({"file": source, "line": raw[:80], "message": f"SHA-256 mismatch: declarado {declared_hash}, actual {actual_hash}"})
                fm = parse_yaml_frontmatter(skill_text)
                if not fm:
                    errors.append({"file": resolved, "line": "", "message": "Skill sin YAML frontmatter valido"})
                else:
                    required = ["name", "description", "version", "license"]
                    for key in required:
                        if key not in fm:
                            errors.append({"file": resolved, "line": "", "message": f"Frontmatter falta '{key}'"})

        # 6. Validar descripcion no vacia
        if not desc or len(desc) < 10:
            warnings.append({"file": source, "line": raw[:80], "message": "Descripcion muy corta"})

    return errors, warnings


def main() -> int:
    parser = argparse.ArgumentParser(description="Valida un llms.txt y sus skills")
    parser.add_argument("source", help="URL o ruta local al llms.txt")
    parser.add_argument("--strict", action="store_true", help="Tratar warnings como errores")
    args = parser.parse_args()

    try:
        text = fetch_content(args.source)
    except Exception as e:
        print(f"[ERROR] Error leyendo fuente: {e}", file=sys.stderr)
        return 1

    errors, warnings = validate_llms_txt(args.source, text)

    # Mostrar resultados
    exit_code = 0
    for issue in errors:
        print(f"[ERROR] {issue['message']}")
        if issue.get("line"):
            print(f"  Linea: {issue['line']}")
        print(f"  Archivo: {issue['file']}")
        print()
        exit_code = 1

    for issue in warnings:
        print(f"[WARNING] {issue['message']}")
        if issue.get("line"):
            print(f"  Linea: {issue['line']}")
        print(f"  Archivo: {issue['file']}")
        print()

    if exit_code == 0 and not warnings:
        print("[OK] Validacion exitosa. Sin errores ni warnings.")
    elif exit_code == 0:
        print(f"[OK] Validacion exitosa con {len(warnings)} warning(s).")
    else:
        print(f"[FAIL] Validacion fallo. {len(errors)} error(es), {len(warnings)} warning(s).")

    if args.strict and warnings:
        print("[FAIL] Modo estricto: warnings tratados como errores.")
        return 1

    return exit_code


if __name__ == "__main__":
    sys.exit(main())

