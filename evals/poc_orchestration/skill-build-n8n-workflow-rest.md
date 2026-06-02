---
name: build-n8n-workflow-rest
description: Build a workflow in this n8n instance using ONLY the public REST API — no MCP, no specialized tools. Use when the user asks to create/automate an n8n workflow. The agent calls one generic HTTP tool; this skill carries the endpoint, the node templates, and the procedure.
version: 1.0.0
license: MIT
---

# Build an n8n workflow via the REST API (no MCP)

You have ONE generic capability: `http_request(method, path, body)`, scoped to
this site's n8n REST API. There are no node-introspection tools — the node JSON
you need is embedded below. Build the workflow JSON and POST it.

## Endpoint

`POST /workflows` — body is a workflow object. Required fields: `name`, `nodes`
(array), `connections` (object), `settings` (object, may be `{}`). Auth is handled
for you. The response contains the new workflow `id`.

## Procedure

1. Pick the node templates you need from the catalog below.
2. Give each node a unique `name` and a `position` ([x, y], space them ~220 apart).
3. Set each node's `parameters` for the user's request.
4. Wire `connections`: `{ "<source node name>": { "main": [[{ "node": "<target name>", "type": "main", "index": 0 }]] } }`.
5. `POST /workflows` with `{ name, nodes, connections, settings: {} }`.
6. Report the returned `id`. Do not activate unless asked.

## Node catalog (copy and adapt `parameters`)

**Schedule Trigger** — runs on an interval/cron.
```json
{ "name": "Schedule Trigger", "type": "n8n-nodes-base.scheduleTrigger", "typeVersion": 1.2,
  "position": [0, 0],
  "parameters": { "rule": { "interval": [ { "field": "cronExpression", "expression": "0 9 * * *" } ] } } }
```

**Webhook** — trigger on an HTTP call.
```json
{ "name": "Webhook", "type": "n8n-nodes-base.webhook", "typeVersion": 2,
  "position": [0, 0],
  "parameters": { "httpMethod": "GET", "path": "my-hook" } }
```

**HTTP Request** — call an external URL.
```json
{ "name": "HTTP Request", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2,
  "position": [220, 0],
  "parameters": { "url": "https://api.example.com/status", "method": "GET" } }
```

**Set (Edit Fields)** — keep/transform fields.
```json
{ "name": "Set", "type": "n8n-nodes-base.set", "typeVersion": 3.4,
  "position": [440, 0],
  "parameters": { "mode": "manual", "assignments": { "assignments": [
    { "id": "1", "name": "value", "type": "string", "value": "={{ $json.value }}" } ] } } }
```

**Slack — send message.**
```json
{ "name": "Slack", "type": "n8n-nodes-base.slack", "typeVersion": 2.3,
  "position": [220, 0],
  "parameters": { "resource": "message", "operation": "post",
    "select": "channel", "channelId": { "mode": "name", "value": "general" },
    "text": "Daily standup time" } }
```

## Rules

- Every node also needs a unique `id` (any short string) — add `"id": "<unique>"`.
- One `POST /workflows`. Do not poll or list afterward.
- If the POST returns a 4xx with a validation message, fix the body and POST once more (max 3 attempts), then report the last error.

## Done criteria

`POST /workflows` returned a workflow `id`, matching the user's request.
