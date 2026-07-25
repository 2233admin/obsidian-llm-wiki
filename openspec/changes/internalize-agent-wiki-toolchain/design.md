## Context

The repository already has the main nouns of an Agent Wiki: Sources, immutable raw evidence, compiled concepts and claims, unified retrieval, optional Knowledge Adapters, Settings, and health checks. The missing piece is an owned maintenance loop. `source.register` currently validates supported inputs but does not create a resumable execution; compilation records dirty topics but can leave small batches pending; compilation appends source references more readily than it revises or retracts prior contributions; and adapters encode vendor command shapes directly.

This change crosses the Python compiler, TypeScript MCP host, Settings Platform, optional CLI/HTTP adapters, and vault-visible machine state. It must preserve the Phase 1 Source Registration boundary (`url` and `vaultPath` only), the distinction between immutable Evidence and rebuildable compiled projections, the existing memory/promotion governance, and a useful filesystem-only baseline when every optional provider is absent.

Current upstream tools are intentionally heterogeneous: qmd 2.x exposes richer intent/explanation and URI semantics; OpenCLI exposes structured discovery and validation; Graphify and Ollama have versioned command/API behavior; LightRAG and RAG-Anything are wrapper-defined; and the MCP TypeScript SDK is between a production v1 line and a not-yet-stable v2 line. The architecture therefore cannot treat a package version or executable name as proof of usable behavior.

## Goals / Non-Goals

**Goals:**

- Own a deterministic Source-to-Knowledge lifecycle from explicit ingest request through capture, compilation, maintenance, and explainable retrieval.
- Make source replacement and deletion revise or retract only the contributions attributable to the changed source version.
- Bound staleness with durable scheduling, recovery, retries, and observable health.
- Normalize optional providers behind a versioned capability contract with fixtures and explicit degraded states.
- Update supported toolchain profiles without making any external tool mandatory.
- Keep generated knowledge rebuildable and keep durable promotion under existing governance.

**Non-Goals:**

- Expanding Phase 1 `source.register` inputs to `repoPath`, `filePath`, `directoryPath`, or `text`.
- Turning registration into an implicit network crawl or background side effect.
- Treating external adapter output as approved memory, a Source, or durable truth.
- Shipping MCP SDK v2 before its stable production release and a separate migration review.
- Requiring qmd, OpenCLI, Graphify, Ollama, LightRAG, RAG-Anything, or a cloud model for baseline operation.
- Replacing the existing review and promotion boundaries for Decisions, Architecture, or Runbooks.

## Decisions

### 1. Separate Source registration from Ingest Run execution

`source.register` remains a validation and identity operation. A separate `source.ingest.plan` / `source.ingest.run` flow creates an immutable Ingest Run record, resolves a Toolchain Capability Profile, executes captures and derivatives, writes receipts, and then marks compilation work dirty. Idempotency keys bind a Source identity, source revision, provider profile revision, and requested operation.

This preserves explicit authority over network and subprocess side effects and allows plan, report-only, resume, and CI modes. The rejected alternative was to make registration automatically crawl because it conflates identity with execution and makes failures and retries difficult to audit.

### 2. Track source-versioned contributions before rendering projections

Compilation produces a contribution manifest keyed by `sourceId`, `sourceRevision`, compiler schema version, and stable contribution identifiers. Claims, relationships, concept membership, summaries, and contradiction observations are derived from the active manifest set. Replacing or removing a source first deactivates its prior manifest, recomputes the affected topic closure, and atomically swaps generated projections while preserving unaffected bytes.

The rejected alternative was append-plus-deduplicate because deduplication cannot prove which source version introduced a claim and therefore cannot safely retract it.

### 3. Use a durable maintenance queue with bounded freshness

Dirty work is persisted as coalescible queue entries rather than held only by process timers. Each entry records affected source/topic keys, reason, earliest execution time, maximum freshness deadline, attempts, lease, and last receipt. Workers debounce bursts but MUST execute by the maximum lag. Expired leases are recoverable after restart. A drain processes all eligible topics within explicit time/cost budgets instead of stopping after the first topic.

Report-only and CI modes use the same planner but do not mutate generated knowledge. This avoids a separate health implementation that could disagree with runtime behavior.

### 4. Plan retrieval across evidence tiers and always expose the route

The query planner accepts optional intent and detail hints, inspects freshness and provenance, and selects among compiled navigation, raw Evidence support, and optional adapter evidence. Compiled results are preferred for conceptual navigation when fresh enough; raw Evidence is preferred or added for factual support, quotation, stale compiled pages, or missing provenance. The trace records selected tiers, normalized identifiers, freshness, fallbacks, and provider explanations without exposing secrets or unsafe vendor error text.

The rejected alternative was a single merged ranking because it hides materially different trust and freshness properties.

### 5. Negotiate capabilities, not executable names

Each provider has a versioned Toolchain Capability Profile containing discovery evidence, semantic capabilities, invocation mode, normalized limits, model/index fingerprints, configuration provenance, and health. A probe is side-effect-free by default and distinguishes `available`, `degraded`, `unavailable`, and `disabled`. Domain services request capabilities such as structured capture, hybrid search with explanation, embeddings, or graph query; an adapter selects a compatible invocation or declines with a typed reason.

Profiles initially cover OpenCLI, media/transcription, qmd, Graphify, Ollama/OpenAI-compatible embeddings, LightRAG, RAG-Anything, and MCP. Version ranges are advisory gates; contract probes and fixtures are authoritative because wrappers and distributions can diverge.

### 6. Support qmd CLI and SDK modes behind one normalized adapter

The qmd adapter normalizes `qmd://` identifiers, collections, intent, detail, explanations, index health, and embedding/model fingerprints. CLI mode remains the portable default. SDK mode is enabled only when its Node runtime and package contract pass the probe. Both modes emit the same `SearchResult` and trace fixtures.

### 7. Support multiple embedding profiles while keeping each index fingerprint-homogeneous

`bge-m3` and `qwen3-embedding:0.6b` are both first-class supported model presets, and Settings may select either preset or another compatible explicit profile per index/collection. Every produced index or vector receipt records provider, endpoint identity, model identifier, dimensions when known, and adapter schema version. A fingerprint mismatch between the selected profile and an existing index marks that index stale or incompatible and triggers an explicit rebuild plan; it never silently mixes vectors produced by different profiles. Existing `bge-m3` and `qwen3-embedding:0.6b` defaults are migrated into explicit index bindings rather than collapsing support to one global model.

### 8. Isolate MCP SDK version differences at the transport composition root

MCP operations and domain handlers remain SDK-neutral. The current v1 SDK stays pinned for production. Transport construction and conformance fixtures form a narrow seam for a future v2 package split. Adopting v2 requires a later change with stable upstream artifacts and release verification.

### 9. Roll out through additive state and compatibility reads

New manifests, queue records, receipts, and profiles use explicit schema versions and atomic writes. Existing compiled pages remain readable while contribution manifests are backfilled. Legacy environment variables remain subordinate compatibility candidates during a deprecation window and appear in Doctor/migration output. Rollback disables new execution and restores the previous compile trigger while retaining additive receipts for later recovery.

## Risks / Trade-offs

- [Contribution backfill cannot perfectly infer old provenance] → Mark legacy projections as `unknown-provenance`, rebuild from registered Evidence where possible, and require a full rebuild before destructive retraction.
- [Provider probes become slow or accidentally mutate state] → Define bounded, side-effect-free probe contracts, cache receipts with expiry, and separate optional verification probes from startup health.
- [Durable queue introduces duplicate execution] → Use idempotency keys, leases, atomic receipts, and idempotent projection swaps; guarantee at-least-once scheduling rather than exactly-once subprocess execution.
- [Freshness rebuilds increase model cost] → Coalesce by affected topic closure, enforce time/token/cost budgets, and support report-only/CI gates.
- [Richer retrieval traces leak paths or vendor errors] → Normalize identifiers, redact Settings/Secret References, and map raw errors to bounded diagnostic codes.
- [Optional SDK and CLI modes drift] → Share golden contract fixtures and require normalized result equivalence for supported features.
- [Upstream version churn invalidates static ranges] → Treat ranges as hints and contract probes as the deciding evidence.

## Migration Plan

1. Add schemas and readers for capability profiles, Ingest Runs, contribution manifests, queue entries, receipts, and retrieval traces without changing default execution.
2. Add provider probes and compatibility fixtures; surface Doctor/migration diagnostics while preserving current adapter paths.
3. Introduce the explicit ingest planner/runner and filesystem baseline, then enable opt-in provider execution.
4. Write contribution manifests during compilation in shadow mode and compare projections against current output.
5. Backfill active contributions from registered Evidence, mark unresolved legacy provenance, and enable atomic source-scoped revise/retract.
6. Replace the in-memory compile threshold with the durable queue and bounded-lag worker; retain a feature flag for the prior trigger during one release window.
7. Enable retrieval routing and trace output, then migrate qmd/OpenCLI/Graphify/Ollama profiles individually after their contract fixtures pass.
8. Remove deprecated environment authority only in a later change after migration telemetry shows no remaining use.

Rollback disables the new runner/worker/router flags, resumes the prior read paths, and leaves additive versioned state untouched. Generated projections can be rebuilt from Evidence and active manifests.

## Open Questions

- What default maximum freshness lag should apply to interactive vault edits versus scheduled remote Sources?
- Which Ingest Run and contribution records belong in vault-visible machine state versus device-local cache when they contain machine-specific paths?
- Should qmd SDK mode ship in the first implementation slice or remain behind an experimental capability flag until CLI parity fixtures are complete?
- What retention window is required for superseded captures and contribution manifests before garbage collection is permitted?
