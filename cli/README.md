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
