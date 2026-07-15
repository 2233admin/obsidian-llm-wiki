---
llmwiki-source: true
source-id: "src_2af75360003e"
input-type: "url"
platform: "generic-web"
source-kind: "post"
actor: "codex"
project-id: null
project: null
canonical: "https://github.com/Radiant303/SpringNote"
registered-at: "2026-07-15T15:25:05.946Z"
updated-at: "2026-07-15T15:23:43.595Z"
tags: ["daily-weekly-monthly", "memory-review", "product-research", "clean-room"]
---

# Radiant303 SpringNote product research

## Source

- Input: https://github.com/Radiant303/SpringNote
- Canonical: https://github.com/Radiant303/SpringNote
- Platform: generic-web
- Source kind: post

## Preflight

```json
{
  "url": "https://github.com/Radiant303/SpringNote",
  "platform": "generic-web",
  "label": "Generic web page",
  "sourceType": "web",
  "sourceKind": "post",
  "access_context": "public",
  "mode": "web-capture",
  "provider": {
    "id": "opencli",
    "name": "OPENCLI",
    "configured": false,
    "command": "opencli",
    "env": "VAULT_MIND_OPENCLI_CMD",
    "fallbackEnv": "OPENCLI_CMD",
    "purpose": "OpenCLI plus BBX/browser bridge web capture, article extraction, browser-assisted clipping, and text-first source normalization."
  },
  "pipeline": [
    {
      "id": "opencli",
      "name": "OPENCLI",
      "configured": false,
      "command": "opencli",
      "capability": "resolve.capture",
      "role": "resolve browser/page/source metadata and capture text-first material"
    }
  ],
  "can_auto_ingest": false,
  "status": "needs_provider",
  "confidence": "medium",
  "needs": [
    "OPENCLI web capture"
  ],
  "limitations": [
    "Login-gated, private, deleted, paywalled, or region-blocked content may require browser/cookie-assisted capture.",
    "LLM Wiki must not bypass platform access controls; use only content available to the user and configured providers."
  ],
  "output_contract": "Save Markdown into the vault, preserving source URL and capture metadata.",
  "recommended_vault_path": "素材库/web/<source-slug>.md",
  "next_action": "Configure OPENCLI with VAULT_MIND_OPENCLI_CMD or OPENCLI_CMD; then run the provider to produce Markdown in the vault."
}
```

## Notes

Product-mechanism research only. Inspected commit 9c062d91a8cf93bfb51406d9475417091437c625 on 2026-07-15. AGPL-3.0: do not copy product code, prompts, tests, UI text, styles, icons, screenshots, fixtures, or assets. Independent requirements: governed daily/weekly/monthly knowledge diagnosis, proposal-only reflection, memory conversation, usage observability.

## Captures

- Pending. Phase 1 registers the source only.

## Derivatives

- Pending. Transcript/OCR/comment digests are later ingest artifacts.

## References

- https://github.com/Radiant303/SpringNote
