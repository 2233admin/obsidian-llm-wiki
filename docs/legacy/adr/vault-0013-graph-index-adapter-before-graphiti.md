# ADR 0013: Build Graph Index Adapter Interface Before Graphiti Backend

## Status

Accepted

## Context

LLM Wiki wants Graphiti-style temporal graph retrieval, but the important first boundary is not the third-party backend. The graph index must consume only normalized Vault Index Snapshot records and must return provenance-bearing hits that cite source and evidence records.

## Decision

Build an internal `GraphIndexAdapter` interface and an in-memory or fake backend first. Add Graphiti as a later backend adapter after the contract, fixtures, query integration, and release profile behavior are proven.

## Consequences

This keeps graph-index semantics testable without Neo4j/FalkorDB, structured-output LLM extraction, telemetry, or backend configuration in the first slice. Graphiti remains the target production-style adapter, but it cannot shape the canonical LLM Wiki boundary.
