---
type: Documentation
title: Adoption ladder (L0-L3)
description: Start minimal, harden later - what each level adds and costs.
tags: [adoption]
---

# Adoption ladder (L0-L3)

Adoption is not all-or-nothing. Each level is additive:

- L0 Discoverable: one `## Skills` bullet in your llms.txt + a SKILL.md. ~2 minutes.
- L1 Integrity: an inline sha256 per skill. Agents refuse altered content.
- L2 Executable: a tool.js + tool_sha256. A runtime executes it verbatim in a sandbox.
- L3 Attested: an ed25519 or Sigstore attestation. Signed human review with expiry.

L0 is the whole ask; everything else is progressive hardening the tooling
(`npx @rckflr/llms-skills`) generates for you. Details: /adoption.md.
