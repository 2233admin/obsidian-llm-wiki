# ADR 0010: Refresh Hot Cache After Successful Apply and Via Explicit Command

## Status

Accepted

## Context

`wiki/hot.md` gives agents a compact recent-context surface, but canonical truth lives in source notes, evidence notes, and artifacts. If hot cache updates are only manual, it will often be stale after ingest. If release-check or query/search owns generation, the read-model boundary becomes unclear.

## Decision

The vault layer owns hot cache generation.

Rules:

- `vault apply-ingest-output` refreshes `wiki/hot.md` after a successful all-or-nothing apply.
- Failed apply does not update hot cache.
- `vault update-hot <vault>` provides explicit manual refresh.
- `release-check` may require fresh hot cache but does not generate canonical state.
- Hot cache is a summary/read model, not canonical truth.

## Consequences

- Daily agent use gets fresh context after ingest.
- Hot cache freshness remains lintable and release-checkable.
- Answers must still cite source/evidence records rather than treating hot cache as provenance.
