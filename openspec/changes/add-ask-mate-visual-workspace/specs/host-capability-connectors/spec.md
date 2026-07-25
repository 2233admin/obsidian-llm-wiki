## ADDED Requirements

### Requirement: Typed plugin diagnostic reporting
An approved Host Capability Connector MAY expose bounded, read-only diagnostic operations that return versioned typed findings with provider identity, rule identity, subject, severity, evidence references, health, and required permissions, and those findings SHALL enter Problem Intake rather than becoming Work-OS or knowledge state directly.

#### Scenario: Approved Obsidian plugin adapter reports a problem
- **WHEN** an authorized diagnostic operation returns a valid typed finding
- **THEN** the proxy preserves connector and operation provenance and submits the finding to Problem Intake under the canonical Project Context

#### Scenario: Adapter returns an undeclared payload
- **WHEN** a plugin adapter returns fields, resources, or data classes outside its approved descriptor
- **THEN** the proxy rejects the result, records a safe connector diagnostic, and performs no downstream persistence

### Requirement: Knowledge graph adapters remain separate
Graphify and other Knowledge Adapters SHALL provide read-side search or graph evidence through the Knowledge Adapter registry and SHALL NOT be registered as Host Capability Connectors merely because Ask Mate or Visual Workspace consumes their results.

#### Scenario: Ask Mate requests Graphify relations
- **WHEN** Ask Mate reads relationship evidence for a map preview
- **THEN** it uses the read-side graph/query contract without acquiring plugin command authority, a Capability Grant for unrelated host operations, or permission to mutate Graphify state

### Requirement: No arbitrary Obsidian command bridge
Host Capability Connectors for Obsidian plugins SHALL invoke only versioned allowlisted adapter operations and SHALL NOT expose arbitrary command identifiers, dynamic code evaluation, unrestricted vault access, or plugin installation as a capability.

#### Scenario: Agent requests an undeclared plugin command
- **WHEN** an Agent asks the proxy to execute a command that is not a typed operation in the approved descriptor and grant
- **THEN** invocation is denied without calling Obsidian or changing plugin state

### Requirement: Diagnostic scans preserve execution authority
Agent-triggered plugin diagnostic scans SHALL require canonical Project Context, an active Work Run, an approved Assignment Plan, and a Capability Grant whose resource and side-effect scope includes the exact read operation; human-triggered local scans SHALL still obey descriptor visibility, declared resource scope, and Operation Write Policy before persisting observations.

#### Scenario: Installed plugin lacks a grant
- **WHEN** an Agent can discover that a plugin is installed but has no grant for its diagnostic operation
- **THEN** the operation remains unavailable and installation alone grants no execution or data authority
