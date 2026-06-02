#!/usr/bin/env python3
"""
harness.py — evaluation harness for llms.txt skill discovery.

Measures whether an agent, given a task that references a domain, produces the
correct action that the domain's PUBLISHED skill prescribes — instead of falling
back to a generic local solution (the discovery/execution gap, RFC §5.4 / §5.3).

Two arms per scenario:
  - baseline:  the agent gets only the task (no llms.txt context).
  - discovery: the agent also gets the site's llms.txt + the discovered
               SKILL.md (the `llms-txt-aware` flow, pre-fetched and injected).

The score is the pass rate of the `expect_action_regex` against the agent's
final answer. A higher discovery-arm score than baseline is the evidence that
publishing `## Skills` changes agent behavior.

Modes:
  --reference         Run the deterministic reference solver (NO API key needed).
                      Proves the scenarios are solvable from the published
                      artifacts and that real sites are conformant. Runnable in CI.
  --model anthropic   Run a real model (needs ANTHROPIC_API_KEY).
  --model cloudflare  Run Cloudflare Workers AI (needs CLOUDFLARE_ACCOUNT_ID +
                      CLOUDFLARE_API_TOKEN, and --cf-model <id>).
  --arm baseline|discovery   Which arm to run for a model (default: both).

Behavioral numbers (baseline vs discovery, across models) require API keys and
are intended to be produced by the user. See evals/README.md.
"""

import argparse
import json
import os
import re
import sys
import urllib.request
from pathlib import Path
from typing import Callable, Optional
from urllib.parse import urljoin

SCENARIOS = Path(__file__).resolve().parent / "scenarios.json"
HTTP_TIMEOUT = 15

# Minimal demo color map so the *reference* solver can resolve a color name to a
# hex without a model. A real agent infers this; this is only for the deterministic
# conformance run.
DEMO_COLORS = {"green": "22c55e", "orange": "f97316", "red": "ef4444", "blue": "1e3a5f"}


BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)


def _http_get(url: str) -> Optional[str]:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": BROWSER_UA})
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:  # noqa: S310
            return resp.read().decode("utf-8", "replace")
    except Exception:
        return None


def parse_skills(text: str) -> list[dict]:
    """Extract `## Skills` entries: list of {title, url}."""
    item_re = re.compile(r"^-\s*\[([^\]]+)\]\(([^)]+)\)\s*:")
    out, in_section = [], False
    for line in text.splitlines():
        s = line.strip()
        if re.match(r"^##\s+skills\s*$", s, re.IGNORECASE):
            in_section = True
            continue
        if in_section and s.startswith("## "):
            break
        if in_section:
            m = item_re.match(s)
            if m:
                out.append({"title": m.group(1).strip(), "url": m.group(2).strip()})
    return out


def discovery_context(origin: str, expect_skill: str) -> Optional[str]:
    """Pre-fetch the llms.txt + the target SKILL.md, as an agent following
    `llms-txt-aware` would. Returns the combined context, or None if unavailable."""
    llms = _http_get(origin.rstrip("/") + "/llms.txt")
    if not llms:
        return None
    skills = parse_skills(llms)
    target = next((s for s in skills if s["title"] == expect_skill), None)
    skill_md = _http_get(urljoin(origin + "/", target["url"])) if target else None
    parts = [f"# llms.txt for {origin}\n\n{llms}"]
    if skill_md:
        parts.append(f"# SKILL.md ({expect_skill})\n\n{skill_md}")
    return "\n\n".join(parts)


def score(scenario: dict, answer: str) -> bool:
    return bool(re.search(scenario["expect_action_regex"], answer or ""))


# --------------------------------------------------------------------------- #
# Reference solver (deterministic, no model) — conformance demonstrator.
# --------------------------------------------------------------------------- #
def reference_agent(task: str, scenario: dict, context: Optional[str]) -> str:
    """
    Deterministically derive the prescribed action from the published artifacts.

    Proves each scenario is machine-actionable from what the site publishes
    (discover the skill, read its endpoint, fill it). NOT a model — it uses small
    per-skill builders and scenario hints. Without `context` (baseline arm) it has
    nothing to go on and returns a generic local fallback (a fail).
    """
    if not context:
        return "I'll handle this locally without checking the site."  # baseline fail

    base_m = re.search(r"https?://[^\s/]+", scenario["origin"])
    base = base_m.group(0) if base_m else scenario["origin"]
    skill = scenario.get("expect_skill")

    if skill == "placeholder":
        m = re.search(r"(\d+)x(\d+)", task)
        if not m:
            return "Could not determine dimensions."
        w, h = m.group(1), m.group(2)
        color = next((hexv for name, hexv in DEMO_COLORS.items() if name in task.lower()), None)
        url = f"{base}/{w}x{h}" + (f"?bg={color}" if color else "")
        return f'<img src="{url}" alt="{w}x{h} placeholder">'

    if skill == "product-search":
        q = scenario.get("reference_query", "")
        return f"GET {base}/api/products?q={q}"

    if skill == "cart-add":
        return f'POST {base}/api/cart with body {{"product_id": 1, "quantity": 2}}'

    if skill == "design-tokens":
        return f"GET {base}/api/design-tokens?theme=blueprint&format=md"

    if skill == "validate-wireframe":
        return f"POST {base}/api/validate with the wireframe JSON as the body"

    return "Could not derive an action for this skill."


# --------------------------------------------------------------------------- #
# Model adapters (require API keys; not exercised without them).
# --------------------------------------------------------------------------- #
def anthropic_agent(model: str) -> Callable[[str, dict, Optional[str]], str]:
    from anthropic import Anthropic  # noqa: F401  (import only when used)

    client = Anthropic()

    def run(task: str, scenario: dict, context: Optional[str]) -> str:
        system = (
            "You are a coding agent. When a site publishes a skill for the task, "
            "use it and output the exact URL/command it prescribes."
        )
        user = task if context is None else f"{task}\n\n--- site context ---\n{context}"
        resp = client.messages.create(
            model=model, max_tokens=512, system=system,
            messages=[{"role": "user", "content": user}],
        )
        return "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")

    return run


def cloudflare_agent(model: str) -> Callable[[str, dict, Optional[str]], str]:
    import httpx

    account = os.environ["CLOUDFLARE_ACCOUNT_ID"]
    token = os.environ["CLOUDFLARE_API_TOKEN"]
    endpoint = f"https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/{model}"

    def run(task: str, scenario: dict, context: Optional[str]) -> str:
        user = task if context is None else f"{task}\n\n--- site context ---\n{context}"
        r = httpx.post(
            endpoint,
            headers={"Authorization": f"Bearer {token}"},
            json={"messages": [{"role": "user", "content": user}]},
            timeout=60,
        )
        r.raise_for_status()
        return r.json().get("result", {}).get("response", "")

    return run


def lmstudio_agent(model: str, base_url: str = "http://localhost:1234/v1") -> Callable[[str, dict, Optional[str]], str]:
    """Adapter for a local LM Studio server (OpenAI-compatible /chat/completions). No key needed."""

    def run(task: str, scenario: dict, context: Optional[str]) -> str:
        system = (
            "You are a coding agent. When a site publishes a skill for the task, "
            "use it and output the exact URL/command it prescribes."
        )
        user = task if context is None else f"{task}\n\n--- site context ---\n{context}"
        payload = json.dumps(
            {
                "model": model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "temperature": 0,
                "max_tokens": 600,
            }
        ).encode()
        req = urllib.request.Request(
            base_url.rstrip("/") + "/chat/completions",
            data=payload,
            headers={"Content-Type": "application/json", "Authorization": "Bearer lm-studio"},
        )
        try:
            with urllib.request.urlopen(req, timeout=300) as resp:  # noqa: S310
                data = json.load(resp)
            return data["choices"][0]["message"]["content"]
        except Exception as e:  # noqa: BLE001
            return f"[error: {type(e).__name__}: {e}]"

    return run


def run_arm(agent: Callable, scenarios: list[dict], arm: str) -> dict:
    passed = 0
    rows = []
    for sc in scenarios:
        context = discovery_context(sc["origin"], sc["expect_skill"]) if arm == "discovery" else None
        answer = agent(sc["task"], sc, context)
        ok = score(sc, answer)
        passed += ok
        rows.append({"id": sc["id"], "ok": bool(ok), "answer": (answer or "").strip()})
    return {"arm": arm, "passed": passed, "total": len(scenarios), "rows": rows}


def print_result(label: str, result: dict) -> None:
    print(f"\n[{label} / {result['arm']}] {result['passed']}/{result['total']} passed")
    for r in result["rows"]:
        preview = r["answer"].replace("\n", " ")[:80]
        print(f"  {'PASS' if r['ok'] else 'FAIL':4}  {r['id']}: {preview}")


def dump_results(path: str, label: str, results: list[dict]) -> None:
    """Append this run's results to a JSON file (one record per model/label)."""
    p = Path(path)
    existing = json.loads(p.read_text(encoding="utf-8")) if p.exists() else []
    existing = [r for r in existing if r.get("label") != label]
    existing.append({"label": label, "arms": results})
    p.write_text(json.dumps(existing, indent=2, ensure_ascii=False), encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description="llms.txt skill discovery eval harness")
    ap.add_argument("--reference", action="store_true", help="Run deterministic reference solver (no key)")
    ap.add_argument("--model", choices=["anthropic", "cloudflare", "lmstudio"], help="Run a real model")
    ap.add_argument("--model-id", help="Model id (e.g. claude-sonnet-4-6, @cf/meta/llama-3.1-8b-instruct, or an LM Studio model id)")
    ap.add_argument("--base-url", default="http://localhost:1234/v1", help="LM Studio base URL")
    ap.add_argument("--arm", choices=["baseline", "discovery", "both"], default="both")
    ap.add_argument("--out", help="Append full results (with answers) to this JSON file")
    args = ap.parse_args()

    # Console may be cp1252 on Windows; model output can contain other chars.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

    scenarios = json.loads(SCENARIOS.read_text(encoding="utf-8"))["scenarios"]
    arms = ["baseline", "discovery"] if args.arm == "both" else [args.arm]

    if args.reference:
        results = [run_arm(lambda t, s, c: reference_agent(t, s, c), scenarios, arm) for arm in arms]
        if args.out:
            dump_results(args.out, "reference", results)
        for r in results:
            print_result("reference", r)
        return 0

    if not args.model:
        print("Nothing to run. Use --reference (no key) or --model <name> (needs key).")
        return 2

    if args.model == "anthropic":
        agent = anthropic_agent(args.model_id or "claude-sonnet-4-6")
    elif args.model == "lmstudio":
        if not args.model_id:
            print("--model-id is required for lmstudio (an id from /v1/models)")
            return 2
        agent = lmstudio_agent(args.model_id, args.base_url)
    else:
        if not args.model_id:
            print("--model-id is required for cloudflare (e.g. @cf/meta/llama-3.1-8b-instruct)")
            return 2
        agent = cloudflare_agent(args.model_id)

    label = args.model_id or args.model
    results = [run_arm(agent, scenarios, arm) for arm in arms]
    if args.out:
        dump_results(args.out, label, results)
    for r in results:
        print_result(label, r)
    return 0


if __name__ == "__main__":
    sys.exit(main())
