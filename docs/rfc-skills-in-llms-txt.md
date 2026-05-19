# RFC: Publishing Agent Skills through `llms.txt`

- **Status:** Draft (v0.3)
- **Date:** 2026-05-19
- **Author:** automators.work
- **Depends on:** [llmstxt.org](https://llmstxt.org/) spec, [Agent Skills](https://agentskills.io) (`SKILL.md`)
- **Reference implementation:** [img.automators.work](https://img.automators.work)

---

## TL;DR

Añade una sección `## Skills` a tu `llms.txt`. Cada entrada es un link a un `SKILL.md` remoto. Los agentes descubren skills en el mismo documento que ya leen para entender tu sitio. Sin servidor, sin proceso persistente, sin autenticación extra.

---

## 1. The Problem

### 1.1 Two ecosystems that do not talk to each other

`llms.txt` tells LLMs what a domain *is*. Agent Skills (`SKILL.md`) tell an agent *how to use* that domain. Both exist. Neither knows about the other.

The result: a site describes itself in `llms.txt`, and it publishes a `SKILL.md` somewhere, but there is **no standardized way** for the site to say *"here is the skill you need to work with me"* — and no standardized way for an agent to discover it.

**Concrete example:** `img.automators.work` serves an SVG placeholder image API. It has a `llms.txt` that documents the API. It also has a `SKILL.md` that teaches agents how to build placeholder URLs. But an agent that reads `llms.txt` has **no signal** that the `SKILL.md` exists. The user must know the URL in advance.

### 1.2 Existing alternatives require infrastructure most sites do not have

| Mechanism | What it requires | Works for a static blog? |
|---|---|---|
| **MCP** | A persistent server process, transport layer, endpoint | **No** |
| **A2A** | A persistent server process, agent-to-agent protocol | **No** |
| **`/.well-known/skills/`** | Static file serving only | **Yes, but only one skill** |

MCP and A2A are the right tools for complex, stateful integrations. They are overkill for:

- **Static sites** (Cloudflare Pages, GitHub Pages, Netlify, Vercel) — no server process exists.
- **Existing APIs** that want to teach agents which endpoints to call, not reimplement their surface.
- **Documentation sites** that want to describe interaction patterns once, not maintain a daemon.

The reference implementation for this RFC (`img.automators.work`) is a **Cloudflare Pages static site**. It cannot run an MCP server. It *can* serve a text file.

### 1.3 The well-known convention is limited

The emerging `/.well-known/skills/default/skill.md` convention (proposed by Cloudflare, adopted by Mintlify) works when:
- The agent knows the domain in advance.
- The agent is configured to probe `.well-known` paths.

It fails when:
- The site wants to declare **multiple** skills for different use cases.
- The agent encounters the site for the first time via `llms.txt`.
- The site wants to co-locate skill discovery with the rest of its agent-facing context.

**Co-location matters.** An agent that reads `llms.txt` to understand a site already has the right document open. If skill discovery requires a separate probe, that is extra latency and a second source of truth.

---

## 2. Proposal

Add an optional `## Skills` section to `llms.txt`. Each entry is a link to a remote `SKILL.md` (or a skill bundle archive) that conforms to the Agent Skills spec.

### 2.1 Syntax

```markdown
## Skills

- [skill-name](https://example.com/skills/skill-name/SKILL.md): description of when to use this skill.
- [bundle-name](https://example.com/skills/bundle-name.zip): description. <!-- skill: {"version":"1.0.0"} -->
```

Rules:

1. The section heading MUST be exactly `## Skills` (case-insensitive).
2. Each list item MUST follow the standard `llms.txt` link convention: `- [title](URL): description`.
3. The URL MUST resolve to either:
   - A raw `SKILL.md` document (`Content-Type: text/markdown`), OR
   - An archive ending in `.zip` or `.tar.gz` containing `SKILL.md` at the archive root.
4. The remote `SKILL.md` MUST be a valid Agent Skill (YAML frontmatter + body per the Agent Skills spec).
5. The URL SHOULD be same-origin as the `llms.txt`. Cross-origin URLs are permitted but carry additional security implications (see §4).
6. The description SHOULD match or summarize the `description` field in the skill's frontmatter.

### 2.2 Optional inline metadata

A skill entry MAY carry a trailing HTML comment with a JSON object for richer discovery:

```markdown
- [pay-with-x402](/skills/x402/SKILL.md): make x402 payments. <!-- skill: {"version":"1.2.0","sha256":"abc123…","license":"MIT"} -->
```

Recognized keys: `version`, `sha256`, `requires`, `license`, `homepage`. Agents that do not understand the comment MUST ignore it.

### 2.3 Discovery flow

```
1. Agent encounters a domain (via user instruction, URL in context, or search result)
2. Agent fetches https://example.com/llms.txt
3. Agent parses the ## Skills section
4. Agent surfaces available skills to the user
5. User opts in to one or more skills
6. Agent fetches the SKILL.md, verifies sha256 if declared, loads it
7. Agent caches the skill per HTTP cache semantics of the SKILL.md response
```

Step 5 is mandatory. Agents MUST NOT auto-install or auto-activate skills without explicit user approval (see §4).

### 2.4 Two primary use cases

**Pattern A — API wrapping.** The site has a public HTTP API. The skill teaches the agent how to authenticate and which endpoints to call. The agent executes calls directly against the API.

*Example:* `img.automators.work` teaches agents to call `/{width}x{height}?bg={hex}` to generate placeholder images.

*Example:* [DemoShop](https://demoshop-88e.pages.dev) publishes three skills (product-search, cart-add, checkout-complete) that teach agents to browse a catalog, add items to a cart, and complete a purchase via its public HTTP API — all without authentication or server-side sessions.

**Pattern B — Interaction instructions.** The site has no dedicated API but wants to describe how an agent should interact with it. The skill contains heuristics, preferred phrasing, or task decomposition patterns.

*Example:* A documentation site teaches agents to quote specific sections when answering questions about its content.

---

## 3. Ecosystem Comparison

| Dimension | MCP | A2A | `/.well-known/skills/` | **`## Skills` in `llms.txt`** |
|---|---|---|---|---|
| Requires server process | Yes | Yes | **No** | **No** |
| Works on static hosts | No | No | **Yes** | **Yes** |
| Multi-skill per domain | Yes | Yes | **No** (fixed path) | **Yes** |
| Co-located with `llms.txt` | No | No | No | **Yes** |
| Zero infrastructure beyond static files | No | No | **Yes** | **Yes** |
| Complex / stateful integrations | **Yes** | **Yes** | No | No |
| Simple API wrapping | Overkill | Overkill | Limited | **Designed for this** |
| Version metadata inline | N/A | N/A | No | **Yes** |
| User opt-in required | Runtime-dependent | Runtime-dependent | Runtime-dependent | **Mandatory** |

**This RFC does not replace MCP or A2A.** It fills the gap below them: the case where a site wants to publish a skill for a simple API or interaction pattern, without running a server.

---

## 4. Security

1. **No auto-installation.** Agents MUST NOT activate a discovered skill without explicit user opt-in.
2. **Same-origin preference.** Agents SHOULD treat same-origin skills as lower friction than cross-origin skills.
3. **Content verification.** If `sha256` is declared in the inline metadata, agents MUST verify the hash of the fetched file and refuse to load on mismatch.
4. **Cross-origin skills require elevated confirmation.** If a skill URL is on a different origin from the `llms.txt` that references it, agents SHOULD require additional user confirmation beyond the base opt-in. This prevents a compromised `llms.txt` from silently delegating trust to a third-party host.
5. **Least privilege.** Skills loaded from a domain operate within the permission scope of that domain. They cannot request filesystem access, network calls to unrelated origins, or other capabilities not stated in the skill's frontmatter without explicit user re-confirmation.

---

## 5. On Agent-Side Discovery Triggers

This RFC defines the *publishing* side of the protocol. It does not mandate when or how agents decide to read `llms.txt`.

Today, most agents read `llms.txt` only when the user explicitly directs them to a URL or instructs them to research a site. Proactive, background skill discovery does not yet occur in mainstream runtimes.

This is not a defect of the proposal — it is the current state of the ecosystem. MCP, A2A, and `/.well-known/skills/` face the same trigger problem: all require the user or agent to know the site exists before discovery begins.

**What this RFC adds, even today:** when an agent does encounter a site — via user instruction, a URL in context, or a tool result — a `## Skills` section gives it an unambiguous, machine-readable signal that purpose-built skills are available. That is more than any site can currently express through `llms.txt` alone.

As agent runtimes evolve toward more proactive web discovery, the `## Skills` section provides the declaration primitive those systems will need.

### 5.1 Proactive Discovery Mechanisms

To reduce the friction of skill discovery from "user must know to ask" to "agent finds it automatically", this RFC proposes four optional mechanisms that sites MAY implement and agents MAY support. None are required for compliance, but each lowers the barrier for the agent side.

#### Mechanism A — HTTP `Link` header

Every HTTP response from the domain MAY include a `Link` header pointing to `llms.txt`:

```
Link: </llms.txt>; rel="llms.txt"
```

**Why it matters:** When the agent makes its *first* request to the domain (e.g., loading the homepage or calling an API endpoint), it receives this header for free. No extra round-trip is needed to probe for `llms.txt`. The agent parses the header, fetches `llms.txt`, and discovers skills before the user even asks.

**Reference implementation:** [DemoShop](https://demoshop-88e.pages.dev) sends this header on every API response.

#### Mechanism B — DNS TXT record

The domain MAY publish a DNS TXT record:

```
demoshop-88e.pages.dev. 300 IN TXT "llms-txt=https://demoshop-88e.pages.dev/llms.txt"
```

**Why it matters:** DNS resolution is often faster than HTTP and can be cached at the resolver. The agent can discover the `llms.txt` URL *before* making any HTTP request, allowing it to preload skills or show them to the user at the exact moment the domain is mentioned.

**Limitation:** DNS TXT records are limited to ~255 bytes per string and require DNS access, which sandboxed agents may not have.

#### Mechanism C — HTML `<meta>` tag

In addition to the existing `link rel="alternate"`, the site MAY include a visible `<meta>` tag in the HTML `<head>`:

```html
<meta name="llms-txt" content="/llms.txt">
```

**Why it matters:** It is more discoverable by HTML parsers than `rel="alternate"` (which some agents ignore). It also signals to developers inspecting the page source that the site exposes agent-facing resources.

#### Mechanism D — The `/llms.txt` convention probe

Similar to `robots.txt` or `favicon.ico`, agents MAY adopt the convention:

> "On first encounter with any new domain, attempt `HEAD /llms.txt`. If it returns 200, read it. If 404, assume no skills are published and proceed normally."

**Why it matters:** It requires zero cooperation from the site (the file either exists or it doesn't). It costs one cheap HEAD request (~200 bytes). It works for every domain on the web, not just those that implement headers or DNS records.

**Trade-off:** It adds one round-trip per new domain. Agents SHOULD cache negative responses (404) to avoid repeated probes.

### 5.2 Recommended Agent Behavior (Non-Normative)

When an agent runtime decides to implement proactive discovery, this is the recommended flow:

```
1. Agent encounters a domain (user instruction, URL in context, search result)
2. Check local cache for llms.txt of this domain
   2a. Hit -> skip to step 5
   2b. Miss -> continue
3. Probe for llms.txt using any available mechanism:
   3a. Check HTTP Link header of the first request already made
   3b. Check DNS TXT record (if DNS available)
   3c. HEAD /llms.txt (fallback, cache 404 for 24h)
4. If llms.txt found, parse and cache it
5. If ## Skills exists, surface skills to the user
6. User opts in explicitly to one or more skills
7. Agent fetches SKILL.md, verifies sha256 if declared, loads it
8. Agent caches the skill per HTTP cache semantics
```

**Key principle:** The user opt-in (step 6) remains mandatory. Even with automatic discovery, agents MUST NOT auto-install skills without explicit approval.

**Cache strategy:**
- `llms.txt`: cache per HTTP `Cache-Control` (typically short TTL, e.g., 5 minutes).
- Negative 404: cache for 24 hours to avoid repeated probes.
- `SKILL.md`: cache per HTTP `Cache-Control` (can be long, e.g., immutable).

---

## 6. Why This Is Worth Doing---

## 6. Why This Is Worth Doing

- **Deployable on any static host.** A Cloudflare Pages site, a GitHub Pages repo, a Netlify deploy — any host that can serve a text file can publish skills through this mechanism. No server process required.
- **Self-describing at the source.** A site ships its API *and* the skill for consuming it in the same deploy. No third-party marketplace required.
- **Version-locked to the API.** When the API changes, the skill changes in the same commit. No drift between capability and documentation.
- **Co-located discovery.** An agent reading `llms.txt` finds skills in the same document, in one fetch, with no additional probing.
- **Multi-skill support.** A single domain can publish skills for different use cases (e.g., read-only queries, authenticated writes, admin operations) as separate entries.
- **No gatekeeper.** Publishing a skill is a `git push`. No approval process, no marketplace submission.

---

## 7. Non-Goals

- Replacing local skill filesystems or marketplaces — both remain valid distribution modes.
- Defining a new skill format — this RFC reuses the Agent Skills `SKILL.md` spec as-is.
- Mandating skill *execution* behavior — that is the agent runtime's responsibility.
- Replacing MCP or A2A for complex, stateful integrations — this RFC targets the simpler, static-hosting case.

---

## 8. Open Questions

1. **Should `llms.txt` grow parallel `## MCP` and `## Agents` sections**, making it the single discovery document for a domain's full agent surface? Or should each standard manage its own discovery separately?
2. **Cross-origin skill trust model.** Should cross-origin skills be disallowed entirely, allowed with elevated confirmation, or allowed freely? Current proposal: allowed with elevated confirmation (§4.4).
3. **Archive format.** Should `.zip` be the only mandated archive format, or should `.tar.gz` remain in scope? `.zip` is more universally supported; `.tar.gz` is more natural for git-hosted skill bundles.
4. **Signature scheme beyond `sha256`.** Is content hashing sufficient, or is a signing scheme (sigstore, Web Bot Auth) necessary for high-trust deployments?
5. **Relationship to `/.well-known/skills/`.** Should this RFC explicitly recommend that sites serve both — a `## Skills` section in `llms.txt` *and* the `.well-known` convention — for maximum compatibility?

---

## 9. Reference Implementation

[`img.automators.work`](https://img.automators.work) is a live Cloudflare Pages static site — no server process, no MCP server, no A2A endpoint.

- [`/llms.txt`](https://img.automators.work/llms.txt) — contains a `## Skills` section
- [`/skills/placeholder/SKILL.md`](https://img.automators.work/skills/placeholder/SKILL.md) — the skill itself
- [`/docs/rfc-skills-in-llms-txt.md`](https://img.automators.work/docs/rfc-skills-in-llms-txt.md) — this document
- [`/scripts/parse_llms_txt_skills.py`](https://img.automators.work/scripts/parse_llms_txt_skills.py) — reference parser
- [`/scripts/validate.py`](https://img.automators.work/scripts/validate.py) — validator
- [`/schema/llms-txt-skills.schema.json`](https://img.automators.work/schema/llms-txt-skills.schema.json) — JSON schema

---

## 10. Changelog

- **v0.3 (2026-05-19):** Expanded agent-side discovery triggers with four mechanisms (HTTP Link header, DNS TXT, HTML meta tag, convention probe); added recommended agent behavior flow; added cache strategy; updated examples with DemoShop.
- **v0.2 (2026-04-21):** Added §3 ecosystem comparison; expanded §4 with cross-origin security rule; added §5 on discovery triggers; added §1.2 infrastructure barrier argument; refined two use-case patterns in §2.4; updated open questions.
- **v0.1 (2026-04-20):** Initial draft.

