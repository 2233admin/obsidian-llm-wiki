# fleet-workflow Specification

## Purpose
TBD - created by archiving change complete-settings-platform-and-fleet-release. Update Purpose after archive.
## Requirements
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

### Requirement: Expiring device capability advertisement
Each fleet device SHALL advertise versioned execution capabilities, connector availability, model availability, resource class, health, and expiry without publishing machine-local paths, secret values, process handles, or lease tokens.

#### Scenario: Device advertisement expires
- **WHEN** a device capability advertisement passes its expiry without renewal
- **THEN** assignment planning excludes the device and reports the stale health evidence

### Requirement: Evidence-backed fleet assignment
Fleet dispatch SHALL use a recorded Assignment Plan that references the selected device advertisement, Agent descriptor, Project policy, Work Run requirement, and Context Envelope fingerprint.

#### Scenario: 5090 executes an assigned Child Work Run
- **WHEN** a local parent delegates a model-heavy child run to the 5090 device
- **THEN** both devices preserve the same Project, parent/child Work Run, Agent assignment, context fingerprint, and artifact identities while local workspace and credential state remain isolated

### Requirement: Fail-closed fleet dispatch
Fleet workflow SHALL NOT dispatch when no healthy permitted device and Agent combination satisfies the requested capability, model, grant, budget, and side-effect policy.

#### Scenario: Only unauthorized remote capacity is available
- **WHEN** a healthy remote device has capacity but lacks the Project or connector grant
- **THEN** the system returns a diagnosable no-match result and does not widen authorization or create a remote lease

### Requirement: Portable collaboration handoff
Fleet handoff artifacts SHALL include parent/child Work Run identities, locked Agent and Binding versions, Context Envelope fingerprint, non-secret grant summary, input Artifact references, expected output, and transition tokens required for idempotent join and recovery.

#### Scenario: Remote workflow is replayed
- **WHEN** the same portable handoff is submitted after a remote response is lost
- **THEN** the remote side joins or reports the existing Child Work Run instead of creating a duplicate execution identity

### Requirement: Cross-device completion evidence
Fleet completion SHALL include assignment, local and remote execution, Artifact Projection, policy, memory revision when applicable, and secret/path leak evidence for the same Work Run graph.

#### Scenario: Remote task passes but artifact provenance is missing
- **WHEN** a remote Agent reports success without an Artifact Projection tied to the approved context and child run
- **THEN** fleet verification remains failed and the parent cannot treat the delegation as complete

### Requirement: Device-signed release evidence
Release evidence for a real 5090 fleet run SHALL be signed by the enrolled 5090 Ed25519 device key over the exact release identity, all canonical report digests, and complete execution provenance, SHALL bind exactly one remote Orca task and terminal External Projection to the corresponding signed provenance values, and SHALL be verified against a public trust anchor already frozen in the tested product commit.

#### Scenario: Evidence is edited or self-signed after the real run
- **WHEN** release evidence is unsigned, signed by another key, changes any raw report or execution-provenance field including `runtimeId`, or introduces or replaces its own public trust anchor after `testedCommit`
- **THEN** the release gate fails closed and does not treat the evidence-only descendant as an accepted fleet run

