#!/usr/bin/env python3
"""
generate.py

Generador/sincronizador de skills para llms.txt.

A partir de un manifest (scripts/skills-manifest.json) y del frontmatter de cada
SKILL.md publicado, regenera de forma determinista:

  1. La seccion `## Skills` de llms.txt (con version, license y sha256 inline).
  2. La copia de compatibilidad `.well-known/skills/default/SKILL.md`.
  3. El indice `.well-known/agent-skills/index.json` (RFC v0.4 §2.2). El
     documento es un superset del esquema de descubrimiento de agentskills.io
     v0.2.0, de modo que tambien lo descubre y verifica agents.txt sin que el
     publisher mantenga un segundo archivo (ver RFC §3.2).
  4. La copia del consumer skill dentro del plugin de Claude Code
     (plugins/llms-txt-aware/skills/llms-txt-aware/SKILL.md), porque los
     plugins se copian a cache y no pueden referenciar archivos externos.

Esto elimina el trabajo manual y el drift entre fuentes: el sha256, la copia
.well-known y el indice dejan de mantenerse a mano. El sha256 se calcula con
CRLF normalizado a LF, igual que scripts/validate.py.

Uso:
    python scripts/generate.py            # escribe los archivos
    python scripts/generate.py --check    # no escribe; falla (exit 1) si hay drift
"""

import argparse
import base64
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
SIGNING_KEY_PUB = REPO_ROOT / ".well-known" / "agent-skills" / "signing-key.pub"

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
            v = m.group(2).strip()
            # strip one MATCHING pair of quotes (double or single), mirroring
            # the CLI parser (cli/lib/core.mjs parseFrontmatter)
            if len(v) >= 2 and v[0] == v[-1] and v[0] in ('"', "'"):
                v = v[1:-1]
            result[m.group(1)] = v
    return result


def sha256_normalized(path: Path) -> str:
    """SHA-256 del contenido con CRLF normalizado a LF (igual que validate.py)."""
    return hashlib.sha256(path.read_bytes().replace(b"\r\n", b"\n")).hexdigest()


def load_skills(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    """Lee cada SKILL.md publicado y arma su metadata combinando frontmatter + manifest.

    Si la entrada del manifest declara 'tool' (path al tool.js relativo al repo)
    y 'tool_url' (URL/path publico de ese tool.js), la skill se trata como
    ejecutable (Executable Skills extension v0.4 Sec. 2.1): se calcula
    tool_sha256 igual que sha256 (CRLF normalizado a LF) y ambos campos viajan
    juntos en el metadata inline y en el indice. Sin 'tool' -> skill de solo
    prosa, comportamiento identico al anterior.
    """
    skills: list[dict[str, Any]] = []
    for entry in manifest["published"]:
        path = REPO_ROOT / entry["path"]
        if not path.exists():
            raise FileNotFoundError(f"SKILL.md no encontrado: {entry['path']}")
        fm = parse_yaml_frontmatter(path.read_text(encoding="utf-8"))
        for key in REQUIRED_FRONTMATTER:
            if key not in fm:
                raise ValueError(f"{entry['path']}: frontmatter falta '{key}'")

        tool_url = None
        tool_sha256 = None
        if entry.get("tool"):
            if not entry.get("tool_url"):
                raise ValueError(f"{entry['path']}: declara 'tool' sin 'tool_url' (ambos son requeridos juntos)")
            tool_path = REPO_ROOT / entry["tool"]
            if not tool_path.exists():
                raise FileNotFoundError(f"tool.js no encontrado: {entry['tool']}")
            tool_url = entry["tool_url"]
            tool_sha256 = sha256_normalized(tool_path)

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
                "tool_url": tool_url,
                "tool_sha256": tool_sha256,
            }
        )
    return skills


def load_memory(manifest: dict[str, Any]) -> dict[str, Any] | None:
    """Lee la declaracion opcional de origin memory del manifest (Executable
    Skills extension v0.4 Sec. 2.4). manifest["memory"] = {"snapshot_path":
    "<path relativo al repo>", "snapshot_url": "<path publico>", "format":
    "minimemory-okf-v1"}. Sin 'memory' en el manifest -> None (el origin no
    declara memoria, comportamiento identico al anterior).
    """
    memory = manifest.get("memory")
    if not memory:
        return None
    for key in ("snapshot_path", "snapshot_url", "format"):
        if not memory.get(key):
            raise ValueError(f"manifest['memory'] necesita '{key}'")
    snapshot_path = REPO_ROOT / memory["snapshot_path"]
    if not snapshot_path.exists():
        raise FileNotFoundError(f"snapshot no encontrado: {memory['snapshot_path']}")
    return {
        "snapshot_url": memory["snapshot_url"],
        "format": memory["format"],
        "snapshot_sha256": sha256_normalized(snapshot_path),
    }


def render_skills_memory_line(memory: dict[str, Any] | None) -> str:
    """Construye la linea `<!-- skills-memory: {...} -->` (sin 'memory' -> string vacio)."""
    if not memory:
        return ""
    meta = {
        "snapshot": memory["snapshot_url"],
        "snapshot_sha256": memory["snapshot_sha256"],
        "format": memory["format"],
    }
    meta_json = json.dumps(meta, separators=(",", ":"), ensure_ascii=False)
    return f"<!-- skills-memory: {meta_json} -->\n\n"


def render_skills_section(manifest: dict[str, Any], skills: list[dict[str, Any]]) -> str:
    """Construye el bloque ## Skills con metadata inline compacta.

    Skills con tool_url/tool_sha256 (Executable Skills v0.4) llevan 'tool' y
    'tool_sha256' agregados al JSON inline, despues de sha256; skills de solo
    prosa quedan identicas a antes.
    """
    lines = ["## Skills", "", manifest["section_intro"], ""]
    for s in skills:
        meta = {"version": s["version"], "license": s["license"], "sha256": s["sha256"]}
        if s.get("tool_url") and s.get("tool_sha256"):
            meta["tool"] = s["tool_url"]
            meta["tool_sha256"] = s["tool_sha256"]
        meta_json = json.dumps(meta, separators=(",", ":"), ensure_ascii=False)
        lines.append(
            f"- [{s['name']}]({s['url']}): {s['summary']} <!-- skill: {meta_json} -->"
        )
    return "\n".join(lines) + "\n"


MEMORY_LINE_RE = re.compile(r"^<!--\s*skills-memory:\s*\{.*?\}\s*-->\s*$")


def render_llms_txt(current: str, section: str, memory_line: str = "") -> str:
    """Reemplaza (o agrega) la seccion ## Skills al final de llms.txt, preservando
    el resto. Cualquier linea skills-memory preexistente se descarta (se
    regenera determinista desde el manifest); memory_line (si no es "") se
    reinserta justo antes de ## Skills, como exige Sec. 2.4 de la extension.
    """
    out: list[str] = []
    for line in current.splitlines():
        if re.match(r"^##\s+skills\s*$", line.strip(), re.IGNORECASE):
            break
        if MEMORY_LINE_RE.match(line.strip()):
            continue
        out.append(line)
    while out and not out[-1].strip():
        out.pop()
    return "\n".join(out) + "\n\n" + memory_line + section


def load_signing_key(manifest: dict[str, Any]):
    """
    Devuelve la clave privada ed25519 a usar para firmar, o None si no hay firma.

    Soporta dos modos en manifest["signing"]:
    - {"private_key_path": "..."}: clave real del publisher. NUNCA se commitea;
      vive offline / fuera del servidor. Es el modo de produccion.
    - {"demo_seed": "..."}: deriva una clave determinista desde un seed publico,
      solo para que el ejemplo del repo sea reproducible. NO usar en produccion.
    """
    signing = manifest.get("signing")
    if not signing:
        return None

    try:
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    except ImportError as e:
        raise SystemExit(
            "El manifest declara 'signing' pero falta la dependencia 'cryptography'.\n"
            "Instalala con: pip install cryptography"
        ) from e

    path = signing.get("private_key_path")
    if path:
        pem = (REPO_ROOT / path).read_bytes()
        return serialization.load_pem_private_key(pem, password=None)

    seed = signing.get("demo_seed")
    if seed:
        # Seed publico -> clave de demo determinista. Firma ed25519 es determinista
        # (RFC 8032), asi que las firmas resultantes son estables para --check.
        return Ed25519PrivateKey.from_private_bytes(hashlib.sha256(seed.encode()).digest())

    raise ValueError("manifest['signing'] necesita 'private_key_path' o 'demo_seed'")


def public_key_b64(private_key) -> str:
    """Clave publica ed25519 (32 bytes crudos) en base64."""
    from cryptography.hazmat.primitives import serialization

    raw = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    return base64.b64encode(raw).decode()


def sign_skills(skills: list[dict[str, Any]], private_key) -> None:
    """Firma los bytes normalizados de cada SKILL.md y guarda la firma base64 en cada skill."""
    for s in skills:
        normalized = s["path"].read_bytes().replace(b"\r\n", b"\n")
        s["signature"] = base64.b64encode(private_key.sign(normalized)).decode()


# Esquema de descubrimiento de agentskills.io que consume agents.txt
# (https://agents-txt.com, capa "Skills"). Emitir un indice conforme a este
# esquema en la misma ruta .well-known/agent-skills/index.json hace que un solo
# archivo sirva a la vez a los consumidores de este RFC (sha256 + firma ed25519)
# y a los de agents.txt / agentskills.io (type + digest). Ver RFC Sec. 3.2.
AGENTSKILLS_DISCOVERY_SCHEMA = "https://schemas.agentskills.io/discovery/0.2.0/schema.json"


def render_index(skills: list[dict[str, Any]], signing_key_b64: str | None) -> str:
    """Construye el indice .well-known/agent-skills/index.json.

    El documento es un *superset* del esquema de descubrimiento agentskills.io
    v0.2.0: cada skill lleva los campos que ese esquema espera (name, type,
    description, url, digest) mas las extensiones de este RFC (version, license,
    homepage, sha256, signature). `digest` es el mismo hash que `sha256` pero con
    el prefijo "sha256:" que usa agentskills.io; se mantienen ambos para no
    romper a los consumidores existentes (MCP server, verify_signatures.py) que
    leen `sha256` crudo. Asi agents.txt descubre y verifica estas skills sin que
    el publisher mantenga un segundo archivo.
    """
    items: list[dict[str, Any]] = []
    for s in skills:
        # Campos del esquema agentskills.io v0.2.0 primero, en su orden.
        item: dict[str, Any] = {
            "name": s["name"],
            "type": "skill-md",
            "description": s["description"],
            "url": s["url"],
            "digest": f"sha256:{s['sha256']}",
        }
        # Extensiones de este RFC.
        item["version"] = s["version"]
        item["license"] = s["license"]
        if s["homepage"]:
            item["homepage"] = s["homepage"]
        item["sha256"] = s["sha256"]
        if s.get("tool_url") and s.get("tool_sha256"):
            item["tool"] = s["tool_url"]
            item["tool_sha256"] = s["tool_sha256"]
        if s.get("signature"):
            item["signature"] = s["signature"]
        items.append(item)

    doc: dict[str, Any] = {"$schema": AGENTSKILLS_DISCOVERY_SCHEMA}
    if signing_key_b64:
        doc["signing_alg"] = "ed25519"
        doc["signing_key"] = signing_key_b64
    doc["skills"] = items
    return json.dumps(doc, indent=2, ensure_ascii=False) + "\n"


def build_targets(manifest: dict[str, Any], skills: list[dict[str, Any]]) -> list[tuple[Path, str]]:
    section = render_skills_section(manifest, skills)
    memory = load_memory(manifest)
    memory_line = render_skills_memory_line(memory)
    new_llms = render_llms_txt(LLMS_TXT_PATH.read_text(encoding="utf-8"), section, memory_line)

    default_name = manifest["default_skill"]
    try:
        default_skill = next(s for s in skills if s["name"] == default_name)
    except StopIteration:
        raise ValueError(f"default_skill '{default_name}' no esta en la lista published")
    new_default = default_skill["path"].read_text(encoding="utf-8")

    # Firma (autenticidad). Opcional: solo si el manifest declara "signing".
    private_key = load_signing_key(manifest)
    signing_key_b64 = None
    if private_key is not None:
        sign_skills(skills, private_key)
        signing_key_b64 = public_key_b64(private_key)

    new_index = render_index(skills, signing_key_b64)

    targets = [
        (LLMS_TXT_PATH, new_llms),
        (WELL_KNOWN_DEFAULT, new_default),
        (AGENT_SKILLS_INDEX, new_index),
    ]

    if signing_key_b64:
        targets.append((SIGNING_KEY_PUB, signing_key_b64 + "\n"))

    # Sincronizar la copia del consumer skill dentro del plugin de Claude Code.
    plugin = manifest.get("consumer_plugin")
    if plugin:
        src = REPO_ROOT / plugin["skill"]
        if not src.exists():
            raise FileNotFoundError(f"consumer_plugin.skill no encontrado: {plugin['skill']}")
        targets.append((REPO_ROOT / plugin["dest"], src.read_text(encoding="utf-8")))

    return targets


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
