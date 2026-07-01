# ADR 0012: Add Temporal Graph as a Derived Search Index

## Status

Accepted

## Context

Graphiti provides a useful model for agent memory: episodes, entities, temporal relationships, provenance, and hybrid retrieval across semantic, keyword, and graph traversal signals. This fits LLMwiki's need for stronger question answering over changing research state.

LLMwiki already has an accepted boundary: Markdown source notes, evidence notes, and artifacts are canonical vault state. Query/search consumes normalized vault read APIs instead of parsing Markdown directly. Hot cache and generated views are read models, not source truth.

If Graphiti or any graph database becomes canonical state, LLMwiki would lose audit-grade portability and make release checks depend on an external service.

## Decision

LLMwiki may internalize the temporal knowledge graph pattern as a derived graph index. The graph index is optional, rebuildable, and never canonical.

Rules:

- Canonical truth remains `sources/`, `evidence/`, artifacts, and their normalized vault read/index snapshot.
- Graph indexing consumes `vault.build_index_snapshot()` or equivalent normalized records only.
- Graph indexing must not parse Markdown directly outside the vault read API.
- Graph indexing must not write canonical source/evidence records.
- Graph indexing may write only backend-local graph state and generated diagnostics.
- Graphiti is an allowed first adapter for the graph index, not a required runtime dependency.
- If the graph backend is unavailable, `vault.search` and `query.unified` must degrade to file/BM25/vector-capable paths with an explicit warning or release-check failure according to profile.
- Any graph result returned to users must include source/evidence IDs and links. Graph-derived facts without provenance are not answerable evidence.
- Temporal validity must preserve superseded facts instead of deleting history when evidence changes.
- Telemetry for third-party graph/index libraries must be disabled or explicitly documented before release profiles may pass.

## Mapping

Suggested Graphiti-style mapping:

| LLMwiki concept | Temporal graph concept |
|---|---|
| Evidence note | Episode |
| Source note | Provenance source |
| Project/topic/concept note | Entity node |
| Extracted claim/fact | Temporal relationship |
| `captured_at` / `fetched_at` | Episode timestamp |
| Superseding evidence | Relationship invalidation or new validity window |
| Artifact path | Provenance attachment |

The first adapter should index a small fixture set from normalized vault records and prove that graph answers still cite the original source/evidence notes.

## Consequences

- LLMwiki gets a path to Graphiti-like temporal retrieval without weakening Markdown-first auditability.
- Graphiti can be evaluated behind an adapter before committing to its operational costs.
- Query/search owns ranking and retrieval composition. Vault owns schema normalization. The graph adapter owns only graph materialization and graph-specific lookup.
- Release-check can require graph freshness for profiles that enable graph indexing, while normal vault lint can treat missing graph backend as warning or info.

## PoC Acceptance

- Index at least one source note, one evidence note, one artifact reference, and one extracted relationship.
- Query by source ID, evidence ID, entity, and temporal fact.
- Return source/evidence links for every graph hit.
- Rebuild graph index from scratch using only normalized vault read APIs.
- Demonstrate graceful behavior when the graph backend is unavailable.
- Confirm no secrets or private headers are written to graph diagnostics.
