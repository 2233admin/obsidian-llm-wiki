## ADDED Requirements

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
