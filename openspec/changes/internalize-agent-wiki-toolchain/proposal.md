## Why

LLM Wiki already exposes compilation, source registration, retrieval, lint, and optional provider adapters, but these surfaces do not yet form a maintained Agent Wiki loop: registering a source does not create an auditable ingest execution, existing compiled claims are not reliably revised or retracted when a source changes, small dirty sets can remain uncompiled, and external tool upgrades are discovered only after an adapter command fails. Recent OpenWiki, GBrain, qmd, OpenCLI, Graphify, Ollama, and MCP SDK releases make now the right time to internalize the stable domain behavior while moving volatile vendor behavior behind negotiated compatibility profiles.

## What Changes

- Add an explicit Source-to-Knowledge execution path for supported `url` and `vaultPath` inputs: plan an Ingest Run, execute configured provider capabilities, record immutable captures/derivatives and receipts, materialize searchable Evidence Notes, and hand successful outputs to compilation without changing `source.register` into an implicit crawler.
- Replace append-oriented concept maintenance with provenance-bearing, source-versioned contributions. Recompilation will revise or retract affected claims, relationships, concept projections, summaries, and contradiction records while leaving unaffected pages byte-stable.
- Add a durable maintenance queue with debounce, maximum freshness lag, restart recovery, per-source refresh policy, retry/backoff, multi-topic draining, and report-only/CI execution modes.
- Add staleness- and provenance-aware retrieval planning. Queries can provide intent and detail, prefer compiled knowledge for navigation, fall back to raw Evidence for factual support, and expose the selected evidence tier and freshness in query traces.
- Add a versioned Toolchain Capability Profile and probe contract for OpenCLI, media/transcription providers, qmd, Graphify, Ollama/OpenAI-compatible embedding endpoints, LightRAG, RAG-Anything, and MCP runtimes. Domain code consumes normalized capabilities instead of hard-coded CLI or HTTP assumptions.
- Update the qmd integration for current qmd 2.x behavior, including `intent`, `explain`, `qmd://` URI normalization, multiple collections, index health, model fingerprints, and optional SDK/library mode when the runtime satisfies qmd's Node.js requirement. CLI mode remains supported and qmd remains optional.
- Update the OpenCLI integration for the current structured command surface (`--version`, structured list/help, validate/verify, doctor, profiles, plugins, and adapters) and preserve OpenCLI as a capture Provider rather than vault authority.
- Add compatibility profiles and contract fixtures for Graphify 0.9.x, current Ollama embedding APIs, and wrapper-defined LightRAG/RAG-Anything endpoints; reconcile the conflicting embedding-model defaults already present in the repository.
- Keep MCP SDK v1 as the production runtime while v2 remains pre-stable. Add an isolated compatibility seam and contract tests so the split v2 server/client packages can be adopted in a later change after the 2026-07-28 release stabilizes.
- Preserve legacy environment variables and adapter settings during a deprecation window, but emit capability-health diagnostics when a provider is missing, too old, incompatible, or only partially supported.

## Capabilities

### New Capabilities

- `source-ingest-execution`: Auditable planning, execution, resume, and verification of supported Source ingestion through replaceable provider capabilities.
- `maintained-wiki-compilation`: Source-versioned contribution tracking and deterministic rebuild/retraction of affected compiled wiki projections.
- `knowledge-maintenance`: Durable refresh scheduling, queue recovery, freshness policy, health gates, and CI/report execution.
- `retrieval-routing`: Intent-, detail-, provenance-, and freshness-aware selection of compiled knowledge and raw evidence with explainable fallback.
- `toolchain-compatibility`: Capability discovery, version negotiation, normalized provider invocation, health reporting, and backward-compatible configuration for external toolchains.

### Modified Capabilities

- `knowledge-adapters`: Require external search and graph adapters to normalize vendor identifiers, freshness, provenance, explanations, and partial-capability degradation into the shared Knowledge Adapter contract.
- `settings-platform`: Add typed, scoped Toolchain Capability Profile settings, version/capability provenance, embedding-model fingerprints, and migration diagnostics for legacy environment-based configuration.

## Impact

- Python compiler and metadata surfaces under `compiler/`, including compile state, contribution manifests, contradiction reconciliation, health checks, and cost controls.
- MCP domain operations and runtime wiring under `mcp-server/src/`, especially Source, Ingest, compile trigger, unified query, adapter registry, settings runtime, capability health, and write-policy effects.
- Provider adapters for qmd, Graphify, Ollama, LightRAG, RAG-Anything, OpenCLI, and media/transcription runners; new compatibility fixtures will replace unversioned command assumptions.
- Vault-visible machine state for Ingest Runs, compilation contributions, maintenance queue receipts, and freshness reports. Generated views remain rebuildable and durable truth still requires the existing review/promotion path.
- Documentation, setup, doctor output, sample configuration, MCP reference generation, evaluation fixtures, release verification, and migration guidance.
- No new external provider becomes mandatory. Filesystem retrieval and report-only health remain the baseline; unavailable optional providers degrade with explicit diagnostics.
