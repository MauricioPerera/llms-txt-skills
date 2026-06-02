# Eval results — does publishing `## Skills` change agent behavior?

Run 2026-06-01 with the harness in this directory against local models served by
[LM Studio](https://lmstudio.ai) (no API keys, temperature 0). Raw data:
[`results.json`](results.json).

Each model is run in two arms over the same 2 scenarios:

- **baseline** — the agent gets only the task (which already names the domain).
- **discovery** — the agent also gets the site's `llms.txt` + the discovered
  `SKILL.md` (the `llms-txt-aware` flow).

A scenario passes only if the answer contains the **exact published endpoint**
(`img.automators.work/{w}x{h}` with optional `?bg=<6 hex>`, and no extra path
segment — the scorer rejects invented paths like `/600x50/green.png`).

## Results

| Model | Params | baseline | discovery |
|---|---|---|---|
| qwen2.5-0.5b-instruct | 0.5B | 0/2 | 0/2 |
| qwen3-0.6b | 0.6B | 0/2 | **2/2** |
| llama-3.2-1b-instruct | 1B | 0/2 | 1/2 |
| nvidia/nemotron-3-nano-4b | 4B | 0/2 | **2/2** |
| ibm/granite-4-h-tiny | ~7B | 0/2 | **2/2** |
| qwen/qwen3.5-9b | 9B | 1/2 | **2/2** |
| **Total (6 LLMs)** | | **1/12 (8%)** | **9/12 (75%)** |
| reference solver (deterministic, not a model) | — | 0/2 | 2/2 |

## Takeaways

- **Discovery moves correct skill usage from ~8% to ~75%.** Given only the task,
  models almost never produce the site's real endpoint; given the published
  `llms.txt` + `SKILL.md`, most do. This is the core claim of the proposal,
  measured.
- **The execution gap persists at the smallest scale.** `qwen2.5-0.5b` stays 0/2
  even in the discovery arm — it echoes the URL template literally
  (`/{width}x{height}[?bg={hex}]`) instead of filling it. Publishing a skill is
  necessary but not sufficient; the model still has to follow it (RFC §5.3).
- **Baseline failure modes are exactly the documented gap (§5.4):** inventing
  plausible-but-wrong paths (`/images/placeholder.png`, `/placeholder?size=512`),
  refusing ("I can't access external sites"), or generating a local image.

## Caveats (honest scope)

- Small n: 2 scenarios, one reference site. This is a **proof of mechanism**, not
  a large benchmark. It complements the loader-level 3-model A/B in
  [agentic-tools-poc](https://github.com/MauricioPerera/agentic-tools-poc).
- Single run, greedy decoding (temp 0).
- Two listed models (`mistralai/ministral-3-3b`, `ibm/granite-3.2-8b`) failed to
  load in LM Studio (HTTP 400) and are excluded.
- The `reference` row is a deterministic solver, included only to show the
  scenarios are solvable from the published artifacts (and the site is conformant).

Reproduce: see [`README.md`](README.md).
