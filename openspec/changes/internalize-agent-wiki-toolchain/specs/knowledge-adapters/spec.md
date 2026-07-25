## MODIFIED Requirements

### Requirement: Settings-derived Knowledge Adapter profile
The MCP host SHALL resolve adapter enablement and MemU, LightRAG, RAG-Anything, Hindsight, Kanban, QMD, Graphify, OpenCLI, media/transcription, and embedding runtime configuration from one redacted Settings Snapshot plus its versioned Toolchain Capability Profiles, SHALL NOT let adapter constructors read environment configuration directly, and SHALL invoke only capabilities advertised by the effective profile.

#### Scenario: Explicit adapter disablement overrides legacy environment
- **WHEN** `adapters.enabled` explicitly excludes an adapter while its historical environment variables remain present
- **THEN** the adapter is not initialized and the legacy values do not revive it

#### Scenario: Legacy configuration remains compatible
- **WHEN** a corresponding adapter setting still resolves from product scope and one unambiguous historical environment or YAML value exists
- **THEN** the runtime may use it as a compatibility candidate, records `legacy-env` or `legacy-config` provenance, and emits a migration diagnostic

#### Scenario: Adapter lacks a requested capability
- **WHEN** an enabled adapter is installed but its effective profile does not advertise the capability requested by a query or ingest plan
- **THEN** the adapter declines with typed degradation and the host continues through compatible adapters or the filesystem baseline

## ADDED Requirements

### Requirement: Normalized external evidence metadata
Every external Knowledge Adapter SHALL normalize vendor identifiers, freshness, provenance, relative score semantics, explanation, capability-profile revision, and partial-result status into the shared retrieval evidence contract.

#### Scenario: Provider returns a vendor-specific URI
- **WHEN** qmd, LightRAG, RAG-Anything, Hindsight, or Graphify returns a vendor-specific identifier
- **THEN** the adapter preserves the original identifier as redacted provenance and emits a stable normalized identifier usable by the query trace

### Requirement: Partial capability degradation
An adapter SHALL advertise and execute independently supported capabilities and SHALL NOT fail host startup solely because an optional capability, model, index, or remote endpoint is unavailable.

#### Scenario: Search works but explanations do not
- **WHEN** a provider passes search fixtures but lacks its configured explanation feature
- **THEN** the adapter returns normalized search results, marks explanation unavailable, and reports degraded health without fabricating an explanation

