---
type: Documentation
title: Executable skills and origin memory
description: tool.js sandboxed execution and hash-pinned BM25 search over the site's own content.
tags: [extension]
---

# Executable skills and origin memory

The Executable Skills extension (v0.4) adds `tool` + `tool_sha256` to a skill
line: a tool.js a runtime (mcpwasm) executes VERBATIM inside a QuickJS-wasm
sandbox instead of asking a model to improvise. The only bridge out is an
explicit host capability (e.g. fetchOrigin, scoped to the publishing origin).

Origin memory: a `skills-memory` line declares a hash-pinned BM25 snapshot;
after verification the runtime injects host.memorySearch, giving every skill
search over the site's own knowledge. One command builds all of it:
`npx @rckflr/llms-skills memory <bundle>`. Spec: /ext-executable-skills.md.
