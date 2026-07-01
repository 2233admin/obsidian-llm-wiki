# ADR 0004: Make Vault Apply All-or-Nothing

## Status

Accepted

## Context

Vault state is audit state. Partial writes can create source notes without evidence, evidence without artifacts, hot cache entries that point to missing files, or generated views that reflect only part of an ingest result. Those failures are hard to diagnose and make release-check results unstable.

## Decision

`vault apply-ingest-output` must be all-or-nothing.

The apply flow must:

1. Validate the ingest output contract.
2. Check every target path for vault containment and write safety.
3. Check no-clobber and conflict rules before writing canonical state.
4. Stage writes before replacing existing files.
5. Replace canonical files only after all validations and staging succeed.
6. Regenerate index, hot cache, and views only after canonical writes succeed.

If any source, evidence, artifact, path, or conflict check fails, the apply fails and leaves existing vault state unchanged.

## Consequences

- Apply implementation needs explicit staging and rollback discipline.
- Generated files are downstream of successful canonical writes.
- Failed apply reports should include planned writes and the first blocking error.
- Tests must verify failed apply does not update source, evidence, hot cache, or generated views.
