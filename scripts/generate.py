#!/usr/bin/env python3
"""
generate.py

Generador/sincronizador de skills para llms.txt.

A partir de un manifest (scripts/skills-manifest.json) y del frontmatter de cada
SKILL.md publicado, regenera de forma determinista:

  1. La seccion `## Skills` de llms.txt (con version, license y sha256 inline).
  2. La copia de compatibilidad `.well-known/skills/default/SKILL.md`.
  3. El indice canonico `.well-known/agent-skills/index.json` (RFC v0.4 §2.2).

Esto elimina el trabajo manual y el drift entre fuentes: el sha256, la copia
.well-known y el indice dejan de mantenerse a mano. El sha256 se calcula con
CRLF normalizado a LF, igual que scripts/validate.py.

Uso:
    python scripts/generate.py            # escribe los archivos
    python scripts/generate.py --check    # no escribe; falla (exit 1) si hay drift
"""

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = REPO_ROOT / "scripts" / "skills-manifest.json"
LLMS_TXT_PATH = REPO_ROOT / "llms.txt"
WELL_KNOWN_DEFAULT = REPO_ROOT / ".well-known" / "skills" / "default" / "SKILL.md"
AGENT_SKILLS_INDEX = REPO_ROOT / ".well-known" / "agent-skills" / "index.json"

REQUIRED_FRONTMATTER = ("name", "description", "version", "license")


def parse_yaml_frontmatter(text: str) -> dict[str, str]:
    """Extrae YAML frontmatter plano (key: value) de un SKILL.md."""
    if not text.startswith("---"):
        return {}
    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}
    result: dict[str, str] = {}
    for line in parts[1].strip().splitlines():
        m = re.match(r"^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$", line)
        if m:
            result[m.group(1)] = m.group(2).strip().strip('"')
    return result


def sha256_normalized(path: Path) -> str:
    """SHA-256 del contenido con CRLF normalizado a LF (igual que validate.py)."""
    return hashlib.sha256(path.read_bytes().replace(b"\r\n", b"\n")).hexdigest()


def load_skills(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    """Lee cada SKILL.md publicado y arma su metadata combinando frontmatter + manifest."""
    skills: list[dict[str, Any]] = []
    for entry in manifest["published"]:
        path = REPO_ROOT / entry["path"]
        if not path.exists():
            raise FileNotFoundError(f"SKILL.md no encontrado: {entry['path']}")
        fm = parse_yaml_frontmatter(path.read_text(encoding="utf-8"))
        for key in REQUIRED_FRONTMATTER:
            if key not in fm:
                raise ValueError(f"{entry['path']}: frontmatter falta '{key}'")
        skills.append(
            {
                "name": fm["name"],
                "description": fm["description"],
                "version": fm["version"],
                "license": fm["license"],
                "homepage": fm.get("homepage"),
                "url": entry["url"],
                "summary": entry["summary"],
                "sha256": sha256_normalized(path),
                "path": path,
            }
        )
    return skills


def render_skills_section(manifest: dict[str, Any], skills: list[dict[str, Any]]) -> str:
    """Construye el bloque ## Skills con metadata inline compacta."""
    lines = ["## Skills", "", manifest["section_intro"], ""]
    for s in skills:
        meta = {"version": s["version"], "license": s["license"], "sha256": s["sha256"]}
        meta_json = json.dumps(meta, separators=(",", ":"), ensure_ascii=False)
        lines.append(
            f"- [{s['name']}]({s['url']}): {s['summary']} <!-- skill: {meta_json} -->"
        )
    return "\n".join(lines) + "\n"


def render_llms_txt(current: str, section: str) -> str:
    """Reemplaza (o agrega) la seccion ## Skills al final de llms.txt, preservando el resto."""
    out: list[str] = []
    for line in current.splitlines():
        if re.match(r"^##\s+skills\s*$", line.strip(), re.IGNORECASE):
            break
        out.append(line)
    while out and not out[-1].strip():
        out.pop()
    return "\n".join(out) + "\n\n" + section


def render_index(skills: list[dict[str, Any]]) -> str:
    """Construye el indice canonico .well-known/agent-skills/index.json."""
    items: list[dict[str, Any]] = []
    for s in skills:
        item: dict[str, Any] = {
            "name": s["name"],
            "description": s["description"],
            "version": s["version"],
            "license": s["license"],
        }
        if s["homepage"]:
            item["homepage"] = s["homepage"]
        item["url"] = s["url"]
        item["sha256"] = s["sha256"]
        items.append(item)
    return json.dumps({"skills": items}, indent=2, ensure_ascii=False) + "\n"


def build_targets(manifest: dict[str, Any], skills: list[dict[str, Any]]) -> list[tuple[Path, str]]:
    section = render_skills_section(manifest, skills)
    new_llms = render_llms_txt(LLMS_TXT_PATH.read_text(encoding="utf-8"), section)

    default_name = manifest["default_skill"]
    try:
        default_skill = next(s for s in skills if s["name"] == default_name)
    except StopIteration:
        raise ValueError(f"default_skill '{default_name}' no esta en la lista published")
    new_default = default_skill["path"].read_text(encoding="utf-8")

    new_index = render_index(skills)

    return [
        (LLMS_TXT_PATH, new_llms),
        (WELL_KNOWN_DEFAULT, new_default),
        (AGENT_SKILLS_INDEX, new_index),
    ]


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Genera/sincroniza skills en llms.txt y .well-known"
    )
    ap.add_argument(
        "--check",
        action="store_true",
        help="No escribe; falla con exit 1 si algun archivo esta desactualizado",
    )
    args = ap.parse_args()

    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    skills = load_skills(manifest)
    targets = build_targets(manifest, skills)

    # Comparacion insensible a fin de linea: solo importa el contenido.
    drift = [
        path
        for path, content in targets
        if (path.read_text(encoding="utf-8") if path.exists() else None) != content
    ]

    if args.check:
        if drift:
            print("[DRIFT] Archivos desactualizados. Corre: python scripts/generate.py")
            for p in drift:
                print(f"  - {p.relative_to(REPO_ROOT)}")
            return 1
        print("[OK] Todo sincronizado.")
        return 0

    for path, content in targets:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8", newline="\n")
        print(f"[WRITE] {path.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
