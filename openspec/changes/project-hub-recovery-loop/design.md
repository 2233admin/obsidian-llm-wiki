# Design: Project Hub recovery loop

## Context

S01 introduced `project-hub-recovery/v1`, a deterministic read-only snapshot composed by `mcp-server/src/project/project-hub.ts` and validated in `mcp-server/src/project-hub/recovery.ts`. It already joins canonical Project identity, Work-OS state, Project Memory summary, active Work Runs, capability health, freshness, diagnostics, Citation Targets, and bounded next-action candidates.

The remaining gap is execution continuity. A fresh Agent still needs a safe context bundle, cited project retrieval, a governed Work Run transition, output routing, an Obsidian-first control surface, adapter parity, and an end-to-end acceptance gate. Those capabilities cross Project, Workflow, Project Memory, Knowledge, Agent, Settings, Obsidian, MCP, and CLI boundaries. The Project Hub must compose them without becoming a second authority.

## Goals

- Recover interrupted work from one current, fingerprinted Project Hub snapshot.
- Give an Agent only bounded, cited, reviewed, secret-safe context.
- Resume a valid Work Run or create one governed Work Run from a current next action.
- Route every result through a versioned Run Output Class and the owning policy.
- Make Obsidian the primary human journey while preserving MCP and CLI semantic parity.
- Fail explicitly on stale, missing, partial, incompatible, unauthorized, or replayed input.
- Produce deterministic, sanitized acceptance evidence across normal and failure paths.

## Non-goals

- Replacing Work-OS, Project Memory, Workflow, Agent Domain, Settings, or Knowledge authority.
- Persisting a Project Hub database, context cache, search index, or plugin-owned task state.
- Returning raw prompts, complete transcripts, credentials, environment values, or absolute workspace paths.
- Automatically promoting knowledge claims or performing external side effects.
- Adding new Source Input types, Python requirements, external tracker federation, or Fleet behavior.
- Redesigning the S01 snapshot unless an acceptance failure proves its existing contract insufficient.

## Decisions

### D1. S01 is the immutable planning baseline

This change consumes `project-hub-recovery/v1`; it does not rewrite S01. An additive schema version is allowed only if an S02–S08 requirement cannot be expressed through a separate contract. Existing callers and S01 tests must remain green.

### D2. Shared TypeScript operations own semantics

The shared Project Hub/Workflow/Project Memory TypeScript modules own validation, selection, fingerprints, diagnostics, action planning, and receipts. Obsidian, MCP, and CLI only map inputs and format outputs. No adapter may reimplement selection, freshness, security filtering, or governance rules.

Canonical operations:

- `project.hub.get` — existing S01 snapshot.
- `project.hub.resume-context.get` — read-only resumable context resolution.
- `project.hub.search` — read-only Project-scoped cited retrieval.
- `project.hub.action-candidates.get` — read-only additive candidate set over S01/context/search locks.
- `project.hub.action.plan` — read-only immutable action plan.
- `workflow.recovery.apply` — governed resume/create mutation owned by Workflow/Work Driver.

### D3. Fingerprints lock only the facts each contract actually reads

`project-hub-recovery/v1` remains unchanged. Its fingerprint invalidates a caller only when an action-relevant fact projected into S01 changes. Context, search, candidate, and plan contracts additionally bind the exact owner revisions they read.

| Lock | Required source identities | Invalidated by |
|---|---|---|
| S01 snapshot fingerprint | Existing composed recovery fields | Any change visible in `project-hub-recovery/v1` |
| Context fingerprint | S01 fingerprint, Work Run record hash/revision, checkpoint-set hash, Project Memory revision/fingerprint, Session revision/content hash | Any bound context owner change |
| Search fingerprint | S01 fingerprint, normalized query, owner source-snapshot hashes/revisions | Query or searched-owner change |
| Action-candidate fingerprint | S01, context, and search fingerprints plus candidate bytes | Any input or candidate change |
| Action-plan fingerprint | Candidate-set fingerprint, selected candidate, Agent Binding/Profile revisions, capability snapshot, expiry, owning operation | Any immutable execution prerequisite change |

An owner record change that is not projected into S01 does not falsely invalidate the S01 fingerprint; it invalidates the downstream contract that binds that owner's revision. `workflow.recovery.apply` revalidates all five locks before mutation.

### D4. Resume selection and bounded serialization are deterministic

Selection order:

1. A caller-specified Work Run ID, when it is a valid resumable run selected by the current snapshot.
2. The current snapshot's recommended `resume-work-run` candidate.
3. The latest valid Session Record associated with the current Project and current Work Item.

Candidates sort by authoritative observed timestamp descending, then canonical ID ascending. An invalid explicitly requested Work Run returns `not-resumable` and never falls through. A Session Record fallback produces a session-sourced bundle with `workRunId: null`; it can support a governed create candidate but cannot impersonate an existing run.

Collection selection:

- reviewed decisions: `observedAt` descending, null last, then `claimId` ascending;
- checkpoints: select `recordedAt` descending then `checkpointId` ascending, retain the newest 32, and return them in chronological order;
- Citation Targets: mandatory Project/Work Item/Work Run/Session references first, then decision citations in retained-decision order, checkpoint citations in retained-checkpoint order, and diagnostic citations last; deduplicate by `ref`;
- diagnostics: severity `error`, `warning`, `info`, then `code` and first Citation Target.

The envelope, task state, prerequisites, and blocking/security diagnostics are mandatory. If those exceed 64 KiB of UTF-8 canonical JSON, return `not-resumable/context_too_large`. Optional decisions, checkpoints, citations, and non-blocking diagnostics are appended in the order above only while the 32/32/64 count caps and 64 KiB total cap remain satisfied. An evidence item is omitted if none of its required citations fit. Omitted counts and byte-limit facts are included in diagnostics and the fingerprint.

### D5. Context uses authorities, not projection internals

The resolver uses the snapshot for selection, then reads each payload through its owner:

- Project Context owns Project ID and Workspace Binding;
- Work-OS owns Work Item state and blockers;
- Workflow durable run records own Work Run identity and lifecycle;
- Workflow owns checkpoints;
- Project Memory owns reviewed decisions and current claims;
- Session Record owns Session identity and metadata;
- each source owner supplies normalized Citation Targets.

Raw Session evidence is never copied into the bundle. Draft, unresolved, superseded, stale, or unreviewed claims do not appear as decisions; diagnostics may cite their existence without returning their private content.

### D6. Resumable context is a closed discriminated schema

Schema version: `project-hub-resume-context/v1`. Every listed field is required. Nullable fields serialize as JSON `null`; omission is invalid. Unknown fields are invalid.

| Common field | Type and bound | Fingerprint |
|---|---|---|
| `schemaVersion` | exact literal | included |
| `projectId` | canonical Project ID, max 88 bytes | included |
| `snapshotFingerprint` | `sha256:` plus 64 lowercase hex | included |
| `ownerLocks` | closed object containing the bound run/checkpoint/memory/session revisions or nulls | included |
| `generatedAt` | ISO-8601 UTC timestamp | excluded |
| `result` | `resumable` or `not-resumable` | included |
| `payload` | exactly one arm below | included |
| `fingerprint` | digest of every included field after safe normalization | excluded from its own digest |

`ownerLocks` has exactly four required keys:

| Key | Required value |
|---|---|
| `workRun` | `{ workRunId, recordFingerprint }` or null |
| `checkpoints` | `{ setFingerprint }` or null |
| `memory` | `{ revision, fingerprint }` or null; revision is string, number, or null |
| `session` | `{ sessionId, revision, contentHash, recordFingerprint }` or null; revision is string, number, or null and contentHash is digest or null |

Every fingerprint uses the repository `sha256:<64 lowercase hex>` form. A missing owner serializes as null; it is never omitted.

`resumable` payload:

| Field | Required shape |
|---|---|
| `source` | `work-run` or `session` |
| `workItemId` | canonical Work Item ID |
| `workRunId` | canonical Work Run ID for `work-run`; otherwise null |
| `sessionId` | safe Session ID for `session`; otherwise null |
| `freshness` | `current` or `partial` |
| `taskState` | `{ state, label, blockedBy[], citationTargets[] }` |
| `reviewedDecisions` | max 32 `{ claimId, value, observedAt, citationTargets[] }`; value max 4096 canonical-JSON bytes |
| `checkpoints` | max 32 `{ checkpointId, stage, status, summary, recordedAt, citationTargets[] }` |
| `citations` | max 64 closed recovery-citation objects |
| `prerequisites` | max 16 `{ code, owner, state, remediation, citationTargets[] }`, state `satisfied|missing|stale` |
| `diagnostics` | max 32 closed recovery-diagnostic objects |
| `omitted` | `{ decisions, checkpoints, citations, diagnostics, bytes }`, non-negative integers |

`not-resumable` payload:

| Field | Required shape |
|---|---|
| `workItemId` | canonical Work Item ID or null |
| `requestedWorkRunId` | canonical Work Run ID or null |
| `sourceSessionId` | safe Session ID or null |
| `reasonCode` | `no_candidate`, `explicit_run_missing`, `explicit_run_terminal`, `explicit_run_expired`, `explicit_run_malformed`, `project_mismatch`, `work_item_mismatch`, `session_unavailable`, `owner_unavailable`, `unsafe_source`, or `context_too_large` |
| `citations` | max 64 closed recovery-citation objects |
| `diagnostics` | 1–32 closed recovery-diagnostic objects |
| `manualNextAction` | `{ actionId, label, owner, operation, citationTargets[] }`; operation is a canonical operation name or null |

IDs are 1–160 safe bytes under their existing canonical patterns. Session IDs are 1–128 `[A-Za-z0-9._-]` bytes. Labels are 1–200 UTF-8 bytes, summaries 0–1000, diagnostic messages/remediations 1–500, and Citation Targets 1–1024. Control characters and unsafe path/secret material are invalid.

### D7. Retrieval is a closed bounded schema over existing owners

`project.hub.search` normalizes the query with Unicode NFKC, trim, and internal-whitespace collapse. Normalized input must be 1–2048 UTF-8 bytes with no control characters. P0 excludes every other Project and creates no index.

`project-hub-search/v1` common fields are all required; nullable fields use JSON null and unknown fields are invalid:

| Field | Required shape | Fingerprint |
|---|---|---|
| `schemaVersion` | exact literal | included |
| `projectId` | canonical Project ID | included |
| `snapshotFingerprint` | S01 digest | included |
| `query` | normalized query | included |
| `limit` | integer `1..25` | included |
| `ownerLocks` | 1–5 `{ owner, revision, fingerprint, state }`; owner `work-os|project-memory|source-evidence|session-record|workflow`, revision string/number/null, state `current|stale|unavailable` | included |
| `generatedAt` | ISO-8601 UTC | excluded |
| `results` | max 25 closed results | included |
| `diagnostics` | max 32 closed recovery diagnostics | included |
| `omitted` | `{ results, diagnostics, bytes }` non-negative integers | included |
| `fingerprint` | digest of the normalized response | excluded from its own digest |

Each result has exactly:

| Field | Required shape |
|---|---|
| `itemId` | stable Knowledge Item identity, 1–160 bytes |
| `itemType` | `source_record|evidence|analysis|memory|issue|comment|kanban_card|asset|transcript` |
| `label` | 1–200 UTF-8 bytes |
| `projectId` | same canonical Project ID |
| `owner` | one owner enum from `ownerLocks` |
| `matchClass` | `exact-identity|exact-label|exact-phrase|all-tokens|partial-tokens` |
| `normalizedScore` | integer `0..1_000_000` |
| `freshness` | `current|stale|unknown|unavailable` |
| `confidence` | `source|derived|unknown` |
| `provenance` | 1–8 `{ kind, id, revision }`, revision string/number/null |
| `citationTargets` | 1–4 safe Citation Targets |

Result order is match class as listed, owner priority `work-os`, `project-memory`, `source-evidence`, `session-record`, `workflow`, freshness `current`, `stale`, `unknown`, `unavailable`, normalized score descending, then `itemId` ascending.

Each result is at most 4096 canonical-JSON bytes and the response at most 128 KiB. Results are appended in normative order until the count or byte cap; diagnostics follow severity/code order. Omitted counts are explicit and fingerprinted. Display time is excluded.

### D8. Candidates, plans, and apply are closed; create is TypeScript-governed

S01 remains unchanged. `project.hub.action-candidates.get` returns the discriminated `project-hub-action-candidates/v1`; all fields are required and unknown fields are invalid:

| Field | Required shape | Fingerprint |
|---|---|---|
| `schemaVersion` | exact literal | included |
| `projectId` | canonical Project ID | included |
| `snapshotFingerprint` | S01 digest | included |
| `contextFingerprint` | current context digest | included |
| `searchFingerprint` | current search digest | included |
| `generatedAt` | ISO-8601 UTC | excluded |
| `result` | `available|unavailable` | included |
| `candidates` | 1–3 closed candidates for available; empty for unavailable | included |
| `capabilityFacts` | 0–16 closed capability facts | included |
| `reasonCode` | null for available; `no_safe_action|capability_unavailable|blocked_work_item|context_unavailable|search_unavailable` for unavailable | included |
| `diagnostics` | 0–32 for available; 1–32 for unavailable | included |
| `manualNextAction` | null for available; D6 manual-action shape for unavailable | included |
| `fingerprint` | candidate-set digest, including the empty/unavailable arm | excluded from its own digest |

Capability facts have exactly `{ capabilityId, state, revision, fingerprint }`: ID is 1–160 safe bytes; state is `available|degraded|unavailable|disabled`; revision is string, number, or null; fingerprint is SHA-256 or null. Candidate `capabilities` uses the same shape but permits only `available|degraded`.

Each candidate has exactly `{ candidateId, kind, projectId, workItemId, workRunId, contextFingerprint, searchFingerprint, citationTargets, prerequisites, capabilities, recommended }`. `kind` is `resume|create`; `workRunId` is canonical for resume and null for create; citations/capabilities are max 16; prerequisites use D6; exactly one available candidate is recommended. Resume candidates reuse S01 `resume-work-run`. Create exists only with no resume candidate, session-sourced context, matching current unblocked S01 Work Item, and satisfied capabilities. IDs are `resume:<workRunId>` or `create:<64 lowercase hex digest>`. Missing capability, blocked work, or no safe context returns the unavailable arm instead of inventing an action.

`project.hub.action.plan` accepts exactly `{ candidateSetFingerprint, candidateId, agentSelection }`. `agentSelection` is `{ bindingId, bindingRevision }`; the server resolves that exact current Project Agent Binding and its Profile from Agent Domain, rejects Project/revision/capability mismatch, and binds the source revisions. The returned `project-hub-action-plan/v1` has every field required:

| Field | Required shape |
|---|---|
| `schemaVersion` | exact literal |
| `projectId` | canonical Project ID |
| `candidateSetFingerprint` / `candidateId` | exact selected current available candidate |
| `kind` | `resume|create` |
| `workItemId` / `workRunId` | canonical Work Item; Work Run canonical for resume and null for create |
| `agentSelection` | `{ role, bindingId, bindingRevision, profileId, profileRevision }`; role 1–128 safe bytes, IDs canonical, revisions positive integers |
| `snapshotFingerprint` / `contextFingerprint` / `searchFingerprint` | current upstream digests |
| `capabilityFacts` | max 16 closed capability facts, all `available|degraded` |
| `citationTargets` | 1–32 safe refs |
| `owningOperation` | exact `workflow.recovery.apply` |
| `createdAt` / `expiresAt` | ISO UTC; expiry exactly five minutes after creation using injected server clock |
| `leaseDurationMs` | exact `900000` for create and `0` for resume |
| `fingerprint` | digest of every field except itself |

Plans are not persisted. Apply receives the full plan:

| `recovery-apply-request/v1` field | Required shape |
|---|---|
| `schemaVersion` | exact literal |
| `plan` | full closed `project-hub-action-plan/v1` object |
| `planFingerprint` | presented digest equal to recomputed `plan.fingerprint` |
| `transitionToken` | 1–128 safe identifier bytes |

The authenticated actor comes from `OperationContext`, never caller JSON, and becomes the Work Run `agentId`; existing Workflow behavior records that authenticated actor as host when no separately authenticated host authority exists. The immutable plan binds only role and exact Binding/Profile revisions because those Agent Domain records do not own `agentId` or host.

Under the existing Workflow lock it atomically maintains two bindings:

- plan claim: `01-Projects/<slug>/runs/recovery-plans/<plan-fingerprint-hex>.json`;
- token index: `01-Projects/<slug>/runs/recovery-tokens/<token-digest>.json` containing the bound plan fingerprint.

The `recovery-apply/v1` plan claim contains:

| Claim field | Required shape |
|---|---|
| `schemaVersion` | exact literal |
| `tokenDigest` / `planFingerprint` | SHA-256 digests |
| `actorId` | authenticated actor, 1–160 safe bytes |
| `kind` | `resume|create` |
| `state` | `claimed|applied|outcome-unknown` |
| `workRunId` | canonical ID or null |
| `receipt` | closed receipt or null |
| `updatedAt` | ISO UTC, excluded only from receipt fingerprint |

The closed receipt contains `{ schemaVersion, tokenDigest, planFingerprint, state, projectId, workItemId, workRunId, ownerOperation, ownerReceiptFingerprint, diagnostics, recordedAt, fingerprint }`; state is `applied|outcome-unknown`, owner operation is `workflow.agent.join|workflow.recovery.apply:create`, and recordedAt is excluded from its fingerprint.

Apply ordering is normative:

1. Validate the closed request shape, recompute the presented plan fingerprint, authenticate the actor, and hash the transition token without checking plan expiry.
2. Under the Workflow lock, load the token index and plan claim. A token bound to other plan bytes or actor conflicts.
3. If the exact claim is `applied`, return its stored receipt even when the plan is now expired. If it is `outcome-unknown`, block replay. If it is `claimed`, recover or continue that already-authorized transition using the same frozen plan.
4. Only when no claim exists, check five-minute expiry, Binding/Profile revision, capabilities, every upstream lock, and lease prerequisites, then atomically create the claim and token index.

Claim recovery revalidates request/plan/token/actor binding and local Work Run/lease identity. It does not re-evaluate plan expiry or mutable upstream selection locks: successful claim creation is the durable authorization point after those facts passed. It reconciles the owner receipt and Work Run bytes before another owner call; an unprovable outcome becomes `outcome-unknown`.

Resume calls replay-safe `workflow.agent.join` with the authenticated actor as `agentId`, the plan's role/Binding/Profile locks, and the existing Work Run identity. Create does **not** call manual `workflow.agent.start`. The TypeScript create branch:

1. derives `work-run/recovery-<first 32 hex>` solely from Project ID, Work Item ID, and plan fingerprint;
2. under the Workflow lock, atomically creates or verifies the durable `leased` Work Run and matching machine-local lease with the authenticated actor and the plan's 15-minute duration;
3. calls `workflow.agent.join` with the deterministic ID, authenticated actor, plan role/Binding/Profile locks, upstream context fingerprint, and winning transition token;
4. persists the `applied` receipt atomically.

A token index bound to another plan conflicts. The first token to claim a plan wins. A second token for the same plan returns the stored receipt only when the plan claim is `applied`; while `claimed` or `outcome-unknown` it conflicts with reconciliation instructions. Thus concurrent two-token apply cannot create another Work Run. A same-token retry recovers the existing claim before any fresh expiry check. If neither owner receipt nor absence of mutation can be proven, persist `outcome-unknown`, block replay, and require `workflow.agent.doctor`. Fault-injection covers before owner mutation, after run/lease creation before join receipt, after receipt persistence before response, expiry after claim, and concurrent different-token apply of one plan.

### D9. Output governance is a closed, claimed completion protocol

`workflow.agent.leave` accepts the closed `work-run-output-submission/v1` with
exactly `{ schemaVersion, result, output, quarantine }`. `result` is
`output|quarantine`; the selected arm is non-null and the other arm is explicit
`null`.

The valid `output` arm is `work-run-output/v1`. Every field is required and
unknown fields are invalid:

| Field | Required shape |
|---|---|
| `schemaVersion` | exact `work-run-output/v1` |
| `outputId` | safe stable ID, 1–160 bytes |
| `projectId` / `workItemId` / `workRunId` | exact identities of the completing Work Run |
| `outputClass` | `view|work-state-transition|knowledge-claim|external-side-effect` |
| `payload` | JSON-safe value, max 64 KiB canonical JSON |
| `citationTargets` | max 32 safe refs; at least one for `knowledge-claim` |
| `provenance` | 1–32 safe logical refs |
| `producedAt` | ISO-8601 UTC, excluded from the fingerprint |
| `fingerprint` | digest of every other normalized field except `producedAt` |

The closed `quarantine` arm carries exactly `{ projectId, workItemId, workRunId,
observedClass, payloadFingerprint, provenance, diagnostics, producedAt,
fingerprint }`. Identities must match the authoritative Work Run;
`observedClass` is a safe string or null; the unsafe/malformed payload is never
persisted or echoed; `payloadFingerprint` is SHA-256 or null; provenance is
1–32 safe logical refs; diagnostics is 1–16 closed citation-safe diagnostics.
Quarantine always routes to `awaiting_review`.

The closed route receipt uses `work-run-output-route/v1` and contains exactly
`{ schemaVersion, outputFingerprint, tokenDigest, state, ownerOperation,
ownerReceiptFingerprint, diagnostics, recordedAt, fingerprint }`. `state` is
`accepted|review-required|denied|outcome-unknown`; owner fields are explicit
nullable values; `recordedAt` is excluded from its fingerprint.

Before any owner mutation, Workflow atomically maintains:

- output claim: `01-Projects/<slug>/runs/output-claims/<output-fingerprint-hex>.json`;
- token index: `01-Projects/<slug>/runs/output-tokens/<token-digest>.json`.

The claim is `work-run-output-claim/v1` with exactly `{ schemaVersion,
outputFingerprint, tokenDigest, actorId, workRunId, state, receipt, updatedAt }`;
state is `claimed|routed|outcome-unknown`. The leave transition token is the
replay key. First token wins; rebound output/token/actor conflicts. Same-token
retry loads the claim before another owner call, returns the routed receipt,
reconciles a claimed owner outcome, or blocks on outcome-unknown. Every owner
port is idempotent on output fingerprint and returns a durable receipt. Failure
before owner mutation, after owner mutation before route-receipt persistence,
and after receipt persistence before response are fault-injected. Unprovable
owner outcome persists `outcome-unknown`; it takes precedence over retry.

`workflow.agent.leave` is the single successful/review completion boundary.
`workflow.agent.step` may record `reflect` and `workflow.agent.checkpoint` may
record evidence, but neither may move a Work Run to `completed` or
`awaiting_review`; failed/cancelled paths remain available. Leaving as
`completed` or `awaiting_review` requires the submission, while failed/cancelled
leave does not. The cutover migrates every TypeScript caller/test and preserves
cross-runtime durable `output_class` and `approval_status` summary fields.

TypeScript owns routing and its receipt:

- `view`: artifact/receipt only; never Project or Knowledge truth.
- `work-state-transition`: one allowlisted Work-OS transition through an output-fingerprint-idempotent owner port.
- `knowledge-claim`: one cited Project Memory draft, or idempotent binding to an existing exact Project Memory proposal supplied by an existing owner flow such as Dream Time; never auto-promote.
- `external-side-effect`: exact per-run approval plus Operation Write Policy before an output-fingerprint-idempotent owner call.
- `quarantine`: review-required receipt with bounded diagnostics; no owner content mutation.

The production-unused Python `route_work_run_output` helper is removed when this
TypeScript protocol lands; Python Work Driver creation/transition records keep
their existing durable field shape.

### D10. Obsidian proves the journey before mutating and adapter surfaces

The primary recovery entry is the existing LLM Wiki/Ask Mate ItemView opened for
current Project Context. `control-plane-ui.ts` remains the advanced
administrative surface and does not become the day-to-day recovery journey. A
focused recovery client/panel owns only ephemeral UI selection and delegates all
semantics to shared operations.

Split the Obsidian delivery:

- **S06A recovery preview**, after S02/S03 and S04A read-only candidate/plan contracts: render current stage/work groups, freshness, diagnostics, citations, context, retrieval, additive action candidates, exact current Agent Binding selection, and immutable plan preview. Actual-Obsidian verification must prove this path is understandable before S04B mutation.
- **S06B action and receipt**, after S04B/S05: confirm `workflow.recovery.apply`, show claimed/applied/outcome-unknown state, display the owner receipt, and refresh the derived snapshot.

The plugin stores only ephemeral UI selection. All durable state remains in
owning domain records. Missing or stale inputs display remediation rather than
an empty success state. Keyboard order, focus retention, cancellation, and no
pre-confirmation write are acceptance requirements.

### D11. MCP and CLI follow verified Obsidian behavior

S07 starts only after S06B passes actual-Obsidian verification. MCP and CLI expose equivalent snapshot, context, search, candidate, plan, and apply semantics through the shared operations. Claim state is internal Workflow storage; adapters observe it only through the apply response/receipt and doctor remediation, not by reading claim files. Adapter-specific errors stay at the transport boundary. Contract parity tests run the same sanitized fixture and compare fingerprints, reason codes, citations, diagnostics, apply states, and receipts.

### D12. Delivery follows the Obsidian-first dependency graph

```text
S01 complete
  -> S02 resumable context + shared Workflow read model
       -> S03 cited retrieval
            -> S04A read-only candidates/plan
                 -> S06A Obsidian preview proof
                 -> S04B Workflow apply
                 -> S05 output governance
                 -> S06B Obsidian apply/receipt proof
                 -> S07 MCP/CLI parity
                 -> S08 acceptance
```

S03 depends on S02's shared Workflow read model so it can include Work Run
evidence without duplicating owner reads. No backend action mutation starts
until S06A proves the plan in the primary human surface. MCP/CLI parity never
defines the UX because S07 is gated on S06B.

## Data flow

```text
Project Hub open
  -> project.hub.get
  -> project-hub-recovery/v1 + snapshot fingerprint

User inspects recovery
  -> project.hub.resume-context.get(snapshot fingerprint)
  -> project.hub.search(snapshot fingerprint, query)
  -> project.hub.action-candidates.get(snapshot/context/search fingerprints)
  -> bounded context + cited results + additive candidates + fingerprints

User selects next action
  -> project.hub.action.plan(candidate-set fingerprint, candidate ID, exact Agent Binding revision)
  -> immutable plan preview

User confirms
  -> workflow.recovery.apply(full plan, presented fingerprint, transition token)
  -> recompute plan fingerprint + owner locks + authenticated actor binding
  -> recovery transition claim
  -> existing Workflow join (resume) or TypeScript governed create + join
  -> Work Run receipt or explicit outcome-unknown reconciliation
  -> output classification + owning policy
  -> refreshed project.hub.get
```

## Failure policy

| Failure | Required behavior |
|---|---|
| S01-projected action fact changed | Reject with `snapshot_stale`; return recomposition action. |
| Context/search owner changed outside S01 | Reject the affected downstream fingerprint; do not overclaim S01 staleness. |
| Work Run missing, terminal, expired, or identity-mismatched | Return `not-resumable`; never select another run silently when one was explicitly requested. |
| Session missing or private payload only | Return bounded metadata diagnostics and a manual action; never return raw evidence. |
| Memory claim unreviewed, stale, superseded, or unresolved | Exclude it from decisions and include a citation-safe diagnostic. |
| Citation cannot resolve | Mark unavailable/unknown; do not present the claim as corroborated evidence. |
| Search owner unavailable | Return partial results plus owner diagnostic; never convert partial to current. |
| Capability missing | Block plan/apply and provide the owning Settings/Capability remediation. |
| Transition token bound to another plan | Conflict before owner mutation. |
| Apply claim is `applied` | Return the exact stored receipt. |
| Apply claim outcome cannot be proven | Persist `outcome-unknown`, block automatic replay, and require doctor reconciliation. |
| Output malformed or unknown class | Route to review; do not promote or discard. |
| Adapter failure | Format at adapter boundary without stacks, secrets, transcript text, or absolute paths. |

## Security and privacy

One shared safe-normalization contract inspects both keys and string values.

- Unsafe caller-supplied contract fields are rejected with a stable code and the matched material is never echoed.
- Unsafe owner payload fields are omitted, a stable citation-safe diagnostic is added, and the remainder may continue only when the omitted field is not an identity or mandatory safety fact.
- Identity or mandatory safety fields containing unsafe material make the result unavailable/not-resumable.
- Fingerprints are computed only after normalization over the safe result.
- Detection covers credential/cookie/token/secret/password/authorization/environment semantics, common token shapes, raw prompt/transcript markers, Windows/POSIX/UNC/home-relative paths, and control characters even when stored under a benign key.

Fixtures contain synthetic canaries under both suspicious and benign keys. Domain, Obsidian client, MCP, CLI, claims, receipts, diagnostics, and errors must not serialize a canary or matched material. Error `cause` values remain internal.

## Verification strategy

Each slice adds observable contract tests before its implementation is accepted:

- contract validation, canonical JSON, fingerprint stability, and rejection cases;
- deterministic selection, ordering, truncation, and freshness behavior;
- exact owner-lock invalidation;
- stale candidate/plan and identity-conflict rejection;
- transition-claim crash windows, replay, outcome-unknown reconciliation, and no-duplicate Work Run assertions;
- reviewed-only memory and value-based secret/transcript/path exclusion;
- actual-Obsidian keyboard/focus and visible degraded-state behavior;
- MCP/CLI/domain fingerprint parity after Obsidian proof;
- one sanitized end-to-end fixture covering normal, interrupted, stale, missing-capability, expired-run, malformed-output, replay, and remediation paths.

The 60-second metric uses a previously active sanitized Project with Obsidian and the vault already loaded. After one unmeasured familiarization run, record three runs. Start at invocation of the Open Project Hub command; stop when the user selects a cited next action and its immutable plan preview is visible. No raw issue, transcript, or code file may be opened during a run. All three runs must be under 60 seconds. T9.3 records raw start/stop timestamps and duration; T9.4 fails S08 if any run misses the threshold.

## Luna delegation gate

Luna receives one reviewed leaf task at a time. Every delegation contract includes:

- exact Work-OS issue and OpenSpec task/scenario IDs;
- allowed files and explicit non-goals;
- authoritative snapshot/commit identity;
- expected operation and schema names;
- required tests and rejection cases;
- no push, merge, external mutation, compatibility shim, or scope expansion;
- escalation on any contract conflict instead of guessing.

The controller reviews Luna's diff, checks every changed exported symbol and caller, runs the slice-specific tests, and records evidence in the owning Work-OS issue before the next dependency is unblocked.