# @rckflr/llms-skills

One-command publisher CLI for the [llms.txt Skills](https://github.com/MauricioPerera/llms-txt-skills)
standard. Scaffold a skill, then let the CLI compute the `sha256`, render the
`## Skills` section into your `llms.txt`, sync `.well-known/agent-skills/index.json`,
and (optionally) sign — so you never touch the seven artifacts by hand.

It produces artifacts **byte-identical** to the reference Python generator
(`scripts/generate.py`), enforced by `cli/test.mjs`. What you publish is exactly
what a runtime — [mcpwasm](https://github.com/MauricioPerera/mcpwasm), the MCP
server, agents.txt — verifies. **Zero dependencies** (ed25519 and hashing via
Node's built-in `crypto`).

> Three independent version numbers appear in this doc — this CLI's own
> (see `package.json`), the spec's (currently Executable Skills v0.5), and
> the mcpwasm runtime's (currently 0.11.x). Every version mentioned below is
> named right next to the thing it belongs to; none of them refer to this
> CLI unless it's explicitly called out as this package's version.

```bash
npx @rckflr/llms-skills <command>
```

## The 2-minute path (L0)

```bash
npx @rckflr/llms-skills init my-skill     # scaffolds skills/my-skill/SKILL.md + a manifest
#   …edit the SKILL.md (frontmatter + instructions) and set the manifest summary…
npx @rckflr/llms-skills publish            # writes ## Skills into llms.txt + index.json
```

That's it — an agent reading your `llms.txt` now discovers the skill. Everything
below is optional hardening you climb into when your risk model asks for it (see
the [adoption ladder](../docs/adoption.md)).

## Commands

| Command | What it does |
| :--- | :--- |
| `init <name> [--tool]` | Scaffold `skills/<name>/SKILL.md` (and `tool.js` with `--tool` for an executable skill), and add the entry to `llms-skills.json`. |
| `publish [--check]` | Read the manifest, hash every `SKILL.md`/`tool.js`, render `## Skills` into `llms.txt`, write `index.json`, and sign if the manifest has a `signing` block. `--check` writes nothing and exits non-zero on drift — the CI guard. |
| `validate <src> [--strict]` | Validate an `llms.txt` (local path or `https://` URL) and its skills: section shape, `sha256`/`tool_sha256` match, frontmatter, memory line. |
| `keygen [--out <file>]` | Generate an ed25519 signing keypair. Keep the private key **offline** (never commit it); the public key is embedded in `index.json` on publish. |

## Executable skills (L2)

```bash
npx @rckflr/llms-skills init fetch-quote --tool   # also scaffolds tool.js
```

`tool.js` runs verbatim inside a sandbox (QuickJS-wasm in mcpwasm); its only
bridge out is the host capabilities the runtime injects (`host.fetchOrigin`,
scoped to your origin). `publish` computes `tool_sha256` and carries `tool` +
`tool_sha256` in both the inline metadata and `index.json`.

## Knowledge / serverless RAG (`memory`)

Turn a directory of [OKF](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
concepts (`*.md` with `type`/`title` frontmatter; `index.md`/`log.md` reserved)
into a serverless RAG any consumer can query — no vector DB, no server:

```bash
npx @rckflr/llms-skills memory ./knowledge   # snapshot + 3 knowledge skills + manifest wiring
npx @rckflr/llms-skills publish              # as always
```

What it generates: a **byte-deterministic** BM25 snapshot (canonicalized, so
`--check`/CI content-addressing works), pinned by `snapshot_sha256` in the
`skills-memory` line, plus three executable skills — `search_knowledge`
(a **universal template**: identical bytes for every publisher, so its
`tool_sha256` is a stable ecosystem-wide constant — audit once, attest once),
`get_concept`, and `list_concepts` (concept metadata embedded at build time,
content-addressed). It also pins the snapshot as `-text` in `.gitattributes`
so git's CRLF conversion can never break the published hash.

**Multi-project origins (scopes).** Publishing several projects on one origin
(e.g. a GitHub Pages root)? Add `--scope <name>` (pattern
`^[a-z][a-z0-9_-]*$`, Executable Skills v0.5 §2.5):

```bash
npx @rckflr/llms-skills memory ./knowledge --scope kdd
```

The manifest and the rendered lines carry `"scope":"kdd"`; runtimes
(the **mcpwasm runtime**, version ≥ 0.6.0 — not this CLI's version) expose
the tools as `kdd__search_knowledge` etc. and bind
each scope's memory to its own snapshot — no name collisions, one
`skills-memory` line per scope. Published bytes and hashes are untouched
(the rename is runtime-side), so `search_knowledge` stays the universal
template.

Consumers need nothing new: `npx -y @rckflr/mcpwasm <origin>` — that's the
**mcpwasm runtime**, version >= 0.4.0 (again, not this CLI's version, which
happens to share the same number at the time of writing) — verifies the
snapshot and injects `host.memorySearch` on both runtimes.
`memory <bundle> --check` is the CI guard. The BM25 engine
(`@rckflr/minimemory`, ~630 KB wasm) is an optionalDependency — installed by
default; if omitted, `memory` fails with a clear message and every other
command works as before.

## Knowledge freshness (`freshness` / `attest`)

Hashes prove *not tampered*; they say nothing about whether the content is
still **true**. The freshness layer separates three signals honestly:

```bash
npx @rckflr/llms-skills freshness ./knowledge --now 2026-07-10   # CI report
npx @rckflr/llms-skills attest ./knowledge --concept policies/refunds.md \
    --by human:mauricio --until 2027-07-10 --key mauricio.key    # sign "still true"
```

- **Age vs TTL** (`knowledge/freshness.yaml`): per-`type` TTL in days +
  per-path overrides. A concept past its TTL reports `STALE`; `on_stale:
  abort` makes the command exit 1 (CI gate). Age is a *proxy* — old-but-true
  passes as stale, new-but-false passes as fresh. Which is why:
- **Signed attestations** (`knowledge/attestations.json`): a reviewer
  registered in `knowledge/reviewers.json` (raw-hex ed25519 pubkey) signs
  "this content is still true". The signature binds to the exact content
  sha — **any edit voids it** — and expires at `valid_until`, re-affirmable
  without touching the content. A valid attestation supersedes age
  (`VIGENT`); tampering, expiry or an unregistered reviewer degrade it
  loudly (`VOID-ATTEST` / `EXPIRED-ATTEST` / `INVALID-ATTEST`).

Wire-compatible with the original Python sidecar
(`ccdd/examples/okf-integration`): attestations sign/verify across both
toolchains. Note: the content sha is over raw bytes — pin your bundle's
markdown (`*.md text eol=lf`) so git CRLF conversion cannot void
attestations.

## Signing / attestation (L3)

```bash
npx @rckflr/llms-skills keygen --out signing.key   # once; keep signing.key offline
# add to the manifest:  "signing": { "private_key_path": "signing.key" }
npx @rckflr/llms-skills publish                    # now every skill is ed25519-signed
```

The signature covers the CRLF-normalized `SKILL.md` bytes; consumers pin the
public key per origin (TOFU). A server compromise *without* the offline key
cannot forge valid signatures. For identity-bound, keyless provenance, the
standard also defines Sigstore attestations (see the
[Skill Attestations](../docs/ext-skill-attestations.md) extension).

## Manifest (`llms-skills.json`)

`init` creates and maintains it; you rarely edit it by hand beyond the summaries.

```json
{
  "section_intro": "Remote Agent Skills published by this domain.",
  "signing": { "private_key_path": "signing.key" },
  "published": [
    { "path": "skills/my-skill/SKILL.md", "url": "/skills/my-skill/SKILL.md", "summary": "what it does" }
  ]
}
```

`section_intro` and `signing` are optional. Your `llms.txt` is the source of
truth; `index.json` is a **derived** artifact the CLI keeps in sync.

## CI

Run `publish --check` on every push to fail the build if the published artifacts
drift from the sources:

```yaml
- run: npx @rckflr/llms-skills publish --check
```

MIT. Part of the [llms-txt-skills](https://github.com/MauricioPerera/llms-txt-skills) project.
