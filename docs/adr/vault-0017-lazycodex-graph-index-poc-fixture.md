# ADR 0017: Use LazyCodex Evidence as Graph Index PoC Fixture

## Status

Accepted

## Context

The Temporal Graph Index PoC needs a real LLM Wiki memory workflow fixture, not a toy graph that only proves the adapter can store synthetic facts. `10-Projects/lazycodex` already contains source registry, evidence, and docket material tied to LLM Wiki memory integration.

## Decision

Use the existing LazyCodex source/evidence material as the first graph-index PoC fixture. The fake backend should index manual Temporal Facts for source ID, evidence ID, entity `lazycodex`, issue `LCX-001`, and relation/topic `llmwiki memory workflow`, then return provenance-bearing graph hits through graph-index and `query.unified` opportunistic mode.

## Consequences

The first graph-index test validates the actual LLM Wiki workflow the user cares about. It also prevents a misleading toy success where graph retrieval works but source/evidence provenance and project-memory integration remain unproven.
