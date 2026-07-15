# settings-platform Specification

## Purpose
TBD - created by archiving change complete-settings-platform-and-fleet-release. Update Purpose after archive.
## Requirements
### Requirement: Versioned setting definitions
The system SHALL expose one versioned registry for every setting in the first vertical slice, including its namespaced key, owner, value type, default, allowed scopes, sensitivity, validator, apply mode, and visibility.

#### Scenario: Two hosts render a setting
- **WHEN** MCP and Obsidian request the same setting definition
- **THEN** both receive the same semantic definition and neither host invents validation or precedence rules

### Requirement: Scope-safe persistence
The system SHALL persist product, user-device, vault, workspace-project, and session assignments in storage whose physical boundary matches the declared scope, and SHALL NOT write user-device assignments into a vault-synchronized file.

#### Scenario: Two devices use different Python paths
- **WHEN** two devices open the same vault with different user-device Python runtime assignments
- **THEN** each device resolves its own path without modifying or observing the other device's assignment

### Requirement: Deterministic effective snapshots
The system SHALL resolve immutable effective snapshots using `session > workspace-project > vault > user-device > product default`, including source revisions, winning scope, provenance, validation, and overridden candidates.

#### Scenario: Project override and device path coexist
- **WHEN** a project overrides semantic query while the Python path is assigned at user-device scope
- **THEN** the snapshot selects each value from its independently winning allowed scope and explains both decisions

### Requirement: Atomic optimistic mutation
Every persisted settings mutation SHALL validate the complete affected scope, require an expected revision, write atomically, and retain recoverable previous-revision metadata.

#### Scenario: Stale Obsidian editor submits a value
- **WHEN** Obsidian submits revision 12 after another host committed revision 13
- **THEN** the mutation returns a conflict with a redacted diff and leaves revision 13 unchanged

### Requirement: Secret-reference safety
The Settings Platform SHALL store and return only Secret References and redacted presence health, and SHALL NOT persist or return resolved secret values through snapshots, events, exports, logs, plugin data, or durable knowledge.

#### Scenario: Provider credential is configured
- **WHEN** a caller resolves or exports settings for a provider credential
- **THEN** the caller receives reference metadata and presence state but never the credential value

### Requirement: Host-neutral operations and health
The system SHALL expose definitions, scope reads, snapshot resolve/explain, set/unset, validate, migrations plan, and doctor through the Operation Interface, and doctor SHALL distinguish `available`, `degraded`, `unavailable`, and `disabled` with evidence and remediation.

#### Scenario: Obsidian is closed
- **WHEN** MCP or CLI resolves settings and runs doctor without an Obsidian process
- **THEN** the same persisted settings and capability health remain available

### Requirement: Agent model connection binding
The Settings Platform SHALL define one default Agent model connection with `inherit`, `local`, and `cloud` modes, and Agent/Compiler invocation SHALL consume its effective provider, OpenAI-compatible base URL, model identifier, and Secret Reference without persisting or returning resolved credential material.

#### Scenario: Local model is selected in Obsidian
- **WHEN** a user selects local mode, an OpenAI-compatible endpoint, and a model identifier in the Obsidian control plane
- **THEN** the next Agent/Compiler invocation uses those effective values without requiring or forwarding a cloud credential

#### Scenario: Cloud model credential is bound
- **WHEN** a user selects cloud mode and binds an environment Secret Reference on the current device
- **THEN** the credential is resolved only for the child-process invocation and snapshots, Doctor output, plugin data, vault files, and logs remain redacted

### Requirement: Cross-runtime conformance
TypeScript and Python SHALL resolve the shared conformance fixtures to canonically equivalent redacted snapshots and validation results.

#### Scenario: Shared fixture is evaluated
- **WHEN** both runtimes evaluate the same registry, assignments, and runtime context fixture
- **THEN** their canonical effective values, provenance, source revisions, redaction, and errors are equivalent

