## ADDED Requirements

### Requirement: Stable project identity
The system SHALL identify every managed Project with a Project ID in the form `project/<slug>` that is independent of repository URL, local path, vault path, provider record, and display name.

#### Scenario: Workspace moves to another path
- **WHEN** a registered workspace is rebound to a different local directory
- **THEN** the Project ID remains unchanged and only the machine-local Workspace Binding changes

#### Scenario: Ambiguous slug is supplied
- **WHEN** an external project reference matches more than one registered identity or alias
- **THEN** the system returns an ambiguity error and does not select a Project

### Requirement: Shared project record
The system SHALL use the shared project record as the authority for Project ID and project lifecycle, and SHALL NOT persist machine-local absolute paths or secret values in that record.

#### Scenario: Project is adopted locally
- **WHEN** a user applies an adoption plan for an unregistered local workspace
- **THEN** the shared record contains logical identity and lifecycle while the absolute path is written only to `.vault-mind/local-bindings.json`

### Requirement: Domain bindings preserve authority
The Project Registry SHALL represent repositories, directories, vault roots, and provider records as Workspace Bindings or External Projections without treating them as Project identity or copying provider-owned workflow state.

#### Scenario: GitHub repository is replaced
- **WHEN** a Project changes its GitHub repository binding
- **THEN** the Project ID and vault-owned Work-OS state remain unchanged and projection drift is reported until reconciliation

### Requirement: Cross-runtime registry conformance
TypeScript and Python components SHALL resolve the same Project ID, lifecycle, aliases, and Workspace Binding for identical registry fixtures.

#### Scenario: Shared fixture is resolved by both runtimes
- **WHEN** the TypeScript MCP server and Python compiler load the same registry and local bindings fixture
- **THEN** their normalized Project Context identity and binding results are equivalent
