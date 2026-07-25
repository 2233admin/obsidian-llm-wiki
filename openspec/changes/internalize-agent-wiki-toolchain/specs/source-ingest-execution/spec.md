## ADDED Requirements

### Requirement: Explicit Ingest Run lifecycle
The system SHALL keep Source registration separate from execution and SHALL provide plan, run, inspect, resume, and verify operations for supported `url` and `vaultPath` Sources.

#### Scenario: Registration has no capture side effect
- **WHEN** a caller registers a valid `url` or `vaultPath` Source
- **THEN** the system assigns or resolves Source identity without performing network access, launching a provider, or writing captured Evidence

#### Scenario: Caller executes an approved plan
- **WHEN** a caller runs a previously planned Source revision
- **THEN** the system creates an immutable Ingest Run, resolves compatible provider capabilities, and records each state transition and result receipt

### Requirement: Idempotent resumable execution
Every Ingest Run SHALL have an idempotency key derived from Source identity, Source revision, requested operation, and capability-profile revision, and SHALL resume completed stages without duplicating accepted outputs.

#### Scenario: Process stops after capture
- **WHEN** an Ingest Run restarts after its capture receipt was committed but before derivative materialization completed
- **THEN** the runner reuses the verified capture, resumes from the first incomplete stage, and does not create a second accepted capture for the same idempotency key

### Requirement: Immutable capture and derivative receipts
The runner SHALL record immutable capture and derivative identities, content hashes, normalized provenance, provider-profile revision, timestamps, and validation status before materializing searchable Evidence Notes.

#### Scenario: Provider returns an unchanged capture
- **WHEN** a refresh produces content whose normalized hash matches the active Source revision
- **THEN** the run records an unchanged receipt and does not enqueue redundant compilation work

#### Scenario: Provider output fails validation
- **WHEN** captured or derived output violates the declared media type, size, schema, or provenance contract
- **THEN** the run fails the affected stage, preserves bounded diagnostic evidence, and does not publish the output as searchable Evidence

### Requirement: Baseline operation and provider degradation
The system SHALL support filesystem-native ingestion for eligible vault content without optional providers and SHALL report typed degradation when a requested optional capability is unavailable or incompatible.

#### Scenario: Optional provider is absent
- **WHEN** an Ingest Run requests transcription or structured remote capture and no compatible provider is available
- **THEN** the plan or run reports the missing capability and remediation without failing unrelated filesystem ingestion or the MCP host

