# ADR 0005: Do Not Auto-Merge Canonical URL Conflicts

## Status

Accepted

## Context

`canonical_url` is part of source identity. If two different source IDs point at the same canonical URL, the system may be seeing a duplicate ingest, a provider normalization difference, or a real source identity conflict. Automatically merging or overwriting those records can mix evidence, artifacts, limitations, and provenance from different runs.

## Decision

`vault apply-ingest-output` must not silently overwrite or auto-merge different source IDs with the same `canonical_url`.

Default rules:

```text
same canonical_url + same source_id
  -> update allowed, subject to no-clobber and transaction checks

same canonical_url + different source_id
  -> block apply unless the contract explicitly declares conflict handling

contract declares conflict
  -> write or update explicit conflict state linking both candidates

forced merge/overwrite
  -> future explicit flag, not MVP default
```

## Consequences

- Duplicate canonical URLs are audit events, not silent updates.
- MVP apply should prefer blocking errors or explicit `conflict` status over automatic data repair.
- A future conflict-resolution workflow can be added without weakening default provenance guarantees.
