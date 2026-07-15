## ADDED Requirements

### Requirement: Proposal-only memory generation
Dream Time model execution SHALL produce a Memory Proposal and SHALL NOT receive tools, network access, connector access, or authority to write an Agent Memory Revision or protected knowledge.

#### Scenario: Model completes a checkpoint
- **WHEN** the Dream Time model generates a checkpoint candidate
- **THEN** the system stores a proposed record with source identities, expected revision, source fingerprint, candidate diff, provenance, warnings, model lock, and expiry while leaving approved memory unchanged

### Requirement: Explicit Checkpoint Learn Review lifecycle
The system SHALL expose separate `checkpoint`, `learn`, and `review` operations whose inputs and allowed outputs are validated against their respective memory sections.

#### Scenario: Checkpoint captures recent work
- **WHEN** checkpoint is invoked for a Thread or Work Run
- **THEN** it may propose changes to recent context and open items but does not directly rewrite stable memory

#### Scenario: Learn consolidates reviewed recent context
- **WHEN** learn is invoked from approved recent-context revisions
- **THEN** it may propose stable working-memory updates with citations back to the approved inputs

#### Scenario: Review maintains stable memory
- **WHEN** review is invoked for a stable memory revision
- **THEN** it may propose deduplication, compression, or structure changes but rejects uncited new claims and preserves protected sections

### Requirement: Fingerprinted approval and stale rejection
The approval service SHALL verify actor authority, proposal state, expiry, expected Memory Revision, and the complete proposal fingerprint before applying a proposal, and SHALL fail closed on any mismatch.

#### Scenario: Two devices approve against the same revision
- **WHEN** one device applies a proposal and another device submits a proposal based on the prior revision
- **THEN** the second proposal becomes stale and no last-write-wins merge occurs

#### Scenario: Proposal content changes after review
- **WHEN** proposal content or metadata differs from the fingerprint presented to the reviewer
- **THEN** approval is rejected and approved memory remains unchanged

### Requirement: Copy-on-write Memory Revisions
Every approved memory mutation SHALL create a new immutable Memory Revision linked to its previous revision and SHALL append an event containing proposal ID, diff, approval actor, timestamp, provenance, and policy result.

#### Scenario: Approved proposal is replayed
- **WHEN** the same approval transition token is submitted more than once
- **THEN** exactly one new revision and one logical approval event are produced and all replays return the prior result

### Requirement: Protected memory directives
The memory schema SHALL represent must-keep content, protected sections, retention constraints, and unresolved conflicts as structured fields that a model cannot silently delete or reinterpret.

#### Scenario: Review proposes removal of must-keep content
- **WHEN** a review proposal omits or alters protected content without an authorized override
- **THEN** validation rejects the proposal before approval

### Requirement: Working memory and knowledge promotion separation
Agent working memory SHALL NOT become durable team knowledge by approval alone, and any output classified as decision, architecture, runbook, or durable knowledge claim SHALL enter the existing Knowledge Promotion review path.

#### Scenario: Learn proposes an architectural conclusion
- **WHEN** a learn proposal contains an architectural conclusion intended as team truth
- **THEN** the system may store it only as working-memory context and separately creates or references a human-reviewed Promotion candidate

### Requirement: Dream Time observability and recovery
The system SHALL expose proposal, approval, revision, conflict, model-lock, warning, and provenance status through read-only operations and SHALL support recovery from an interrupted approval without rewriting prior revisions.

#### Scenario: Process stops after revision write
- **WHEN** a process stops after durable revision creation but before returning a response
- **THEN** replay with the same transition token returns the committed revision and does not create a duplicate

### Requirement: Explicit governed daily weekly monthly cadence
The system SHALL expose disabled-by-default daily, weekly, and monthly Project-scoped Dream Time cadence without starting a daemon or background scheduler. UTC days SHALL map to `checkpoint`, Monday-based UTC weeks SHALL map to `learn`, and UTC months SHALL map to `review`.

#### Scenario: A host inspects a due cadence
- **WHEN** the host reads cadence status for an exact Project, Agent Profile, cadence, and canonical UTC timestamp
- **THEN** the system deterministically returns the same window and invocation identity without invoking a model or mutating state

#### Scenario: A host explicitly runs an enabled cadence
- **WHEN** the cadence is enabled and the active Project Binding, Profile, approved Memory Revision, source identities, and proposal bytes pass validation
- **THEN** the system reuses the canonical Work Run pipeline, compiles one Context Envelope, stores one immutable proposal, appends idempotent Usage facts, and leaves the Work Run awaiting manual review without writing a Memory Revision

#### Scenario: Default collaboration policy authorizes only the exact cadence boundary
- **WHEN** an authenticated `human`, `approver`, or `admin` explicitly runs cadence with a canonical Project ID and no caller-supplied write-path allowlist
- **THEN** Operation Write Policy authorizes exactly the shared Agent Domain state, shared Usage state, that Project's Work Run root, and that Project's Agent proposal root, while unauthenticated actors, Agent roles, aliases, cross-Project paths, and arbitrary file targets remain denied

#### Scenario: A cadence invocation is replayed
- **WHEN** the same Project, Profile, UTC window, source identities, proposal bytes, expiry, and actor are submitted again
- **THEN** the system returns the same Work Run, proposal, Context Envelope fingerprint, and logical Usage facts and rejects any immutable-byte drift

#### Scenario: Two devices concurrently create the same cadence invocation
- **WHEN** two services submit the same Project, Profile, UTC window, source identities, proposal bytes, expiry, and actor before either observes a committed proposal
- **THEN** exactly one canonical Work Run, one immutable proposal, and one logical Usage fact per idempotency key are committed, and both requests return the same Work Run, proposal, and Context Envelope fingerprint

#### Scenario: Concurrent cadence bytes drift
- **WHEN** requests reuse the same stable cadence invocation identity with different immutable proposal semantics
- **THEN** at most one exact proposal is committed, every losing request fails with a conflict after strict comparison against the committed bytes, and no duplicate Work Run, proposal, or logical Usage fact is created
