---
type: Playbook
title: Publishing skills
description: The two-command publisher flow and the CI guard.
tags: [publisher]
---

# Publishing skills

```
npx @rckflr/llms-skills init mi-skill    # scaffold SKILL.md (+ tool.js with --tool)
npx @rckflr/llms-skills memory ./docs    # optional: OKF bundle -> serverless RAG
npx @rckflr/llms-skills publish          # sha256 + ## Skills + index.json (+ signing)
```

Your llms.txt is the source of truth; index.json is derived. In CI, one line
(`uses: MauricioPerera/llms-txt-skills@master`) fails the build if what you
serve drifts from your sources. Signing needs one keygen; keep the private key
offline and out of git.
