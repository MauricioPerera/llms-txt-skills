# Changelog

All notable changes to the [`@rckflr/llms-skills`](https://www.npmjs.com/package/@rckflr/llms-skills)
package. Format based on [Keep a Changelog](https://keepachangelog.com/); dates
are the npm publish dates.

## [0.4.0] — 2026-07-10

### Added
- **Signed knowledge freshness — the RAG-OKF v2 "vigencia" layer.** Two new
  commands over a knowledge bundle, porting the proven
  `ccdd/examples/okf-integration` sidecar and staying **wire-compatible**
  with its Python tooling (same signed message
  `vigencia:{concept}:{content_sha256}:{attested_at}:{valid_until}`, same
  raw-hex ed25519 keys/signatures, same `freshness.yaml` /
  `attestations.json` / `reviewers.json` files — attestations sign/verify
  across both toolchains, covered by a verbatim fixture signed with the
  Python reference):
  - **`freshness <bundle> [--now ISO] [--json]`** — CI-friendly report of
    three honestly-separated signals: content hashes say *not tampered*
    (publish), age vs per-`type` TTLs says *recent* (a proxy — age ≠ truth),
    and a signed human attestation says *still true*. Statuses: `fresh` /
    `STALE` / `MISSING-TS` / `untracked` / `VIGENT` / `VOID-ATTEST` /
    `EXPIRED-ATTEST` / `INVALID-ATTEST`. `on_stale: abort` turns stale
    knowledge into a failing exit code.
  - **`attest <bundle> --concept <rel.md> --by <reviewer> --until <ISO>
    --key <hex-file>`** — a registered human signs "this content is still
    true". The signature binds to the exact content sha (any edit voids it)
    and expires at `--until` (re-affirmable without touching content); the
    signing key must match the reviewer's registered pubkey. The machine
    binds, verifies and expires; the human judges.
- Note: `content_sha256` is over **raw** file bytes (Python-reference
  compatibility, no CRLF normalization) — pin your bundle's markdown
  (`*.md text eol=lf` or `-text`) so git line-ending conversion cannot void
  attestations.
- Hybrid embeddings (the other half of the v2 design) remain **not built**,
  blocked upstream: `@rckflr/minimemory`'s OKF index is BM25-only by design,
  there is no embedder in the stack, and float embeddings clash with
  byte-exact content addressing.

## [0.3.0] — 2026-07-10

### Added
- **`--scope <name>` on `memory`** (Executable Skills v0.5 §2.5, resolves
  core RFC v0.10 Open Question 6). Declares the project namespace for
  multi-project origins: the manifest's `memory` block and every generated
  `published` entry carry `scope`, and `publish` renders it as the **last**
  key of both the skill lines and the `skills-memory` line
  (`"scope":"kdd"`). Runtimes (mcpwasm ≥ 0.6.0) expose the tools as
  `<scope>__<toolName>` and bind each scope's memory to its own snapshot.
  Pattern `^[a-z][a-z0-9_-]*$`; invalid values fail fast. Re-running
  `memory` with a different `--scope` (or none) refreshes the manifest
  entries idempotently.
- `validate` understands scopes: accepts multiple `skills-memory` lines when
  each carries a distinct `scope` (at most one unscoped), and reports invalid
  `scope` values and duplicated scopes as errors.
- New test part: scoped fixture end-to-end (manifest wiring, key order,
  validate, and **byte-identity with `scripts/generate.py`** on scoped
  output — the mirror contract now covers scopes).

### Changed
- `scripts/generate.py` mirrored: manifest entries and the `memory` block
  accept `scope` and render it identically (byte-identity enforced by
  `cli/test.mjs` Part 6). No `scope` anywhere ⇒ output identical to 0.2.1.

## [0.2.1] — 2026-07-10

### Fixed
- **Frontmatter values quoted with single quotes** (`type: 'Concept'`) are now
  unquoted correctly: one *matching* pair of quotes (double or single) is
  stripped. Found with a real OKF bundle (KDD) whose frontmatter uses single
  quotes; before this fix the quotes leaked into concept `type`/`title`.
  Mirrored in `scripts/generate.py` (`parse_yaml_frontmatter`) — byte-identity
  between both generators re-verified.

## [0.2.0] — 2026-07-10

### Added
- **`memory <bundle-dir>` — the RAG-OKF builder.** Turns a directory of
  [OKF 0.1](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
  concepts (`*.md` with `type`/`title` frontmatter; `index.md`/`log.md`
  reserved) into a serverless RAG:
  - a **byte-deterministic** BM25 snapshot (`minimemory-okf-v1`), pinned by
    `snapshot_sha256` in the `skills-memory` line. Determinism requires
    canonicalization: minimemory's export order comes from a Rust HashMap and
    varies run to run — chunks are sorted by id and re-serialized, which is
    what makes `--check`/CI content-addressing possible at all;
  - three generated executable skills: `search_knowledge` (a **universal
    template** — identical bytes for every publisher, so its `tool_sha256` is
    a stable ecosystem-wide constant: audit once, attest once), `get_concept`
    and `list_concepts` (concept metadata embedded at build time,
    content-addressed);
  - manifest wiring (`memory` block + `published` entries) so a plain
    `publish` emits everything, and a `.gitattributes` pin
    (`skills-index.snapshot -text`) so git CRLF conversion can never break
    the published hash.
  - `memory <bundle> --check` is the CI drift guard. Consumers need nothing
    new: `@rckflr/mcpwasm` ≥ 0.4.0 verifies the snapshot and injects
    `host.memorySearch` on both runtimes (covered by a real end-to-end test
    against the published mcpwasm tarball).

### Changed
- `@rckflr/minimemory` (~630 KB wasm BM25 engine) added as an
  **optionalDependency**: installed by default, lazily imported by `memory`;
  if omitted, `memory` fails with a clear message and every other command
  works exactly as before (the CLI keeps zero hard dependencies).

## [0.1.0] — 2026-07-10

### Added
- Initial release: one-command publisher CLI for the llms.txt Skills
  standard — `init` (scaffold SKILL.md + optional tool.js + manifest),
  `publish [--check]` (sha256, `## Skills` into llms.txt,
  `.well-known/agent-skills/index.json`, ed25519 signing), `validate`
  (llms.txt + skills, local path or URL), `keygen`. Zero dependencies
  (hashing and ed25519 via `node:crypto`); output **byte-identical** to the
  reference Python generator (`scripts/generate.py`), enforced by
  `cli/test.mjs` in CI.
