#!/usr/bin/env python3
"""
MCP server for llms.txt Skills discovery.

Exposes the `llms-txt-aware` workflow as MCP tools so that any MCP-capable
runtime (Claude Desktop, Cline, Continue, Cursor, Windsurf, ...) can:

  1. read a domain's `/llms.txt` in full (its operating manual),
  2. discover the Agent Skills it publishes via the `## Skills` section,
  3. fetch a published SKILL.md and verify its integrity (sha256) and
     authenticity (ed25519 signature from `.well-known/agent-skills/index.json`).

See the spec: https://github.com/MauricioPerera/llms-txt-skills

This file is a standalone distributable: it has no repo-relative imports so it
can be dropped into any MCP client config.
"""

import base64
import hashlib
import json
import re
from enum import Enum
from typing import Any, Optional
from urllib.parse import urljoin, urlparse

import httpx
from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, ConfigDict, Field

mcp = FastMCP("llms_txt_skills_mcp")

USER_AGENT = "llms-txt-skills-mcp/1.0 (+https://github.com/MauricioPerera/llms-txt-skills)"
HTTP_TIMEOUT = 10.0


# --------------------------------------------------------------------------- #
# Shared helpers
# --------------------------------------------------------------------------- #
def _origin_of(url: str) -> Optional[str]:
    """Return the scheme://host[:port] origin of a URL, or None if not absolute."""
    try:
        parts = urlparse(url if "//" in url else f"https://{url}")
    except ValueError:
        return None
    if not parts.scheme or not parts.netloc:
        return None
    return f"{parts.scheme}://{parts.netloc}"


def _looks_like_html(content_type: str, body: str) -> bool:
    head = body.lstrip().lower()
    return "html" in content_type.lower() or head.startswith(("<!doctype html", "<html"))


async def _http_get(url: str) -> Optional[httpx.Response]:
    """GET a URL, following redirects. Returns the response or None on any error."""
    try:
        async with httpx.AsyncClient(
            headers={"User-Agent": USER_AGENT}, follow_redirects=True, timeout=HTTP_TIMEOUT
        ) as client:
            return await client.get(url)
    except httpx.HTTPError:
        return None


async def _fetch_llms_txt(origin: str) -> Optional[str]:
    """Fetch {origin}/llms.txt. None on non-200, error, or an HTML (SPA) body."""
    resp = await _http_get(origin.rstrip("/") + "/llms.txt")
    if resp is None or resp.status_code != 200:
        return None
    if _looks_like_html(resp.headers.get("content-type", ""), resp.text):
        return None
    return resp.text


def _parse_skills_section(text: str) -> list[dict[str, Any]]:
    """Extract the `## Skills` section. Returns dicts with title, url, description, metadata."""
    item_re = re.compile(
        r"^-\s*\[([^\]]+)\]\(([^)]+)\)\s*:\s*(.+?)(?:\s*<!--\s*skill:\s*(\{.*?\})\s*-->)?\s*$"
    )
    skills: list[dict[str, Any]] = []
    in_section = False
    for line in text.splitlines():
        stripped = line.strip()
        if re.match(r"^##\s+skills\s*$", stripped, re.IGNORECASE):
            in_section = True
            continue
        if in_section and stripped.startswith("## "):
            break
        if in_section:
            m = item_re.match(stripped)
            if m:
                entry: dict[str, Any] = {
                    "title": m.group(1).strip(),
                    "url": m.group(2).strip(),
                    "description": m.group(3).strip(),
                }
                if m.group(4):
                    try:
                        entry["metadata"] = json.loads(m.group(4))
                    except json.JSONDecodeError:
                        pass
                skills.append(entry)
    return skills


async def _fetch_index(origin: str) -> Optional[dict[str, Any]]:
    """Fetch and parse {origin}/.well-known/agent-skills/index.json."""
    resp = await _http_get(origin.rstrip("/") + "/.well-known/agent-skills/index.json")
    if resp is None or resp.status_code != 200:
        return None
    try:
        return resp.json()
    except (json.JSONDecodeError, ValueError):
        return None


def _verify_signature(content: bytes, signature_b64: str, key_b64: str) -> Optional[bool]:
    """Verify an ed25519 signature. Returns True/False, or None if crypto is unavailable."""
    try:
        from cryptography.exceptions import InvalidSignature
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    except ImportError:
        return None
    pub = Ed25519PublicKey.from_public_bytes(base64.b64decode(key_b64))
    try:
        pub.verify(base64.b64decode(signature_b64), content)
        return True
    except InvalidSignature:
        return False


# --------------------------------------------------------------------------- #
# Input models
# --------------------------------------------------------------------------- #
class ResponseFormat(str, Enum):
    MARKDOWN = "markdown"
    JSON = "json"


class UrlInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    url: str = Field(
        ...,
        description="Any URL or domain of the target site (e.g. 'https://example.com/api/x' or 'example.com'). The origin is used to locate /llms.txt.",
        min_length=3,
        max_length=2048,
    )


class DiscoverInput(UrlInput):
    response_format: ResponseFormat = Field(
        default=ResponseFormat.MARKDOWN,
        description="'markdown' for a human-readable list or 'json' for structured data.",
    )


class FetchSkillInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    skill_url: str = Field(
        ...,
        description="Absolute URL to a SKILL.md published by a site (from llmstxt_discover_skills).",
        min_length=10,
        max_length=2048,
    )
    verify: bool = Field(
        default=True,
        description="If true, verify sha256 integrity and ed25519 signature against the site's index.json before returning.",
    )


# --------------------------------------------------------------------------- #
# Tools
# --------------------------------------------------------------------------- #
@mcp.tool(
    name="llmstxt_read",
    annotations={
        "title": "Read a site's llms.txt",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": True,
    },
)
async def llmstxt_read(params: UrlInput) -> str:
    """Fetch a domain's `/llms.txt` in full and return it verbatim.

    `/llms.txt` is the site's operating manual for agents: endpoints, parameters,
    limits, canonical examples, agent notes, and any published skills. Read it
    BEFORE interacting with a domain you have not checked this session.

    Args:
        params (UrlInput): { url: any URL/domain of the target site }

    Returns:
        str: The raw llms.txt content, or a short message if the site has none.
    """
    origin = _origin_of(params.url)
    if not origin:
        return f"Error: '{params.url}' is not a valid URL or domain."
    text = await _fetch_llms_txt(origin)
    if text is None:
        return f"No /llms.txt found at {origin} (404, error, or HTML response). Proceed with normal tools."
    return f"# llms.txt for {origin}\n\n{text}"


@mcp.tool(
    name="llmstxt_discover_skills",
    annotations={
        "title": "Discover skills published via llms.txt",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": True,
    },
)
async def llmstxt_discover_skills(params: DiscoverInput) -> str:
    """Discover the Agent Skills a site publishes in the `## Skills` section of its llms.txt.

    Use when a user mentions a domain and you want to know whether it ships
    purpose-built skills before acting with generic tools. Never auto-load a
    skill: surface them and let the user opt in, then use llmstxt_fetch_skill.

    Args:
        params (DiscoverInput): { url, response_format }

    Returns:
        str: Markdown or JSON listing each skill's title, absolute URL,
        description and inline version (if declared). Schema (json):
        {
          "origin": str,
          "count": int,
          "skills": [
            {"title": str, "url": str, "description": str, "version": str|null}
          ]
        }
    """
    origin = _origin_of(params.url)
    if not origin:
        return f"Error: '{params.url}' is not a valid URL or domain."
    text = await _fetch_llms_txt(origin)
    if text is None:
        return f"No /llms.txt found at {origin}; no skills to discover."

    skills = _parse_skills_section(text)
    resolved = []
    for s in skills:
        meta = s.get("metadata") or {}
        resolved.append(
            {
                "title": s["title"],
                "url": urljoin(origin + "/", s["url"]),
                "description": s["description"],
                "version": meta.get("version"),
            }
        )

    if params.response_format == ResponseFormat.JSON:
        return json.dumps(
            {"origin": origin, "count": len(resolved), "skills": resolved},
            indent=2,
            ensure_ascii=False,
        )

    if not resolved:
        return f"{origin} has an llms.txt but no `## Skills` section."
    lines = [f"# {len(resolved)} skill(s) published by {origin}", ""]
    for s in resolved:
        ver = f" (v{s['version']})" if s["version"] else ""
        lines.append(f"## {s['title']}{ver}")
        lines.append(f"- {s['description']}")
        lines.append(f"- Load with `llmstxt_fetch_skill`: {s['url']}")
        lines.append("")
    return "\n".join(lines)


@mcp.tool(
    name="llmstxt_fetch_skill",
    annotations={
        "title": "Fetch and verify a published skill",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": True,
    },
)
async def llmstxt_fetch_skill(params: FetchSkillInput) -> str:
    """Fetch a published SKILL.md and (optionally) verify its integrity and authenticity.

    Verification uses the site's `/.well-known/agent-skills/index.json`:
    - integrity: sha256 of the content (CRLF normalized) vs the declared hash.
    - authenticity: ed25519 signature vs the index's `signing_key`.

    A failed integrity or signature check is a strong signal to NOT load the skill.

    Args:
        params (FetchSkillInput): { skill_url, verify }

    Returns:
        str: JSON with schema:
        {
          "skill_url": str,
          "content": str,            # the SKILL.md text
          "integrity": "ok"|"mismatch"|"absent",
          "authenticity": "ok"|"invalid"|"absent"|"unsupported",
          "notes": str
        }
    """
    resp = await _http_get(params.skill_url)
    if resp is None or resp.status_code != 200:
        return json.dumps(
            {"skill_url": params.skill_url, "error": "Could not fetch the skill URL."}
        )
    content = resp.text
    result: dict[str, Any] = {
        "skill_url": params.skill_url,
        "content": content,
        "integrity": "absent",
        "authenticity": "absent",
        "notes": "",
    }

    if not params.verify:
        result["notes"] = "Verification skipped (verify=false)."
        return json.dumps(result, ensure_ascii=False, indent=2)

    origin = _origin_of(params.skill_url)
    index = await _fetch_index(origin) if origin else None
    if not index:
        result["notes"] = "No index.json published; could not verify. Treat as unverified."
        return json.dumps(result, ensure_ascii=False, indent=2)

    skill_path = urlparse(params.skill_url).path
    entry = next(
        (s for s in index.get("skills", []) if urlparse(urljoin(origin + "/", s.get("url", ""))).path == skill_path),
        None,
    )
    if not entry:
        result["notes"] = "Skill not listed in index.json; could not verify."
        return json.dumps(result, ensure_ascii=False, indent=2)

    normalized = content.encode("utf-8", "replace").replace(b"\r\n", b"\n")

    declared_hash = entry.get("sha256")
    if declared_hash:
        actual = hashlib.sha256(normalized).hexdigest()
        result["integrity"] = "ok" if actual == declared_hash else "mismatch"

    signature = entry.get("signature")
    key = index.get("signing_key")
    if signature and key:
        verdict = _verify_signature(normalized, signature, key)
        if verdict is None:
            result["authenticity"] = "unsupported"
            result["notes"] = "Install 'cryptography' to verify ed25519 signatures."
        else:
            result["authenticity"] = "ok" if verdict else "invalid"

    if result["integrity"] == "mismatch" or result["authenticity"] == "invalid":
        result["notes"] = "VERIFICATION FAILED — do not load this skill without user confirmation."

    return json.dumps(result, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    mcp.run()
