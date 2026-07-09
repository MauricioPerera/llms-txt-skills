# State of adoption

A single, linkable summary of where the `## Skills` in `llms.txt` proposal stands: what consumes it, how trust works, and where it has been proposed. Updated 2026-06-02 (RFC v0.8).

## Consumers (you can use these today)

The proposal is no longer "one author + demos." There are three independent ways to consume skills published via `llms.txt`:

| Consumer | Runtime(s) | How |
|---|---|---|
| **Claude Code plugin** | Claude Code | `/plugin marketplace add MauricioPerera/llms-txt-skills` then `/plugin install llms-txt-aware@llms-txt-skills` |
| **MCP server** | Any MCP runtime (Cline, Continue, Cursor, Claude Desktop, Windsurf, …) | [`integrations/mcp/`](../integrations/mcp/) — tools `llmstxt_read`, `llmstxt_discover_skills`, `llmstxt_fetch_skill` (with signature verification) |
| **aider (native `/web`)** | aider | PR adding discovery on `/web`: https://github.com/Aider-AI/aider/pull/5208 (in review) |

All three follow the same contract: read `/llms.txt`, surface published skills, **never auto-load** (explicit user opt-in), fail open when a site has no `llms.txt`.

## Trust model (RFC §4.6)

Two independent layers:

- **Integrity** — `sha256` of each `SKILL.md`. Proves the content was not altered in transit. Declared inline in `## Skills` and in `/.well-known/agent-skills/index.json`.
- **Authenticity** — an **ed25519 signature** over each `SKILL.md`, made with a key kept **offline** (not on the web server). The public key and signatures live in `index.json`. Agents verify the signature and **pin the key per origin (TOFU)**, warning if it later changes. For identity-bound provenance, the RFC recommends keyless signing via a transparency log (Sigstore), at the cost of needing network to verify.

Honest scope: a same-origin key does not defend against a *fully* compromised origin (attacker swaps key + signatures + content together). What it buys is (1) a server compromise *without* the offline key cannot forge valid signatures, and (2) key-pinning detects silent swaps across sessions — the gap plain `sha256` cannot close.

Verify it yourself:

```bash
pip install cryptography
python scripts/verify_signatures.py   # verifies signatures in index.json against the actual SKILL.md files
```

## Live reference sites

All three are published by the project author (first-party demos — **not** third-party adoption, which remains the open gap). Each serves a signed `index.json` you can verify live.

| Site | What it shows | Skills |
|---|---|---|
| [img.automators.work](https://img.automators.work) | Minimal Pattern A — an image API wrapped by a skill | `placeholder`, `api-client` |
| [demoshop-88e.pages.dev](https://demoshop-88e.pages.dev) | A storefront flow: search → cart → checkout | `product-search`, `cart-add`, `checkout-complete` |
| [**wireframe-studio.pages.dev**](https://wireframe-studio.pages.dev) | Most complete showcase: a **landing page that explains the standard for humans**, a working JSON-to-UI tool, real API endpoints, and an ed25519-signed `index.json` that verifies live | `wireframe-schema`, `validate-wireframe`, `design-tokens` |

[WireframeStudio](https://wireframe-studio.pages.dev) is the best single entry point: it pairs a human-readable explainer of `## Skills` with a backend that implements and signs it.

## Publishing without manual work

Publishers declare their skills in [`scripts/skills-manifest.json`](../scripts/skills-manifest.json) and run the generator:

```bash
python scripts/generate.py          # regenerates ## Skills, .well-known copies, index.json, and signs
python scripts/generate.py --check  # CI guard: fails if anything is out of sync
```

The generator computes `sha256`, syncs the `.well-known` artifacts, and signs each skill — eliminating the manual steps and the drift between source and published artifacts. CI runs `--check` and `verify_signatures.py` on every push.

## Where it has been proposed

| Venue | Thread | Status |
|---|---|---|
| llms.txt (AnswerDotAI) | https://github.com/AnswerDotAI/llms-txt/issues/116 | Open; minimal ask = register `## Skills` as a convention |
| Agent Skills (agentskills) | https://github.com/agentskills/agentskills/discussions/329 | Active; trust + cost feedback addressed |

## Reproduce the discovery flow

Against the live reference site:

```bash
# discover skills published by a domain
python scripts/parse_llms_txt_skills.py https://img.automators.work/llms.txt --resolve
```

Or point any MCP client at [`integrations/mcp/`](../integrations/mcp/) and ask it to inspect a site.
