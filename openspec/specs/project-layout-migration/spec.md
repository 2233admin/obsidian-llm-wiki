# project-layout-migration Specification

## Purpose
TBD - created by archiving change unify-project-context-architecture. Update Purpose after archive.
## Requirements
### Requirement: Side-effect-free project inventory
The system SHALL inventory shared project records, Work-OS roots, knowledge roots, legacy records, bindings, and runtime records without writing files or acquiring leases.

#### Scenario: Inventory finds three representations
- **WHEN** matching project data exists in `Projects/`, `01-Projects/`, and `10-Projects/`
- **THEN** the inventory reports their proposed common Project ID and current domain ownership without proposing that the roots be merged

### Requirement: Dry-run migration by default
The system SHALL produce an auditable migration plan by default and SHALL require an explicit apply mode before modifying project data.

#### Scenario: Migration is planned
- **WHEN** a caller runs migration without apply mode
- **THEN** the result lists proposed writes, redirects, warnings, hashes, and conflicts and the vault remains byte-identical

### Requirement: Conflict-safe application
The migration SHALL refuse ambiguous identity mappings, stale hash preconditions, and writes outside allowed project paths.

#### Scenario: Two records claim the same alias
- **WHEN** a migration batch finds two Project IDs that claim one legacy project name
- **THEN** both records remain unchanged and the batch reports a review-required conflict

### Requirement: Canonical-write compatibility window
During migration, the system SHALL write canonical Project IDs and domain paths while temporarily reading supported legacy forms with visible diagnostics.

#### Scenario: Legacy caller updates a project issue
- **WHEN** an unambiguous legacy project reference reaches a supported compatibility operation
- **THEN** the update is written only to the canonical Work-OS path and the result reports compatibility usage

### Requirement: Retired docket remains retired
Migration and compatibility behavior SHALL NOT recreate or write current work under `10-Projects/<project>/docket/**`.

#### Scenario: Legacy docket item is discovered
- **WHEN** inventory finds an item in the retired docket store
- **THEN** it is reported as retired migration input and any proposed current-work destination is under `01-Projects/<project>/issues/`

### Requirement: Recoverable migration
Every applied migration batch SHALL record sufficient audit evidence to resume or restore the affected files.

#### Scenario: Batch fails after partial progress
- **WHEN** an applied batch stops after one or more atomic file writes
- **THEN** its manifest identifies completed and pending actions and supports restoration from recorded preconditions or backups

### Requirement: Anchor-only project adoption
The migration system SHALL recognize a Work-OS anchor under `01-Projects/<slug>/_project.md` as migration evidence and SHALL be able to plan a missing canonical `Projects/<slug>.md` registry record without merging domain roots.

#### Scenario: Existing vault has only a Work-OS anchor
- **WHEN** inventory finds a valid anchor and no conflicting Project Registry record
- **THEN** the plan proposes a hash-guarded registry record and apply makes the Project resolvable

#### Scenario: Anchor identity conflicts with a registry alias
- **WHEN** the proposed Project ID or alias is already claimed by another record
- **THEN** the migration reports a review-required conflict and writes nothing
