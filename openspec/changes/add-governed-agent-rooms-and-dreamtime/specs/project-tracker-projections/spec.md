## ADDED Requirements

### Requirement: Project Tracker configuration is independent
The system SHALL configure GitHub, Gitea, Linear, and Plane External Projections through a dedicated `providers.project_tracker.*` Settings profile and SHALL NOT use Host Capability Connector configuration or grants as tracker authority.

#### Scenario: Host Capability and Project Tracker select different providers
- **WHEN** a Project configures a Host Capability provider and a different Project Tracker provider
- **THEN** Forge reads only the Project Tracker profile and neither endpoint, credential reference, nor authorization crosses the boundary

### Requirement: Explicit tracker configuration fails closed
An explicit Project Tracker Settings assignment SHALL take precedence over legacy forge.json and environment inputs, and disabled, invalid, provider-mismatched, or unavailable-secret profiles SHALL fail closed without compatibility fallback.

#### Scenario: Explicit tracker profile is disabled
- **WHEN** a legacy provider token exists but the effective Project Tracker profile is explicitly disabled
- **THEN** no provider call occurs and diagnostics identify Settings as the configuration source

### Requirement: Plane uses the current work-items REST contract
The Plane adapter SHALL support Plane Cloud and self-hosted HTTPS base URLs, authenticate with `X-API-Key`, and use `/api/v1/workspaces/{workspace_slug}/projects/{project_id}/work-items/` for pull, create, and update operations.

#### Scenario: Plane work items are pulled
- **WHEN** an authorized Plane projection reads a configured workspace and project
- **THEN** paginated work items map to provider-neutral RemoteItems without a live-network dependency in contract tests

#### Scenario: Plane create lacks binding identity
- **WHEN** a create plan lacks `workspace_slug` or `project_id`
- **THEN** planning records a fail-closed error and apply performs no network mutation

### Requirement: Plane state identities are explicit
The Plane adapter SHALL map canonical work state to Plane state group intent but SHALL set a concrete state UUID only when the binding contains an explicit `state_type_ids` entry.

#### Scenario: State UUID is not configured
- **WHEN** a reviewed snapshot maps to a Plane state group without a configured UUID
- **THEN** the pure push plan omits the `state` field and records a `needs-mapping` diagnostic instead of guessing an identifier

### Requirement: Tracker mutations preserve Forge safety gates
Project Tracker push SHALL resolve Secret References only after configuration and reviewed-head drift checks and SHALL recheck the reviewed-head digest immediately before a bounded network mutation using same-origin HTTPS redirect policy.

#### Scenario: Reviewed head changes after credential resolution
- **WHEN** the reviewed head digest changes after the Secret Reference is resolved but before Plane execute
- **THEN** no POST or PATCH occurs and the result records reviewed-head drift without exposing the secret

### Requirement: Legacy tracker inputs are compatibility-only
Legacy forge.json bindings and provider-specific environment variables SHALL be used only when the Project Tracker Settings profile is entirely unconfigured, and public results SHALL label their compatibility provenance.

#### Scenario: Unconfigured Settings with a Plane legacy token
- **WHEN** no Project Tracker Settings key is explicitly assigned and `PLANE_API_KEY` is present for a Plane forge binding
- **THEN** sync may use the legacy inputs while reporting legacy configuration and credential provenance

### Requirement: Successful tracker creates are replay-safe
GitHub, Gitea, Plane, and Linear create apply SHALL persist a non-secret canonical Project-scoped mutation receipt binding the Project entity, target, provider, credential-free binding digests, Settings snapshot, reviewed-head digest, and create-plan digest to the provider-returned remote ID and revision.

#### Scenario: An identical successful create is replayed
- **WHEN** create apply is repeated with the same Project entity, target, provider, binding, Settings snapshot, reviewed head, and create plan after a successful receipt is durable
- **THEN** the stored remote ID and revision are returned as an idempotent result and no provider POST occurs

#### Scenario: Projection context drifts after create
- **WHEN** the binding, Settings snapshot, reviewed head, provider, or create-plan semantics differ from the durable receipt
- **THEN** apply fails closed without resolving the drift by issuing another create

#### Scenario: Create outcome is unknown
- **WHEN** the request may have been accepted remotely but the response identity or durable success finalization is unavailable
- **THEN** a pending unknown-outcome receipt blocks automatic repost and requires remote reconciliation because provider-side exactly-once delivery cannot be inferred
