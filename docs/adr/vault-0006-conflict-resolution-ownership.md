# ADR 0006: Vault Owns Conflict State, Not Conflict Decisions

## Status

Accepted

## Context

Canonical URL conflicts affect auditability and source identity. The system needs deterministic conflict detection and representation, but automatic resolution can destroy provenance by selecting, merging, or archiving source records without explicit intent.

## Decision

The vault layer owns conflict state and mechanics. Humans or explicit higher-level workflows own conflict resolution decisions.

Responsibilities:

- Vault detects canonical URL conflicts.
- Vault records explicit conflict state.
- Vault lint reports unresolved conflicts.
- Vault may provide commands such as `vault resolve-conflict`.
- Ingest does not decide merges.
- Query/search displays conflicts without silently resolving them.
- Release-check may treat unresolved conflicts as blocking errors.
- The decision to keep, merge, archive, or supersede records must come from a human or explicit workflow.

## Consequences

- Conflict records remain auditable.
- Ingest pipelines stay deterministic and provider-focused.
- Release-check can enforce stricter policy without duplicating conflict detection.
- A future conflict-resolution workflow can be added as a separate product surface.
