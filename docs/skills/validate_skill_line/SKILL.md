---
name: validate_skill_line
description: Validate a single `## Skills` bullet line against the llms.txt Skills format before publishing it.
version: 1.0.0
license: MIT
---

# validate_skill_line

Use this when drafting or reviewing a `## Skills` entry. Pass the EXACT
markdown bullet line; you get back `valid`, the parsed fields, and precise
`errors` / `warnings` (missing sha256, tool without tool_sha256, non-semver
version, short description). Fix errors before publishing; warnings are
adoption-ladder hints, not blockers. For whole-file validation use
`npx @rckflr/llms-skills validate <llms.txt>`.
