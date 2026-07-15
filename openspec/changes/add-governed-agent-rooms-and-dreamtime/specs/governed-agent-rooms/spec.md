## ADDED Requirements

### Requirement: Project-rooted Room identity
The system SHALL derive a Room from exactly one Agent Profile, one Project Context, and one active Thread, and SHALL NOT create an independent project identity or execution ledger for the Room.

#### Scenario: User opens an Agent Room for a project
- **WHEN** a user opens an enabled Agent binding within a registered Project Context
- **THEN** the system returns one Room projection containing the canonical Project ID, Agent Profile version, active Thread, related Work Runs, approved Memory Revision fingerprint, and permitted connector summaries

#### Scenario: Temporary conversation has no project
- **WHEN** a conversation is created without a Project Context
- **THEN** the system may maintain an ephemeral Thread but denies Project-scoped memory, connector grants, and durable work mutation

### Requirement: Versioned Agent Profile and Project binding
The system SHALL store Agent Profile and Project Agent Binding as separate versioned records, SHALL lock their versions into each execution, and SHALL exclude secrets, machine-local paths, lease tokens, and process state from both records.

#### Scenario: Profile changes during an active Work Run
- **WHEN** an Agent Profile is updated after a Work Run has compiled its context
- **THEN** the active run retains the locked profile version and a later run may select the new version

#### Scenario: Agent is disabled for one project
- **WHEN** a Project Agent Binding is disabled
- **THEN** new Project-scoped Threads and Work Runs for that binding are rejected without disabling the global Agent Profile

### Requirement: Explicit Thread continuity
The system SHALL give each durable Thread a stable identity, lifecycle state, Project ID, Agent binding, and ordered references to messages, artifacts, and Work Runs without treating message content as approved memory.

#### Scenario: A Thread is resumed on another device
- **WHEN** a user resumes a durable Thread from a second device
- **THEN** the system reconstructs the Room from shared identities and approved revisions without transferring device-local paths, secrets, or runtime sessions

### Requirement: Four-layer Context Envelope
The context compiler SHALL produce a versioned Context Envelope containing Platform Kernel, Agent Constitution, Governed Working Memory, and Runtime Envelope layers with per-layer provenance, token accounting, content hashes, and one aggregate fingerprint.

#### Scenario: Context exceeds the model budget
- **WHEN** the selected model cannot fit all eligible context
- **THEN** the compiler applies deterministic layer-aware trimming, records every omission reason, preserves mandatory governance content, and emits the resulting fingerprint

#### Scenario: A retry uses changed context
- **WHEN** a caller retries an execution using a Context Envelope fingerprint that no longer matches the stored snapshot
- **THEN** the system rejects the retry or creates an explicit new execution attempt instead of silently changing context

### Requirement: Surface-independent Room operations
Room lifecycle and projection operations SHALL be implemented behind shared backend contracts usable by MCP, CLI, Obsidian, and Fleet, and clients SHALL NOT independently compose governance prompts or persist approval state.

#### Scenario: CLI and Obsidian inspect the same Room
- **WHEN** CLI and Obsidian request the same Project and Agent Room
- **THEN** both receive equivalent canonical identities, lifecycle state, revision fingerprints, and policy decisions subject only to presentation differences

### Requirement: Diagnosable Room projection
The system SHALL expose a read-only Room doctor projection that reports missing profiles, disabled bindings, stale context fingerprints, unavailable connectors, unresolved Work Runs, and memory conflicts without exposing secret values or prompt bodies.

#### Scenario: Room cannot start a run
- **WHEN** a Room lacks a healthy permitted execution capability
- **THEN** doctor reports the failed matching constraints and safe remediation references while leaving durable state unchanged
