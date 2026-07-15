## MODIFIED Requirements

### Requirement: Deterministic project context resolution
The system SHALL normalize every project-scoped operation, including memory, conversation, source, workflow, settings, and Project Hub operations, to a Project ID before domain behavior runs and SHALL return a Project Context containing canonical domain roots, lifecycle, optional Workspace Binding, projection descriptors, and diagnostics.

#### Scenario: Legacy project name is accepted
- **WHEN** a public compatibility operation receives an unambiguous legacy project name
- **THEN** the resolver returns its Project ID and records a compatibility diagnostic before domain behavior runs

#### Scenario: Unknown project is supplied
- **WHEN** no registered identity, alias, or binding matches the input
- **THEN** the operation returns not-found without creating a directory, settings document, knowledge root, or implicit Project

### Requirement: Read-only Project Hub
The system SHALL provide a read-only Project Hub that identifies the owning domain, freshness, and health or drift for every composed section, and its settings section SHALL consume an Effective Settings Snapshot rather than plugin-private configuration.

#### Scenario: Workspace is unavailable on the current device
- **WHEN** the Project exists but its local Workspace Binding path cannot be reached
- **THEN** the Project Hub remains readable and reports workspace health as unavailable with an explanation

#### Scenario: Settings snapshot is unavailable
- **WHEN** settings cannot be resolved for the Project Context
- **THEN** the Project Hub reports settings health as unavailable or degraded and does not report the overall section as healthy

