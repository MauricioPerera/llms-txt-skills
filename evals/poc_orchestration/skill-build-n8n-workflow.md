---
name: build-n8n-workflow
description: Build a workflow in this n8n instance from a natural-language request. Use when the user asks to create, automate, or wire up an n8n workflow. Encodes the exact tool order so you never guess or discover the procedure by trial-and-error.
version: 1.0.0
license: MIT
---

# Build an n8n workflow

You are connected to an n8n instance over MCP. The tools available are **building blocks**, not a procedure — this skill is the procedure. Follow it in order. Do **not** improvise the order, and do **not** call `create_workflow_from_code` before validating.

## The recipe (follow in this exact order)

1. **Learn the SDK first.** Call `get_sdk_reference` once (sections `"patterns"` then, only if you hit trouble, `"guidelines"`). This tells you the SDK syntax. Do this before writing any code — guessing syntax is the #1 cause of validation failure.

2. **Discover the nodes you need.** Call `search_nodes` ONCE with all the services in a single `queries` array (e.g. `["schedule trigger", "slack", "http request"]`). Read the returned node IDs **and their discriminators** (resource / operation / mode). You will need those exact IDs in the next step.

3. **Get the exact parameter types — do not skip this.** Call `get_node_types` with **every** node ID you plan to use, including the discriminators from step 2. This returns the exact parameter names. Writing parameter names from memory produces invalid workflows; always pull the types.

4. **Write the workflow code** using the SDK patterns from step 1 and the exact parameter names from step 3. Keep it minimal: a trigger plus the requested action nodes, connected in order.

5. **Validate before creating.** Call `validate_workflow` with the full code. If it returns errors, fix the code and re-validate. Repeat until valid. **Never** call create with un-validated code.

6. **Create it.** Call `create_workflow_from_code` with the validated code and a one-sentence `description`. Capture the returned workflow **id**.

7. **Closure.** Unless the user said otherwise, leave the workflow as an inactive draft and report its id. Only call `publish_workflow` (activate) if the user explicitly asked to activate/turn it on, and only call `execute_workflow` / `test_workflow` if they asked to run it.

## Rules

- One `search_nodes` call with a batched `queries` array — not one call per service.
- Always `get_node_types` before writing code.
- Always `validate_workflow` before `create_workflow_from_code`.
- Stop after the create (+ optional activate/run). Do not poll, list, or explore further.
- If validation still fails after 3 attempts, report the last error instead of looping.

## Done criteria

A `create_workflow_from_code` call returned a workflow id, built from validated code, matching the user's request.
