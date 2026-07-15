---
llmwiki-source: true
source-id: "src_cf6515f951be"
input-type: "url"
platform: "github"
source-kind: "repo"
actor: "codex"
project-id: null
project: null
canonical: "https://github.com/EXXETA/exxperts"
registered-at: "2026-07-15T08:12:11.984Z"
updated-at: "2026-07-15T08:12:11.984Z"
tags: ["agent-room", "dream-time", "product-research", "clean-room"]
---

# EXXETA exxperts product research

## Source

- Input: https://github.com/EXXETA/exxperts
- Canonical: https://github.com/EXXETA/exxperts
- Platform: github
- Source kind: repo

## Preflight

```json
{
  "url": "https://github.com/EXXETA/exxperts",
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

Product-mechanism research only. Inspected commit 035594aad68db78ef92899578b2e4839343f53d9 on 2026-07-15. PolyForm Noncommercial product layer: do not copy code, prompts, tests, UI text, styles, icons, or assets.

## Captures

- Pending. Phase 1 registers the source only.

## Derivatives

- Pending. Transcript/OCR/comment digests are later ingest artifacts.

## References

- https://github.com/EXXETA/exxperts
