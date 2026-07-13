# work-run-coordination Specification

## Purpose
TBD - created by archiving change unify-project-context-architecture. Update Purpose after archive.
## Requirements
### Requirement: One Work Run identity
The system SHALL assign one Work Run ID to a single execution attempt from Work Item lease through agent execution, checkpoints, output routing, and terminal state.

#### Scenario: Python leases and TypeScript agent joins
- **WHEN** the Python Work Driver leases an executable Work Item and a TypeScript agent joins the execution
- **THEN** both runtimes reference the same Project ID, Work Item identity, and Work Run ID

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
