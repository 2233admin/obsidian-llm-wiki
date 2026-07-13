# project-context Specification

## Purpose
TBD - created by archiving change unify-project-context-architecture. Update Purpose after archive.
## Requirements
### Requirement: Deterministic project context resolution
The system SHALL normalize every project-scoped operation to a Project ID and SHALL return a Project Context containing canonical domain roots, lifecycle, optional Workspace Binding, projection descriptors, and diagnostics.

#### Scenario: Legacy project name is accepted
- **WHEN** a public compatibility operation receives an unambiguous legacy project name
- **THEN** the resolver returns its Project ID and records a compatibility diagnostic before domain behavior runs

#### Scenario: Unknown project is supplied
- **WHEN** no registered identity, alias, or binding matches the input
- **THEN** the operation returns not-found without creating a directory or implicit Project

### Requirement: Domain-owned state remains separate
The Project Context SHALL join registry, Work-OS, knowledge, runtime, settings, capability, workspace, and integration records without transferring mutation authority to the Project domain.

#### Scenario: Work Item state changes
- **WHEN** a caller requests a Work Item transition from a Project Hub
- **THEN** the request is routed to the Work-OS operation and the Project Hub stores no independent state

### Requirement: Read-only Project Hub
The system SHALL provide a read-only Project Hub that identifies the owning domain, freshness, and health or drift for every composed section.

#### Scenario: Workspace is unavailable on the current device
- **WHEN** the Project exists but its local Workspace Binding path cannot be reached
- **THEN** the Project Hub remains readable and reports workspace health as unavailable with an explanation

### Requirement: Project-aware knowledge recall
Project-scoped context and recall SHALL include eligible Work-OS records from `01-Projects/<slug>/` and knowledge records from `10-Projects/<slug>/` under their distinct Knowledge Item types and authority rules.

#### Scenario: Current issue has no memory note
- **WHEN** recall is requested for a Project with a current issue only under its Work-OS root
- **THEN** the issue is discoverable as project context without being promoted into durable knowledge

### Requirement: Secret-safe context
Project Context and Project Hub results SHALL expose Secret References and capability diagnostics but SHALL NOT return resolved secret values.

#### Scenario: Integration uses an API token
- **WHEN** the Project Hub reports the integration's settings and health
- **THEN** it returns secret reference metadata and health only, never the token value
