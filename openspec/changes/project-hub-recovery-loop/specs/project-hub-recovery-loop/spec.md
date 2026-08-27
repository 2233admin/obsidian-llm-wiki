# Project Hub recovery-loop specification

## ADDED Requirements

### Requirement: R1. Contract-specific recovery locks

The system SHALL keep `project-hub-recovery/v1` unchanged, bind every downstream result to its S01 fingerprint, and additionally bind the exact owner revisions or source hashes read by context, search, candidate, and plan contracts.

#### Scenario R1.1: Current locks are reused

- **GIVEN** an unchanged sanitized Project and valid S01 and owner-lock fingerprints
- **WHEN** context resolution or Project-scoped retrieval runs
- **THEN** the result carries those locks and deterministic output derived from the same authoritative state

#### Scenario R1.2: S01-projected action fact changed

- **GIVEN** an action-relevant fact represented in the displayed S01 snapshot changed
- **WHEN** the prior S01 fingerprint is submitted
- **THEN** the operation rejects with `snapshot_stale`, performs no mutation, and instructs the caller to refresh

#### Scenario R1.3: Non-projected owner fact changed

- **GIVEN** S01 bytes are unchanged but a bound Memory, Session, checkpoint, run, or search-owner revision changed
- **WHEN** the prior downstream fingerprint is submitted
- **THEN** the affected context, search, candidate, or plan lock is rejected without falsely reporting the S01 snapshot as stale

### Requirement: R2. Versioned bounded resumable context

The system SHALL return the closed `project-hub-resume-context/v1` schema defined in design D6 as a `resumable` or `not-resumable` result. Every field is required, nullable fields use explicit JSON null, owner locks and omissions are fingerprinted, display time is excluded, and unknown fields are rejected.

#### Scenario R2.1: Active Work Run is resumable

- **GIVEN** the current snapshot recommends a non-expired active Work Run whose Project and Work Item identities match
- **WHEN** `project.hub.resume-context.get` resolves it
- **THEN** the result is `resumable`, is sourced from that Work Run, and includes bounded authoritative context without a raw transcript

#### Scenario R2.2: Explicit Work Run is invalid

- **GIVEN** the caller explicitly requests a missing, terminal, expired, malformed, or identity-mismatched Work Run
- **WHEN** context resolution runs
- **THEN** the result is `not-resumable` with a stable reason code and manual next action, and the resolver does not silently choose another run

#### Scenario R2.3: Session fallback is available

- **GIVEN** no valid Work Run exists and a current Session Record is associated with the current Project and Work Item
- **WHEN** context resolution runs without an explicit Work Run ID
- **THEN** the result is session-sourced, sets `workRunId` to null, includes only safe Session metadata and reviewed context, and may be used only by a governed create path

#### Scenario R2.4: Shape differs from the closed schema

- **GIVEN** a context result omits a required nullable field, adds an unknown field, uses an unlisted reason code, or exceeds a field bound
- **WHEN** contract validation runs
- **THEN** validation fails before the value can be returned, persisted, fingerprinted, or consumed by another surface

### Requirement: R3. Reviewed-only, secret-safe context

The system SHALL exclude draft, unresolved, superseded, stale, or unreviewed claims from `reviewedDecisions` and SHALL never return or persist raw prompts, complete transcripts, credentials, environment values, or absolute machine paths.

#### Scenario R3.1: Reviewed and draft claims coexist

- **GIVEN** Project Memory contains one current reviewed decision and one draft session-derived claim
- **WHEN** the context bundle is composed
- **THEN** only the reviewed decision appears as context and the draft claim is represented, if needed, only by a citation-safe diagnostic

#### Scenario R3.2: Sensitive payload enters an owning record

- **GIVEN** a Work Run, Session Record, error, or checkpoint contains a token marker, cookie, authorization value, raw prompt, transcript body, Windows path, POSIX absolute path, UNC path, or home-relative path
- **WHEN** any recovery contract is serialized
- **THEN** unsafe caller fields are rejected without echo, unsafe optional owner values are omitted with a stable diagnostic, unsafe mandatory identity/safety values make the result unavailable, and every serialized surface remains canary-free

### Requirement: R4. Deterministic limits and fingerprints

The system SHALL use the collection comparators and byte-allocation order in design D4, enforce 32 reviewed claims, 32 checkpoints, 64 Citation Targets, 32 diagnostics, and 64 KiB of canonical JSON, and fingerprint omissions and limit facts.

#### Scenario R4.1: Same inputs resolve twice

- **GIVEN** identical authoritative records and differing wall-clock invocation times
- **WHEN** the same context is resolved twice
- **THEN** ordering, bounded content, diagnostics, and fingerprint are identical while display timestamps may differ

#### Scenario R4.2: Context exceeds a limit

- **GIVEN** more reviewed claims, checkpoints, citations, diagnostics, or bytes than the contract permits
- **WHEN** the bundle is composed
- **THEN** items survive according to the normative comparator/allocation order, omitted counts are explicit, each retained evidence item keeps a Citation Target, and the result remains within every limit

#### Scenario R4.3: Mandatory envelope exceeds the byte cap

- **GIVEN** identity, task state, prerequisites, or blocking/security diagnostics alone exceed 64 KiB
- **WHEN** the bundle is composed
- **THEN** the result is `not-resumable` with `context_too_large` and no partially trusted context is returned

### Requirement: R5. Project-scoped cited retrieval

The system SHALL expose `project-hub-search/v1` through `project.hub.search`, normalize and bound queries and owner results as defined in design D7, exclude other Projects, return at most 25 cited results and 32 diagnostics within 128 KiB, and fingerprint owner locks and omissions.

#### Scenario R5.1: Current Project evidence is found

- **GIVEN** the active Project has a matching Work-OS issue, reviewed decision, and Source/Evidence record
- **WHEN** the user searches for the current blocker
- **THEN** normalized results carry stable identities, Knowledge Item types, provenance, freshness, confidence state, Citation Targets, deterministic ordering, and a search fingerprint

#### Scenario R5.2: Another Project also matches

- **GIVEN** a stronger text match belongs to another Project
- **WHEN** P0 Project-scoped search runs
- **THEN** that result is excluded and cannot influence ordering or the fingerprint

#### Scenario R5.3: One search owner is unavailable

- **GIVEN** at least one owning search boundary is stale or unavailable while another returns valid evidence
- **WHEN** search runs
- **THEN** valid results remain visible, the response is partial with an owner diagnostic, and unavailable material is not represented as current truth

#### Scenario R5.4: Query or response exceeds a bound

- **GIVEN** a normalized query exceeds 2048 UTF-8 bytes or ordered results exceed the response limit
- **WHEN** Project-scoped search runs
- **THEN** an oversized query is rejected, while an oversized result set is truncated only by the normative order with explicit fingerprinted omissions

### Requirement: R6. Additive action candidates and immutable plan

The system SHALL keep S01 unchanged, return the closed available/unavailable `project-hub-action-candidates/v1` from current S01/context/search/capability locks, and produce `project-hub-action-plan/v1` only from one available candidate plus an exact current Project Agent Binding selection.

#### Scenario R6.1: Resume candidate comes from S01

- **GIVEN** S01 contains a valid `resume-work-run` action and context/search locks are current
- **WHEN** action candidates and a plan are requested
- **THEN** the candidate reuses the exact S01 Work Run identity and the plan binds the candidate-set fingerprint, owning Workflow operation, citations, prerequisites, capability facts, expiry, and upstream locks without mutation

#### Scenario R6.2: Session context produces a create candidate

- **GIVEN** no valid resume candidate exists, context is session-sourced with `workRunId: null`, its Work Item matches the current unblocked S01 inspect action, and required capabilities are satisfied
- **WHEN** `project.hub.action-candidates.get` runs
- **THEN** it returns one additive `create:<sha256>` candidate without changing or reinterpreting S01

#### Scenario R6.3: Candidate is invented or stale

- **GIVEN** a candidate ID is absent from the current candidate set or any upstream lock changed
- **WHEN** action planning runs
- **THEN** planning rejects before mutation and does not substitute a different candidate

#### Scenario R6.4: No safe action is available

- **GIVEN** there is no resumable run and create is blocked by missing capability, blocked Work Item, or unavailable context/search
- **WHEN** `project.hub.action-candidates.get` runs
- **THEN** it returns the fingerprinted unavailable arm with zero candidates, exact capability facts, reason code, diagnostics, and one manual remediation

#### Scenario R6.5: Agent binding changed after selection

- **GIVEN** the caller selects a Project Agent Binding revision and that binding or Profile revision changed
- **WHEN** `project.hub.action.plan` runs
- **THEN** planning rejects instead of inventing agent identity, role, host, or capabilities

### Requirement: R7. Replay-safe Work Run apply

The system SHALL accept only the closed D8 apply request containing the full canonical plan, presented fingerprint, and transition token; bind the authenticated actor; revalidate all locks; execute resume or TypeScript-governed create; and return the closed auditable receipt.

#### Scenario R7.1: Existing Work Run resumes

- **GIVEN** a current approved resume plan, valid lease/capability facts, and a fresh transition token
- **WHEN** `workflow.recovery.apply` runs
- **THEN** it reuses the same Project ID, Work Item ID, and Work Run ID and returns the owning operation's receipt

#### Scenario R7.2: Session context creates a Work Run

- **GIVEN** a current create plan sourced from safe Session fallback, current authoritative unblocked Work Item, available capabilities, and authenticated agent context
- **WHEN** `workflow.recovery.apply` runs
- **THEN** Workflow derives one deterministic Work Run ID, atomically creates or verifies its durable leased run and local lease, joins it without calling manual `workflow.agent.start`, and returns that single ID in the receipt

#### Scenario R7.3: Transition request is replayed

- **GIVEN** an already completed plan fingerprint and transition token
- **WHEN** the identical request is repeated
- **THEN** the prior receipt is returned without another Work Run or state transition

#### Scenario R7.4: Token is rebound or a prerequisite expired

- **GIVEN** a transition token is bound to different plan bytes or actor, or a plan/owner lock/lease/capability/identity is stale or invalid
- **WHEN** apply runs
- **THEN** it fails before mutation with an explicit conflict or remediation

#### Scenario R7.5: Apply stops before owner mutation

- **GIVEN** the transition claim is durable and execution stops before the owner call
- **WHEN** the same plan and transition token are retried
- **THEN** Workflow continues the same claimed transition and creates or joins at most one Work Run

#### Scenario R7.6: Response is lost after Work Run mutation

- **GIVEN** the replay-safe owner operation committed a Work Run and its durable transition receipt but the wrapper receipt or response was interrupted
- **WHEN** the same plan and transition token are retried
- **THEN** Workflow recovers the owner receipt, persists `applied`, and returns the same Work Run without duplication

#### Scenario R7.7: Owner outcome cannot be proven

- **GIVEN** a claimed transition has neither a provable owner receipt nor a provable absence of mutation
- **WHEN** apply recovery runs
- **THEN** Workflow persists `outcome-unknown`, blocks automatic mutation replay, and requires doctor reconciliation

#### Scenario R7.8: Apply request omits the canonical plan

- **GIVEN** a caller submits only a plan fingerprint, changes the presented plan bytes, or adds an unknown request field
- **WHEN** `workflow.recovery.apply` validates the request
- **THEN** it rejects before claim creation because a fingerprint is not a plan store or execution payload

#### Scenario R7.9: Two tokens race on one create plan

- **GIVEN** the same unexpired create plan is submitted concurrently with two fresh transition tokens
- **WHEN** Workflow atomically claims the plan fingerprint
- **THEN** one token wins, one deterministic Work Run may be created, and the other request returns the applied receipt or an explicit in-progress/outcome-unknown conflict without another Work Run

### Requirement: R8. Closed Agent-output governance

The system SHALL classify every completed Work Run result as `view`, `work-state-transition`, `knowledge-claim`, or `external-side-effect` under `work-run-output/v1` and route it through the matching owner and policy.

#### Scenario R8.1: Four valid output classes complete

- **GIVEN** one completed synthetic result for each class
- **WHEN** governance routing runs
- **THEN** view remains derived, an allowlisted work transition returns a Work-OS receipt, a knowledge claim becomes a cited reviewable draft, and an external side effect requires exact per-run approval plus Operation Write Policy

#### Scenario R8.2: Output is malformed or unclassifiable

- **GIVEN** a completed Work Run result with an unknown class or invalid shape
- **WHEN** routing runs
- **THEN** the result enters review with provenance and diagnostics and is neither promoted nor discarded

### Requirement: R9. Obsidian-first recovery surface

The Obsidian plugin SHALL first prove a derived, keyboard-operable preview journey over S01–S03 plus S04A's read-only candidate/plan contracts, then integrate Workflow apply and receipts after S04B/S05, with every durable write routed through shared domain operations.

#### Scenario R9.1: Preview is proven before action mutation

- **GIVEN** S02, S03, and S04A are complete and S04B mutation has not started
- **WHEN** the user opens the S06A Project Hub preview
- **THEN** stage, work groups, freshness, diagnostics, citations, context, retrieval, additive candidates, and immutable plan preview are understandable and testable without any write

#### Scenario R9.2: User completes normal recovery

- **GIVEN** S04B/S05 are complete and a sanitized interrupted Project has current evidence, context, and capability health
- **WHEN** the user inspects a Citation Target, reviews context, confirms one plan, and receives the owner result
- **THEN** S06B shows claim/receipt state and refreshes the derived snapshot without plugin-owned durable task or run state

#### Scenario R9.3: Recovery input is stale or unavailable

- **GIVEN** stale evidence, a missing capability, an expired Work Run, or an outcome-unknown apply claim
- **WHEN** the user opens or acts from Project Hub
- **THEN** the affected state and remediation are visible, focus remains usable, and the UI never renders an empty or guessed success state

### Requirement: R10. MCP and CLI semantic parity

MCP and CLI SHALL start only after S06B actual-Obsidian verification and SHALL consume the same shared snapshot, context, search, candidate, plan, apply-claim, and receipt contracts, differing only in argument and response formatting.

#### Scenario R10.1: Same fixture is inspected through three surfaces

- **GIVEN** one sanitized Project fixture
- **WHEN** Obsidian, MCP, and CLI request snapshot, context, retrieval, and action planning
- **THEN** schema versions, fingerprints, reason codes, citations, diagnostics, and action semantics are equivalent

#### Scenario R10.2: Adapter receives an internal failure

- **GIVEN** a shared operation returns an internal error with a cause
- **WHEN** MCP or CLI formats it
- **THEN** the adapter returns its supported error shape without a stack, secret, transcript body, or absolute path

### Requirement: R11. Recovery-loop foundation acceptance

The system SHALL provide one sanitized end-to-end fixture and reproducible procedure covering normal recovery, interrupted work, stale evidence, missing capability, expired run, malformed output, action replay, and explicit remediation.

#### Scenario R11.1: Foundation acceptance passes

- **GIVEN** S02–S07, including S06A and S06B actual-Obsidian gates, are complete
- **WHEN** the S08 procedure and three measured timing runs execute
- **THEN** the user identifies stage, blockers, next action, and Agent context; verifies one citation; applies one governed action; reproduces equivalent adapter results; and every measured plan-preview selection completes in under 60 seconds

#### Scenario R11.2: Timing target fails

- **GIVEN** one of the three measured runs takes 60 seconds or longer
- **WHEN** foundation exit is evaluated
- **THEN** S08 remains incomplete and records the raw start, stop, and duration evidence

#### Scenario R11.3: Any required path fails

- **GIVEN** one required normal, failure, privacy, crash-window, replay, parity, accessibility, or timing check fails
- **WHEN** foundation exit is evaluated
- **THEN** exit remains blocked and a linked Work-OS issue records the failing evidence rather than waiving it as pre-existing