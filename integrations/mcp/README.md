# llms-txt-skills MCP server

A small [MCP](https://modelcontextprotocol.io) server that lets **any MCP-capable runtime** (Claude Desktop, Cline, Continue, Cursor, Windsurf, …) discover and consume Agent Skills published via `llms.txt`.

It exposes the [`llms-txt-aware`](../../skills/llms-txt-aware/SKILL.md) workflow as three tools:

| Tool | What it does |
|---|---|
| `llmstxt_read` | Fetch a domain's `/llms.txt` in full (its operating manual). |
| `llmstxt_discover_skills` | List the skills a site publishes in its `## Skills` section. |
| `llmstxt_fetch_skill` | Fetch a `SKILL.md` and verify integrity (sha256) + authenticity (ed25519 signature from `index.json`). |

The server never auto-loads a skill — it surfaces what's available so the agent (and user) can opt in. It fails open: sites without `llms.txt` simply return "none".

## Install

```bash
pip install -r requirements.txt
```

## Configure your client

Point your MCP client at the server over stdio. Example (Claude Desktop / Cline / Cursor `mcpServers` block):

```json
{
  "mcpServers": {
    "llms-txt-skills": {
      "command": "python",
      "args": ["/absolute/path/to/integrations/mcp/llms_txt_skills_mcp.py"]
    }
  }
}
```

For Continue, add the equivalent entry under `mcpServers` in your config.

## Try it

Once connected, ask your agent something like:

> "Check what https://img.automators.work publishes and load its placeholder skill."

The agent will call `llmstxt_read` / `llmstxt_discover_skills`, show you the skills, and use `llmstxt_fetch_skill` (with signature verification) when you approve.

## Trust model

`llmstxt_fetch_skill` reports two independent checks (see RFC §4.6):

- **integrity** (`sha256`): the content was not altered in transit.
- **authenticity** (`ed25519 signature`): the content was signed by the publisher's key declared in `index.json`.

A `mismatch` or `invalid` result means the skill should not be loaded without explicit user confirmation.
