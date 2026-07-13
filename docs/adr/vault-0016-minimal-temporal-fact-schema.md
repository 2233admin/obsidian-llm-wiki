# ADR 0016: Start with Minimal Temporal Fact Schema

## Status

Accepted

## Context

Graphiti supports richer ontology patterns, but LLM Wiki's first graph-index slice needs to prove rebuildability, provenance, freshness, and query integration. A broad ontology surface would expand the product before the derived-index boundary is proven.

## Decision

The first Temporal Graph Index uses a minimal temporal fact schema: `fact_id`, `subject_text`, `predicate`, `object_text`, `observed_at`, `valid_from`, `valid_to`, `temporal_status`, `source_id`, `evidence_id`, `artifact_refs`, `confidence`, and `extraction_method`. It does not include custom entity types, ontology inheritance, automatic schema evolution, cross-vault entity resolution, or contradiction adjudication.

## Consequences

The PoC stays focused on provenance-bearing retrieval. Rich ontology support can be added later as an adapter capability or release profile extension after the basic graph-index contract is stable.
Missing validity windows are allowed. `observed_at` records when LLM Wiki saw the evidence; `valid_from` and `valid_to` record when the fact was true in the world only when evidence supports that window. `temporal_status` distinguishes `atemporal`, `inferred_window`, `explicit_window`, and `unknown`.
Extraction methods are `manual`, `rule`, or `llm`. First-version fake backend fixtures use `manual`, predictable source structures may use `rule`, and `llm` extraction must be explicitly enabled with recorded model, provider, and prompt schema version. Release-check does not depend on LLM extraction by default.

