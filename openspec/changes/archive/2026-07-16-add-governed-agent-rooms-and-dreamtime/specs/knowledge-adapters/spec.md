## ADDED Requirements

### Requirement: Settings-derived Knowledge Adapter profile
The MCP host SHALL resolve adapter enablement and MemU, LightRAG, RAG-Anything, Hindsight, Kanban, and QMD runtime configuration from one redacted Settings Snapshot and SHALL NOT let adapter constructors read environment configuration directly.

#### Scenario: Explicit adapter disablement overrides legacy environment
- **WHEN** `adapters.enabled` explicitly excludes an adapter while its historical environment variables remain present
- **THEN** the adapter is not initialized and the legacy values do not revive it

#### Scenario: Legacy configuration remains compatible
- **WHEN** a corresponding adapter setting still resolves from product scope and one unambiguous historical environment or YAML value exists
- **THEN** the runtime may use it as a compatibility candidate and records `legacy-env` or `legacy-config` provenance

### Requirement: Last-mile Secret Reference resolution
Knowledge Adapter profiles, snapshots, Doctor results, logs, and shared records SHALL contain only Secret Reference metadata and status, and the host SHALL resolve a secret value only at the final device-local boundary immediately before constructing the adapter that needs it.

#### Scenario: Explicit Secret Reference is missing
- **WHEN** an enabled adapter has an explicit Secret Reference that is missing or unreachable on the current device
- **THEN** the adapter fails closed without falling back to a historical token and no secret value appears in diagnostics

#### Scenario: MemU uses a credential-bearing DSN
- **WHEN** MemU requires a PostgreSQL DSN containing credentials
- **THEN** Settings stores only an endpoint without userinfo, query parameters, or fragments plus a device-local Secret Reference, unsafe legacy values fail closed without reflection, and the final resolver rejects a private DSN whose host, port, or database differs

#### Scenario: MemU recall launches a local subprocess
- **WHEN** graph recall or the Python fallback reads through a Settings-resolved private DSN
- **THEN** the host passes that DSN only through the device-local child environment, keeps it out of the operating-system argument vector and parent diagnostics, and rejects child output that reflects the resolved value

#### Scenario: MemU vault sync writes through the shared profile
- **WHEN** the vault-to-MemU sync command reads sync state, writes graph records, or runs graph maintenance
- **THEN** it uses the same Settings-derived enablement and `adapters.memu.*` profile, resolves the Secret Reference separately at each final device-local boundary, and never places the private DSN in an operating-system argument vector, log, result, snapshot, or Doctor output

#### Scenario: Legacy sync CLI receives a private DSN
- **WHEN** `--dsn` contains userinfo, a query, or a fragment
- **THEN** the Node and Python boundaries reject it without reflection and do not forward it to another process, while a credential-free compatibility endpoint remains subordinate to explicit Settings

### Requirement: Read-only Hindsight recall
The Hindsight Knowledge Adapter SHALL implement only read-only recall through `POST /v1/default/banks/{bank_id}/memories/recall`, SHALL map ranked results into `SearchResult`, and SHALL NOT expose retain or reflect operations.

#### Scenario: Recall succeeds
- **WHEN** Hindsight returns ranked `results` for the configured bank
- **THEN** the adapter maps `text` to content, uses `scores.final` as the preferred relative score, creates an external read-only path, and preserves LLM Wiki as Memory authority

#### Scenario: Hindsight is unavailable
- **WHEN** endpoint/bank configuration is missing, the timeout expires, or the remote service fails
- **THEN** the adapter degrades to no results without startup failure, remote error text disclosure, or a real network call from Settings Doctor

### Requirement: Retrieval evidence does not become governed memory
Results from every external Knowledge Adapter SHALL remain retrieval evidence and SHALL NOT become an approved Agent Memory Revision, Source, decision, architecture, runbook, or durable knowledge claim without the existing governing workflow.

#### Scenario: External recall contains a durable claim
- **WHEN** an Agent uses a Hindsight or RAG result that asserts a durable project conclusion
- **THEN** successful retrieval does not approve the claim and the existing Memory/Source/Promotion boundary remains required

### Requirement: Bootstrap vault locators remain limited
Historical vault path environment variables MAY remain as bootstrap-only locators for finding the vault and scoped Settings documents, but SHALL NOT act as a parallel authority for adapter, provider, model, or credential configuration.

#### Scenario: MCP starts from a legacy vault locator
- **WHEN** the MCP host uses `VAULT_MIND_VAULT_PATH` or `VAULT_BRIDGE_VAULT` to find the vault
- **THEN** subsequent adapter configuration comes from the resolved Settings profile and not from additional implicit vault-path configuration
