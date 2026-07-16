# ADR 0014: Use Snapshot Revision for Graph Index Freshness

## Status

Accepted

## Context

A temporal graph index can become stale whenever canonical vault records change. Time-based TTL is not enough: a recent index can already be wrong after a vault apply, and an old index can still be correct if the vault snapshot is unchanged.

## Decision

Graph index freshness is determined by the Vault Index Snapshot hash or revision. Graph metadata records the indexed snapshot identifier, and graph-enabled release profiles fail when it does not match the current snapshot. TTL may produce warnings, but it is not the correctness signal.

## Consequences

Graph rebuilds become idempotent and verifiable. Query paths can degrade clearly when the graph backend is unavailable or stale, while still knowing whether graph results correspond to current Markdown canonical state.
