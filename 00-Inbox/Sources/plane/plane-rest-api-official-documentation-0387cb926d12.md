---
llmwiki-source: true
source-id: "src_0387cb926d12"
input-type: "url"
platform: "plane"
source-kind: "documentation"
actor: "codex"
project-id: null
project: null
canonical: "https://developers.plane.so/api-reference/introduction"
registered-at: "2026-07-15T15:35:45.647Z"
updated-at: "2026-07-15T15:35:45.647Z"
tags: ["project-management", "external-projection", "plane", "official-docs"]
---

# Plane REST API official documentation

## Source

- Input: https://developers.plane.so/api-reference/introduction
- Canonical: https://developers.plane.so/api-reference/introduction
- Platform: plane
- Source kind: documentation

## Preflight

```json
{
  "url": "https://developers.plane.so/api-reference/introduction",
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

Authoritative clean-room reference for the LLM Wiki Project external projection adapter. Use /api/v1/workspaces/{workspace_slug}/projects/{project_id}/work-items/, X-API-Key authentication, and configurable Plane Cloud or self-hosted base URL. Do not copy Plane source code.

## Captures

- Pending. Phase 1 registers the source only.

## Derivatives

- Pending. Transcript/OCR/comment digests are later ingest artifacts.

## References

- https://developers.plane.so/api-reference/introduction
