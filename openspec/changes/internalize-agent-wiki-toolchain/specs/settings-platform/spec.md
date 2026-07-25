## MODIFIED Requirements

### Requirement: Versioned setting definitions
The system SHALL expose one versioned registry for every setting in the first vertical slice, including its namespaced key, owner, value type, default, allowed scopes, sensitivity, validator, apply mode, visibility, and any Toolchain Capability Profile binding or embedding-fingerprint effect.

#### Scenario: Two hosts render a setting
- **WHEN** MCP and Obsidian request the same setting definition
- **THEN** both receive the same semantic definition and neither host invents validation, precedence, capability, or migration rules

#### Scenario: Embedding model changes
- **WHEN** a setting mutation changes the effective embedding provider, endpoint identity, model, or dimensions
- **THEN** validation reports the affected index fingerprints and required rebuild plan before the new setting is applied to indexing

#### Scenario: Built-in embedding preset is selected
- **WHEN** a caller selects either `bge-m3` or `qwen3-embedding:0.6b` for a compatible index binding
- **THEN** the registry accepts the preset as supported and resolves it independently of bindings for other indexes

### Requirement: Host-neutral operations and health
The system SHALL expose definitions, scope reads, snapshot resolve/explain, set/unset, validate, migrations plan, Toolchain Capability Profile inspect/probe, and doctor through the Operation Interface, and doctor SHALL distinguish `available`, `degraded`, `unavailable`, and `disabled` with evidence and remediation.

#### Scenario: Obsidian is closed
- **WHEN** MCP or CLI resolves settings and runs doctor without an Obsidian process
- **THEN** the same persisted settings, capability profiles, and capability health remain available

#### Scenario: Legacy environment configures a provider
- **WHEN** no higher-precedence setting exists and one unambiguous legacy environment value is accepted during the deprecation window
- **THEN** the snapshot identifies legacy provenance and Doctor emits a redacted migration target and compatibility status

## ADDED Requirements

### Requirement: Scoped Toolchain Capability Profile settings
The Settings Platform SHALL define typed settings for provider selection, invocation mode, compatible version policy, executable or endpoint reference, feature requirements, timeouts, index or collection identity, and model fingerprints using only scopes valid for each field, and SHALL allow different indexes or collections to bind different compatible embedding profiles.

#### Scenario: Device-specific executable and vault collection coexist
- **WHEN** a qmd executable is assigned at user-device scope and its collection policy is assigned at vault scope
- **THEN** the effective snapshot combines the independently winning values and records both provenances in the qmd capability profile

### Requirement: Capability profile provenance and migration diagnostics
Effective snapshots and Doctor results SHALL expose redacted profile schema version, discovered tool version, supported capability set, probe receipt age, configuration provenance, and migration diagnostics without exposing resolved secret values.

#### Scenario: Installed tool is too old
- **WHEN** a configured provider is present but fails the minimum capability contract
- **THEN** Doctor reports the observed version and missing normalized capabilities, marks the profile degraded or unavailable, and provides a bounded upgrade or fallback remediation
