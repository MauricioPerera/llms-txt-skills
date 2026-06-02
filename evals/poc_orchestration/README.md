# POC: a published skill (recipe) vs. a raw tool list — orchestration, not just token bloat

This POC tests a claim from the RFC discussion: **tool search / progressive
disclosure fixes the *token* cost of having many tools, but it does not tell the
agent the *order* to use them in.** A published skill carries the recipe, so the
agent does not have to guess which tool to run first, or discover — by hitting an
error — that it should have validated before creating.

We test it against a **real** target: n8n ships an MCP server with **25 tools**
to build workflows (verified live: `n8n MCP Server v1.1.0`). The harness drives a
real agentic loop (local model via LM Studio ↔ the n8n MCP) and measures what it
actually costs to get a workflow created.

## The five arms — a spectrum from "25 tools" to "0 tools"

Each arm changes how much of the capability lives as **tool schemas in the model
context** vs. as **prose in a published skill**:

| arm | system prompt | tools in context | execution |
|-----|---------------|------------------|-----------|
| `naive` | generic "build it with the tools" | **25** | MCP tool-calls |
| `n8n` | n8n's **own** `instructions` (from MCP `initialize`) | **25** | MCP tool-calls |
| `skill` | curated [`skill-build-n8n-workflow.md`](skill-build-n8n-workflow.md) recipe | **8** (the [declared segment](segment-build-workflow.json)) | MCP tool-calls |
| `dispatch` | same recipe + "you have one tool `n8n(tool,args)`" | **1** generic passthrough | MCP (via the passthrough); **keeps `get_node_types` introspection** |
| `rest` | [REST skill](skill-build-n8n-workflow-rest.md) w/ node templates | **1** generic `http_request` | n8n **REST API** directly; **no MCP, no introspection** |

`naive`/`n8n` are the raw-MCP reality. `skill` is segmentation. `dispatch` and
`rest` are the two "near-zero tools" architectures: `dispatch` keeps the MCP (and
its node introspection) but exposes one passthrough; `rest` is the demoshop
pattern (skill → direct HTTP) applied to a complex, multi-step capability — the
skill carries the node templates because the REST API has no introspection.

`--all-tools` forces `naive`/`n8n`/`skill` to the full 25 (isolates the recipe
effect from the segmentation effect, when the model's context can hold 25).

## Metrics (per task, per arm)

- **success** — a `create_workflow_from_code` call returned a workflow id, built
  from validated code.
- **tool_calls / turns** — orchestration cost.
- **errors** — tool calls that returned an error (the "discover-by-error" tax).
- **context_overflow** — the tool defs + prompt did not fit in the model's
  context window (a failure the *publisher* can prevent, the client cannot).

## Finding 0 (no model reasoning required): the 25 tools don't even fit

The 25 n8n tool definitions cost **~5,106 tokens**. On a model loaded with a
4,096-token context window (a common small-model default), the `naive` and `n8n`
arms **fail before the first turn** with `context_overflow` — the raw tool list
literally does not fit. The `skill` arm (8 segmented tools) fits and runs.

> This is the token-bloat half of the thesis as a hard HTTP error, not an opinion.
> The publisher's skill segment is what makes the server usable on a small model.

## Finding 1: the full spectrum (16k-context run, `schedule-slack`, `qwen/qwen3.5-9b`)

With the model reloaded at 16k context (so all 25 tools *fit* and the comparison
is about behavior, not fitting):

| arm | tools in ctx | success | tool_calls | turns | errors | validate_attempts |
|-----|------:|:---:|-----------:|------:|-------:|------------------:|
| naive    | 25 | ✅ | 7 | 6 | 0 | 2 |
| n8n      | 25 | ✅ | 6 | 5 | 0 | 1 |
| skill    | 8  | ✅ | 6 | 6 | 0 | 1 |
| dispatch | **1** | ✅ | 7 | 7 | 0 | 2 |
| rest     | **1** | ✅ | **1** | **1** | 0 | 0 |

**All five succeed in creating the workflow.** The point is not *whether* it
works but *how much capability has to sit in the model's context* to make it
work — and the answer is: **as little as one generic tool.**

- `dispatch` (1 passthrough tool, MCP-backed) ran the full recipe
  (`get_sdk_reference → search_nodes → get_node_types×2 → validate×2 → create`)
  and created the workflow — proving you can keep the MCP **and its node
  introspection** while putting just one tool definition in context.
- `rest` (1 generic HTTP tool, no MCP) did it in **a single call** — the skill's
  embedded node templates meant zero runtime discovery; the agent assembled the
  workflow JSON and `POST`ed it once.

**Honest reads (so we don't oversell):**
1. Once the tools *fit* (16k), the **orchestration** gap among the MCP arms is
   marginal: `naive` spent one extra `validate` round-trip fixing an
   `INVALID_PARAMETER`; `n8n`/`skill` validated clean. n8n's tool descriptions
   are good enough that a capable model mostly self-orchestrates. The decisive,
   model-independent win is **Finding 0** (at 4k the 25-tool arms don't run).
2. `rest`'s "1 call" is partly because the **REST API does not validate node
   parameters like the SDK's `validate_workflow` does** — it accepted the body
   that the SDK arms had to fix. **Fewer round-trips ≠ higher quality.** `rest`
   is the leanest but skips validation and couples the skill to node-template
   versions; `dispatch` is more robust for the unknown tail (keeps introspection).
3. The footprint result holds regardless of task: **the same workflow gets built
   with 1 tool definition in context instead of 25** — the publisher-side lever,
   declared server-lessly in a skill.

Raw rows: `poc-results.json` (naive/n8n/skill), `poc-results-dispatch.json`,
`poc-results-rest.json`.

## Running it

Requires:
- a local LM Studio server with a tool-calling model (`lms load <id> --context-length 16384`),
- the Bearer token for the n8n MCP in `N8N_MCP_TOKEN` (never commit it).

```bash
export N8N_MCP_TOKEN=...            # n8n MCP Server bearer token (naive/n8n/skill/dispatch)
export N8N_API_KEY=...              # n8n REST API key, X-N8N-API-KEY (rest arm only)

python poc_harness.py --model-id qwen/qwen3.5-9b --arm all            # naive, n8n, skill
python poc_harness.py --model-id qwen/qwen3.5-9b --arm dispatch       # 1 passthrough tool (MCP)
python poc_harness.py --model-id qwen/qwen3.5-9b --arm rest           # 1 HTTP tool (no MCP)
python poc_harness.py --model-id qwen/qwen3.5-9b --arm all --all-tools   # isolate recipe effect
```

Created workflows are cleaned up automatically (MCP arms archive; `rest` deletes).
Use `--no-cleanup` to keep them.

> **Concurrency note.** LM Studio splits a model's context across parallel slots
> (`PARALLEL=N` → `n_ctx / N` per request). Run arms **sequentially**, or an arm
> can hit a spurious `context_overflow`. Load with enough context:
> `lms load <id> --context-length 16384`.

## Honest caveats

- **Not isolated by default.** The headline `skill` arm changes *two* things vs.
  `naive`: the recipe **and** the tool segment. Use `--all-tools` to isolate the
  recipe alone. Both are real, separable benefits of publishing a skill; we report
  them separately rather than conflating.
- **Small-N, single model.** This is a POC, not a benchmark. It demonstrates the
  mechanism and produces a real number; scaling to many models/tasks is the next
  step (mirror `../harness.py`'s multi-model approach).
- **Live side effects.** The loop really creates workflows in the target n8n and
  archives them afterward. Point it at a test instance.
- **The n8n MCP already ships an `instructions` blob** (the `n8n` arm) — so the
  baseline is *not* naive. That the curated skill still helps over n8n's own
  guidance is the stronger result; that 25 tools don't fit at all is the starker one.
