---
type: issue
entity: project/obsidian-llm-wiki/issue/temporal-graph-index-search-accelerator
state: todo
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/temporal-graph-index-search-accelerator
description: Add temporal graph index as a rebuildable search accelerator.
status: active
priority: 2
assignee: codex
last-verified: 2026-07-02
labels:
- ready-for-agent
- graph-index
- llmwiki
- search
- memory-system
related_adrs:
- vault-0012
- vault-0013
- vault-0014
- vault-0015
- vault-0016
- vault-0017
---# Temporal Graph Index Search Accelerator PRD

## Problem

LLMwiki already has an audit-grade Markdown-first Vault Layer with Source Notes, Evidence Notes, artifacts, the Vault Read API, and the Vault Index Snapshot. That gives durable provenance, but it does not yet provide a temporal knowledge graph that can accelerate agent memory queries over entities, facts, changing relationships, and project history.

The user wants Graphiti-style temporal graph retrieval inside LLMwiki without weakening the existing source/evidence canonical model. Graph retrieval must help answer which projects, issues, topics, sources, and evidence relate to another concept while keeping every result tied back to source and evidence provenance.

The main risk is that a graph database, Graphiti adapter, or LLM extraction pipeline could become a second source of truth. That would make LLMwiki harder to audit, rebuild, release-check, and run without external services.

## Solution

Add a Temporal Graph Index as a derived, rebuildable search accelerator. It consumes only the Vault Index Snapshot, materializes minimal Temporal Facts, and returns Provenance-Bearing Graph Hits through query surfaces. It never writes canonical Source Notes, Evidence Notes, artifacts, or other vault state.

The first implementation slice should build an internal GraphIndexAdapter contract with a deterministic fake or in-memory backend. Graphiti can be added later as a backend adapter, not as the first dependency. The first PoC fixture should use existing LazyCodex memory material so the graph flow proves a real LLMwiki workflow instead of a toy graph.

`query.unified` uses graph retrieval in `opportunistic` mode by default. Missing or stale graph infrastructure should degrade with an explicit warning on normal query paths. Release Profiles may require graph freshness and fail when the graph index is missing or stale.

## User Stories

1. As an LLMwiki user, I want graph retrieval to improve search over research memory, so I can find related sources, evidence, issues, and concepts faster.
2. As an LLMwiki user, I want graph retrieval to preserve source and evidence links, so every graph result remains auditable.
3. As an LLMwiki user, I want normal vault use to work without Graphiti or a graph database, so I can keep the Markdown-first workflow lightweight.
4. As an LLMwiki user, I want graph search to participate automatically when it is fresh and available, so I do not need to manage two query flows manually.
5. As an LLMwiki user, I want graph search to degrade clearly when unavailable, so missing graph infrastructure does not look like missing evidence.
6. As an LLMwiki user, I want release checks to optionally require graph freshness, so stricter publication workflows can depend on graph-backed retrieval.
7. As an agent using LLMwiki, I want to query by source ID, so I can recover graph facts tied to a known source.
8. As an agent using LLMwiki, I want to query by evidence ID, so I can recover graph facts tied to a known evidence record.
9. As an agent using LLMwiki, I want to query by entity text, so I can find related project memory such as LazyCodex.
10. As an agent using LLMwiki, I want to query by relation or topic text, so I can find facts related to the LLMwiki memory workflow.
11. As an agent using LLMwiki, I want Provenance-Bearing Graph Hits rather than generated answers, so I can compose answers using verified evidence.
12. As an agent using LLMwiki, I want graph hits to include snippets or fact text, so I can decide whether a hit is relevant before reading full evidence.
13. As an agent using LLMwiki, I want graph hits to include source IDs, evidence IDs, and artifact references, so I can cite the right records.
14. As a maintainer, I want graph facts extracted during Graph Index Rebuild, so ingest and vault apply remain focused on canonical evidence capture.
15. As a maintainer, I want graph rebuilds to be deterministic for fake backend fixtures, so tests do not depend on external services.
16. As a maintainer, I want the graph index to record the Vault Index Snapshot hash or revision it indexed, so freshness is precise.
17. As a maintainer, I want freshness to be based on snapshot identity rather than TTL, so correctness is tied to vault content.
18. As a maintainer, I want TTL to remain only an auxiliary warning signal, so old-but-current indexes do not fail incorrectly.
19. As a maintainer, I want a minimal Temporal Fact schema, so the first implementation does not become an ontology project.
20. As a maintainer, I want Temporal Facts to distinguish observed time from validity time, so capture time is not confused with when a fact was true.
21. As a maintainer, I want `valid_from` and `valid_to` to be optional, so evidence without explicit temporal validity is not polluted by invented dates.
22. As a maintainer, I want `temporal_status` on each Temporal Fact, so consumers know whether the validity window is absent, inferred, explicit, or unknown.
23. As a maintainer, I want `extraction_method` on each Temporal Fact, so manual, rule-based, and LLM extractions remain distinguishable.
24. As a maintainer, I want LLM extraction to be explicitly enabled, so release checks do not depend on model access or nondeterministic extraction by default.
25. As a maintainer, I want Graphiti to be added behind the same adapter contract later, so third-party backend behavior does not leak into LLMwiki's core query contract.
26. As a maintainer, I want graph diagnostics to avoid secrets and private headers, so graph indexing remains safe for release artifacts.
27. As a maintainer, I want LazyCodex to be the first PoC fixture, so the graph feature proves value against real LLMwiki memory material.
28. As a maintainer, I want the fake backend to support source, evidence, entity, and relation/topic queries, so the high-level retrieval contract is tested before Graphiti.
29. As a release-check author, I want graph mode `off`, `opportunistic`, and `required`, so different workflows can choose different strictness levels.
30. As a release-check author, I want required graph mode to fail when the graph is stale or unavailable, so graph-dependent releases do not silently degrade.
31. As a query implementation author, I want graph hits to merge with non-graph results at `query.unified`, so ranking and answer composition stay above individual retrieval backends.
32. As a query implementation author, I want graph-index to return structured hits instead of final prose, so answer generation remains testable separately.
33. As a future Graphiti adapter author, I want LLMwiki Temporal Facts to be the normalized output shape, so Graphiti internals do not become the public contract.
34. As a future Graphiti adapter author, I want telemetry expectations documented, so Graphiti can be adopted without violating privacy or release requirements.
35. As a future ontology author, I want rich ontology support to be out of scope for the first slice, so it can be designed later as an explicit capability.

## Implementation Decisions

- Build the Temporal Graph Index as a derived search index. It is rebuildable and never canonical.
- Build the GraphIndexAdapter contract before adding a Graphiti backend.
- Include a fake or in-memory backend in the first slice to test graph semantics without external services.
- Graph indexing consumes only the Vault Index Snapshot produced by the Vault Read API.
- Fact extraction happens during Graph Index Rebuild, not during ingest or vault apply.
- Graph Index Rebuild materializes episodes, entities, and minimal Temporal Facts from normalized vault records.
- Graph-index does not parse Markdown directly. Markdown parsing remains owned by the Vault Read API.
- Graph-index does not write Source Notes, Evidence Notes, artifacts, or other canonical vault state.
- Graph-index returns Provenance-Bearing Graph Hits, not generated final answers.
- A Provenance-Bearing Graph Hit includes retrieved graph fact information plus source ID and evidence ID.
- The graph hit shape should support hit identity, score, entity identifiers or text, fact identity, observed time, optional validity window, source ID, evidence ID, artifact references, and snippet or fact text.
- Graph Index Freshness is determined by matching the current Vault Index Snapshot hash or revision with graph metadata.
- TTL may produce warnings, but it is not the correctness signal for graph freshness.
- `query.unified` uses graph mode `opportunistic` by default.
- Graph mode `off` disables graph retrieval.
- Graph mode `required` fails when the graph is unavailable or stale for graph-aware Release Profiles.
- The first Temporal Fact schema includes fact identity, subject text, predicate, object text, `observed_at`, optional `valid_from`, optional `valid_to`, `temporal_status`, source ID, evidence ID, artifact references, confidence, and `extraction_method`.
- The first Temporal Fact schema does not include custom entity types, ontology inheritance, automatic schema evolution, cross-vault entity resolution, or contradiction adjudication.
- Missing validity windows are allowed. `observed_at` records when LLMwiki saw evidence. `valid_from` and `valid_to` record when the fact was true in the world only when evidence supports that window.
- `temporal_status` distinguishes `atemporal`, `inferred_window`, `explicit_window`, and `unknown`.
- `extraction_method` distinguishes `manual`, `rule`, and `llm`.
- First fake backend fixtures use manual Temporal Facts.
- Rule extraction may be added for predictable source structures.
- LLM extraction is explicitly enabled only and records the model, provider, and prompt schema version used.
- Release-check does not depend on LLM extraction by default.
- A later Graphiti backend adapter normalizes output into LLMwiki Temporal Facts and Provenance-Bearing Graph Hits.
- Graph diagnostics must not store secrets, cookies, private headers, credentials, or unreviewed private payloads.
- The first PoC fixture uses existing LazyCodex memory material.
- The LazyCodex PoC must support queries by source ID, evidence ID, entity `LazyCodex`, issue `LCX-001`, and relation/topic `LLMwiki memory workflow`.
- The LazyCodex PoC must prove graph hits can be returned through the graph-index API and merged into `query.unified` in opportunistic mode.

## Testing Decisions

- Test the highest-level contract first: GraphIndexAdapter rebuild and search behavior from the Vault Index Snapshot, plus `query.unified` opportunistic integration.
- Existing Vault Index Snapshot and `read-vault-index` tests are prior art for normalized record fixture setup.
- Existing lint and ingest contract tests are prior art for release-style validation and explicit degradation behavior.
- Tests verify external behavior: given normalized vault records and graph mode, the system returns expected provenance-bearing hits and explicit degradation status.
- Tests should not assert private graph backend storage layout.
- Fake backend tests rebuild normalized records into manual facts without network, database, Graphiti, or LLM calls.
- Freshness tests change the snapshot hash or revision and verify stale graph indexes are detected.
- Opportunistic query tests verify fresh graph hits participate, stale graph degrades with a warning, and missing backend degrades with a warning.
- Required graph mode tests verify failure when the graph index is missing or stale.
- Off mode tests verify graph retrieval is not attempted.
- Provenance tests reject graph hits that lack source ID or evidence ID.
- Temporal fact tests allow missing `valid_from` and `valid_to`, while requiring `observed_at` and `temporal_status`.
- Extraction tests verify manual facts are accepted, rule facts are represented, and LLM extraction metadata is required when `extraction_method` is `llm`.
- LazyCodex fixture tests cover source ID, evidence ID, entity `LazyCodex`, issue `LCX-001`, and relation/topic `LLMwiki memory workflow`.
- Secret-safety tests verify graph diagnostics do not include tokens, cookies, private headers, or credentials.
- Graphiti adapter tests are out of the first slice unless implemented behind the already-tested adapter contract.

## Out of Scope

- Making Graphiti or any graph database canonical state.
- Requiring Graphiti, Neo4j, FalkorDB, or another graph backend for normal vault use.
- Parsing Markdown directly inside graph-index.
- Writing Source Notes or Evidence Notes from graph-index.
- Generating final natural-language answers from graph-index.
- Full ontology design, custom entity type hierarchy, schema evolution, or cross-vault entity resolution.
- Contradiction adjudication between facts.
- Default LLM fact extraction.
- Release-check dependence on LLM extraction by default.
- Production Graphiti adapter behavior before the fake backend contract is proven.
- Whole-vault visual graph or Obsidian graph polish.

## Further Notes

Relevant domain terms are Temporal Graph Index, Graph Index Rebuild, Provenance-Bearing Graph Hit, Graph Index Freshness, Graph Query Mode, Temporal Fact, Observed Time, Temporal Status, and Extraction Method.

Relevant architectural decisions are ADR 0012 through ADR 0017. This PRD assumes those decisions remain accepted.

This PRD is ready for agent implementation planning. The next workflow step is to split it into independently implementable issues.
