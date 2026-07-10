# State of adoption

A single, linkable summary of where the `## Skills` in `llms.txt` proposal stands: what consumes it, how trust works, and where it has been proposed. Updated 2026-06-02 (RFC v0.8).

## Adoption levels — start minimal, harden later

You do **not** adopt everything at once. Each level is additive and independently useful; a site can stop at any of them.

| Level | You add | What it buys | Effort |
|---|---|---|---|
| **L0 · Discoverable** | A `## Skills` section in the `llms.txt` you already serve — one bullet per skill, pointing at a `SKILL.md`. | An agent reading your `llms.txt` now *sees* the skill and can use it (with explicit user opt-in). | ~2 minutes, by hand |
| **L1 · Integrity** | An inline `sha256` per skill. | Agents refuse to load a `SKILL.md` altered in transit. | one generator command |
| **L2 · Executable** | A `tool.js` + `tool_sha256` per skill. | A runtime executes the tool verbatim in a sandbox instead of asking a model to improvise ([Executable Skills](ext-executable-skills.md)). | one generator command |
| **L3 · Attested** | An ed25519 or Sigstore attestation per skill. | Signed human review with an expiry window; a runtime can *require* it before loading ([Skill Attestations](ext-skill-attestations.md)). | one command + a key |

**L0 is the whole ask.** One markdown line makes you discoverable. `sha256`, `tool.js`, `index.json`, signing, and attestations are progressive hardening the tooling adds *for* you — not prerequisites. Publish at L0 today; climb only when your risk model asks for it.

## Consumers (you can use these today)

The proposal is no longer "one author + demos." There are three independent ways to consume skills published via `llms.txt`:

| Consumer | Runtime(s) | How |
|---|---|---|
| **Claude Code plugin** | Claude Code | `/plugin marketplace add MauricioPerera/llms-txt-skills` then `/plugin install llms-txt-aware@llms-txt-skills` |
| **MCP server** | Any MCP runtime (Cline, Continue, Cursor, Claude Desktop, Windsurf, …) | [`integrations/mcp/`](../integrations/mcp/) — tools `llmstxt_read`, `llmstxt_discover_skills`, `llmstxt_fetch_skill` (with signature verification) |
| **Static-site → MCP (mcpwasm)** | Any MCP client | `npx -y @rckflr/mcpwasm <origin>` — the reference runtime for **executable** skills: fetches `/llms.txt`, verifies every `tool_sha256`, sandboxes each `tool.js` in QuickJS-wasm, and speaks MCP over stdio. Zero install on either side. |
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

The one-command way — **no clone, no Python** — is the [`@rckflr/llms-skills`](../cli/README.md) CLI:

```bash
npx @rckflr/llms-skills init my-skill   # scaffold SKILL.md (+ tool.js with --tool) + manifest
npx @rckflr/llms-skills publish          # write ## Skills into llms.txt + index.json (+ sign)
npx @rckflr/llms-skills publish --check   # CI guard: fails on drift
```

Inside this repo, the reference Python generator does the identical thing (byte-identical output, enforced by `cli/test.mjs`) from [`scripts/skills-manifest.json`](../scripts/skills-manifest.json):

```bash
python scripts/generate.py          # regenerates ## Skills, .well-known copies, index.json, and signs
python scripts/generate.py --check  # CI guard: fails if anything is out of sync
```

And for CI, a reusable **GitHub Action** (defined at this repo's root, self-tested by this repo's own CI) gives publishers a green check that what they serve is what agents verify:

```yaml
- uses: MauricioPerera/llms-txt-skills@master   # validate llms.txt + skills, and (if a manifest exists) publish --check
```

The generator computes `sha256`, syncs the `.well-known` artifacts, and signs each skill — eliminating the manual steps and the drift between source and published artifacts. CI runs `--check` and `verify_signatures.py` on every push.

Your `llms.txt` is the **source of truth**. `index.json` and the `.well-known` copies are **derived** artifacts the generator produces and keeps in sync — you never hand-edit them, and a publisher who only needs L0–L1 discovery does not need `index.json` at all (a consumer treats it as an optional canonical/cross-check layer, not a requirement).

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
