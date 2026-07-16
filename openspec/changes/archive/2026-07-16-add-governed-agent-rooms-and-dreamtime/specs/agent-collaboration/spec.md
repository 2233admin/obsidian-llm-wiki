## ADDED Requirements

### Requirement: Read-only Context Consult
The system SHALL implement Context Consult as an as-of read against an approved Agent Memory Revision and SHALL return the consulted revision, fingerprint, provenance, warnings, and generated artifact without modifying either Agent's memory.

#### Scenario: One Agent consults another
- **WHEN** an authorized Work Run consults another Project-bound Agent
- **THEN** the result is attached to the requesting Thread or Work Run as a read-only artifact and neither Agent Memory Revision changes

#### Scenario: Consult target changes during generation
- **WHEN** the target Agent Memory Revision changes after consult begins
- **THEN** the result retains the original as-of fingerprint and is marked stale for any operation requiring current context

### Requirement: Explicit Delegation Plan
Delegation SHALL begin with a reviewable plan containing parent Work Run, objective, candidate Agent assignment, input artifacts, capability scope, budget, expiry, expected output, and side-effect policy.

#### Scenario: Delegation includes external write authority
- **WHEN** a Delegation Plan requests an external side effect
- **THEN** the system requires explicit per-run approval and does not infer authority from the parent run or Project binding

### Requirement: Delegation creates a Child Work Run
An approved Delegation Plan SHALL create a Child Work Run with the same Project ID, a recorded parent Work Run ID, an assigned Agent Profile version, and its own lifecycle and transition tokens.

#### Scenario: Child execution fails
- **WHEN** a Child Work Run reaches `failed` or `cancelled`
- **THEN** the parent receives a terminal child status and diagnostic artifact without being silently marked completed or failed

### Requirement: Scoped capability grants
Every delegated or consulted execution SHALL use an explicit, expiring Capability Grant limited by Project, Agent, Work Run, connector, operation, resource scope, and side-effect class.

#### Scenario: Child attempts an ungranted connector call
- **WHEN** a Child Work Run invokes a connector or operation outside its grant
- **THEN** the call is denied, the policy result is recorded, and no external effect occurs

### Requirement: Provenance-preserving Artifact Projection
Child and consult outputs SHALL return to the parent through Artifact Projection containing producer identity, source Work Run, context fingerprint, input references, content hash, output classification, and review state.

#### Scenario: Parent promotes a child conclusion
- **WHEN** a parent Work Run routes a child artifact toward durable knowledge
- **THEN** Promotion Policy evaluates the artifact and its provenance independently of the child's successful execution state

### Requirement: Idempotent collaboration replay
Consult, delegation approval, Child Work Run creation, cancellation, and Artifact Projection SHALL accept stable transition or invocation tokens and SHALL not duplicate durable effects when replayed.

#### Scenario: Delegation response is lost
- **WHEN** a client retries delegation after the Child Work Run was created but before the response was received
- **THEN** the retry returns the existing child identity and grant instead of creating another child
