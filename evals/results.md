# Eval results — does publishing `## Skills` change agent behavior?

Run 2026-06-02 with the harness in this directory against local models served by
[LM Studio](https://lmstudio.ai) (no API keys, temperature 0). Raw data:
[`results.json`](results.json).

**7 scenarios across 3 reference sites** — all three sites are published by the
project author (not independent third-party adopters); they exist to exercise the
mechanism, and cover different skill shapes:

- `img.automators.work` — build a URL from a template (`placeholder`, ×3 sizes).
- `demoshop-88e.pages.dev` — call a GET search + a POST cart endpoint.
- `wireframe-studio.pages.dev` — GET with query params + a POST validate endpoint.

Each model runs every scenario in two arms:

- **baseline** — the agent gets only the task (which already names the domain).
- **discovery** — the agent also gets the site's `llms.txt` + the discovered
  `SKILL.md` (the `llms-txt-aware` flow).

A scenario passes only if the answer contains the **exact published endpoint**
(the scorer rejects invented paths like `/600x50/green.png` via a lookahead).

## Results

| Model | Params | baseline | discovery |
|---|---|---|---|
| qwen2.5-0.5b-instruct | 0.5B | 0/7 | 4/7 |
| qwen3-0.6b | 0.6B | 0/7 | 6/7 |
| llama-3.2-1b-instruct | 1B | 0/7 | 4/7 |
| nvidia/nemotron-3-nano-4b | 4B | 0/7 | 6/7 |
| ibm/granite-4-h-tiny | ~7B | 0/7 | 6/7 |
| qwen/qwen3.5-9b | 9B | 2/7 | 7/7 |
| **Total (6 models)** | | **2/42 (5%)** | **33/42 (79%)** |
| reference solver (deterministic, not a model) | — | 0/7 | 7/7 |
| google/gemma-4-26b-a4b † | 26B MoE | 0/7 | 3/7 |

† **Excluded from the aggregate.** This model hit repeated local-serving errors
(4 timeouts/HTTP 400 + 5 empty completions out of 14 calls) on the test hardware.
Of the 3 discovery scenarios where it actually produced output, it got **3/3**
correct — its low score reflects serving instability, not capability.

## Takeaways

- **Discovery moves correct skill usage from ~5% to ~79%.** Given only the task,
  models almost never produce the site's real endpoint; given the published
  `llms.txt` + `SKILL.md`, most do. This is the core claim of the proposal,
  measured.
- **The execution gap persists at the smallest scale, and depends on skill shape.**
  `qwen2.5-0.5b` reaches only 4/7 in the discovery arm: it passes the
  "call this documented endpoint" scenarios (demoshop, wireframe) but fails the
  "fill this URL template" ones (`placeholder`), where it echoes
  `/{width}x{height}[?bg={hex}]` literally instead of substituting. Small models
  consume *endpoint* skills more reliably than *template* skills (RFC §5.3).
- **Baseline failure modes are exactly the documented gap (§5.4):** inventing
  plausible-but-wrong paths (`/api/search?query=`, `/cart/1/2`,
  `/600x50/green.png`), refusing ("I can't access external sites"), or generating
  a local artifact.

## Caveats (honest scope)

- The 3 sites are **all first-party** — this measures the mechanism, not
  third-party adoption (which remains the real open gap).
- Small n: 7 scenarios. A proof of mechanism; complements the loader-level
  3-model A/B in [agentic-tools-poc](https://github.com/MauricioPerera/agentic-tools-poc).
- Single run, greedy decoding (temp 0).
- One 26B MoE was unreliable to serve locally (see †). Two other listed models
  (`mistralai/ministral-3-3b`, `ibm/granite-3.2-8b`) failed to load at all and
  were not run.
- The `reference` row is a deterministic solver, included only to show the
  scenarios are solvable from the published artifacts and the sites are conformant.

Reproduce: see [`README.md`](README.md).
