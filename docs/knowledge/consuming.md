---
type: Playbook
title: Consuming published skills
description: The three ways an agent consumes skills today, and when to use each.
tags: [consumer]
---

# Consuming published skills

1. mcpwasm local runtime (recommended, zero install both sides):
   `npx -y @rckflr/mcpwasm <origin>` - discovers, verifies every hash, sandboxes
   each tool.js, and speaks MCP over stdio. Serves each skill's SKILL.md recipe
   as an MCP resource (skill://<name>) plus a get_skill_guide fallback tool.
2. Claude Code plugin (`llms-txt-aware`): loads SKILL.md as context on domains
   you touch. Prose skills, no execution.
3. Standalone MCP discovery server (integrations/mcp): discover/fetch/verify
   tools for any MCP client.

Note: a GitHub Pages PROJECT site (user.github.io/project) is not directly
consumable by origin-based runtimes (URL origin strips the path); use a user
ROOT site, any custom domain, or clone + `npx mcpwasm --serve <dir>`.
