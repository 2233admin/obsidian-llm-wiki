---
llmwiki-source: true
source-id: "src_ef1d62b18b98"
input-type: "url"
platform: "github"
source-kind: "repo"
actor: "codex"
project-id: null
project: null
canonical: "https://github.com/vectorize-io/hindsight"
registered-at: "2026-07-15T15:43:10.175Z"
updated-at: "2026-07-15T15:43:10.175Z"
tags: ["agent-memory", "retrieval-adapter", "hindsight", "clean-room"]
---

# Hindsight agent memory product research

## Source

- Input: https://github.com/vectorize-io/hindsight
- Canonical: https://github.com/vectorize-io/hindsight
- Platform: github
- Source kind: repo

## Preflight

```json
{
  "url": "https://github.com/vectorize-io/hindsight",
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

Clean-room product/API reference inspected at main commit 5ab6bdc9b63b76ba644124bf65a0fb18c72db7d9, MIT license. Internalize only the provider-neutral recall adapter shape: optional HTTP recall against a configured bank, Settings/SecretRef ownership, read-only Knowledge Adapter semantics, and no copied source, prompts, tests, UI, or assets.

## Captures

- Pending. Phase 1 registers the source only.

## Derivatives

- Pending. Transcript/OCR/comment digests are later ingest artifacts.

## References

- https://github.com/vectorize-io/hindsight
