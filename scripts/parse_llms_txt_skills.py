#!/usr/bin/env python3
"""
parse_llms_txt_skills.py

Parser de referencia para extraer la seccion ## Skills de un archivo llms.txt.
Cumple con el RFC v0.2 de img.automators.work.

Uso:
    python parse_llms_txt_skills.py https://ejemplo.com/llms.txt
    python parse_llms_txt_skills.py ./llms.txt
"""

import argparse
import json
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
    """Lee contenido desde URL o archivo local."""
    if source.startswith(("http://", "https://")):
        if urllib.request is None:
            raise RuntimeError("urllib.request no esta disponible")
        with urllib.request.urlopen(source, timeout=15) as resp:  # type: ignore
            return resp.read().decode("utf-8", errors="replace")
    else:
        path = Path(source)
        if not path.exists():
            raise FileNotFoundError(f"Archivo no encontrado: {source}")
        return path.read_text(encoding="utf-8")


def parse_skills_section(text: str) -> list[dict[str, Any]]:
    """
    Extrae la seccion ## Skills de un llms.txt.

    Reglas:
    - Heading exacto: ## Skills (case-insensitive)
    - Cada entrada: - [title](URL): description <!-- skill: {...} -->
    - La seccion termina al encontrar otro heading de nivel 2 (## ...) o fin de documento.
    """
    skills: list[dict[str, Any]] = []

    # Normalizar line breaks
    lines = text.splitlines()

    in_skills_section = False
    skill_block: list[str] = []

    for line in lines:
        stripped = line.strip()

        # Detectar inicio de seccion
        if re.match(r"^##\s+skills\s*$", stripped, re.IGNORECASE):
            in_skills_section = True
            continue

        # Si ya estamos en la seccion y encontramos otro ## ... termina
        if in_skills_section and re.match(r"^##\s+", stripped, re.IGNORECASE):
            break

        if in_skills_section:
            skill_block.append(line)

    if not skill_block:
        return skills

    # Parsear cada item de la lista
    # Un item puede ocupar multiples lineas si hay soft-wraps o comentarios largos
    current_item: list[str] = []
    for line in skill_block:
        stripped = line.strip()
        if not stripped:
            continue

        # Nueva lista markdown
        if stripped.startswith("- "):
            if current_item:
                parsed = _parse_skill_item("\n".join(current_item))
                if parsed:
                    skills.append(parsed)
            current_item = [stripped]
        else:
            # Continuacion del item anterior
            if current_item:
                current_item.append(stripped)

    # No olvidar el ultimo item
    if current_item:
        parsed = _parse_skill_item("\n".join(current_item))
        if parsed:
            skills.append(parsed)

    return skills


def _parse_skill_item(raw: str) -> dict[str, Any] | None:
    """Parsea un solo item de la lista de skills."""
    # Patron: - [title](url): description <!-- skill: {...} -->
    # Mas permisivo con whitespace y multiline
    pattern = re.compile(
        r"^-\s*\[([^\]]+)\]\s*\(((?:[^()]|\([^)]*\))*)\)\s*:\s*(.+?)(?:\s*<!--\s*skill:\s*(\{.*?\})\s*-->)?$",
        re.DOTALL | re.IGNORECASE,
    )

    m = pattern.match(raw.strip())
    if not m:
        return None

    title = m.group(1).strip()
    url = m.group(2).strip()
    description = m.group(3).strip()
    meta_raw = m.group(4)

    result: dict[str, Any] = {
        "title": title,
        "url": url,
        "description": description,
    }

    if meta_raw:
        try:
            result["metadata"] = json.loads(meta_raw)
        except json.JSONDecodeError:
            result["metadata_raw"] = meta_raw

    return result


def resolve_url(skill_url: str, base_url: str) -> str:
    """Resuelve URLs relativas a absolutas usando la fuente como base."""
    # Si la fuente es una URL HTTP(S), usar urljoin
    if base_url.startswith(("http://", "https://")):
        return urllib.parse.urljoin(base_url, skill_url)

    # Si la fuente es un archivo local, resolver relativo al directorio del llms.txt
    base_path = Path(base_url).parent.resolve()
    # Si la skill_url empieza con /, tratar como relativo al directorio del llms.txt
    # Si es relativa sin /, urljoin de pathlib la maneja bien
    resolved = (base_path / skill_url.lstrip("/")).resolve()
    return str(resolved)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Extrae la seccion ## Skills de un llms.txt"
    )
    parser.add_argument("source", help="URL o ruta local al llms.txt")
    parser.add_argument(
        "--resolve",
        action="store_true",
        help="Convierte URLs relativas a absolutas usando la fuente como base",
    )
    args = parser.parse_args()

    try:
        text = fetch_content(args.source)
    except Exception as e:
        print(f"[ERROR] Error leyendo fuente: {e}", file=sys.stderr)
        return 1

    skills = parse_skills_section(text)

    if not skills:
        print(json.dumps({"skills": [], "count": 0}, indent=2))
        return 0

    if args.resolve:
        for s in skills:
            s["url"] = resolve_url(s["url"], args.source)

    output = {
        "source": args.source,
        "skills": skills,
        "count": len(skills),
    }

    print(json.dumps(output, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())

