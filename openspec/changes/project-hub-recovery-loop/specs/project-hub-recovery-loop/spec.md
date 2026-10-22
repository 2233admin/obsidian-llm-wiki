# Project Hub Recovery Flow v2 specification

## ADDED Requirements

### Requirement: R1. Clean Recovery Flow v2 cutover

The system SHALL replace repository use of `project-hub-recovery/v1` with `project-hub-recovery-flow/v2`, expose the complete read path through read-only `project.hub.recovery.flow`, keep `project.hub.get` as ordinary Hub composition without a `recovery` field, and retain no dual-version shim after S04A.

#### Scenario R1.1: V2 becomes publicly available only when complete

- **GIVEN** S01B defines the complete internal V2 contract and S02/S03 implement open/context/search components
- **WHEN** S04A completes candidates and planning
- **THEN** the full Flow operation is registered once, every repository caller/fixture/doc migrates, and V1 types/validator/export/tests are removed in the same cutover

#### Scenario R1.2: A caller requests an unsupported shape

- **GIVEN** a Flow request/response contains an old V1 schema, unknown action/stage, unknown field, omitted required null, or invalid enum
- **WHEN** validation runs
- **THEN** it rejects before owner reads or mutation and does not translate the input through a compatibility alias

#### Scenario R1.3: Existing S01 facts survive migration

- **GIVEN** the same sanitized Project facts used by S01
- **WHEN** V2 open composition runs before V1 deletion
- **THEN** Project identity, stage, work groups, freshness, diagnostics, citations, and safe next-action facts are behaviorally equivalent under the V2 field model

### Requirement: R2. Closed stateless staged Flow

The system SHALL implement `project-hub-recovery-flow-request/v2` actions `open|search|plan|refresh-plan|restart` and `project-hub-recovery-flow/v2` stages `open|searched|needs-agent-selection|planned|stale|unavailable` without persisting a Flow session, response cache, query history, selection, or Plan.

#### Scenario R2.1: Open starts a Flow without self-reference

- **GIVEN** a canonical Project ID
- **WHEN** action `open` runs
- **THEN** the server hashes the intrinsic open projection first, assigns that digest to both `flowFingerprint` and the excluded convenience field `rootOpenFlowFingerprint`, sets `previousFlowFingerprint` null, and derives search requests afterward

#### Scenario R2.2: Search proves its open prerequisite

- **GIVEN** action `search` carries an open Flow Fingerprint, normalized query, and limit
- **WHEN** the server recomputes current open state
- **THEN** it continues only if the recomputed open fingerprint matches and otherwise returns `stale`

#### Scenario R2.3: First Plan proves its searched prerequisite

- **GIVEN** `plan/from-search` carries open and searched-basis fingerprints, query, limit, candidate, Binding, `plannedFlowFingerprint:null`, and `priorPlan:null`
- **WHEN** planning runs
- **THEN** the server recomputes open, search, candidates, and Binding eligibility and rejects any mixed branch or substituted input

#### Scenario R2.4: Override and refresh prove immediate planned state

- **GIVEN** `plan/override` or `refresh-plan` carries `searchedBasisFlowFingerprint`, `plannedFlowFingerprint`, and the complete prior Plan
- **WHEN** the server validates the prior Plan and recomputes the planned response
- **THEN** it continues only when the immediate planned fingerprint and underlying searched basis both match

#### Scenario R2.5: Restart uses a finite stale proof

- **GIVEN** action `restart` carries one closed `RecoveryStaleProofV2` containing no response or next request
- **WHEN** its intrinsic fingerprint validates
- **THEN** the server composes a new open stage from current owners without reading hidden Flow state

#### Scenario R2.6: Stage and payload arms cannot be crossed

- **GIVEN** a response combines one literal stage with another stage's payload or next-request type
- **WHEN** V2 response validation runs
- **THEN** it rejects because `RecoveryFlowResponseV2` is a six-interface discriminated union, not independent stage/payload unions

### Requirement: R3. Bounded authoritative open context

The system SHALL compose open-stage work and resumable context from Project Context, Work-OS, Workflow, Project Memory, Session Record, Settings, and Agent Domain owners without returning raw private session evidence.

#### Scenario R3.1: Current Work Run context is available

- **GIVEN** a current resumable Work Run for the active Project and Work Item
- **WHEN** open runs
- **THEN** bounded context uses that exact Work Run identity, current task state, reviewed decisions, chronological retained checkpoints, prerequisites, citations, and owner locks

#### Scenario R3.2: Session fallback is available

- **GIVEN** no valid resumable Work Run and one safe current Session Record for the current Work Item
- **WHEN** open runs
- **THEN** context is session-sourced, `workRunId` is null, only safe metadata/reviewed context appears, and later candidates may use it only for governed create

#### Scenario R3.3: Context cannot be made safe

- **GIVEN** mandatory identity/security data is unsafe, owners are unavailable, or mandatory content exceeds 64 KiB
- **WHEN** open runs
- **THEN** the Flow returns `unavailable` with bounded citations/diagnostics and one manual remediation, never a partial success disguised as current

#### Scenario R3.4: Optional context is truncated deterministically

- **GIVEN** reviewed decisions, checkpoints, citations, or diagnostics exceed their 32/32/64/32 limits or byte budget
- **WHEN** open serializes context
- **THEN** mandatory data is allocated first, optional data follows normative ordering, and omission counts/bytes are fingerprinted

### Requirement: R4. Chained Flow fingerprints and layered owner locks

The system SHALL distinguish one action-relevant recovery fingerprint from exact per-owner locks and SHALL chain every stage fingerprint to its prior stage, normalized current input, locks read, payload fingerprint, diagnostics, and omission facts.

#### Scenario R4.1: Unrelated owner data changes

- **GIVEN** an owner record changes without affecting the open-stage action projection
- **WHEN** a downstream stage validates
- **THEN** the affected owner lock changes without falsely claiming the recovery fingerprint changed

#### Scenario R4.2: Search branches differ

- **GIVEN** two normalized queries from the same open Flow
- **WHEN** search runs for each
- **THEN** each receives an independent chained fingerprint and neither branch's candidate can be planned with the other's fingerprint

#### Scenario R4.3: Upstream owner changed

- **GIVEN** any owner lock read by the prior stage changed before the next action
- **WHEN** prerequisite recomputation runs
- **THEN** the response stage is `stale`, lists ordered changed owners and safe Citation Targets, and includes one closed restart request without silently retaining user selection

#### Scenario R4.4: Derived requests cannot create a fingerprint cycle

- **GIVEN** an open, searched, planned, or stale response exposes next requests that refer to the current Flow fingerprint
- **WHEN** the response fingerprint is computed and validated
- **THEN** only fingerprint-free semantic intents participate in the intrinsic hash, while root convenience data and exact requests are derived afterward and checked against those intents

### Requirement: R5. Mandatory repeatable Project-scoped cited search

The system SHALL require one valid searched branch before planning and SHALL normalize results only from current Project Work-OS, Project Memory, Project Source/Evidence, Session Record, and Workflow owner records.

#### Scenario R5.1: Search finds current Project evidence

- **GIVEN** the active Project has a matching Work Item, reviewed decision, Source/Evidence record, and Work Run checkpoint
- **WHEN** a safe query runs
- **THEN** results carry stable Knowledge Item identity/type, owner, match class, integer score, freshness, confidence, provenance, and 1–4 resolvable Citation Targets in deterministic order

#### Scenario R5.2: Search is repeated

- **GIVEN** a current open Flow
- **WHEN** the user submits multiple different safe queries
- **THEN** each query produces a separate searched branch and only the branch passed to planning is bound into the Plan

#### Scenario R5.3: Search input is unsafe or oversized

- **GIVEN** a query is empty after NFKC normalization, exceeds 2048 UTF-8 bytes, contains controls, credentials, transcript markers, or unsafe paths
- **WHEN** search validation runs
- **THEN** it rejects without echo and performs no owner search

#### Scenario R5.4: An owner is stale or unavailable

- **GIVEN** one search owner is stale or unavailable while others remain readable
- **WHEN** search runs
- **THEN** returned evidence is marked partial with the exact owner diagnostic and is never promoted to current

#### Scenario R5.5: Cross-Project material is discovered

- **GIVEN** an adapter or filesystem candidate belongs to another Project
- **WHEN** owner-source normalization runs
- **THEN** it is excluded before ranking and cannot contribute citations or fingerprints

### Requirement: R6. Safe candidates, Binding eligibility, and immutable Plans

The system SHALL derive bounded candidates from the chosen searched branch,
auto-recommend exactly one safe candidate, derive a plan request only when
exactly one compatible current Binding exists, and generate
`project-hub-recovery-plan/v2` only from explicit exact candidate and Binding
input.

#### Scenario R6.1: Unique Binding allows a derived recommended request

- **GIVEN** one recommended safe candidate and exactly one current enabled Project-matching Profile-current capability-compatible Binding
- **WHEN** search composition completes
- **THEN** the intrinsic searched response contains one fingerprint-free plan intent and, after Flow fingerprint computation, exposes the exact closed recommended plan request with no Plan yet

#### Scenario R6.2: Two through sixteen Bindings require selection

- **GIVEN** 2–16 compatible current Bindings
- **WHEN** search composition completes
- **THEN** stage is `needs-agent-selection`, it returns every exact Binding revision, and no Binding is selected by sorting or inference

The `needs-agent-selection` response includes the valid candidate list and
compatible Binding/Profile revisions, but contains no generated Plan request.
The presence of multiple valid Bindings is not `no_compatible_binding` or
`no_safe_candidate`; those reasons are reserved for their respective empty or
unsafe conditions.

#### Scenario R6.3: More than sixteen Bindings is unavailable

- **GIVEN** 17 or more compatible current Bindings
- **WHEN** search composition completes
- **THEN** stage is `unavailable` with reason `binding_selection_too_large` and Agent Domain remediation; no list is silently truncated

#### Scenario R6.4: No Binding or candidate is safe

- **GIVEN** no compatible Binding, blocked work, unavailable capability, unavailable context/search, or no safe candidate
- **WHEN** candidate composition runs
- **THEN** stage is `unavailable` with exact owner remediation and no invented action

#### Scenario R6.5: Recommended request is automatically submitted

- **GIVEN** a searched response contains the derived closed recommended plan request
- **WHEN** an adapter auto-submits that exact request
- **THEN** the server recomputes all prerequisites and returns `planned` only if every fingerprint and Binding revision remains current

#### Scenario R6.6: User replaces candidate

- **GIVEN** a planned response lists another available candidate
- **WHEN** the user submits `plan/override` with searched-basis and immediate planned Flow fingerprints, the complete prior Plan, and another exact candidate/Binding
- **THEN** the server validates both prior layers, recomputes the search basis, and returns a new Plan/Flow fingerprint; the old Plan is not the current confirmation object

#### Scenario R6.7: Plan expires

- **GIVEN** a visible Plan is older than five minutes
- **WHEN** the user attempts to confirm or continue it
- **THEN** it remains visibly expired and only explicit `refresh-plan` with the complete prior Plan can produce a replacement after current-owner validation

#### Scenario R6.8: Plan never invents runtime identity

- **GIVEN** Agent Binding/Profile owns role and revisions but not runtime agent ID or host
- **WHEN** a Plan is composed
- **THEN** it binds only role, Binding/Profile revisions and capabilities; authenticated execution identity remains absent until apply

### Requirement: R7. Replay-safe Workflow apply

The system SHALL accept only `recovery-apply-request/v2` carrying the complete V2 Plan, presented fingerprint, safe ephemeral `{ query, limit }` planning input, and transition token; bind authenticated actor context; recompute mandatory search/candidate/Binding basis before a new claim; claim before owner mutation; resume or create exactly one Work Run; and return a closed durable receipt.

#### Scenario R7.1: Existing Work Run resumes

- **GIVEN** a current approved resume Plan and fresh token
- **WHEN** `workflow.recovery.apply` runs
- **THEN** it joins the exact Work Run with authenticated actor identity and Plan role/Binding/Profile locks

#### Scenario R7.2: Session candidate creates one Work Run

- **GIVEN** a current approved create Plan from safe Session context
- **WHEN** apply runs
- **THEN** Workflow derives one deterministic Work Run ID, creates/verifies one durable lease and local lease for the actor, and joins without calling manual `workflow.agent.start`

#### Scenario R7.3: Same token is replayed

- **GIVEN** an exact plan/token/planning-input/actor claim already exists
- **WHEN** the request repeats
- **THEN** applied returns its receipt, claimed recovers the same owner transition, and outcome-unknown blocks mutation replay

#### Scenario R7.4: Token, planning input, or actor is rebound

- **GIVEN** a token is presented with different Plan bytes, normalized query/limit, or actor
- **WHEN** apply loads token/plan claims
- **THEN** it conflicts before another owner mutation

#### Scenario R7.5: Plan expires after claim

- **GIVEN** the exact valid claim was created before Plan expiry
- **WHEN** the same request retries after expiry
- **THEN** Workflow recovers the existing claim before fresh expiry checks and revalidates request/Plan/token/planning-input/actor plus local Work Run/lease identity, not mutable pre-claim selection locks

#### Scenario R7.6: Expired or unverifiable unclaimed Plan is submitted

- **GIVEN** no claim exists and the Plan is expired, planning input cannot reproduce its search/candidate/Binding basis, or any current owner/capability/lease prerequisite changed
- **WHEN** apply runs
- **THEN** it rejects before claim creation and persists no raw query

#### Scenario R7.7: Crash windows occur

- **GIVEN** execution stops before owner mutation, after create before join receipt, after owner receipt before wrapper receipt, or after wrapper receipt before response
- **WHEN** the exact request retries
- **THEN** Workflow proves absence/receipt and continues once, or persists outcome-unknown when the owner result cannot be proven

#### Scenario R7.8: Two tokens race

- **GIVEN** one unexpired Plan is submitted concurrently with two fresh tokens
- **WHEN** plan fingerprint is claimed atomically
- **THEN** one token wins, at most one Work Run is created/joined, and the other receives the stored receipt or explicit claimed/outcome-unknown conflict

### Requirement: R8. Claimed Work Run output governance

The system SHALL clean-cut `workflow.agent.leave` to a closed request union:
`mode:complete` with exact Work Run identity, transition token,
`target_state:completed|awaiting_review`, and closed output submission; or
`mode:terminate` with `target_state:failed|cancelled` and `submission:null`.
Authenticated actor comes from OperationContext. Workflow SHALL claim output
before owner mutation and return a replay-safe route receipt.

#### Scenario R8.1: Four valid classes route

- **GIVEN** one valid complete-mode request for each cited output class
- **WHEN** leave routes it
- **THEN** view remains artifact-only, work-state transition returns one allowlisted Work-OS receipt, knowledge claim creates/binds one cited Project Memory draft without promotion, and external side effect requires exact approval plus Operation Write Policy

#### Scenario R8.2: Output is malformed

- **GIVEN** output cannot form valid `work-run-output/v1`
- **WHEN** the complete-mode request carries a closed quarantine arm with exact Work Run identities, safe classification metadata, payload fingerprint, provenance and diagnostics
- **THEN** unsafe payload bytes are neither persisted nor echoed and the route receipt is review-required

#### Scenario R8.3: Legacy or alternate completion bypass is attempted

- **GIVEN** step/checkpoint attempts `completed|awaiting_review`, or leave uses legacy `work_run_state|output_class|approval_status` fields
- **WHEN** Workflow validates the request
- **THEN** it rejects and requires the closed complete-mode leave arm; terminate mode remains available for failed/cancelled

#### Scenario R8.4: Output routing is replayed or interrupted

- **GIVEN** one output/token/actor claim exists
- **WHEN** retry occurs before owner mutation, after owner mutation before route receipt, or after receipt before response
- **THEN** Workflow returns/recovers one owner receipt, never repeats the owner effect, rejects rebound, and persists outcome-unknown when proof is impossible

#### Scenario R8.5: No second routing authority remains

- **GIVEN** TypeScript owns output completion and Python still writes compatible Work Run records
- **WHEN** S05 lands
- **THEN** the production-unused Python output router is removed and no caller can bypass TypeScript promotion/effect policy

### Requirement: R9. Obsidian-first ephemeral Recovery Flow

The Obsidian plugin SHALL expose Recovery Flow through the existing LLM Wiki/Ask Mate Project-context ItemView, keep all Flow/query/search/candidate/Binding/Plan state ephemeral, prove read-only preview before apply, and route confirmed mutation through Workflow.

#### Scenario R9.1: Preview completes without write

- **GIVEN** complete V2 read stages and no S04B mutation
- **WHEN** the user opens, searches, accepts or changes candidate/Binding, and previews a Plan
- **THEN** stage/work/context/evidence/candidates/Plan/stale/unavailable states are keyboard-operable and no durable bytes change

#### Scenario R9.2: ItemView reloads

- **GIVEN** an in-memory searched or planned Flow
- **WHEN** Obsidian reloads or the view reopens
- **THEN** no query/selection/Plan is restored from plugin data and the Flow starts from current `open`

#### Scenario R9.3: Plan expires in UI

- **GIVEN** a displayed Plan expires
- **WHEN** the user remains on the panel or attempts confirmation
- **THEN** the Plan is marked expired and a deliberate Refresh Plan action is required; no background substitution occurs

#### Scenario R9.4: Confirmed recovery applies

- **GIVEN** a current exact Plan and explicit confirmation
- **WHEN** S06B invokes Workflow apply
- **THEN** cancellation writes nothing, success shows exact receipt and restarts Flow from owners, and outcome-unknown disables another mutation with doctor remediation

### Requirement: R10. MCP and CLI parity

The system SHALL expose the same Flow actions/stages and Workflow apply through MCP and a dedicated CLI after accepted S06B, without adapter-owned transition, recommendation, refresh, or claim semantics.

#### Scenario R10.1: Read stages agree

- **GIVEN** one sanitized fixture and identical Flow requests
- **WHEN** domain, MCP, and CLI execute them
- **THEN** stages, Flow/Plan fingerprints, owner locks, reason codes, citations, diagnostics, and recommended requests agree

#### Scenario R10.2: Apply agrees

- **GIVEN** the same full Plan and token/actor context
- **WHEN** adapters invoke shared Workflow apply
- **THEN** apply state and receipt semantics agree and errors are redacted at adapter boundaries

### Requirement: R11. Foundation acceptance

The system SHALL provide one sanitized end-to-end fixture and reproducible actual-Obsidian procedure covering the full V2 Flow, clean V1 removal, failure/replay paths, privacy canaries, parity, and the under-60-second Plan-preview metric.

#### Scenario R11.1: End-to-end recovery passes

- **GIVEN** a previously active sanitized interrupted Project
- **WHEN** a user opens Flow, searches, previews an evidence-backed Plan, confirms apply, observes output routing, and sees refreshed owner state
- **THEN** normal and degraded behavior satisfies R1–R10 with no second state store or authority violation

#### Scenario R11.2: Timing target passes

- **GIVEN** Obsidian and the sanitized vault are already loaded and one unmeasured familiarization run is complete
- **WHEN** three runs start at Open Project Hub invocation and stop when a cited immutable Plan preview is visible
- **THEN** every run is under 60 seconds and raw start/stop timestamps/durations are recorded

#### Scenario R11.3: Privacy gate passes

- **GIVEN** canaries under suspicious and benign keys across fixture owners
- **WHEN** every domain, plugin-client, MCP, CLI, Flow, Plan, claim, receipt, diagnostic, quarantine, and error serialization is scanned
- **THEN** none contains private vault content, canaries, credentials, transcript bodies, or absolute paths

#### Scenario R11.4: Any gate fails

- **GIVEN** any contract, behavior, actual-surface, parity, timing, or privacy check fails
- **WHEN** Foundation acceptance is evaluated
- **THEN** S08 and Foundation remain incomplete and a linked Work-OS follow-up records the failure without waiver

### Requirement: R12. `workflow.recovery.plan` is a read-only Workflow Operation

The system SHALL register `workflow.recovery.plan` as a `mutating: false` Workflow Operation with the exact outer envelope:

```ts
export const WORKFLOW_RECOVERY_PLAN_REQUEST_SCHEMA_VERSION =
  "workflow-recovery-plan-request/v1" as const;
export interface WorkflowRecoveryPlanEnvelopeV1 {
  schemaVersion: typeof WORKFLOW_RECOVERY_PLAN_REQUEST_SCHEMA_VERSION;
  request:
    | RecoveryPlanFromSearchRequestV2
    | RecoveryPlanOverrideRequestV2
    | RecoveryRefreshPlanRequestV2;
}
```

It SHALL accept only those closed Plan request arms and return only
`RecoveryPlannedResponseV2 | RecoveryStaleResponseV2 |
RecoveryUnavailableResponseV2` (`planned|stale|unavailable`), write zero
bytes, have no actor/token/claim/apply path, and persist nothing. The Plan arm
source remains `project-hub-recovery-flow-request/v2`; there is no
`workflow-recovery-plan/v1` Plan or response schema.

#### Scenario R12.1: Operation is registered

- **GIVEN** S04P registers `workflow.recovery.plan`
- **WHEN** the Operation catalog is built
- **THEN** it is declared `mutating: false` with schema `workflow-recovery-plan-request/v1`, request arms `plan/from-search|override|refresh-plan` (envelope containing `project-hub-recovery-flow-request/v2` arms), and response stages `planned|stale|unavailable` (V2 Flow response schemas)

#### Scenario R12.2: Operation accepts only Plan arms

- **GIVEN** a request to `workflow.recovery.plan` with `open`, `search`, or `restart` action
- **WHEN** Operation validation runs
- **THEN** it rejects as an unsupported action

#### Scenario R12.3: Operation returns only planned/stale/unavailable

- **GIVEN** a valid Plan request to `workflow.recovery.plan`
- **WHEN** the Operation executes
- **THEN** it returns `planned|stale|unavailable` and never `open|searched|needs-agent-selection`

#### Scenario R12.4: No write occurs

- **GIVEN** any request to `workflow.recovery.plan`
- **WHEN** the Operation executes
- **THEN** zero bytes are written, no claim/token/Plan/session is persisted, and no actor/token/claim/apply path exists

#### Scenario R12.5: Handler is shared with Flow

- **GIVEN** the same Plan request is sent to `project.hub.recovery.flow` and `workflow.recovery.plan`
- **WHEN** both execute
- **THEN** the `planned|stale|unavailable` response is byte-identical; semantics, validators, and fingerprints are not duplicated

The Workflow operation unwraps `WorkflowRecoveryPlanEnvelopeV1.request` and
calls `RecoveryPlanningService.plan(request)`; it does not implement a second
validator, reducer, or fingerprint path.

### Requirement: R13. One shared planning service

The system SHALL own one internal planning service with this exact contract:

```ts
export interface RecoveryPlanDependencies {
  openOwners: RecoveryOpenOwners;
  searchSource?: ProjectSearchSource;
  agentSelection?: RecoveryAgentSelectionSource;
  now?: () => number;
  currentPlanned?: RecoveryPlannedResponseV2;
}
export interface RecoveryPlanningService {
  readonly capabilityFact: RecoveryCapabilityFactV2;
  plan(
    request:
      | RecoveryPlanFromSearchRequestV2
      | RecoveryPlanOverrideRequestV2
      | RecoveryRefreshPlanRequestV2,
  ): Promise<
    | RecoveryPlannedResponseV2
    | RecoveryStaleResponseV2
    | RecoveryUnavailableResponseV2
  >;
}
export function createRecoveryPlanningService(
  dependencies: RecoveryPlanDependencies,
): RecoveryPlanningService;
```

`project.hub.recovery.flow` and `workflow.recovery.plan` SHALL both delegate to
this service without duplicating semantics, validators, or fingerprints.

#### Scenario R13.1: Service owns prerequisite recomputation

- **GIVEN** a Plan request to either surface
- **WHEN** the service executes
- **THEN** it recomputes open → search → candidate → Binding and derives Plan fingerprint without re-implementing that logic in each caller

#### Scenario R13.2: Service owns stale/unavailable composition

- **GIVEN** a prerequisite fingerprint mismatch or missing capability
- **WHEN** the service returns stale or unavailable
- **THEN** the response matches the same shapes and diagnostics as the Flow-only path

#### Scenario R13.3: Core composition shares runtime and service

- **GIVEN** core composition creates the default Recovery runtime with the `workflow.recovery.plan: available` capability fact
- **WHEN** it creates `RecoveryPlanningService` from that runtime's capability-aware dependencies
- **THEN** it injects the same runtime and service into `makeProjectHubOps(registry, settingsService?, options?)` and `makeWorkflowOps(vaultPath, options?)` before either operation array is built; operation order cannot control capability visibility

The current `defaultRecoveryOwners` adapter SHALL be produced once by this
runtime and SHALL not use an empty planning `loadCapabilities` implementation.

### Requirement: R14. Capability separation: planning never authorizes mutation

The system SHALL introduce `workflow.recovery.plan` capability as `available` when the Operation is registered, require it for candidate recommendation, and keep it independent of `workflow.recovery.apply` availability.

`validateRecoveryPlanV2` in `mcp-server/src/project-hub/recovery-flow.ts` SHALL
migrate its capability invariant from requiring available
`workflow.recovery.apply` to requiring available `workflow.recovery.plan`.
The Plan's `owningOperation` remains `workflow.recovery.apply`; S04B performs
the separate apply-capability check before creating a claim.

#### Scenario R14.1: Planning capability introduced when Operation registered

- **GIVEN** S04P registers `workflow.recovery.plan`
- **WHEN** the capability factory runs
- **THEN** `workflow.recovery.plan: available` appears in the capability list and `workflow.recovery.apply: available` does not appear until S04B registers apply

#### Scenario R14.2: Candidate composition requires planning capability

- **GIVEN** `composeRecoveryCandidates` runs with `workflow.recovery.plan: available`
- **WHEN** candidates and compatible Bindings are computed
- **THEN** candidates are recommended and the searched/needs-agent-selection stage is reachable

#### Scenario R14.3: Candidate composition blocked without planning capability

- **GIVEN** `composeRecoveryCandidates` runs without `workflow.recovery.plan: available`
- **WHEN** candidates and compatible Bindings are computed
- **THEN** `unavailable` with `capability_unavailable` reason and bounded remediation is returned

#### Scenario R14.4: Apply independently proves both capabilities

- **GIVEN** a Plan request to `workflow.recovery.apply`
- **WHEN** S04B validates the request
- **THEN** it checks both the planning basis (Plan fingerprint, `searchInputFingerprint`, `searchFingerprint`, `candidateSetFingerprint`) and `workflow.recovery.apply: available`

The S04B apply-capability check occurs before claim creation; an absent or
unusable apply capability is never treated as a planning failure.

#### Scenario R14.5: Missing planning capability is not apply failure

- **GIVEN** `workflow.recovery.apply` runs but `workflow.recovery.plan` capability is missing
- **WHEN** S04B validates
- **THEN** apply returns `unavailable` with its own remediation; the planning capability failure and apply capability failure are distinct responses

### Requirement: R15. S06A surface unblocked after S04P

The system SHALL exercise the full read-only Flow in actual Obsidian after S04P registers `workflow.recovery.plan`, reaching `searched`, `needs-agent-selection`, and `planned` stages without S04B.

#### Scenario R15.1: Searched stage reachable after S04P

- **GIVEN** S04P has landed and the plugin is reloaded in Obsidian 1.13.7
- **WHEN** the user opens the Flow, submits a safe query, and `composeRecoveryCandidates` runs
- **THEN** the `searched` or `needs-agent-selection` stage is returned with candidates and recommended plan intent

#### Scenario R15.2: Planned stage reachable after S04P

- **GIVEN** the `searched` stage is visible with a recommended plan request
- **WHEN** the user auto-follows or explicitly submits the plan request
- **THEN** the `planned` stage is returned with an immutable Plan preview

This scenario SHALL pass while `workflow.recovery.apply` is absent or
unusable; apply availability is not a prerequisite for the S06A Plan preview.

#### Scenario R15.3: S06A principal acceptance resumes after S04P

- **GIVEN** S04P has landed
- **WHEN** T5.3 runs in actual Obsidian
- **THEN** `searched`, `needs-agent-selection`, `planned`, candidate replacement, and explicit refresh are all exercised and principal accepts the surface

The actual Obsidian gate SHALL also exercise `open`, `stale` after a controlled
owner-lock change, and `unavailable` with bounded remediation. Before and after
each read-only stage, it SHALL compare SHA-256 and byte counts for fixture vault
files, plugin `data.json`, and durable recovery roots; any difference fails the
gate. Missing plan capability, a failure to reach `planned` while apply is
absent/unusable, any write, skipped fingerprint validation, or broken
keyboard/focus/cancellation is a stop condition.
