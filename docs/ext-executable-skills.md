# Extension: Executable Skills

**Status:** Draft (v0.2)
**Date:** 2026-07-02
**Extends:** [RFC: Publishing Agent Skills through `llms.txt`](./rfc-skills-in-llms-txt.md) (v0.8)

---

## 1. Motivation

The core RFC publishes skills as instructional documents (`SKILL.md`). Section 5.3 of the core RFC identifies the *execution gap*: an agent may read instructions and still improvise, substitute tools, or drift from the published behavior.

This extension closes that gap for publishers who want it: a skill MAY additionally ship an **executable artifact** — a small JavaScript file with a declared input schema — that a conforming runtime executes *verbatim* inside a sandbox, instead of asking a model to improvise from prose.

Executing third-party code is only acceptable under a strict security model. This extension therefore defines two things, and only two things:

1. The **publication format** for executable skills (publisher side).
2. The **minimum requirements** for a runtime that chooses to execute them (consumer side).

Everything else — transport, agent UX, approval flows — remains governed by the core RFC. A publisher that adopts this extension remains fully conformant with the core RFC: agents that do not understand executable skills simply fall back to `SKILL.md` prose.

## 2. Publication format

### 2.1 Skill entry

An executable skill is declared with two additional keys in the skill entry's JSON comment:

```markdown
- [sum_numbers](/skills/sum_numbers/SKILL.md): Sum two numbers a and b. <!-- skill: {"version":"1.0.0","tool":"/skills/sum_numbers/tool.js","tool_sha256":"58daf86111bf7278446eb7e0e8c6384713b50cdb6fa97ac039e23846d723dc3e"} -->
```

| Key      | Type   | Requirement | Meaning |
|----------|--------|-------------|---------|
| `version`| string | inherited from core RFC | Human-readable hint. |
| `tool`   | string | REQUIRED for executable skills | Path to the executable artifact. MUST be a same-origin path (relative or absolute path, never a full URL to another origin). |
| `tool_sha256` | string | REQUIRED when `tool` is present | Lowercase hex SHA-256 of the exact bytes served at `tool`. |

The key is deliberately **not** `sha256`: the core RFC already uses `sha256` (inline and in `/.well-known/agent-skills/index.json`) for the hash of the fetched `SKILL.md`. The two keys MAY appear on the same skill line and verify different files; runtimes MUST NOT conflate them.

Rationale for staying inline (rather than only in `/.well-known/agent-skills/index.json`): the core standard's value proposition is *one static file, no infrastructure*. Two inline keys preserve that. Publishers who already maintain the well-known index MAY mirror the same `tool`/`tool_sha256` fields there; if both are present and disagree, runtimes MUST refuse the skill.

### 2.2 The artifact (`tool.js`)

The artifact is a single JavaScript file that registers exactly one tool:

```js
registerTool({
  name: "server_time",
  description: "Return the current server time.",
  inputSchema: { type: "object", properties: {} },
  async handler(args) {
    const r = await host.fetchOrigin("/api/time");
    return JSON.parse(r.body);
  }
});
```

Contract:

- The file MUST call `registerTool(def)` exactly once, where `def.name` matches the skill name in `llms.txt`, `def.inputSchema` is a JSON Schema object, and `def.handler` is a function (sync or async).
- The handler receives already-parsed `args` and returns a JSON-serializable value. Throwing reports a tool error to the caller; it MUST NOT crash the runtime.
- The only ambient capability available is `host.fetchOrigin(path)`: an HTTP fetch **restricted to the publishing origin**, returning `{ status, body }` (body as text, possibly truncated by the runtime). There is no other network, filesystem, timer, or environment access.
- The artifact MUST NOT rely on any global other than `registerTool`, `host`, and standard ECMAScript built-ins. No `fetch`, no `process`, no dynamic import.

### 2.3 Versioning and updates

The `tool_sha256` pins the artifact. Publishing a new artifact version means serving new bytes at `tool` and updating both `tool_sha256` and `version` in `llms.txt`. Runtimes cache by hash; a stale hash simply keeps serving the old, verified artifact until the index updates.

## 3. Runtime requirements

A runtime that executes skills published under this extension (a *gateway*, an agent-embedded engine, etc.):

1. **Integrity.** MUST fetch the artifact, compute SHA-256 over the exact received bytes, and compare with the declared `tool_sha256`. On mismatch the skill MUST be excluded (not degraded to prose, not executed) and the rejection SHOULD be observable (log or diagnostic surface). This matches the mandatory-refusal language of core RFC §4.
2. **Isolation.** MUST execute artifacts in a sandbox where the host environment is not reachable: no ambient network, no filesystem, no host secrets. Host capabilities are injected explicitly; this extension defines only `host.fetchOrigin`, scoped to the publishing origin. A runtime MUST reject any `fetchOrigin` target that resolves outside that origin.
3. **Resource limits.** SHOULD enforce memory, stack, and execution-time budgets per invocation, so a hostile or buggy artifact cannot exhaust the runtime. (Reference implementation values: 64 MB memory, 1 MB stack, 2 s CPU deadline.)
4. **Trust domain.** Artifacts from the *same origin* MAY share an execution context; artifacts from *different origins* MUST NOT. Runtimes SHOULD isolate per skill even within one origin (defense in depth).
5. **Exposure.** How verified skills are exposed to agents is out of scope. The reference implementation exposes them as an MCP server (`tools/list` / `tools/call`), which requires no agent-side changes at all — but any interface satisfying 1–4 conforms.

## 4. Security considerations

- **What the hash buys:** whoever can edit the site cannot silently swap artifact bytes out from under a cached/pinned hash; and a runtime never executes bytes it did not verify. It does **not** authenticate the publisher — for that, compose with the signature scheme of core RFC §4.6 (signing `llms.txt` transitively pins every declared `tool_sha256`, alongside the core RFC's `sha256` for the prose).
- **What the sandbox buys:** a malicious artifact can, at worst, compute and call its own origin — the same things any visitor's browser can already do to that origin. It cannot reach the runtime's credentials, other tenants, or other origins.
- **Residual risks:** a compromised publisher origin can still publish a *correctly hashed* malicious artifact (garbage in, verified garbage out); `fetchOrigin` responses are attacker-controlled input to the artifact; and resource limits bound, but do not eliminate, denial-of-service pressure on the runtime. Cross-origin user confirmation rules from core RFC §4 apply unchanged.

## 5. Reference implementation

Working end-to-end chain (all deployed):

| Piece | URL |
|---|---|
| Runtime + gateway source (QuickJS-wasm sandbox on Cloudflare Workers) | https://github.com/MauricioPerera/mcpwasm |
| Demo publishing site (`llms.txt` with two executable skills) | https://llmstxt-demo-site.rckflr.workers.dev/llms.txt |
| Gateway exposing them as an MCP server | `POST https://llmstxt-gateway.rckflr.workers.dev/mcp?origin=https%3A%2F%2Fllmstxt-demo-site.rckflr.workers.dev` |

The gateway demonstrates: discovery from `llms.txt`, per-skill SHA-256 verification with exclusion on mismatch, sandboxed execution (QuickJS-wasm) with async handlers, origin-scoped `fetchOrigin`, and the resource limits cited in §3.

## 6. Open questions

1. Should `tool`/`tool_sha256` live only in `/.well-known/agent-skills/index.json` instead of inline, keeping the inline comment single-key? (This draft chooses inline for zero-infrastructure parity; feedback welcome.)
2. Artifact size limit (the reference implementation truncates fetched bodies at 4 KB for `fetchOrigin` but does not yet cap artifact size).
3. A declared capability list per skill (e.g. `"capabilities":["fetchOrigin"]`) so runtimes can surface least-privilege prompts before loading.
4. WASM artifacts as a second artifact type (`tool.wasm` + WIT-style interface) for non-JS publishers.

## 7. Changelog

- **v0.2 (2026-07-02):** Rename `sha256` -> `tool_sha256` to avoid collision with the core RFC's `sha256` (hash of the fetched `SKILL.md`), per review feedback.
- **v0.1 (2026-07-02):** Initial draft, extracted from the mcpwasm reference implementation.
