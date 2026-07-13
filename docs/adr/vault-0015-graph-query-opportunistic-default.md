# ADR 0015: Make Graph Query Opportunistic by Default

## Status

Accepted

## Context

Temporal graph retrieval should improve LLM Wiki search without making graph infrastructure mandatory for normal vault use. Some release profiles may still need graph-backed verification once graph indexing is enabled.

## Decision

`query.unified` uses graph search in `opportunistic` mode by default: fresh graph indexes participate in ranking, while missing or stale graph indexes degrade to non-graph retrieval with an explicit warning. Graph-aware release profiles may set graph mode to `required`, causing missing or stale graph indexes to fail validation. Users may set graph mode to `off`.

## Consequences

LLM Wiki remains usable without Graphiti, Neo4j, or FalkorDB. Projects that need stronger temporal retrieval can opt into required graph freshness during release-check without imposing that dependency on every vault.
