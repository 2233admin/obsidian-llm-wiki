## ADDED Requirements

### Requirement: Durable coalescing maintenance queue
The system SHALL persist dirty Source and topic work with reason, earliest execution time, maximum freshness deadline, attempts, lease, and receipt state, and SHALL coalesce duplicate work without losing the earliest deadline.

#### Scenario: Several edits affect one topic
- **WHEN** multiple Source changes mark the same topic dirty inside the debounce window
- **THEN** the queue retains one executable work item containing all reasons and a maximum freshness deadline no later than the earliest original deadline

### Requirement: Bounded freshness and complete draining
A maintenance worker SHALL debounce bursts but MUST process eligible work by its maximum freshness deadline and SHALL continue across eligible topics until the declared time, cost, or item budget is exhausted.

#### Scenario: Dirty count stays below batch threshold
- **WHEN** one topic remains dirty and no further edits arrive
- **THEN** the worker compiles it no later than the configured maximum freshness lag

#### Scenario: Several topics are ready
- **WHEN** a drain begins with multiple eligible topic entries within budget
- **THEN** the worker processes each eligible entry rather than stopping after the first successful topic

### Requirement: Recovery, retry, and quarantine
The queue SHALL recover expired leases after restart, retry transient failures with bounded backoff, and quarantine terminal or repeatedly failing work with actionable health evidence.

#### Scenario: Worker exits while holding a lease
- **WHEN** the lease expires without a committed receipt
- **THEN** a later worker can reclaim the item and idempotently resume it

#### Scenario: Provider repeatedly fails compatibility checks
- **WHEN** retries reach the configured terminal threshold for an incompatible provider
- **THEN** the work is quarantined with the required capability, observed profile, and remediation while unrelated work continues

### Requirement: Refresh policy and non-mutating modes
Each Source SHALL resolve an explicit refresh policy, and the planner SHALL support report-only and CI modes that compute due work and health without mutating Sources, Evidence, or compiled projections.

#### Scenario: CI checks freshness
- **WHEN** CI runs maintenance in report-only mode and a Source exceeds its freshness policy
- **THEN** the command returns a machine-readable stale result and proposed work without executing capture or compilation

