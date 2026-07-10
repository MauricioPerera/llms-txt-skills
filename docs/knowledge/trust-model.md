---
type: Policy
title: Trust model
description: The rings of trust - integrity, authenticity, attestation - and what each defends against.
tags: [security]
---

# Trust model

- Integrity (sha256): declared inline in `## Skills` and in
  /.well-known/agent-skills/index.json. Content altered in transit is refused.
- Authenticity (ed25519 + TOFU key pinning): the publisher signs each SKILL.md
  with an offline key; agents pin the key per origin and flag silent changes.
- Attestation (extension, v0.4): signed human review with an expiry window.
  Sigstore (keyless, OIDC identities) is the RECOMMENDED default; pre-registered
  Ed25519 is the profile for environments without network/fs at verification time.

Honest scope: a same-origin key does not defend against a fully compromised
origin. What it buys: a server compromise WITHOUT the offline key cannot forge
signatures, and key pinning detects silent swaps across sessions.
