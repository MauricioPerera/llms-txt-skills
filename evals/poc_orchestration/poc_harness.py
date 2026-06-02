#!/usr/bin/env python3
"""
poc_harness.py — POC: does a curated SKILL (a recipe) beat a raw tool list for
ORCHESTRATION, not just for token bloat?

The thesis (see ../../docs/rfc-skills-in-llms-txt.md): tool search / progressive
disclosure fixes the *token* cost of having many tools, but it does NOT tell the
agent the *order* to use them in. A published skill carries the recipe, so the
agent does not have to guess which tool runs first or discover — via errors —
that it should have validated before creating.

This harness drives a REAL agentic loop against a REAL n8n MCP server (n8n ships
an MCP with 25 tools to build workflows) and measures, per task:

  - success    : did a create_workflow_from_code call return a workflow id,
                 built from validated code?
  - tool_calls : how many tool invocations it took
  - errors     : how many tool calls returned an error (isError / bad args /
                 validate failures) -> the "discover-by-error" cost
  - turns      : model round-trips
  - wall_s     : wall-clock seconds

Three arms (the tool SET is identical in all three; only the procedural guidance
in the system prompt changes — that is the whole experiment):

  - naive : tools only, generic "build it" system prompt. The agent must figure
            out the orchestration itself (the bottom-up / search world).
  - n8n   : tools + n8n's OWN `instructions` (returned by the MCP `initialize`).
            The honest real-world default.
  - skill : tools + the curated SKILL.md recipe (top-down).

Lower tool_calls + lower errors + higher success in the `skill` arm is the
evidence that publishing a skill changes agent behavior for the better.

Config (NEVER hard-code the token):
  N8N_MCP_URL    default https://ardf.dev/mcp-server/http
  N8N_MCP_TOKEN  required, the Bearer token for the n8n MCP (read from env)

Usage:
  set N8N_MCP_TOKEN=...        (Windows)   /   export N8N_MCP_TOKEN=...  (unix)
  python poc_harness.py --model-id qwen/qwen3.5-9b --arm all
  python poc_harness.py --model-id qwen/qwen3.5-9b --arm skill --task schedule-slack
  python poc_harness.py --model-id qwen/qwen3.5-9b --arm all --no-cleanup
"""

import argparse
import json
import os
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any, Optional

HERE = Path(__file__).resolve().parent
TASKS_PATH = HERE / "tasks.json"
SKILL_PATH = HERE / "skill-build-n8n-workflow.md"

MCP_URL = os.environ.get("N8N_MCP_URL", "https://ardf.dev/mcp-server/http")
LM_BASE = os.environ.get("LM_BASE_URL", "http://localhost:1234/v1")
API_BASE = os.environ.get("N8N_API_BASE", "https://ardf.dev/api/v1")
ORIGIN = API_BASE.split("/api/")[0]
_API_KEY: Optional[str] = None  # set in main() from N8N_API_KEY (REST arm only)

_BROWSER_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
               "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

MAX_TURNS = 14
TOOL_RESULT_CAP = 4000  # truncate large tool outputs fed back into context
DONE_TOOL = "create_workflow_from_code"


# --------------------------------------------------------------------------- #
# MCP over Streamable HTTP (JSON-RPC; responses arrive as SSE `data:` lines).
# --------------------------------------------------------------------------- #
class MCPClient:
    def __init__(self, url: str, token: str):
        self.url = url
        self.token = token
        self._id = 0

    def _rpc(self, method: str, params: Optional[dict] = None, timeout: int = 120) -> dict:
        self._id += 1
        payload = json.dumps(
            {"jsonrpc": "2.0", "id": self._id, "method": method, "params": params or {}}
        ).encode()
        req = urllib.request.Request(
            self.url,
            data=payload,
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream",
                # Cloudflare in front of n8n 403s the default Python-urllib UA.
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                              "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            },
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
            raw = resp.read().decode("utf-8", "replace")
        # Parse SSE: collect the JSON from the last `data:` line.
        data_obj = None
        for line in raw.splitlines():
            if line.startswith("data:"):
                data_obj = json.loads(line[len("data:"):].strip())
        if data_obj is None:  # plain JSON fallback
            data_obj = json.loads(raw)
        if "error" in data_obj:
            raise RuntimeError(f"MCP error: {data_obj['error']}")
        return data_obj.get("result", {})

    def initialize(self) -> dict:
        return self._rpc(
            "initialize",
            {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "poc-harness", "version": "1.0"},
            },
        )

    def list_tools(self) -> list[dict]:
        return self._rpc("tools/list", {}).get("tools", [])

    def call_tool(self, name: str, arguments: dict) -> tuple[str, bool]:
        """Returns (text_result, is_error)."""
        try:
            res = self._rpc("tools/call", {"name": name, "arguments": arguments})
        except Exception as e:  # noqa: BLE001
            return f"[transport/tool error: {type(e).__name__}: {e}]", True
        is_error = bool(res.get("isError"))
        parts = []
        for c in res.get("content", []):
            if c.get("type") == "text":
                parts.append(c.get("text", ""))
            else:
                parts.append(json.dumps(c))
        text = "\n".join(parts) if parts else json.dumps(res)
        return text, is_error


# --------------------------------------------------------------------------- #
# LM Studio (OpenAI-compatible) chat with tools.
# --------------------------------------------------------------------------- #
class ContextOverflow(Exception):
    """The tool defs + prompt did not fit in the model's context window."""


def chat(model: str, messages: list[dict], tools: list[dict], timeout: int = 300) -> dict:
    payload = json.dumps(
        {"model": model, "messages": messages, "tools": tools, "temperature": 0, "max_tokens": 1200}
    ).encode()
    req = urllib.request.Request(
        LM_BASE.rstrip("/") + "/chat/completions",
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": "Bearer lm-studio"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
            return json.load(resp)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        if "context length" in body or "n_ctx" in body or "n_keep" in body:
            raise ContextOverflow(body[:300]) from e
        raise RuntimeError(f"LM Studio {e.code}: {body[:300]}") from e


_TC_COUNTER = [0]


def _parse_text_tool_calls(text: str) -> list[dict]:
    """Recover tool calls emitted as TEXT (not structured) by reasoning models.

    Some local models (e.g. qwen3 reasoning) write the call inside the thinking
    channel in XML, and LM Studio does not lift it into the structured
    `tool_calls` field. Real runtimes parse it back; so do we. Handles two shapes:

      <tool_call><function=NAME><parameter=KEY>VALUE</parameter>...</function></tool_call>
      <tool_call>{"name": "NAME", "arguments": {...}}</tool_call>
    """
    import re
    out: list[dict] = []
    if not text:
        return out
    # Shape 1: XML function/parameter
    for fm in re.finditer(r"<function=([A-Za-z0-9_]+)>(.*?)</function>", text, re.DOTALL):
        name = fm.group(1)
        args: dict[str, Any] = {}
        for pm in re.finditer(r"<parameter=([A-Za-z0-9_]+)>\s*(.*?)\s*</parameter>", fm.group(2), re.DOTALL):
            raw = pm.group(2).strip()
            try:
                args[pm.group(1)] = json.loads(raw)
            except Exception:  # noqa: BLE001
                args[pm.group(1)] = raw
        out.append(_synth_tool_call(name, args))
    if out:
        return out
    # Shape 2: JSON inside <tool_call>
    for jm in re.finditer(r"<tool_call>\s*(\{.*?\})\s*</tool_call>", text, re.DOTALL):
        try:
            obj = json.loads(jm.group(1))
        except Exception:  # noqa: BLE001
            continue
        name = obj.get("name")
        args = obj.get("arguments", obj.get("parameters", {})) or {}
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except Exception:  # noqa: BLE001
                args = {}
        if name:
            out.append(_synth_tool_call(name, args))
    return out


def _synth_tool_call(name: str, args: dict) -> dict:
    _TC_COUNTER[0] += 1
    return {
        "id": f"synth_{_TC_COUNTER[0]}",
        "type": "function",
        "function": {"name": name, "arguments": json.dumps(args)},
    }


def mcp_tools_to_openai(mcp_tools: list[dict]) -> list[dict]:
    out = []
    for t in mcp_tools:
        schema = dict(t.get("inputSchema") or {"type": "object", "properties": {}})
        schema.pop("$schema", None)
        out.append(
            {
                "type": "function",
                "function": {
                    "name": t["name"],
                    "description": (t.get("description") or "")[:1024],
                    "parameters": schema,
                },
            }
        )
    return out


# --------------------------------------------------------------------------- #
# System prompts per arm.
# --------------------------------------------------------------------------- #
NAIVE_SYS = (
    "You are an agent connected to an n8n instance via tools. Build the n8n "
    "workflow the user asks for using the available tools, then create it. "
    "When you are done, reply with the created workflow id."
)


def system_for_arm(arm: str, n8n_instructions: str) -> str:
    if arm == "naive":
        return NAIVE_SYS
    if arm == "n8n":
        return (
            "You are an agent connected to an n8n instance via tools.\n\n"
            + n8n_instructions
            + "\n\nWhen you are done, reply with the created workflow id."
        )
    if arm == "skill":
        skill = SKILL_PATH.read_text(encoding="utf-8")
        return (
            "You are an agent connected to an n8n instance via tools. A skill has "
            "been published for exactly this task. Follow it.\n\n"
            "--- SKILL: build-n8n-workflow ---\n" + skill +
            "\n\nWhen you are done, reply with the created workflow id."
        )
    if arm == "dispatch":
        skill = SKILL_PATH.read_text(encoding="utf-8")
        seg = json.loads((HERE / "segment-build-workflow.json").read_text(encoding="utf-8"))["tools"]
        return (
            "You are an agent connected to an n8n instance. You have exactly ONE "
            f"tool, `{DISPATCH_TOOL_NAME}(tool, args)`, which calls an n8n tool by "
            "name. No tool schemas are loaded — the skill below tells you which "
            "tools exist and how to use them in order. To learn a node's exact "
            "parameters, call get_node_types through the dispatcher.\n\n"
            f"Available n8n tools: {', '.join(seg)}\n\n"
            "--- SKILL: build-n8n-workflow ---\n" + skill +
            f"\n\nCall every step via {DISPATCH_TOOL_NAME}(tool=..., args=...). "
            "When done, reply with the created workflow id."
        )
    if arm == "rest":
        skill = (HERE / "skill-build-n8n-workflow-rest.md").read_text(encoding="utf-8")
        return (
            "You build n8n workflows using ONLY the REST API. You have one tool, "
            f"`{HTTP_TOOL_NAME}(method, path, body)`. No MCP, no node-introspection "
            "tools — the skill below carries the endpoint and node templates.\n\n"
            "--- SKILL: build-n8n-workflow-rest ---\n" + skill +
            "\n\nWhen done, reply with the created workflow id."
        )
    raise ValueError(arm)


# --------------------------------------------------------------------------- #
# One agentic run.
# --------------------------------------------------------------------------- #
HTTP_TOOL_NAME = "http_request"


def _http_tool() -> dict:
    """A single generic HTTP tool scoped to the n8n REST API (Model B / REST).

    Zero MCP tools, zero node-introspection — the skill carries the endpoint and
    node templates; the agent just makes the call. This is the demoshop pattern
    (skill -> direct HTTP) applied to n8n's REST API.
    """
    return {
        "type": "function",
        "function": {
            "name": HTTP_TOOL_NAME,
            "description": "Make a request to this site's n8n REST API.",
            "parameters": {
                "type": "object",
                "properties": {
                    "method": {"type": "string", "enum": ["GET", "POST", "PUT", "DELETE"]},
                    "path": {"type": "string", "description": "e.g. /workflows"},
                    "body": {"type": "object", "description": "JSON body for POST/PUT"},
                },
                "required": ["method", "path"],
            },
        },
    }


def rest_call(method: str, path: str, body: Optional[dict] = None) -> tuple[str, bool]:
    """Call the n8n public REST API with X-N8N-API-KEY. Returns (text, is_error)."""
    if not _API_KEY:
        return "[error: no N8N_API_KEY configured]", True
    p = path or ""
    if p.startswith("http"):
        url = p if p.startswith(ORIGIN) else None
        if url is None:
            return f"[error: refusing off-site URL {p}]", True
    elif p.startswith("/api/"):
        url = ORIGIN + p
    else:
        url = API_BASE.rstrip("/") + "/" + p.lstrip("/")
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url, data=data, method=method.upper(),
        headers={"X-N8N-API-KEY": _API_KEY, "Content-Type": "application/json",
                 "Accept": "application/json", "User-Agent": _BROWSER_UA},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:  # noqa: S310
            return resp.read().decode("utf-8", "replace"), False
    except urllib.error.HTTPError as e:
        return f"[HTTP {e.code}] " + e.read().decode("utf-8", "replace")[:1500], True
    except Exception as e:  # noqa: BLE001
        return f"[error: {type(e).__name__}: {e}]", True


DISPATCH_TOOL_NAME = "n8n"


def _dispatch_tool(segment: list[str]) -> dict:
    """A single generic passthrough tool. The model calls n8n(tool, args); the
    harness forwards to the real MCP. This puts ONE tool definition in context
    instead of 8 or 25 — the skill prose carries which tools exist and the order.
    """
    return {
        "type": "function",
        "function": {
            "name": DISPATCH_TOOL_NAME,
            "description": (
                "Call an n8n MCP tool by name. `tool` is one of the n8n tool names "
                "listed in the skill; `args` is that tool's argument object."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "tool": {"type": "string", "enum": segment},
                    "args": {"type": "object"},
                },
                "required": ["tool", "args"],
            },
        },
    }


def tools_for_arm(arm: str, openai_tools: list[dict], segment: list[str], all_tools: bool) -> list[dict]:
    """How many tool definitions land in the model's context, per arm.

    - naive / n8n : all 25 (the raw MCP reality), unless --all-tools is moot here.
    - skill       : only the 8 the skill declares (segmentation, Model A).
    - dispatch    : exactly 1 generic passthrough (Model B — tools are NOT loaded
                    as schemas; the skill prose names them, the agent dispatches).
    Pass --all-tools to force naive/n8n/skill to the full 25 (isolates the recipe
    effect from the segmentation effect).
    """
    if arm == "rest":
        return [_http_tool()]
    if arm == "dispatch":
        return [_dispatch_tool(segment)]
    if all_tools or arm != "skill":
        return openai_tools
    seg = set(segment)
    return [t for t in openai_tools if t["function"]["name"] in seg]


def run_one(model: str, arm: str, task: dict, mcp: MCPClient, openai_tools: list[dict],
            n8n_instructions: str, segment: list[str], all_tools: bool,
            verbose: bool = False) -> dict:
    arm_tools = tools_for_arm(arm, openai_tools, segment, all_tools)
    messages = [
        {"role": "system", "content": system_for_arm(arm, n8n_instructions)},
        {"role": "user", "content": task["task"]},
    ]
    metrics = {
        "tool_calls": 0, "errors": 0, "turns": 0, "n_tools": len(arm_tools),
        "validate_attempts": 0, "validate_ok": False,
        "created_ids": [], "success": False, "tool_sequence": [], "fatal": None,
    }
    t0 = time.time()
    for _ in range(MAX_TURNS):
        metrics["turns"] += 1
        try:
            resp = chat(model, messages, arm_tools)
        except ContextOverflow as e:
            metrics["fatal"] = "context_overflow"
            metrics["fatal_detail"] = str(e)
            metrics["turns"] -= 1
            break
        except Exception as e:  # noqa: BLE001
            metrics["fatal"] = f"chat error: {type(e).__name__}: {e}"
            break
        msg = resp["choices"][0]["message"]
        tool_calls = msg.get("tool_calls") or []
        if not tool_calls:
            # Reasoning models may emit the call as text in the thinking channel;
            # recover it the way a real runtime would.
            recovered = _parse_text_tool_calls(
                (msg.get("reasoning_content") or "") + "\n" + (msg.get("content") or "")
            )
            if recovered:
                tool_calls = recovered
                metrics["recovered_calls"] = metrics.get("recovered_calls", 0) + len(recovered)
        # Persist the assistant turn (content may be null when tool_calls present).
        messages.append({"role": "assistant", "content": msg.get("content") or "",
                         "tool_calls": tool_calls})
        if not tool_calls:
            metrics["final_text"] = (msg.get("content") or msg.get("reasoning_content") or "")[:600]
            if verbose:
                print(f"    [final text]: {_short(metrics['final_text'], 300)}")
            break  # model produced a final answer
        for tc in tool_calls:
            fn = tc["function"]["name"]
            metrics["tool_calls"] += 1
            try:
                args = json.loads(tc["function"].get("arguments") or "{}")
            except json.JSONDecodeError:
                args, bad_args = {}, True
            else:
                bad_args = False
            # REST arm: the only tool is http_request -> call the n8n REST API.
            if arm == "rest" and fn == HTTP_TOOL_NAME:
                method = (args.get("method") or "GET").upper()
                path = args.get("path") or args.get("url") or ""
                metrics["tool_sequence"].append(f"{method} {path}")
                if bad_args:
                    result, is_err = "[error: arguments were not valid JSON]", True
                else:
                    result, is_err = rest_call(method, path, args.get("body"))
                if method == "POST" and "workflow" in path and not is_err:
                    wid = _extract_id(result)
                    if wid:
                        metrics["created_ids"].append(wid)
                        metrics["success"] = True
                if is_err:
                    metrics["errors"] += 1
                if verbose:
                    print(f"    -> {method} {path} {'ERR' if is_err else 'ok'}: {_short(result, 120)}")
                messages.append({"role": "tool", "tool_call_id": tc.get("id", fn),
                                 "content": result[:TOOL_RESULT_CAP]})
                continue
            # dispatch arm: unwrap n8n(tool, args) into the real MCP call.
            if arm == "dispatch" and fn == DISPATCH_TOOL_NAME:
                eff_name = args.get("tool", "?")
                eff_args = args.get("args", {}) if isinstance(args.get("args"), dict) else {}
            else:
                eff_name, eff_args = fn, args
            metrics["tool_sequence"].append(eff_name)
            fn = eff_name  # downstream validate/DONE detection uses the real tool
            if bad_args:
                result, is_err = "[error: arguments were not valid JSON]", True
            else:
                result, is_err = mcp.call_tool(eff_name, eff_args)
            if fn == "validate_workflow":
                metrics["validate_attempts"] += 1
                if not is_err:
                    metrics["validate_ok"] = True
            if fn == DONE_TOOL and not is_err:
                # try to pull an id out of the result
                wid = _extract_id(result)
                if wid:
                    metrics["created_ids"].append(wid)
                    metrics["success"] = True
            if is_err:
                metrics["errors"] += 1
            if verbose:
                print(f"    -> {fn}({_short(args)}) {'ERR' if is_err else 'ok'}: {_short(result, 120)}")
            messages.append({
                "role": "tool", "tool_call_id": tc.get("id", fn),
                "content": result[:TOOL_RESULT_CAP],
            })
        if metrics["success"]:
            break  # goal reached; stop (closure handled by the skill/model)
    metrics["wall_s"] = round(time.time() - t0, 1)
    return metrics


def _extract_id(text: str) -> Optional[str]:
    """Best-effort: find a workflow id in a create result (JSON or text)."""
    try:
        obj = json.loads(text)
        for k in ("id", "workflowId", "workflow_id"):
            if isinstance(obj, dict) and obj.get(k):
                return str(obj[k])
            if isinstance(obj, dict) and isinstance(obj.get("workflow"), dict) and obj["workflow"].get("id"):
                return str(obj["workflow"]["id"])
    except Exception:  # noqa: BLE001
        pass
    import re
    m = re.search(r'"id"\s*:\s*"?([A-Za-z0-9_-]{6,})"?', text)
    return m.group(1) if m else None


def _short(obj: Any, n: int = 80) -> str:
    s = obj if isinstance(obj, str) else json.dumps(obj, ensure_ascii=False)
    s = s.replace("\n", " ")
    return s[:n] + ("…" if len(s) > n else "")


def cleanup(mcp: Optional[MCPClient], items: list[tuple[str, str]]) -> None:
    """items = [(arm, workflow_id)]. REST-created workflows are deleted via REST;
    MCP-created ones are archived via MCP."""
    for arm, wid in items:
        try:
            if arm == "rest":
                _, err = rest_call("DELETE", f"/workflows/{wid}")
                print(f"  [cleanup] {'could not delete' if err else 'deleted'} {wid}")
            elif mcp is not None:
                mcp.call_tool("archive_workflow", {"workflowId": wid})
                print(f"  [cleanup] archived {wid}")
        except Exception as e:  # noqa: BLE001
            print(f"  [cleanup] could not clean {wid}: {e}")


# --------------------------------------------------------------------------- #
def main() -> int:
    ap = argparse.ArgumentParser(description="POC: skill recipe vs raw tools (orchestration)")
    ap.add_argument("--model-id", required=True, help="LM Studio model id")
    ap.add_argument("--arm", choices=["naive", "n8n", "skill", "dispatch", "rest", "all"], default="all")
    ap.add_argument("--task", help="Run a single task id (default: all)")
    ap.add_argument("--no-cleanup", action="store_true", help="Do NOT archive created workflows")
    ap.add_argument("--all-tools", action="store_true",
                    help="Force every arm to the full 25 tools (isolates the recipe effect; needs a model whose context holds all 25)")
    ap.add_argument("--verbose", action="store_true", help="Print each tool call")
    ap.add_argument("--out", default=str(HERE / "poc-results.json"))
    args = ap.parse_args()

    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

    global _API_KEY

    tasks = json.loads(TASKS_PATH.read_text(encoding="utf-8"))["tasks"]
    if args.task:
        tasks = [t for t in tasks if t["id"] == args.task]
        if not tasks:
            print(f"No task with id {args.task}")
            return 2

    segment = json.loads((HERE / "segment-build-workflow.json").read_text(encoding="utf-8"))["tools"]
    arms = ["naive", "n8n", "skill"] if args.arm == "all" else [args.arm]
    needs_mcp = any(a in {"naive", "n8n", "skill", "dispatch"} for a in arms)
    needs_rest = "rest" in arms

    mcp: Optional[MCPClient] = None
    openai_tools: list[dict] = []
    n8n_instructions = ""
    if needs_mcp:
        token = os.environ.get("N8N_MCP_TOKEN")
        if not token:
            print("ERROR: set N8N_MCP_TOKEN (the Bearer token for the n8n MCP).")
            return 2
        mcp = MCPClient(MCP_URL, token)
        init = mcp.initialize()
        n8n_instructions = init.get("instructions", "")
        mcp_tools = mcp.list_tools()
        openai_tools = mcp_tools_to_openai(mcp_tools)
        print(f"Connected to {MCP_URL}: {init.get('serverInfo',{}).get('name')} "
              f"v{init.get('serverInfo',{}).get('version')} | {len(mcp_tools)} tools")
    if needs_rest:
        _API_KEY = os.environ.get("N8N_API_KEY")
        if not _API_KEY:
            print("ERROR: the 'rest' arm needs N8N_API_KEY (an n8n REST API key, X-N8N-API-KEY).")
            return 2
        print(f"REST arm enabled against {API_BASE}")
    print(f"model={args.model_id} | skill segment = {len(segment)} tools"
          f"{' (overridden by --all-tools)' if args.all_tools else ''}")

    all_created: list[tuple[str, str]] = []
    rows = []
    for task in tasks:
        for arm in arms:
            print(f"\n=== task={task['id']} arm={arm} ===")
            m = run_one(args.model_id, arm, task, mcp, openai_tools, n8n_instructions,
                        segment, args.all_tools, args.verbose)
            all_created += [(arm, wid) for wid in m["created_ids"]]
            rows.append({"task": task["id"], "arm": arm, **m})
            fatal = f" FATAL={m['fatal']}" if m.get("fatal") else ""
            print(f"  success={m['success']} n_tools={m['n_tools']} tool_calls={m['tool_calls']} "
                  f"errors={m['errors']} turns={m['turns']} validate_attempts={m['validate_attempts']} "
                  f"wall_s={m['wall_s']}{fatal}")
            print(f"  seq: {' -> '.join(m['tool_sequence']) or '(none)'}")

    # Summary table
    print("\n" + "=" * 78)
    print(f"{'arm':6} {'n':>3} {'tools':>6} {'success%':>9} {'overflow':>9} "
          f"{'avg_calls':>10} {'avg_errors':>11} {'avg_turns':>10}")
    for arm in arms:
        ar = [r for r in rows if r["arm"] == arm]
        n = len(ar)
        if not n:
            continue
        sc = sum(r["success"] for r in ar) / n * 100
        ov = sum(1 for r in ar if r.get("fatal") == "context_overflow")
        nt = ar[0]["n_tools"]
        ac = sum(r["tool_calls"] for r in ar) / n
        ae = sum(r["errors"] for r in ar) / n
        at = sum(r["turns"] for r in ar) / n
        print(f"{arm:6} {n:>3} {nt:>6} {sc:>8.0f}% {ov:>9} {ac:>10.1f} {ae:>11.1f} {at:>10.1f}")

    Path(args.out).write_text(
        json.dumps({"model": args.model_id, "url": MCP_URL, "rows": rows}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"\nWrote {args.out}")

    if all_created and not args.no_cleanup:
        print(f"\nCleaning up {len(all_created)} created workflow(s)...")
        cleanup(mcp, all_created)

    return 0


if __name__ == "__main__":
    sys.exit(main())
