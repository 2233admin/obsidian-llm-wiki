# ADR 0008: Plan Legacy Source Registry Migration Before Applying

## Status

Accepted

## Context

The canonical registry shape is one source note per file under `sources/<source-id>.md`. Existing systems may still have a legacy `source-registry.md` that contains structured fields, human notes, historical context, or inconsistent fenced blocks.

Automatically rewriting that file into canonical source notes risks losing context, creating incorrect IDs, or hiding conflicts.

## Decision

Legacy `source-registry.md` migration defaults to generating a migration plan. It only writes vault state when explicitly requested.

Intended commands:

```text
llmwiki vault migrate-source-registry <vault> --plan
llmwiki vault migrate-source-registry <vault> --apply
```

`--apply` must use the same all-or-nothing transaction discipline as `apply-ingest-output`.

The migration plan should report:

- source notes that would be created or updated
- missing required fields
- duplicate or conflicting canonical URLs
- evidence links that cannot be resolved
- human notes that cannot be mapped cleanly

## Consequences

- Existing vault data is not rewritten silently.
- Users can inspect migration risk before canonical state changes.
- Migration output becomes useful test fixture material for old-schema support.
