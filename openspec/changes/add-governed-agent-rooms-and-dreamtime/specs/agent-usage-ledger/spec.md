## ADDED Requirements

### Requirement: Append-only Usage Events
The system SHALL record model, Dream Time, consult, delegation, and connector consumption as append-only Usage Events and SHALL NOT rewrite historical events when pricing, budgets, or projections change.

#### Scenario: Provider pricing changes
- **WHEN** a price catalog changes after usage was recorded
- **THEN** the original provider-reported facts remain immutable and any recalculated estimate is a separate versioned projection

### Requirement: Idempotent usage attribution
Each Usage Event SHALL have a stable idempotency key derived from provider call identity or canonical Work Run and invocation identity, and replay SHALL return the existing logical event without double counting.

#### Scenario: Provider response is retried
- **WHEN** the same provider call is reported twice after a transient failure
- **THEN** aggregate token and cost projections include the call exactly once

### Requirement: Required usage dimensions
Usage Events SHALL identify available Project, Agent, Thread, Work Run, Provider, Model, Device, operation, input/output token, provider-reported cost, currency, timestamp, and provenance dimensions while marking legitimately absent dimensions as unknown.

#### Scenario: Local model reports no token count
- **WHEN** a local model does not expose tokens or cost
- **THEN** the event records explicit unknown values rather than zero or a fabricated estimate

### Requirement: Budget policy remains separate from usage facts
Budget, quota, warning, and admission policy SHALL consume Usage projections without mutating Usage Events and SHALL record the policy version used for each allow or deny decision.

#### Scenario: Delegation would exceed a project budget
- **WHEN** assignment planning predicts that a delegation exceeds the active Project budget policy
- **THEN** the plan records the warning or denial with policy version before dispatch and leaves prior usage facts unchanged

### Requirement: Privacy-safe usage synchronization
Shared Usage Events and projections SHALL exclude prompt and response bodies, secret values, authorization headers, machine-local paths, lease tokens, and provider credentials.

#### Scenario: Usage ledger syncs across devices
- **WHEN** Usage Events are synchronized to another device
- **THEN** canonical dimensions and counts remain available while device-local and sensitive execution material is absent

### Requirement: Observable usage projections
The system SHALL provide deterministic Project, Agent, Work Run, Provider, Device, operation, and time-window projections with source-event counts, unknown counts, and last-updated revision.

#### Scenario: User compares Agent usage
- **WHEN** a user requests usage by Agent for a Project and time window
- **THEN** the projection reports attributable totals, unknown or partial records, source-event count, and revision without presenting estimates as provider-reported cost
