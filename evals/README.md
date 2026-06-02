# Evaluation harness

Measures whether an agent uses the skill a site **publishes** for a task, instead
of falling back to a generic local solution — the discovery/execution gap
documented in RFC §5.3 / §5.4.

Each scenario is run in two arms:

- **baseline** — the agent gets only the task.
- **discovery** — the agent also gets the site's `llms.txt` and the discovered
  `SKILL.md` (the [`llms-txt-aware`](../skills/llms-txt-aware/SKILL.md) flow,
  pre-fetched and injected).

The metric is the pass rate of each scenario's `expect_action_regex` against the
agent's final answer. **A discovery-arm score higher than baseline is the
evidence that publishing `## Skills` changes agent behavior.**

## What runs without an API key

```bash
python evals/harness.py --reference
```

This runs a **deterministic reference solver** (no model) against the live site:

```
[reference / baseline]  0/2 passed     # nothing to go on -> generic local fallback
[reference / discovery] 2/2 passed     # fetches llms.txt + SKILL.md, derives the exact URL
```

The reference solver is **not a model** — it proves two things deterministically:

1. The scenarios are **solvable from the published artifacts** (the site's
   `llms.txt` + `SKILL.md` contain everything needed to produce the correct call).
2. The reference site is **conformant** and reachable.

It is **not** wired into CI on purpose: it needs network access to the live
target site, which would make the build flaky. Run it manually as a conformance
check. Color-name → hex resolution in the solver is a small hardcoded demo map;
a real agent infers that.

## Producing model numbers

The behavioral comparison — *do real models cross the gap?* — needs live models.
**Results from a local run are in [`results.md`](results.md)** (baseline 8% →
discovery 75% across 6 local models). Reproduce with any of:

```bash
# Local models via LM Studio (no API key) — start LM Studio's server first
python evals/harness.py --model lmstudio --model-id qwen3-0.6b
python evals/harness.py --model lmstudio --model-id <id> --out evals/results.json

# Anthropic
ANTHROPIC_API_KEY=... python evals/harness.py --model anthropic --model-id claude-sonnet-4-6

# Cloudflare Workers AI (free tier)
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
  python evals/harness.py --model cloudflare --model-id @cf/meta/llama-3.1-8b-instruct
```

Report `baseline` vs `discovery` pass rates. Expected shape: baseline near zero
(the model invents a local solution), discovery much higher (given the site
context, it uses the published endpoint).

This complements the 3-model A/B benchmark in
[agentic-tools-poc](https://github.com/MauricioPerera/agentic-tools-poc), which
measures the catalog-as-owned-artifact pattern at the loader level.

## Adding scenarios

Append to [`scenarios.json`](scenarios.json):

```json
{
  "id": "unique-id",
  "task": "natural-language task that references a domain",
  "origin": "https://the-site",
  "expect_skill": "the-skill-title-in-##-Skills",
  "expect_action_regex": "regex the correct answer must match",
  "fail_note": "what the generic-fallback failure looks like"
}
```
