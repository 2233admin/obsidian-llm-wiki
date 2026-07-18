## ADDED Requirements

### Requirement: Visual workspace Project Hub projection
Project Hub SHALL expose Project-linked Mind Map Documents and derived view health, including source freshness, document revision, projection status, linked Work-OS entities, and owning Visual Workspace Domain, without storing or mutating map state.

#### Scenario: Linked issue changes state
- **WHEN** a map node references a canonical Work-OS issue whose reviewed state changes
- **THEN** Project Hub and regenerated visual projections show the new derived state without rewriting the map's semantic hierarchy

### Requirement: Problem triage Project Hub projection
Project Hub SHALL expose bounded Problem Intake summaries for untriaged, recurring, dismissed, resolved, and issue-linked observations, including provider health and the observation-to-local-issue-to-upstream-Issue-or-PR-to-Work-Run-to-verification trace.

#### Scenario: Plugin diagnostic provider is unavailable
- **WHEN** the Project has prior observations from a provider whose current health is unavailable
- **THEN** Project Hub keeps prior evidence readable, marks freshness as unknown or stale, and does not present the problem as newly verified

### Requirement: Project Hub routes visual and triage mutations
Project Hub SHALL remain read-only and SHALL route requested map changes to Visual Workspace, observation transitions and contribution planning to Problem Intake, local issue mutations to Work-OS operations, and approved remote mutations to governed tracker or forge adapters.

#### Scenario: User creates work from triage
- **WHEN** the user selects observations and requests an issue from Project Hub
- **THEN** Project Hub requests an Issue Change Plan and does not write canonical issue or observation files itself

#### Scenario: User requests an upstream contribution from Project Hub
- **WHEN** the user selects a reviewed observation and requests an upstream Issue or pull request
- **THEN** Project Hub requests a contribution plan, displays the linked local and remote effects, and performs no remote mutation itself
