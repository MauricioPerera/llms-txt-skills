---
type: Documentation
title: What is llms.txt Skills
description: The one-paragraph definition of the standard and the problem it solves.
tags: [overview]
---

# What is llms.txt Skills

llms.txt already tells agents WHAT a site is. This standard adds a `## Skills`
section to that same file, telling agents HOW to use the site: one markdown
bullet per published Agent Skill (SKILL.md), discovered on the same fetch,
verified by sha256 (and optionally ed25519), and used only with explicit user
opt-in. Zero infrastructure on the publisher side: static files on any host.

Canonical spec: /rfc-skills-in-llms-txt.md (RFC, v0.8).
