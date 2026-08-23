# Domain Docs

How engineering skills should consume this repository's domain documentation
when exploring the codebase.

## Before exploring

Read these before exploring a domain:

- `CONTEXT.md` at the repository root.
- Relevant decisions under `docs/adr/`.
- For ingest, memory, source registration, or workflow integration:
  `docs/AGENT_WORKFLOW_INTEGRATION.md`, `docs/MEMORY_GOVERNANCE.md`,
  `docs/INGEST.md`, and `docs/LOCAL_PROJECTS.md`.

If a referenced ADR does not exist, continue without inventing one. Create
domain documentation lazily when a decision or vocabulary gap requires it.

## File structure

This is a single-context repository:

```text
/
├── CONTEXT.md
├── docs/adr/
└── packages/ and application sources
```

## Vocabulary

Use the terminology defined in `CONTEXT.md` for issues, plans, tests, and
refactor proposals. Do not introduce synonyms for established domain terms.

## ADR conflicts

If a proposed change contradicts an existing ADR, surface the conflict
explicitly instead of silently overriding it.
