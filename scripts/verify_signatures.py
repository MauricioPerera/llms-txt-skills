#!/usr/bin/env python3
"""
verify_signatures.py

Verifica las firmas ed25519 del indice .well-known/agent-skills/index.json
contra el contenido real de cada SKILL.md del repo.

Esto es la capa de AUTENTICIDAD (quien publico la skill), distinta de la capa
de INTEGRIDAD (sha256, que solo prueba que el contenido no cambio en transito).
La firma la genera scripts/generate.py con la clave privada del publisher; aca
solo se necesita la clave publica (incluida en el index) para verificar.

Uso:
    python scripts/verify_signatures.py
    python scripts/verify_signatures.py path/to/index.json
"""

import base64
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INDEX = REPO_ROOT / ".well-known" / "agent-skills" / "index.json"


def read_skill_bytes(url: str, index_path: Path) -> bytes:
    """Lee los bytes normalizados (CRLF->LF) del SKILL.md referenciado por url.

    Lanza OSError con un mensaje claro si la lectura (remota o local) falla,
    en vez de dejar propagar la excepcion original (URLError, socket.timeout,
    FileNotFoundError, etc.) hasta el caller.
    """
    if url.startswith(("http://", "https://")):
        try:
            with urllib.request.urlopen(url, timeout=15) as resp:  # noqa: S310
                data = resp.read()
        except Exception as e:  # noqa: BLE001
            raise OSError(f"no se pudo descargar {url}: {type(e).__name__}: {e}") from e
    else:
        # url relativa al root del sitio: resolver contra el repo.
        local = REPO_ROOT / url.lstrip("/")
        try:
            data = local.read_bytes()
        except OSError as e:
            raise OSError(f"no se pudo leer {local}: {type(e).__name__}: {e}") from e
    return data.replace(b"\r\n", b"\n")


def main() -> int:
    index_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_INDEX
    if not index_path.exists():
        print(f"[SKIP] No existe {index_path}")
        return 0

    doc = json.loads(index_path.read_text(encoding="utf-8"))
    key_b64 = doc.get("signing_key")
    skills = doc.get("skills", [])

    if not key_b64:
        print("[SKIP] El index no declara signing_key; no hay firmas que verificar.")
        return 0

    try:
        from cryptography.exceptions import InvalidSignature
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    except ImportError:
        print("[SKIP] 'cryptography' no instalado; no se pudo verificar firmas.")
        return 0

    pub = Ed25519PublicKey.from_public_bytes(base64.b64decode(key_b64))

    errors = 0
    checked = 0
    for s in skills:
        sig = s.get("signature")
        name = s.get("name", s.get("url", "?"))
        if not sig:
            print(f"[WARN] {name}: sin firma, se omite.")
            continue
        try:
            content = read_skill_bytes(s["url"], index_path)
        except OSError as e:
            print(f"[FAIL] {name}: {e}")
            errors += 1
            continue
        try:
            pub.verify(base64.b64decode(sig), content)
            print(f"[OK] {name}: firma valida.")
            checked += 1
        except InvalidSignature:
            print(f"[FAIL] {name}: FIRMA INVALIDA.")
            errors += 1

    if errors:
        print(f"[FAIL] {errors} firma(s) invalida(s).")
        return 1
    print(f"[OK] {checked} firma(s) verificada(s) contra la clave del publisher.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
