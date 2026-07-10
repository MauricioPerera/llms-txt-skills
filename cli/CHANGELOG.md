# Changelog

All notable changes to the [`@rckflr/llms-skills`](https://www.npmjs.com/package/@rckflr/llms-skills)
package. Format based on [Keep a Changelog](https://keepachangelog.com/); dates
are the npm publish dates.

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
