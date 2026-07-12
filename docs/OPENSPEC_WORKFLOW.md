# OpenSpec Workflow

LLMwiki uses OpenSpec as a lightweight, repo-local planning surface for non-trivial engineering changes. It does not replace GSD, work-OS issue notes, vault memory, release CI, or MCP/runtime tests.

Use OpenSpec when a change touches multiple files, modifies contracts, changes release/onboarding behavior, alters agent coordination, or needs durable design rationale before implementation.

Skip OpenSpec for typo fixes, narrow one-file patches, emergency hotfixes, and mechanical formatting.

## Local Commands

```bash
openspec list
openspec new change <change-id>
openspec status --change <change-id>
openspec validate <change-id> --strict
openspec archive <change-id>
```

Codex local OpenSpec skills are generated under `.codex/skills/openspec-*`. After restarting Codex, the intended slash-flow is:

```text
/opsx:explore
/opsx:propose <change>
/opsx:apply
/opsx:archive
```

## LLMwiki Rules

- Keep public naming as LLMwiki / `llmwiki`; keep `vault-mind` as compatibility surface.
- Treat OpenSpec as change intent, not runtime state.
- Preserve Source Registration Phase 1: only `url` and `vaultPath` inputs are supported by `source.register`.
- Keep draft agent output out of durable team truth until reviewed.
- Route current executable LLMwiki work through `01-Projects/<project>/issues/<slug>.md`, not retired docket paths.
- Validate OpenSpec artifacts before implementation authority: `openspec validate <change-id> --strict`.

## First Change

The initial adoption change lives at:

```text
openspec/changes/adopt-openspec-workflow/
```

It defines the `openspec-governance` capability and acts as the template for future LLMwiki OpenSpec changes.
