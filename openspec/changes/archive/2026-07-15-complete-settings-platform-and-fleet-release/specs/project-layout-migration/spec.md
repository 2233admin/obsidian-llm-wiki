## ADDED Requirements

### Requirement: Anchor-only project adoption
The migration system SHALL recognize a Work-OS anchor under `01-Projects/<slug>/_project.md` as migration evidence and SHALL be able to plan a missing canonical `Projects/<slug>.md` registry record without merging domain roots.

#### Scenario: Existing vault has only a Work-OS anchor
- **WHEN** inventory finds a valid anchor and no conflicting Project Registry record
- **THEN** the plan proposes a hash-guarded registry record and apply makes the Project resolvable

#### Scenario: Anchor identity conflicts with a registry alias
- **WHEN** the proposed Project ID or alias is already claimed by another record
- **THEN** the migration reports a review-required conflict and writes nothing

