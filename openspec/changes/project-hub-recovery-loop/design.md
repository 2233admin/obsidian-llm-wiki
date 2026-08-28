# Design: Project Hub Recovery Flow v2

## Context

S01 shipped `project-hub-recovery/v1` inside `project.hub.get`. It deterministically composes current Project stage, work groups, freshness, diagnostics, citations, and bounded next actions. It does not model the interaction needed to search with a user query, select a candidate and exact Project Agent Binding, preview a five-minute plan, and then apply through Workflow.

Those facts do not exist at one instant. The approved design therefore replaces the Snapshot vocabulary with a stateless staged **Recovery Flow**. The hard-to-reverse decision and rejected alternatives are recorded in `docs/adr/0001-project-hub-recovery-flow-v2.md`.

## Goals

- Make one read-only Project Hub operation own the complete vocabulary from open through immutable plan preview.
- Preserve owner authority and Project identity without adding server-side Flow state or a client-owned durable store.
- Require cited Project search before planning, while allowing repeated queries and candidate replacement.
- Bind plans to exact current owner locks, capability facts, and Binding/Profile revisions without inventing execution identity.
- Apply through Workflow with claim-first crash recovery and route completed output exactly once or fail honestly.
- Prove the human journey in Ask Mate Project Context before MCP/CLI parity.

## Non-goals

- Persisting a recovery session, Flow cache, Project Hub database, plugin task store, query history, candidate selection, or Plan.
- Putting mutation under `project.hub.*`.
- Keeping `project-hub-recovery/v1` as a compatibility shim after V2 cutover.
- Adding new Source Input types, Python requirements, external tracker federation, Fleet behavior, or autonomous promotion.
- Returning raw prompts, transcript bodies, credentials, environment values, or absolute workspace paths.

## Decisions

### D1. Recovery Flow v2 clean-cuts over Snapshot v1

Canonical schema: `project-hub-recovery-flow/v2`.

S01 remains completed history. S01B adds the complete internal V2 contract kernel. S02, S03, and S04A implement its read stages. S04A then registers the complete operation, migrates all repository callers/fixtures/docs, removes `project-hub-recovery/v1` types/validator/export/tests, and removes the old `recovery` field from `project.hub.get` in the same cutover. No dual-version adapter or deprecated alias remains.

`project.hub.get` continues ordinary read-only Hub composition. Recovery uses `project.hub.recovery.flow`.

### D2. One read-only Flow operation, one Workflow mutation

Canonical operations:

- `project.hub.get` — ordinary derived Hub sections; no Recovery Snapshot field after cutover.
- `project.hub.recovery.flow` — read-only staged V2 composition.
- `workflow.recovery.apply` — the only recovery resume/create mutation.
- `workflow.agent.leave` — the successful/review Work Run completion and output-routing boundary.

Every `project.hub.*` operation remains `mutating: false`. Flow stops at an immutable Plan. Obsidian confirmation calls Workflow directly through the shared Operation transport.

### D3. Flow requests are closed, stateless actions

Schema: `project-hub-recovery-flow-request/v2`. Every request contains exact
`schemaVersion`, canonical `projectId`, and one action. Unknown fields are
invalid.

| Request arm | Required fields | Purpose |
|---|---|---|
| `open` | none beyond common fields | Compose current recovery facts and bounded context. |
| `search` | `openFlowFingerprint`, normalized `query`, `limit` | Recompute/verify open, then execute one cited search branch. |
| `plan/from-search` | `openFlowFingerprint`, `searchedBasisFlowFingerprint`, `plannedFlowFingerprint:null`, `query`, `limit`, `candidateId`, `agentSelection`, `priorPlan:null` | Recompute open/search/candidates and generate the first Plan for that branch. |
| `plan/override` | `openFlowFingerprint`, `searchedBasisFlowFingerprint`, `plannedFlowFingerprint`, `query`, `limit`, replacement `candidateId`, `agentSelection`, complete `priorPlan` | Validate the immediate planned response and prior Plan, then replace the candidate. |
| `refresh-plan` | `openFlowFingerprint`, `searchedBasisFlowFingerprint`, `plannedFlowFingerprint`, `query`, `limit`, complete `priorPlan` | Validate old Plan/response, recompute current basis, and issue a new five-minute Plan for the same candidate/Binding. |
| `restart` | complete `staleProof` | Validate a finite stale proof and compose a new open stage. |

`agentSelection` is `{ bindingId, bindingRevision }`. The two `plan` arms share
action `plan` and are discriminated by `mode:from-search|override`; nullability
is exact. `searchedBasisFlowFingerprint` always means the searched or
needs-agent-selection response that supplied the candidate set.

`RecoveryStaleProofV2` is finite and contains exactly `{ schemaVersion,
projectId, rootOpenFlowFingerprint, priorFlowFingerprint,
priorActionInputFingerprint, recoveryFingerprint, changedOwners,
citationTargets, fingerprint }`. It contains no response, payload, or next
request.

No Flow response is stored. A later request repeats the minimum normalized
inputs needed to recompute its prerequisite stage. The server accepts a prior
fingerprint only after recomputation proves it. Refresh and candidate override
submit the complete prior Plan because its exact creation/expiry bytes cannot be
reconstructed from a fingerprint alone.

### D4. Flow responses are a six-arm discriminated union

`RecoveryFlowResponseV2` is exactly:

```ts
type RecoveryFlowResponseV2 =
  | RecoveryOpenResponseV2
  | RecoverySearchedResponseV2
  | RecoveryNeedsAgentSelectionResponseV2
  | RecoveryPlannedResponseV2
  | RecoveryStaleResponseV2
  | RecoveryUnavailableResponseV2;
```

Each interface has a literal `stage`, its exact payload type, and only its
allowed next-request array type. Validators reject every cross-stage payload or
next-request arm.

Common intrinsic fields:

| Field | Required shape | Intrinsic Flow fingerprint |
|---|---|---|
| `schemaVersion` | exact literal | included |
| `stage` | one literal for the selected interface | included |
| `projectId` | canonical Project ID | included |
| `previousFlowFingerprint` | SHA-256 or null | included |
| `recoveryFingerprint` | digest of current action-relevant Project/work facts | included |
| `ownerLocks` | ordered closed owner-lock list | included |
| `payload` | exact stage payload, containing no derived request | included |
| `nextRequestIntents` | max 8 closed semantic intents with no current Flow fingerprint | included |
| `diagnostics` | max 32 closed diagnostics | included |
| `omitted` | `{ items, citations, diagnostics, bytes }` non-negative integers | included |
| `rootOpenFlowFingerprint` | assigned after intrinsic hashing | excluded |
| `nextRequests` | deterministically derived after intrinsic hashing | excluded |
| `generatedAt` | ISO-8601 UTC | excluded |
| `flowFingerprint` | chained digest defined by D5 | excluded from itself |

Stage-specific pairs:

- `open`: `RecoveryOpenPayloadV2`; search intents/requests only. No candidate or Plan.
- `searched`: `RecoverySearchedPayloadV2`; zero or one plan intent/request. The plan request exists only for the recommended candidate plus exactly one compatible Binding.
- `needs-agent-selection`: `RecoveryNeedsAgentSelectionPayloadV2`; no generated plan request because the user must supply an exact Binding.
- `planned`: `RecoveryPlannedPayloadV2`; refresh and bounded candidate-override intents/requests derived from the complete current Plan.
- `stale`: `RecoveryStaleProofV2`; exactly one restart intent/request built from that proof.
- `unavailable`: `RecoveryUnavailablePayloadV2`; no Flow request unless the payload declares one bounded safe remediation intent permitted by its reason code.

A stage response carries only its current payload plus required upstream
summaries and locks. It never accumulates all previous 64/128 KiB payloads.

### D5. Fingerprints are non-self-referential, chained, and owner-layered

Owner enum: `project|work-os|workflow|project-memory|session-record|source-evidence|agent-domain|settings`.

Each owner lock has exactly `{ owner, revision, fingerprint, state }`; revision
is string/number/null, fingerprint SHA-256/null, and state
`current|stale|unavailable`. Locks sort by the enum order above.

`recoveryFingerprint` covers only open-stage action-relevant Project identity,
Work-OS facts, Workflow resumability facts, and capability availability.
Unrelated owner changes do not falsely invalidate it.

Response construction is two-phase:

1. Build the intrinsic stage projection containing schema/stage/Project,
   previous Flow fingerprint, normalized action-input fingerprint, recovery
   fingerprint, exact locks, payload fingerprint, semantic next-request
   intents, diagnostics, and omissions.
2. Hash that projection to obtain `flowFingerprint`.
3. Assign `rootOpenFlowFingerprint`: for open it equals the newly computed
   Flow fingerprint; later stages copy the recomputed open response value.
4. Derive closed `nextRequests` from the already-hashed intents plus the
   computed Flow/root fingerprints.

`rootOpenFlowFingerprint`, derived `nextRequests`, display time, and
`flowFingerprint` are never part of the intrinsic hash. Payloads contain no
request object. Validation recomputes the intrinsic fingerprint and then proves
that every derived request exactly matches its intent and the computed current
fingerprint.

Every downstream request binds its exact prior Flow fingerprint. Query A and
query B therefore produce independent search branches, and a candidate from one
branch cannot be combined with the other.

### D6. Open composes bounded authoritative context

Open selection order:

1. caller-independent current resumable Work Run recommended by authoritative current facts;
2. latest valid current Work Run by authoritative observation time descending then Work Run ID ascending;
3. latest valid Session Record for the current Project/Work Item.

An explicit Work Run selector is not part of `open`; later candidate choice determines resume versus create. Session fallback has `workRunId: null` and can support only governed create.

Authorities:

- Project Context owns Project ID and Workspace Binding;
- Work-OS owns Work Item state and blockers;
- Workflow durable run records own Work Run identity/lifecycle and agent event checkpoints;
- Project Memory owns reviewed decisions/current claims;
- Session Record owns safe Session identity/metadata;
- Settings/Agent Domain own capability and Binding/Profile facts;
- every owner supplies normalized Citation Targets.

Context bounds remain: max 32 reviewed decisions, 32 checkpoints, 64 citations, 16 prerequisites, 32 diagnostics, and 64 KiB canonical JSON. Mandatory identity/task/prerequisite/security data is allocated first. Raw Session evidence and unreviewed claims never enter the payload.

### D7. Search is mandatory, repeatable, and Project-scoped

Search normalizes Unicode NFKC, trim, and internal whitespace. Input is 1–2048 UTF-8 bytes, limit `1..25`, with no controls or unsafe secret/path/transcript material.

Sources are current Project owner records only:

- reviewed Work-OS issues/comments;
- reviewed Project Memory;
- Project Source/Evidence records;
- safe Session Record metadata;
- safe Workflow Work Run/checkpoint evidence.

Generic `unified-query.ts` RRF results are not Project authority. The Project owner-source composer computes exact owner revisions/fingerprints and excludes cross-Project material before ranking.

Results keep D7's closed fields: stable item ID/type/label, Project ID, owner, match class, normalized integer score, freshness, confidence, provenance, and 1–4 Citation Targets. Ordering is match class, owner priority, freshness, score descending, then item ID. Each result is at most 4096 canonical-JSON bytes; response results max 25, diagnostics max 32, total search payload max 128 KiB.

A user may submit multiple `search` actions from the same current open basis. Only the branch whose searched/needs-selection Flow fingerprint feeds `plan` is bound into the Plan.

### D8. Candidates and automatic planning never guess identity

Candidate set is closed, max three, and derived from current open context, the chosen search branch, current Work Item state, and capability facts.

- Resume candidate reuses the exact authoritative Work Run identity.
- Create candidate exists only with no valid resume candidate, Session-sourced context, matching current unblocked Work Item, and satisfied capabilities.
- Exactly one available candidate is recommended; zero safe candidates returns `unavailable`.

After search:

- zero compatible Bindings returns `unavailable` with Settings/Agent Domain remediation;
- exactly one compatible Binding returns `searched` with one plan intent; after the searched Flow fingerprint is computed, that intent deterministically becomes one complete closed plan request for the recommended candidate;
- 2–16 compatible Bindings returns `needs-agent-selection`;
- more than 16 compatible Bindings returns `unavailable` with reason `binding_selection_too_large` and Agent Domain remediation; V2 has no Binding pagination/filter action.

Adapters may automatically submit the derived recommended plan request; they do
not invent its fields. A user may submit another available candidate. Candidate
replacement uses `plan/override`, validates `plannedFlowFingerprint` plus the
complete prior Plan, recomputes its searched basis, then produces a new Plan and
Flow fingerprint. The old Plan is no longer the current confirmation object.

### D9. Recovery Plans are immutable and execution identity is apply-bound

Schema: `project-hub-recovery-plan/v2`. Every field is required:

| Field | Required shape |
|---|---|
| `schemaVersion` | exact literal |
| `projectId` | canonical Project ID |
| `rootOpenFlowFingerprint` / `searchedBasisFlowFingerprint` | exact open and searched/needs-selection Flow digests |
| `recoveryFingerprint` / `searchInputFingerprint` / `searchFingerprint` / `candidateSetFingerprint` | exact current digests |
| `candidateId` / `kind` | selected current candidate; `resume|create` |
| `workItemId` / `workRunId` | canonical Work Item; Work Run for resume, null for create |
| `agentSelection` | `{ role, bindingId, bindingRevision, profileId, profileRevision }` |
| `ownerLocks` | exact locks required by plan/apply |
| `capabilityFacts` | max 16, all `available|degraded` |
| `citationTargets` | 1–32 safe refs |
| `owningOperation` | exact `workflow.recovery.apply` |
| `createdAt` / `expiresAt` | server clock; exactly five minutes apart |
| `leaseDurationMs` | `900000` create, `0` resume |
| `fingerprint` | digest of every field except itself |

Binding/Profile owns role and revisions, not runtime `agentId` or host. The Plan never invents them. Apply takes authenticated actor identity from `OperationContext`; existing Workflow behavior uses that actor as host fallback when no separately authenticated host authority exists.

Expired Plans are shown as expired. Only explicit `refresh-plan` can issue a replacement after validating the complete prior Plan and all current owners. No adapter silently refreshes a Plan that the user is reviewing or confirming.

### D10. Apply is claim-first and recovers before fresh expiry checks

Schema: `recovery-apply-request/v2` with exactly `{ schemaVersion, plan,
planFingerprint, planningInput, transitionToken }`. `planningInput` is the
closed safe ephemeral `{ query, limit }` used to create the Plan. The full
closed V2 Plan is required; authenticated actor comes from `OperationContext`.
The query is never persisted in a Plan or claim.

Workflow maintains under its existing lock:

- `01-Projects/<slug>/runs/recovery-plans/<plan-fingerprint-hex>.json`;
- `01-Projects/<slug>/runs/recovery-tokens/<token-digest>.json`.

Claim schema `recovery-apply/v2` contains plan/token/planning-input digests,
actor ID, kind, `claimed|applied|outcome-unknown`, Work Run ID/null,
receipt/null, and timestamp. The receipt binds plan/token, state, Project/Work
Item/Work Run, owner operation/receipt, diagnostics, recorded time, and
fingerprint.

Normative order:

1. validate request shape, Plan bytes/fingerprint, safe planning input, actor, and token digest without fresh expiry enforcement;
2. load token/plan claim under lock and reject any Plan/actor/token/planning-input rebound;
3. exact `applied` returns its receipt; `outcome-unknown` blocks; exact `claimed` recovers even after Plan expiry;
4. only a new claim uses `planningInput` to recompute open→search→candidates→Binding and prove the Plan's searched basis/search-input/search/candidate fingerprints, then checks Plan expiry, current owner locks, capability and lease prerequisites;
5. recover/continue the same claimed owner operation; never substitute another query, candidate, Binding, actor, or Work Run.

Claim creation is the durable authorization point. Recovery revalidates
request/Plan/token/planning-input/actor and local Work Run/lease identity, not
mutable pre-claim selection locks. It reconciles owner bytes/receipt before
another call.

Resume calls replay-safe `workflow.agent.join` with exact Work Run identity,
authenticated actor, and Plan role/Binding/Profile locks. Create derives one
Work Run ID from Project ID, Work Item ID, and Plan fingerprint,
creates/verifies one durable leased run and local lease for the actor, then
joins. It never calls manual `workflow.agent.start`.

Fault windows: before owner mutation, after create before join receipt, after
owner receipt before wrapper receipt, after wrapper receipt before response,
expiry after claim, and two tokens racing on one Plan. Unprovable owner outcome
persists `outcome-unknown` and requires doctor reconciliation.

### D11. Work Run output completion is a claimed leave protocol

`workflow.agent.leave` clean-cuts to a closed request union:

```ts
type WorkflowAgentLeaveRequestV2 =
  | {
      mode: \"complete\";
      project: string;
      agent: string;
      work_run_id: string;
      transition_token: string;
      target_state: \"completed\" | \"awaiting_review\";
      submission: WorkRunOutputSubmissionV1;
      summary: string;
    }
  | {
      mode: \"terminate\";
      project: string;
      agent: string;
      work_run_id: string;
      transition_token: string;
      target_state: \"failed\" | \"cancelled\";
      submission: null;
      summary: string;
    };
```

Authenticated actor comes from `OperationContext`, is bound into the output
claim/receipt, and must be authorized for the exact Work Run. Unknown fields
reject. Legacy leave fields `work_run_state`, `output_class`, and
`approval_status` are invalid after the cutover; step/checkpoint also reject
`completed|awaiting_review`. Every repository caller migrates in the same task.

`WorkRunOutputSubmissionV1` is exactly `{ schemaVersion, result, output,
quarantine }`; result `output|quarantine`, selected arm non-null, other arm
null. Valid `work-run-output/v1` contains safe IDs, exact Project/Work Item/Work
Run, one of four output classes, max-64-KiB JSON payload, citations, provenance,
produced time, and fingerprint. Knowledge claims require citations.

Quarantine contains exact Work Run identities, safe observed class/null,
payload fingerprint/null, provenance, 1–16 bounded diagnostics, produced time,
and fingerprint. Malformed payload bytes are never stored or echoed. Quarantine
routes to review.

Workflow maintains output fingerprint and leave-token indexes before owner
mutation. Claim state is `claimed|routed|outcome-unknown`; route receipt state is
`accepted|review-required|denied|outcome-unknown`. Same-token replay returns or
recovers one owner receipt; rebound conflicts; unprovable result becomes
outcome-unknown. Owner ports are idempotent on output fingerprint.

Routes:

- view → artifact/receipt only;
- work-state-transition → allowlisted Work-OS owner receipt;
- knowledge-claim → one cited Project Memory draft or exact binding to an existing Dream Time proposal;
- external-side-effect → exact per-run approval plus Operation Write Policy;
- quarantine → review-required receipt, no content-owner mutation.

The unused Python output router is removed while durable Python Work Run fields
remain compatible.
### D12. Ask Mate Project Context is the primary surface

The existing LLM Wiki/Ask Mate ItemView opened for current Project Context hosts a focused Recovery Flow panel. The advanced control-plane modal remains administrative.

The plugin stores Flow/query/search/candidate/Binding/Plan only in ItemView memory. Reload/reopen starts at `open`. S06A exposes read-only stages and never has apply mapping. S06B adds explicit exact-Plan confirmation, Workflow apply, receipt/outcome-unknown display, and owner-backed Flow restart.

Keyboard order, focus retention, semantic headings, live status, cancellation, Citation Targets, explicit stale/unavailable remediation, and no empty success state are acceptance requirements.

### D13. MCP and CLI expose the same Flow semantics

After accepted S06B, MCP and the dedicated CLI map adapter arguments to the same `project.hub.recovery.flow` actions and `workflow.recovery.apply`. They do not reimplement stage transitions, fingerprints, recommendations, plan refresh, or claim reads. Claim files remain internal; apply response/receipt and doctor expose their observable state.

Parity compares stages, Flow/Plan fingerprints, reason codes, owner locks, citations, diagnostics, apply states, and receipts on one sanitized fixture.

### D14. Delivery remains vertical and source-bound

```text
S01 v1 complete (historical)
  -> S01B complete V2 contract kernel (internal, no public partial operation)
       -> S02 open/context + Workflow read/store seams
            -> S03 mandatory cited search
                 -> S04A candidates/plan + register complete Flow + migrate/remove v1
                      -> S04P read-only workflow.recovery.plan Operation [next]
                           -> S06A actual-Obsidian read-only preview [resumes after S04P]
                                -> S04B Workflow apply
                                     -> S05 output governance
                                          -> S06B actual-Obsidian apply/receipt proof
                                               -> S07 MCP/CLI parity
                                                    -> S08 acceptance
```

No public partial V2 operation is registered. S03 depends on S02's Workflow read model. S04P registers the planning Operation before S06A exercises the full Flow. Mutation starts only after S06A proves the Plan in the primary human surface.

### D15. `workflow.recovery.plan` is a read-only Workflow Operation

Canonical operations:

- `project.hub.get` — ordinary derived Hub sections; no Recovery Snapshot field after cutover.
- `project.hub.recovery.flow` — read-only staged V2 composition.
- **`workflow.recovery.plan`** — read-only immutable Plan preview from closed Plan request arms.
- `workflow.recovery.apply` — the only recovery resume/create mutation (S04B).
- `workflow.agent.leave` — the successful/review Work Run completion and output-routing boundary.

**Schema vocabulary:** The Operation request schema is `workflow-recovery-plan-request/v1` (outer envelope). It contains one closed Plan arm from `project-hub-recovery-flow-request/v2` (`plan/from-search`, `plan/override`, or `refresh-plan`). There is no `workflow-recovery-plan/v1` Plan or response schema. Responses reuse existing V2 Flow schemas: `RecoveryPlannedResponseV2`, `RecoveryStaleResponseV2`, `RecoveryUnavailableResponseV2`.

`workflow.recovery.plan` is `mutating: false`, writes zero bytes, has no actor/token/claim/apply path, and persists nothing. It accepts only `plan/from-search`, `plan/override`, and `refresh-plan` arms and returns only `planned`, `stale`, or `unavailable` responses.

### D16. `RecoveryPlanningService`: one shared runtime-constructed service

**Construction:** `RecoveryPlanningService` is constructed once by core composition (inside `makeAllOperations` or the equivalent composition root) and injected into both `makeProjectHubOps` (for `project.hub.recovery.flow` plan/refresh/override delegation) and `makeWorkflowOps` (for `workflow.recovery.plan` registration). Operation order does not determine capability visibility.

**Service owns:**
- Full stateless prerequisite recomputation: open → search → candidate → Binding
- Plan fingerprint derivation and immutable Plan composition
- Stale/unavailable response composition with ordered changed owners
- Five-minute expiry enforcement
- The single `handlePlanRequest` method called by both surfaces

**Service does not own:** actor validation, claim creation, transition tokens, or receipts — those are apply-only.

**Surface duplication is intentional:** `project.hub.recovery.flow` and `workflow.recovery.plan` both expose plan actions. The shared service ensures semantics, validators, and fingerprints are not copied. Callers of either surface experience identical `planned`/`stale`/`unavailable` behavior.

### D17. Capability separation: planning never authorizes mutation

**Capability fact introduction:** `workflow.recovery.plan` capability enters production state `available` when the Operation is registered in `makeWorkflowOps`. Operation order does not determine capability visibility — the capability fact is injected alongside the Operation registration.

**`defaultRecoveryOwners` / core wiring change:** In the core composition root where `loadCapabilities` is configured for the Recovery open stage, add the `RecoveryPlanningService` instance as an injected dependency. The capability fact factory resolves `workflow.recovery.plan: available` from the same factory used by other Workflow Operations.

**Candidate composition (S04A `composeRecoveryCandidates`):** Requires `workflow.recovery.plan: available` instead of `workflow.recovery.apply: available` for candidate recommendation.

**Compatible Agent Profiles:** Profile capability requirements use `workflow.recovery.plan` for the planning gate, not `workflow.recovery.apply`.

**Apply independence:** `workflow.recovery.apply` independently proves:
1. Current planning basis (Plan fingerprint, `searchInputFingerprint`, `searchFingerprint`, `candidateSetFingerprint`)
2. `workflow.recovery.apply: available` capability
3. Valid transition token and authenticated actor
4. No existing claim for this plan/token/actor

Missing planning capability → explicit bounded remediation in the unavailable response. Missing apply capability → separate unavailable response from the apply Operation itself.

**Why this breaks the cycle:** Candidate recommendation no longer depends on `workflow.recovery.apply` availability. The full read-only Flow (`searched`, `needs-agent-selection`, `planned`) is reachable without S04B. S04B retains its correct dependency order: apply requires demonstrated preview first.

**Integration test:** After `makeWorkflowOps` registers `workflow.recovery.plan`, calling the capability factory returns `workflow.recovery.plan: available`. This test passes even if `makeProjectHubOps` is not yet called — operation order does not determine capability visibility. Before S04B, `workflow.recovery.apply` is not available; after S04P, apply request returns `unavailable`.

## Data flow

```text
open(project)
  -> Project/Work-OS/Workflow/Memory/Session/Settings owners
  -> open stage + bounded context + suggested queries + open Flow fingerprint

search(openFp, query)
  -> recompute open
  -> Project owner search
  -> searched + derived recommended plan request
     OR needs-agent-selection (2–16) / unavailable / stale

plan(openFp, searchedBasisFp, plannedFp?, query, candidate, binding, full priorPlan?)
  -> recompute open/search/candidates
  -> validate exact Binding/Profile and prior planned response when overriding
  -> planned + immutable five-minute Plan

refresh-plan(openFp, searchedBasisFp, plannedFp, query, full priorPlan)
  -> validate old planned response and Plan bytes
  -> recompute all current owners
  -> new planned Flow/Plan

confirm
  -> workflow.recovery.apply(full Plan, planningInput, fingerprint, token)
  -> claim -> join or governed create+join -> receipt
  -> workflow.agent.leave(mode=complete, target_state, submission, token)
  -> output claim -> owner receipt
  -> recovery.flow(open) refresh
```

## Failure policy

| Failure | Required behavior |
|---|---|
| Prior Flow cannot be recomputed to the submitted fingerprint | `stale` with ordered changed owners and closed restart request. |
| Query invalid/unsafe | reject without echo before search. |
| Search owner unavailable | partial search diagnostics; never label partial as current. |
| No safe candidate or compatible Binding | `unavailable` with owner remediation. |
| Multiple compatible Bindings | `needs-agent-selection`; never sort-and-pick. |
| Plan expired | show expired and require explicit refresh. |
| Existing apply claim after Plan expiry | recover claim before fresh expiry checks. |
| New claim with expired/stale Plan | reject before mutation. |
| Apply owner outcome unprovable | persist outcome-unknown; block replay. |
| Output malformed | quarantine safe metadata only; review-required. |
| Output owner outcome unprovable | persist output outcome-unknown; no repeat. |
| Adapter failure | format at boundary without stacks, secrets, transcript text, or absolute paths. |

## Security and privacy

One shared safe-normalization contract inspects keys and string values. It covers credential/cookie/token/password/authorization/environment semantics, common token formats, raw prompt/transcript markers, Windows/POSIX/UNC/home-relative paths, controls, depth/count, and UTF-8 byte bounds.

Unsafe caller contract fields reject without echo. Unsafe optional owner values are omitted with citation-safe diagnostics; unsafe identity/mandatory safety values make the stage unavailable. Fingerprints are computed only from normalized safe results.

Queries and all Flow state are ephemeral. Plans/claims persist no raw query or search result payload; they bind search fingerprints and safe citations. Fixtures place synthetic canaries under suspicious and benign keys, and every domain/Obsidian/MCP/CLI/claim/receipt/error serialization is scanned.

## Verification strategy

- Contract validation for every request action/response stage, null arm, unknown field, bound, and canonical fingerprint.
- V1-to-V2 equivalence for the action-relevant S01 facts before v1 removal.
- Stateless recomputation: prior-stage mismatch, repeated queries, branch mixing, full-prior-Plan refresh/override.
- Owner-lock invalidation without false global staleness.
- Unique/multiple/no compatible Binding behavior and candidate replacement.
- Explicit Plan expiry/refresh and no silent UI substitution.
- Apply/output claim crash windows, replay, races, and outcome-unknown.
- Actual Obsidian keyboard/focus/stale/unavailable behavior with no persisted Flow state.
- MCP/CLI/domain parity after Obsidian proof.
- One sanitized end-to-end fixture and three measured under-60-second Plan-preview runs.

## Luna delegation contract

Luna receives one reviewed implementation Task at a time and may change internal implementation shape: add/split focused files, extract helpers, or adjust focused tests. It must stop before changing approved public operation/schema names, authority, dependency edges, write policy, privacy/security rules, crash invariants, or observable behavior.

Luna may create local Task commits. It may not push, merge, or perform external mutations. The controller reviews code and commit, runs full verification, updates the canonical plan/file map when implementation shape changed, and decides the accepted commit history.