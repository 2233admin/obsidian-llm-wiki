## ADDED Requirements

### Requirement: Capability descriptors remain separate from knowledge adapters
The system SHALL represent executable Agent or host capability through versioned Expert Descriptors and Host Capability Connectors that do not ingest knowledge, own Project Context, or bypass Source Registration and Promotion Policy.

#### Scenario: External repository offers an Agent runtime
- **WHEN** an external runtime is evaluated for execution
- **THEN** its canonical repository URL is registered as a Source and any executable integration is represented separately as a connector descriptor with provenance and review status

### Requirement: Deterministic Assignment Plan
The assignment planner SHALL match Work Run requirements against permitted Expert Descriptors using declared capability, health, device availability, model policy, cost constraints, and capability grants, and SHALL return ordered reasons for selection or rejection.

#### Scenario: No eligible expert is healthy
- **WHEN** every candidate is unhealthy, expired, incompatible, or unauthorized
- **THEN** planning returns a diagnosable no-match result and no lease, dispatch, or external call is created

#### Scenario: Equivalent candidates are available
- **WHEN** two candidates satisfy the same policy and health constraints
- **THEN** the planner applies a documented stable tie-break and records the chosen descriptor version

### Requirement: Work Run gated connector invocation
A Host Capability Connector SHALL be invoked only for a canonical Project Context and Work Run with an approved Assignment Plan and Capability Grant, and SHALL preserve Work Run identity through dispatch, join, checkpoints, and artifacts.

#### Scenario: Connector attempts to overwrite run identity
- **WHEN** a connector response supplies Project, Work Item, Work Run, or Agent identity that conflicts with the approved dispatch
- **THEN** the system rejects the join and leaves canonical state unchanged

### Requirement: Single MCP proxy surface
Third-party MCP capabilities SHALL be exposed to Agents through one governed proxy with `search`, `describe`, and `invoke` operations, lazy connection, operation-level authorization, timeouts, and structured diagnostics.

#### Scenario: Agent searches for a tool
- **WHEN** an authorized Agent searches the MCP proxy
- **THEN** the proxy returns only descriptors visible to the Project and Capability Grant without connecting to unrelated servers

#### Scenario: Agent invokes an undiscovered operation
- **WHEN** an Agent invokes an MCP operation it has not been granted or whose descriptor changed
- **THEN** the proxy rejects the call and requires a current describe/authorization result

### Requirement: Settings and secret boundary
Connector configuration SHALL store non-sensitive policy and endpoint metadata in Settings, SHALL resolve credentials only through Secret Reference at the last responsible moment, and SHALL never persist secret values in vault state, Room projection, Work Run, Usage Event, plugin data, or diagnostics.

#### Scenario: Connector diagnostic is exported
- **WHEN** connector configuration and health diagnostics are exported or synchronized
- **THEN** secret references may be included but secret values, authorization headers, stdio secret environment variables, and OAuth refresh tokens are redacted

### Requirement: Connector identity is independent from Project Tracker providers
Host Capability Settings SHALL select a connector registry identity by canonical `connector/...` identity or a generic identifier normalized into that namespace, SHALL NOT derive Host authority from Project Tracker forge bindings or provider tokens, and SHALL NOT treat selection as connector approval.

#### Scenario: Generic connector identifier is selected
- **WHEN** Settings selects `reviewed-expert`
- **THEN** Host operations match only the reviewed `connector/reviewed-expert` registration and still require the current Project Binding, Capability Grant, and approved Assignment Plan

#### Scenario: Client forges connector review provenance
- **WHEN** a client submits an approved-looking connector registration with self-authored reviewer identity or timestamp
- **THEN** an unauthenticated Agent is rejected, while an authenticated approver registration replaces those authority fields with server-bound actor and time

#### Scenario: Project Tracker compatibility exists
- **WHEN** forge.json or GitHub, Gitea, Linear, or Plane tracker tokens are present but Host-specific Settings and compatibility variables are absent
- **THEN** no Host connector is selected or authorized from those tracker inputs

### Requirement: Provenance-pinned capability imports
Imported connector, skill, or Agent capability metadata SHALL record source URL, inspected commit or version, content hash, license review, importer version, and approval status before it becomes assignable.

#### Scenario: Imported capability source changes
- **WHEN** a source resolves to content different from its approved hash or version
- **THEN** the capability becomes stale and is excluded from automatic assignment until reviewed

### Requirement: Connector and expert diagnostics
The system SHALL provide read-only doctor and Project Hub projections for descriptor validity, connector health, credential-reference presence, device affinity, grant visibility, and last invocation result without performing external side effects.

#### Scenario: Project Hub lists an unavailable cloud Agent
- **WHEN** a configured cloud Agent lacks a resolvable Secret Reference
- **THEN** Project Hub reports it as unavailable with a safe remediation key and does not reveal credential material
