## ADDED Requirements

### Requirement: Stable cross-device identity
A fleet workflow SHALL preserve canonical Project ID, Work Item ID, Work Run ID, transition token semantics, and agent identity across participating devices while keeping machine-local lease tokens and workspace paths local.

#### Scenario: 5090 joins a locally leased run
- **WHEN** the local Work Driver leases an item and the 5090 agent joins the same run
- **THEN** both environments report the same durable identities while neither exposes the other device's local path or lease token

### Requirement: Isolated agent workspaces
Fleet development workers SHALL operate in isolated branches or worktrees derived from a recorded common commit and SHALL return reviewable commits to the integrating agent.

#### Scenario: Two agents implement independent lanes
- **WHEN** settings and project/workflow agents run concurrently
- **THEN** each writes only its assigned lane and integration occurs through explicit commits with tests

### Requirement: Evidence-backed fleet completion
Fleet completion SHALL require local and remote build/test evidence plus Project Hub or workflow doctor evidence for the same run; orchestration-runtime success alone SHALL NOT count as product success.

#### Scenario: Remote workflow reports success but bundle smoke fails
- **WHEN** the 5090 orchestrator completes its task but the shipped bundle lacks a required operation
- **THEN** the release remains blocked and records the failed product-level evidence

