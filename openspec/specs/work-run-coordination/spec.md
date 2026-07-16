# work-run-coordination Specification

## Purpose
TBD - created by archiving change unify-project-context-architecture. Update Purpose after archive.
## Requirements
### Requirement: One Work Run identity
The system SHALL assign one Work Run ID to a single execution attempt from Work Item lease through agent execution, checkpoints, output routing, and terminal state, and agent join SHALL assert rather than overwrite the leased and durable identities.

#### Scenario: Python leases and TypeScript agent joins
- **WHEN** the Python Work Driver leases an executable Work Item and a TypeScript agent joins the execution with matching Project ID, Work Item identity, Work Run ID, and agent lease identity
- **THEN** both runtimes reference the same identities and the join advances only an allowed lifecycle transition

#### Scenario: Agent attempts to overwrite an existing run
- **WHEN** a join request supplies a different Work Item, Project, Work Run, or agent identity for an existing leased or durable run
- **THEN** the system returns a conflict and leaves the run and lease state unchanged

### Requirement: Explicit Work Run lifecycle
The Work Run lifecycle SHALL support `planned`, `leased`, `running`, `awaiting_review`, `completed`, `failed`, and `cancelled`, and SHALL reject transitions that are not defined by the shared state contract.

#### Scenario: Completed run receives another step
- **WHEN** a caller attempts to add an execution step to a completed Work Run
- **THEN** the system rejects the transition without changing the run or lease state

### Requirement: Idempotent transitions
Mutating Work Run operations SHALL accept a transition token and SHALL return the prior result without duplicating state when the same token is replayed.

#### Scenario: Checkpoint response is retried
- **WHEN** the same checkpoint transition token is submitted twice after a transient client failure
- **THEN** exactly one checkpoint is recorded and both calls resolve to the same resulting state

### Requirement: Lease and durable state separation
Machine-local lease tokens SHALL remain in rebuildable `.vault-mind` runtime state, while durable Work Run records SHALL contain logical identities, lifecycle, checkpoints, output classification, and provenance without machine-local paths or secrets.

#### Scenario: Lease expires after agent interruption
- **WHEN** a machine-local lease expires before the Work Run reaches a terminal state
- **THEN** the run is recoverable or marked failed according to policy without losing its durable history

### Requirement: Promotion and side-effect policy
Work Run outputs SHALL be classified by Run Output Class and SHALL pass Promotion Policy and Operation Write Policy before durable writes or external side effects occur.

#### Scenario: Run proposes a knowledge claim
- **WHEN** a Work Run produces a new durable knowledge claim
- **THEN** the output enters human review and is not auto-promoted

#### Scenario: Run proposes an external push
- **WHEN** a Work Run produces an external side-effect request without explicit per-run approval
- **THEN** the side effect is denied and the run records the policy result

### Requirement: One-shot operation
Work Run coordination SHALL operate through explicit calls and SHALL NOT require a background daemon or continuous scanner.

#### Scenario: No agent is running
- **WHEN** no Work Run command is active
- **THEN** the system performs no periodic scan, lease acquisition, or external synchronization

### Requirement: Locked Agent Assignment and context fingerprint
Every Agent-executed Work Run SHALL record the assigned Agent Profile version, Project Agent Binding version, Assignment Plan identity, and Context Envelope fingerprint, and join SHALL assert rather than overwrite these values.

#### Scenario: Agent joins with a different context
- **WHEN** an Agent attempts to join an existing run with a different Profile version, Binding version, Assignment Plan, or Context Envelope fingerprint
- **THEN** the system returns a conflict and leaves the Work Run and lease state unchanged

### Requirement: Parent and Child Work Run relationship
A delegated Child Work Run SHALL preserve its own Work Run identity and lifecycle while recording exactly one parent Work Run in the same Project, and parent state SHALL not be inferred solely from child state.

#### Scenario: Parent has multiple delegated children
- **WHEN** several approved delegations execute for one parent Work Run
- **THEN** each child has a distinct Work Run ID and the parent exposes their ordered statuses without collapsing their transition histories

### Requirement: Durable capability grant summary
The durable Work Run SHALL record a non-secret summary of granted connector, operation, resource, expiry, and side-effect classes while keeping grant tokens and credential values machine-local or in the authorized secret runtime.

#### Scenario: Run is inspected on another device
- **WHEN** a second device inspects a delegated Work Run
- **THEN** it can explain the logical grant and expiry without receiving a usable token or credential

### Requirement: Artifact Projection on Work Runs
Work Runs SHALL expose provenance-preserving Artifact Projections for context consults, child outputs, connector results, and Dream Time proposals, each classified under Run Output Class and reviewed under existing Promotion and Operation Write policies.

#### Scenario: Connector result contains a durable claim
- **WHEN** a connector artifact is classified as a durable knowledge claim
- **THEN** successful connector execution does not auto-promote it and the existing human review path is required

