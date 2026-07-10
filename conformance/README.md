# Conformance kit

Executable conformance suite for llms-txt-skills **runtimes**. A third-party
implementation demonstrates conformance by running this kit against itself —
the kit spins up a deterministic fixture publisher on localhost, drives the
runtime over MCP stdio, and validates every MUST of the core RFC and the
[Executable Skills extension (v0.5)](../docs/ext-executable-skills.md), each
check citing its spec section.

## Run it against your runtime

Your runtime must speak MCP over stdio (one JSON response per line) and take
the origin URL as an argument. Then:

```bash
node conformance/run.mjs --cmd "your-runtime {origin}"
```

`{origin}` is replaced with the fixture's URL. Example — the reference
implementation:

```bash
node conformance/run.mjs --cmd "npx -y @rckflr/mcpwasm {origin}"
# CONFORMANT: 14/14 checks (0 SHOULD warning(s))
```

Exit code 0 = conformant (all MUSTs pass; SHOULDs may warn). Non-zero = not
conformant, with each failed check printed alongside its spec citation.

## What is checked

| Level | Checks |
|---|---|
| MUST | section-scoped discovery; `tool_sha256` rejection on mismatch; valid skills load & execute; prose skills never execute; origin-scoped fetch (escape attempts fail closed); `structuredContent` object wrapping; scope renaming `<scope>__<name>`; invalid-scope rejection; public-name collision (first wins); tampered memory snapshot ⇒ capability absent, fail-closed; unknown tool ⇒ controlled error, runtime survives |
| SHOULD | verified SKILL.md recipes served as `skill://<name>` resources; tampered recipe omitted while its tool still loads |

## Non-MCP runtimes

```bash
node conformance/run.mjs --fixture-only ./fixture
```

writes the fixture files plus `expected.json` (the full check list with
levels and citations) so you can serve the fixture yourself and self-verify
against the documented behaviors.

## Claiming conformance

If your runtime passes (exit 0), you may state: *"conformant with
llms-txt-skills core RFC v0.10 + Executable Skills v0.5, verified with the
official conformance kit `<commit>`"*. PRs adding your runtime to the README
of the spec are welcome — include the kit's output.
