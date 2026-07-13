## MODIFIED Requirements

### Requirement: One Work Run identity
The system SHALL assign one Work Run ID to a single execution attempt from Work Item lease through agent execution, checkpoints, output routing, and terminal state, and agent join SHALL assert rather than overwrite the leased and durable identities.

#### Scenario: Python leases and TypeScript agent joins
- **WHEN** the Python Work Driver leases an executable Work Item and a TypeScript agent joins the execution with matching Project ID, Work Item identity, Work Run ID, and agent lease identity
- **THEN** both runtimes reference the same identities and the join advances only an allowed lifecycle transition

#### Scenario: Agent attempts to overwrite an existing run
- **WHEN** a join request supplies a different Work Item, Project, Work Run, or agent identity for an existing leased or durable run
- **THEN** the system returns a conflict and leaves the run and lease state unchanged
