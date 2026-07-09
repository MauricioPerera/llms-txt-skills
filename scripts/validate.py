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

MEMORY_RE = re.compile(r"^<!--\s*skills-memory:\s*(.*?)\s*-->\s*$")


def validate_skills_memory(source: str, text: str, errors: list[dict[str, str]], warnings: list[dict[str, str]]) -> None:
    """Valida la linea opcional de origin memory (Executable Skills v0.4 Sec. 2.4):
    <!-- skills-memory: {"snapshot":"...","snapshot_sha256":"...","format":"..."} -->
    Ausente -> no hace nada (es opcional). Requiere snapshot/snapshot_sha256/format
    (los 3 strings); snapshot_sha256 debe ser hex de 64 caracteres. Si el snapshot
    resuelve a un archivo local, verifica el hash real contra el declarado.
    """
    memory_line = None
    for line in text.splitlines():
        m = MEMORY_RE.match(line.strip())
        if m:
            memory_line = m.group(1)
            break
    if memory_line is None:
        return

    try:
        meta = json.loads(memory_line)
    except json.JSONDecodeError as e:
        errors.append({"file": source, "line": memory_line[:80], "message": f"skills-memory: JSON invalido: {e}"})
        return

    for key in ("snapshot", "snapshot_sha256", "format"):
        if key not in meta or not isinstance(meta[key], str):
            errors.append({"file": source, "line": memory_line[:80], "message": f"skills-memory: falta o invalido '{key}' (debe ser string)"})
    if any(k not in meta or not isinstance(meta[k], str) for k in ("snapshot", "snapshot_sha256", "format")):
        return

    if not re.match(r"^[a-fA-F0-9]{64}$", meta["snapshot_sha256"]):
        errors.append({"file": source, "line": memory_line[:80], "message": "skills-memory: snapshot_sha256 invalido (debe ser 64 hex chars)"})

    if meta["format"] != "minimemory-okf-v1":
        warnings.append({"file": source, "line": memory_line[:80], "message": f"skills-memory: format '{meta['format']}' no es el unico reconocido hoy (minimemory-okf-v1); un runtime que no lo soporte debe ignorar la capability, no fallar"})

    resolved = resolve_skill_path(meta["snapshot"], source)
    if not resolved.startswith(("http://", "https://")):
        snapshot_path = Path(resolved)
        if not snapshot_path.exists():
            errors.append({"file": source, "line": memory_line[:80], "message": f"skills-memory: snapshot no encontrado: {resolved}"})
        elif re.match(r"^[a-fA-F0-9]{64}$", meta["snapshot_sha256"]):
            actual = hashlib.sha256(snapshot_path.read_bytes().replace(b"\r\n", b"\n")).hexdigest()
            if actual != meta["snapshot_sha256"]:
                errors.append({"file": source, "line": memory_line[:80], "message": f"skills-memory: snapshot_sha256 mismatch: declarado {meta['snapshot_sha256']}, actual {actual}"})


def validate_llms_txt(source: str, text: str) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    """Valida llms.txt y retorna (errores, warnings)."""
    errors: list[dict[str, str]] = []
    warnings: list[dict[str, str]] = []

    validate_skills_memory(source, text, errors, warnings)

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
                # Executable Skills extension v0.4: 'tool' y 'tool_sha256' viajan
                # juntos (Sec 2.1). Uno sin el otro es una declaracion a medias.
                has_tool = "tool" in meta_parsed
                has_tool_sha = "tool_sha256" in meta_parsed
                if has_tool and not has_tool_sha:
                    errors.append({"file": source, "line": raw[:80], "message": "'tool' declarado sin 'tool_sha256' (ambos son requeridos juntos, Executable Skills v0.4)"})
                if has_tool_sha and not has_tool:
                    errors.append({"file": source, "line": raw[:80], "message": "'tool_sha256' declarado sin 'tool' (ambos son requeridos juntos, Executable Skills v0.4)"})
                if has_tool_sha and not re.match(r"^[a-fA-F0-9]{64}$", str(meta_parsed["tool_sha256"])):
                    errors.append({"file": source, "line": raw[:80], "message": "tool_sha256 invalido (debe ser 64 hex chars)"})
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

                # 4c. Executable Skills v0.4: si 'tool' resuelve a un archivo local,
                # verificar tool_sha256 contra los bytes reales del tool.js.
                if meta_parsed and meta_parsed.get("tool") and meta_parsed.get("tool_sha256"):
                    tool_resolved = resolve_skill_path(meta_parsed["tool"], source)
                    if not tool_resolved.startswith(("http://", "https://")):
                        tool_path = Path(tool_resolved)
                        if not tool_path.exists():
                            errors.append({"file": source, "line": raw[:80], "message": f"tool.js no encontrado: {tool_resolved}"})
                        else:
                            actual_tool_hash = hashlib.sha256(tool_path.read_bytes().replace(b"\r\n", b"\n")).hexdigest()
                            if actual_tool_hash != meta_parsed["tool_sha256"]:
                                errors.append({"file": source, "line": raw[:80], "message": f"tool_sha256 mismatch: declarado {meta_parsed['tool_sha256']}, actual {actual_tool_hash}"})
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

