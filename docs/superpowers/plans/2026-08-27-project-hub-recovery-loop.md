# Project Hub Recovery Flow v2 Implementation Plan

> **For agentic workers:** Implement one reviewed Task at a time. Luna may change internal implementation shape, add/split focused files, extract helpers, adjust focused tests, and create a local Task commit. It must stop before changing approved public contracts, authority, dependency edges, write policy, privacy/security, crash invariants, or observable behavior. Luna never pushes, merges, or performs external mutation. The controller reviews, runs full verification, aligns this file map, and accepts or rewrites the commit.

**Goal:** Replace `project-hub-recovery/v1` with a stateless staged Recovery Flow v2 and complete the Obsidian-first journey from current Project facts through cited search and immutable Plan preview to claim-safe Workflow apply and governed output.

**Architecture:** `project.hub.recovery.flow` is one read-only, stateless Operation with closed actions `open|search|plan|refresh-plan|restart` and stages `open|searched|needs-agent-selection|planned|stale|unavailable`. Every later action repeats the minimum inputs needed to recompute its prerequisite and validates a chained Flow Fingerprint plus exact owner locks. The complete read path is built internally through S01B–S04A; S04A registers it and clean-removes V1. Apply/output mutation remains Workflow-owned.

**Tech Stack:** TypeScript 7, Node.js 20+, Bun tests, existing Operation/Application Runtime, existing Agent Domain and Settings packages, Obsidian ItemView API, Markdown Work-OS, existing Python Work Driver compatibility tests, canonical JSON and SHA-256.

**Spec:** `openspec/changes/project-hub-recovery-loop/`

**ADR:** `docs/adr/0001-project-hub-recovery-flow-v2.md`

## Global Constraints

- S01 v1 remains completed history. V1 production code stays byte-stable until Task 9 clean-cuts to V2.
- No public partial V2 Operation is registered before open, search, candidate, Binding, and Plan stages are complete.
- `project.hub.get` remains ordinary Hub composition and loses its old `recovery` field at cutover.
- Every `project.hub.*` Operation is read-only. Flow ends at immutable Plan; apply is `workflow.recovery.apply`.
- No server-side Flow session/cache and no plugin-persisted query, results, selection, Binding, Flow fingerprint, or Plan.
- Search is mandatory, Project-scoped, repeatable, and bound to the Plan branch actually used.
- Automatic planning uses only a server-generated closed recommended request and exactly one compatible current Binding. Multiple Bindings require selection.
- Candidate override and Plan refresh submit the complete prior Plan and always produce a new Plan/Flow fingerprint.
- Expired Plans require explicit refresh. No adapter silently replaces a displayed or confirmed Plan.
- Plan binds role and Binding/Profile revisions, not runtime agent ID/host. Authenticated apply actor becomes Work Run identity.
- Existing apply claims recover before fresh Plan expiry checks; only a new claim checks current expiry/locks.
- `workflow.agent.leave` is the only `completed|awaiting_review` boundary and claims output before owner mutation.
- Project ID is durable identity; machine-local paths, raw transcripts, credentials, tokens, and unsafe values never enter shared contracts.
- Unknown fields reject; every nullable field is explicit; collections/strings/bytes follow OpenSpec bounds.
- Generated bundles and private vault contents remain untracked.

---

## Verified Source Baseline

| Concern | Current source fact | Plan consequence |
|---|---|---|
| V1 implementation | `mcp-server/src/project-hub/recovery.ts` owns V1 types/composer/validator; `project/project-hub.ts` embeds it; `project-hub.test.ts` is the only code consumer found. | Keep V1 byte-stable through Tasks 1–8; Task 9 migrates the exact caller set and deletes V1 in one commit. |
| Recovery helpers | Canonicalization/fingerprint/safe-ref helpers are private in `recovery.ts`. | Extract shared support first and prove V1 bytes unchanged before building V2. |
| Workflow authority | `workflow.ts` owns private run/lease/lock/lifetime/event behavior. Checkpoint summaries/evidence live in agent event Markdown, not only run transitions. | Extract store and read-model seams before open/context and apply. |
| Search | Generic `unified-query.ts` receives adapter results but has no canonical Project/owner-lock contract. | Build a Project owner-source composer; do not make RRF an authority or add an index. |
| Agent selection | Agent Domain Binding/Profile owns role, revisions, enabled state and capability claims; it owns no runtime agent ID/host. | V2 Plan binds only owner facts; apply binds authenticated actor. |
| Primary UI | `main.ts` opens Ask Mate ItemView for current Project Context; `control-plane-ui.ts` explicitly serves advanced administration. | Add a focused Recovery Flow panel under Ask Mate Project context. |
| Workflow factory callers | Core operations, Agent Domain, Workflow tests, two Project characterization/E2E tests, and `scripts/verify_fleet_workflow.ts` call `makeWorkflowOps`. | Any Workflow dependency change migrates this frozen inventory and its tests. |
| Output completion | step/checkpoint can currently enter terminal/review states; Agent Domain, Project E2E, Workflow tests and Fleet verifier exercise those paths. Python has one production-unused output router. | Task 13 migrates every successful/review caller to claimed leave and removes only the obsolete Python router. |
| CLI | Existing CLIs use shared Operation handlers through `createOperationDispatcher`. | Dedicated CLI maps Flow actions and Workflow apply; it never reads claim files or reimplements stages. |

If any baseline row differs at Task start, Luna stops. The controller updates this plan before accepting implementation.

---

## File and Module Map

```text
mcp-server/src/project-hub/
  contract-support.ts          canonical JSON, safety, bounds, SHA-256
  recovery-flow.ts             V2 request/response/stage reducer and validation
  recovery-open.ts             V2 open payload and bounded context
  search-source.ts             Project owner reads and owner locks
  search.ts                    safe deterministic cited search
  action-candidates.ts         resume/create candidates and Binding eligibility
  agent-selection.ts           current Binding/Profile owner adapter
  action-plan.ts               immutable Plan and stateless prerequisite recomputation
  cli.ts                       dedicated Flow/apply CLI
  *.test.ts                    contract, composition, parity and end-to-end tests

mcp-server/src/workflow/
  work-run-store.ts            durable runs/leases, apply/output claims, atomic writes
  workflow-read-model.ts       bounded Work Run/checkpoint reads
  recovery-apply.ts            V2 claim-first resume/create apply
  output-governance.ts         claimed output submission/quarantine routing
  workflow.ts                  Operation registration and agent lifecycle

obsidian-plugin/src/project-hub/
  recovery-client.ts           stateless typed Flow/apply client
  recovery-panel.ts            ephemeral staged Flow controller and renderer
```

---

### Task 1: Extract shared closed-contract support

**Work-OS:** S01B

**Files:**
- Create: `mcp-server/src/project-hub/contract-support.ts`
- Create: `mcp-server/src/project-hub/contract-support.test.ts`
- Modify: `mcp-server/src/project-hub/recovery.ts`
- Modify: `mcp-server/src/project-hub/index.ts`
- Modify: `mcp-server/src/project/project-hub.test.ts`

**Interfaces:**

```ts
export type RecoveryFingerprint = `sha256:${string}`;
export interface RecoveryTextBounds { minBytes: number; maxBytes: number; }
export function canonicalRecoveryJson(value: unknown): string;
export function fingerprintRecoveryValue(value: unknown): RecoveryFingerprint;
export function utf8JsonBytes(value: unknown): number;
export function assertClosedRecoveryObject(
  value: unknown,
  requiredKeys: readonly string[],
  label: string,
): Record<string, unknown>;
export function safeRecoveryText(
  value: unknown,
  label: string,
  bounds: RecoveryTextBounds,
): string;
export function hasUnsafeRecoveryMaterial(value: unknown): boolean;
```

- [ ] **Step 1:** Write failing tests for canonical key ordering, array-order preservation, lowercase SHA-256, UTF-8 bytes, unknown-field rejection, controls, credentials, prompt/transcript markers, and Windows/POSIX/UNC/home-relative paths under suspicious and benign keys.
- [ ] **Step 2:** Run `npm exec bun -- test src/project-hub/contract-support.test.ts`; confirm only the missing module fails.
- [ ] **Step 3:** Extract reusable canonicalization/fingerprint behavior from V1 and add value-based safety/bounds without changing any V1 public type or output.
- [ ] **Step 4:** Update V1 to consume shared helpers and prove canonical V1 bytes/fingerprint remain identical on its fixture.
- [ ] **Step 5:** Run `npm exec bun -- test src/project-hub/contract-support.test.ts src/project/project-hub.test.ts` and `npm run typecheck`.
- [ ] **Step 6:** Create local commit `refactor: share recovery contract support`.

---

### Task 2: Define the complete internal Recovery Flow v2 kernel

**Work-OS:** S01B

**Files:**
- Create: `mcp-server/src/project-hub/recovery-flow.ts`
- Create: `mcp-server/src/project-hub/recovery-flow.test.ts`
- Modify: `mcp-server/src/project-hub/index.ts`

**Interfaces:**

```ts
export const RECOVERY_FLOW_REQUEST_SCHEMA_VERSION = "project-hub-recovery-flow-request/v2" as const;
export const RECOVERY_FLOW_SCHEMA_VERSION = "project-hub-recovery-flow/v2" as const;
export type RecoveryFlowAction = "open" | "search" | "plan" | "refresh-plan" | "restart";
export type RecoveryFlowStage =
  | "open" | "searched" | "needs-agent-selection"
  | "planned" | "stale" | "unavailable";
export type RecoveryOwner =
  | "project" | "work-os" | "workflow" | "project-memory"
  | "session-record" | "source-evidence" | "agent-domain" | "settings";
export interface RecoveryOwnerLock {
  owner: RecoveryOwner;
  revision: string | number | null;
  fingerprint: RecoveryFingerprint | null;
  state: "current" | "stale" | "unavailable";
}
export type RecoveryFlowRequestV2 =
  | RecoveryOpenRequestV2
  | RecoverySearchRequestV2
  | RecoveryPlanFromSearchRequestV2
  | RecoveryPlanOverrideRequestV2
  | RecoveryRefreshPlanRequestV2
  | RecoveryRestartRequestV2;
export interface RecoveryStaleProofV2 {
  schemaVersion: "project-hub-recovery-stale-proof/v2";
  projectId: string;
  rootOpenFlowFingerprint: RecoveryFingerprint;
  priorFlowFingerprint: RecoveryFingerprint;
  priorActionInputFingerprint: RecoveryFingerprint;
  recoveryFingerprint: RecoveryFingerprint;
  changedOwners: RecoveryOwner[];
  citationTargets: string[];
  fingerprint: RecoveryFingerprint;
}
export interface RecoveryFlowResponseBaseV2<
  S extends RecoveryFlowStage,
  P,
  I,
  R extends RecoveryFlowRequestV2,
> {
  schemaVersion: typeof RECOVERY_FLOW_SCHEMA_VERSION;
  stage: S;
  projectId: string;
  previousFlowFingerprint: RecoveryFingerprint | null;
  recoveryFingerprint: RecoveryFingerprint;
  ownerLocks: RecoveryOwnerLock[];
  payload: P;
  nextRequestIntents: I[];
  diagnostics: RecoveryFlowDiagnosticV2[];
  omitted: { items: number; citations: number; diagnostics: number; bytes: number };
  rootOpenFlowFingerprint: RecoveryFingerprint;
  nextRequests: R[];
  generatedAt: string;
  flowFingerprint: RecoveryFingerprint;
}
export type RecoveryFlowResponseV2 =
  | RecoveryOpenResponseV2
  | RecoverySearchedResponseV2
  | RecoveryNeedsAgentSelectionResponseV2
  | RecoveryPlannedResponseV2
  | RecoveryStaleResponseV2
  | RecoveryUnavailableResponseV2;
export function validateRecoveryFlowRequestV2(value: unknown): RecoveryFlowRequestV2;
export function validateRecoveryFlowResponseV2(value: unknown): RecoveryFlowResponseV2;
export function fingerprintRecoveryFlowIntrinsicStage(
  input: RecoveryFlowIntrinsicProjectionV2,
): RecoveryFingerprint;
export function deriveRecoveryFlowRequests(
  response: RecoveryFlowResponseV2,
): RecoveryFlowRequestV2[];
```

- [ ] **Step 1:** Write closed request tests for all five actions, both `plan` modes, exact searched-basis/planned fingerprint nullability, complete prior Plan requirements, finite stale proof, canonical Project ID, query/limit bounds, and unknown fields.
- [ ] **Step 2:** Write response tests for six literal-stage interfaces and reject every cross-stage payload/intent/request arm; cover owner-lock order, current-stage-only payload, diagnostics, omissions, and generated-time exclusion.
- [ ] **Step 3:** Implement non-self-referential two-phase construction: hash intrinsic stage data plus fingerprint-free next-request intents; then assign root-open convenience data and derive requests containing the computed current fingerprint.
- [ ] **Step 4:** Prove open root equals the intrinsic Flow fingerprint without participating in its hash; prove stale proof/restart JSON is finite; validate every derived request against its intent.
- [ ] **Step 5:** Implement pure validators/reducer transitions only; do not read files, register an Operation, or return unsupported-stage stubs.
- [ ] **Step 6:** Run `npm exec bun -- test src/project-hub/contract-support.test.ts src/project-hub/recovery-flow.test.ts` and `npm run typecheck`.
- [ ] **Step 7:** Record S01B contract evidence and create local commit `feat: define Recovery Flow v2 contract kernel`.

---

### Task 3: Extract the Workflow Work Run store

**Work-OS:** S02

**Files:**
- Create: `mcp-server/src/workflow/work-run-store.ts`
- Create: `mcp-server/src/workflow/work-run-store.test.ts`
- Modify: `mcp-server/src/workflow/workflow.ts`
- Modify: `mcp-server/src/workflow/workflow.test.ts`

**Interfaces:**

```ts
export interface WorkRunStore {
  withLock<T>(action: () => T): T;
  readRun(projectSlug: string, workRunId: string): Record<string, unknown> | null;
  writeRunAtomic(projectSlug: string, workRunId: string, value: Record<string, unknown>): void;
  readLocalLease(workRunId: string): Record<string, unknown> | null;
  writeLocalLeaseAtomic(agentId: string, value: Record<string, unknown>): void;
  readRecoveryClaim(projectSlug: string, planFingerprint: RecoveryFingerprint): Record<string, unknown> | null;
  writeRecoveryClaimAtomic(projectSlug: string, planFingerprint: RecoveryFingerprint, value: Record<string, unknown>): void;
  readRecoveryToken(projectSlug: string, tokenDigest: RecoveryFingerprint): Record<string, unknown> | null;
  writeRecoveryTokenAtomic(projectSlug: string, tokenDigest: RecoveryFingerprint, value: Record<string, unknown>): void;
  readOutputClaim(projectSlug: string, outputFingerprint: RecoveryFingerprint): Record<string, unknown> | null;
  writeOutputClaimAtomic(projectSlug: string, outputFingerprint: RecoveryFingerprint, value: Record<string, unknown>): void;
  readOutputToken(projectSlug: string, tokenDigest: RecoveryFingerprint): Record<string, unknown> | null;
  writeOutputTokenAtomic(projectSlug: string, tokenDigest: RecoveryFingerprint, value: Record<string, unknown>): void;
}
export function createFileWorkRunStore(vaultPath: string): WorkRunStore;
```

- [ ] **Step 1:** Characterize current lock acquisition, stale-lock conflict/manual remediation, run/lease paths, atomic replacement, rollback and byte-identical replay. Do not add automatic stale-lock recovery.
- [ ] **Step 2:** Extract those primitives without changing Workflow operation names, params, returned fields, durable JSON, lifetime Markdown, or event logs.
- [ ] **Step 3:** Migrate start/join/step/checkpoint/leave/doctor to the store and delete private duplicates.
- [ ] **Step 4:** Run `npm exec bun -- test src/workflow/work-run-store.test.ts src/workflow/workflow.test.ts` and `npm run typecheck`.
- [ ] **Step 5:** Create local commit `refactor: extract Workflow Work Run store`.

---

### Task 4: Add the bounded Workflow read model

**Work-OS:** S02

**Files:**
- Create: `mcp-server/src/workflow/workflow-read-model.ts`
- Create: `mcp-server/src/workflow/workflow-read-model.test.ts`
- Modify: `mcp-server/src/workflow/workflow.ts`

**Interfaces:**

```ts
export interface WorkflowRunRead {
  projectId: string;
  workItemId: string;
  workRunId: string;
  agentId: string;
  state: string;
  observedAt: string;
  leaseExpiresAt: string | null;
  recordFingerprint: RecoveryFingerprint;
  malformed: boolean;
}
export interface WorkflowCheckpointRead {
  checkpointId: string;
  stage: string;
  status: string;
  summary: string;
  recordedAt: string;
  citationTargets: string[];
}
export interface WorkflowReadModel {
  readRun(projectId: string, workRunId: string): WorkflowRunRead | null;
  listRuns(projectId: string): WorkflowRunRead[];
  listCheckpoints(projectId: string, workRunId: string): WorkflowCheckpointRead[];
  checkpointSetFingerprint(projectId: string, workRunId: string): RecoveryFingerprint;
}
```

- [ ] **Step 1:** Add active, terminal, expired, malformed, Project-mismatch, Work-Item-mismatch, and multi-checkpoint fixtures.
- [ ] **Step 2:** Read durable run JSON plus the matching agent lifetime/event logs; derive stable checkpoint IDs from event identity, not array index.
- [ ] **Step 3:** Sort runs by observed time descending then ID; retain newest 32 checkpoints then return them chronologically.
- [ ] **Step 4:** Prove reads create no files and exclude transition/lease tokens, prompts, transcript bodies and absolute paths.
- [ ] **Step 5:** Run `npm exec bun -- test src/workflow/workflow-read-model.test.ts src/workflow/workflow.test.ts` and `npm run typecheck`.
- [ ] **Step 6:** Create local commit `feat: add Workflow recovery read model`.

---

### Task 5: Compose the V2 open stage and bounded context

**Work-OS:** S02

**Files:**
- Create: `mcp-server/src/project-hub/recovery-open.ts`
- Create: `mcp-server/src/project-hub/recovery-open.test.ts`
- Modify: `mcp-server/src/project-hub/index.ts`
- Modify: `mcp-server/src/project/project-hub.test.ts`

**Interfaces:**

```ts
export interface RecoveryOpenOwners {
  workflow: WorkflowReadModel;
  loadWorkItems(projectId: string): RecoveryWorkItemRead[];
  loadProjectMemory(projectId: string): Promise<RecoveryMemoryRead>;
  listSessions(projectId: string): Promise<RecoverySessionRead[]>;
  loadCapabilities(projectId: string): Promise<RecoveryCapabilityRead[]>;
}
export function composeRecoveryOpenStage(
  projectId: string,
  owners: RecoveryOpenOwners,
  generatedAt: string,
): Promise<RecoveryFlowResponseV2 & { stage: "open" | "unavailable" }>;
```

- [ ] **Step 1:** Add V1-to-V2 equivalence tests for Project ID, current stage, four work groups, freshness, diagnostics, citations, safe next-action facts, and action-relevant recovery fingerprint.
- [ ] **Step 2:** Implement Work Run then Session fallback selection using authoritative owner records; invalid explicit selection does not exist at open.
- [ ] **Step 3:** Allocate mandatory envelope/task/prerequisite/security data first, then reviewed decisions/checkpoints/citations/diagnostics under 32/32/64/32 and 64-KiB bounds.
- [ ] **Step 4:** Add capability summary, 1–3 safe suggested queries derived from current Work Item/blocker labels, ordered owner locks, omissions and open Flow fingerprint. Add no candidates or Plan.
- [ ] **Step 5:** Test unsafe identity, unavailable owner, oversized mandatory data, optional truncation, reviewed-only memory, canaries and no writes.
- [ ] **Step 6:** Run `npm exec bun -- test src/project-hub/recovery-flow.test.ts src/project-hub/recovery-open.test.ts src/project/project-hub.test.ts src/workflow/workflow-read-model.test.ts src/project/agent-room-legacy-characterization.test.ts` and `npm run typecheck`.
- [ ] **Step 7:** Record S02 evidence and create local commit `feat: compose Recovery Flow open context`.

---

### Task 6: Implement mandatory repeatable Project search

**Work-OS:** S03

**Files:**
- Create: `mcp-server/src/project-hub/search-source.ts`
- Create: `mcp-server/src/project-hub/search-source.test.ts`
- Create: `mcp-server/src/project-hub/search.ts`
- Create: `mcp-server/src/project-hub/search.test.ts`
- Modify: `mcp-server/src/project-hub/index.ts`

**Interfaces:**

```ts
export type ProjectSearchOwner =
  | "work-os" | "project-memory" | "source-evidence" | "session-record" | "workflow";
export interface ProjectOwnerSnapshot {
  owner: ProjectSearchOwner;
  revision: string | number | null;
  fingerprint: RecoveryFingerprint | null;
  state: "current" | "stale" | "unavailable";
  items: ProjectOwnerSearchItem[];
  diagnostics: RecoveryFlowDiagnosticV2[];
}
export interface ProjectSearchSource {
  snapshot(projectId: string): Promise<ProjectOwnerSnapshot[]>;
}
export function composeRecoverySearchBasis(input: {
  request: RecoverySearchRequestV2;
  currentOpen: RecoveryOpenResponseV2;
  owners: ProjectOwnerSnapshot[];
}): RecoverySearchedBasisV2;
```

- [ ] **Step 1:** Characterize canonical Project roots and prove cross-Project records are excluded before normalization.
- [ ] **Step 2:** Implement direct owner snapshots; do not change generic `unified-query.ts` or add an index.
- [ ] **Step 3:** Implement NFKC/trim/whitespace normalization, 1–2048-byte safety, match classes, owner/freshness/score/ID ordering, result/provenance/citation/item/response bounds, diagnostics and omissions.
- [ ] **Step 4:** Recompute current open from minimal inputs and return stale on mismatch; branch repeated queries independently from the same open Flow.
- [ ] **Step 5:** Produce an internal searched basis for Task 7; do not register a public partial Flow Operation.
- [ ] **Step 6:** Run `npm exec bun -- test src/project-hub/recovery-open.test.ts src/project-hub/search-source.test.ts src/project-hub/search.test.ts src/workflow/workflow-read-model.test.ts` and `npm run typecheck`.
- [ ] **Step 7:** Record S03 evidence and create local commit `feat: add Recovery Flow cited search`.

---

### Task 7: Add candidates and exact Binding eligibility

**Work-OS:** S04A

**Files:**
- Create: `mcp-server/src/project-hub/action-candidates.ts`
- Create: `mcp-server/src/project-hub/action-candidates.test.ts`
- Create: `mcp-server/src/project-hub/agent-selection.ts`
- Create: `mcp-server/src/project-hub/agent-selection.test.ts`
- Modify: `mcp-server/src/project-hub/index.ts`

**Interfaces:**

```ts
export interface RecoveryAgentSelectionSource {
  listCompatible(projectId: string, capabilities: RecoveryCapabilityFactV2[]): Promise<Array<{
    role: string;
    bindingId: string;
    bindingRevision: number;
    profileId: string;
    profileRevision: number;
  }>>;
}
export function composeRecoveryCandidates(input: {
  open: RecoveryFlowResponseV2;
  search: RecoverySearchResultV2;
  compatibleBindings: Awaited<ReturnType<RecoveryAgentSelectionSource["listCompatible"]>>;
}): RecoveryCandidateStageV2;
```

- [ ] **Step 1:** Add closed candidate tests for resume identity reuse, governed Session create, max-three bounds, exactly one recommended candidate, unavailable reasons and fingerprints.
- [ ] **Step 2:** Read exact current Binding/Profile revisions through Agent Domain; reject disabled, missing, stale Project-context, wrong-Project, Profile-stale and capability-mismatch records.
- [ ] **Step 3:** Return unavailable for zero compatible Bindings; needs-agent-selection with every Binding for 2–16; unavailable `binding_selection_too_large` with remediation for 17+; searched with one fingerprint-free plan intent for exactly one Binding.
- [ ] **Step 4:** After searched intrinsic fingerprint computation, derive the exact recommended request from that intent with open/searched fingerprints, normalized query/limit, candidate, Binding revision, `plannedFlowFingerprint:null`, and `priorPlan:null`; adapters invent no field.
- [ ] **Step 5:** Run `npm exec bun -- test src/project-hub/action-candidates.test.ts src/project-hub/agent-selection.test.ts src/project-hub/search.test.ts` and `npm run typecheck`.
- [ ] **Step 6:** Create local commit `feat: add Recovery Flow candidate eligibility`.

---

### Task 8: Add immutable Plans and stateless prerequisite recomputation

**Work-OS:** S04A

**Files:**
- Create: `mcp-server/src/project-hub/action-plan.ts`
- Create: `mcp-server/src/project-hub/action-plan.test.ts`
- Modify: `mcp-server/src/project-hub/recovery-flow.ts`
- Modify: `mcp-server/src/project-hub/recovery-flow.test.ts`
- Modify: `mcp-server/src/project-hub/index.ts`

**Interfaces:**

```ts
export const RECOVERY_PLAN_SCHEMA_VERSION = "project-hub-recovery-plan/v2" as const;
export interface ProjectHubRecoveryPlanV2 {
  schemaVersion: typeof RECOVERY_PLAN_SCHEMA_VERSION;
  projectId: string;
  rootOpenFlowFingerprint: RecoveryFingerprint;
  searchedBasisFlowFingerprint: RecoveryFingerprint;
  recoveryFingerprint: RecoveryFingerprint;
  searchInputFingerprint: RecoveryFingerprint;
  searchFingerprint: RecoveryFingerprint;
  candidateSetFingerprint: RecoveryFingerprint;
  candidateId: string;
  kind: "resume" | "create";
  workItemId: string;
  workRunId: string | null;
  agentSelection: { role: string; bindingId: string; bindingRevision: number; profileId: string; profileRevision: number };
  ownerLocks: RecoveryOwnerLock[];
  capabilityFacts: RecoveryCapabilityFactV2[];
  citationTargets: string[];
  owningOperation: "workflow.recovery.apply";
  createdAt: string;
  expiresAt: string;
  leaseDurationMs: 0 | 900000;
  fingerprint: RecoveryFingerprint;
}
export async function composeRecoveryPlannedStage(
  request:
    | RecoveryPlanFromSearchRequestV2
    | RecoveryPlanOverrideRequestV2
    | RecoveryRefreshPlanRequestV2,
  dependencies: RecoveryPlanDependencies,
): Promise<RecoveryPlannedResponseV2 | RecoveryStaleResponseV2 | RecoveryUnavailableResponseV2>;
```

- [ ] **Step 1:** Write Plan validation tests for exact fields/nulls, role+Binding/Profile without agent ID/host, locks, citations, five-minute expiry, lease duration and fingerprint.
- [ ] **Step 2:** For `plan/from-search`, require `plannedFlowFingerprint:null` and `priorPlan:null`, repeat query/limit/candidate/Binding inputs, recompute open→search→candidates, and verify `searchedBasisFlowFingerprint`.
- [ ] **Step 3:** For `plan/override`, require both immediate `plannedFlowFingerprint` and underlying `searchedBasisFlowFingerprint`, validate the complete prior Plan/response, recompute search basis, then generate a replacement candidate Plan/fingerprint.
- [ ] **Step 4:** For refresh-plan, require immediate planned and searched-basis fingerprints plus complete expired/current prior Plan, recompute every owner, and emit a new Plan only through explicit action.
- [ ] **Step 5:** Return stale with finite stale proof and a restart request derived only after Flow fingerprint computation; never substitute another query, candidate, Binding or Plan.
- [ ] **Step 6:** Keep normalized query out of persisted Plan; bind `searchInputFingerprint`, search fingerprint and safe citations. Task 12 receives the safe query/limit ephemerally to prove new-claim basis.
- [ ] **Step 7:** Run `npm exec bun -- test src/project-hub/recovery-flow.test.ts src/project-hub/search.test.ts src/project-hub/action-candidates.test.ts src/project-hub/agent-selection.test.ts src/project-hub/action-plan.test.ts` and `npm run typecheck`.
- [ ] **Step 8:** Create local commit `feat: add immutable Recovery Flow plans`.

---

### Task 9: Register complete Flow and clean-cut V1

**Work-OS:** S04A

**Files:**
- Modify: `mcp-server/src/project/project-hub.ts`
- Modify: `mcp-server/src/project/project-hub.test.ts`
- Modify: `mcp-server/src/project/agent-room-legacy-characterization.test.ts`
- Modify: `mcp-server/src/core/operations.ts`
- Modify: `mcp-server/src/project-hub/index.ts`
- Delete: `mcp-server/src/project-hub/recovery.ts`
- Modify: generated operation reference inputs/tests affected by the new Operation catalog

**Interfaces:**

```ts
export interface ProjectHubRecoveryFlowOptions {
  now?: () => number;
  openOwners?: RecoveryOpenOwners;
  searchSource?: ProjectSearchSource;
  agentSelection?: RecoveryAgentSelectionSource;
}
export function makeProjectHubOps(
  registry: AdapterRegistry,
  settingsService?: SettingsService,
  options?: ProjectHubOperationsOptions & { recoveryFlow?: ProjectHubRecoveryFlowOptions },
): Operation[];
```

- [ ] **Step 1:** Add failing Operation tests for every Flow action/stage, `mutating:false`, closed params, stale recomputation, repeated searches, recommended request, needs selection, candidate override and explicit refresh.
- [ ] **Step 2:** Register one complete `project.hub.recovery.flow` Operation that delegates to Tasks 5–8. No stage semantics live in adapter wiring.
- [ ] **Step 3:** Remove `recovery` from `project.hub.get`; migrate exact repository callers and characterization tests to `open` Flow.
- [ ] **Step 4:** Run V1-to-V2 equivalence fixture assertions, then delete V1 types/composer/validator/export/test assertions and `recovery.ts`. Do not leave aliases or dual output.
- [ ] **Step 5:** Search code/docs for V1 schema/type/validator and `project.hub.get.recovery`; allow only historical Work-OS/ADR/migration prose.
- [ ] **Step 6:** Run `npm exec bun -- test src/project-hub/contract-support.test.ts src/project-hub/recovery-flow.test.ts src/project-hub/recovery-open.test.ts src/project-hub/search-source.test.ts src/project-hub/search.test.ts src/project-hub/action-candidates.test.ts src/project-hub/agent-selection.test.ts src/project-hub/action-plan.test.ts src/project/project-hub.test.ts src/project/agent-room-legacy-characterization.test.ts` and `npm run typecheck`.
- [ ] **Step 7:** Record S04A cutover evidence and create local commit `feat: replace Recovery Snapshot with Flow v2`.

---

### Task 10: Add the stateless Obsidian Flow client

**Work-OS:** S06A

**Files:**
- Create: `obsidian-plugin/src/project-hub/recovery-client.ts`
- Create: `obsidian-plugin/tests/project-hub-recovery-client.test.ts`
- Modify: `obsidian-plugin/src/main.ts`
- Modify: `obsidian-plugin/test-settings.mjs`
- Modify: `obsidian-plugin/tests/main-lifecycle.test.ts`

**Interfaces:**

```ts
export const RECOVERY_FLOW_OPERATION = "project.hub.recovery.flow" as const;
export class ProjectHubRecoveryClient {
  open(projectId: ProjectId): Promise<RecoveryFlowResponseV2>;
  search(request: RecoverySearchRequestV2): Promise<RecoveryFlowResponseV2>;
  plan(request: RecoveryPlanRequestV2): Promise<RecoveryFlowResponseV2>;
  refreshPlan(request: RecoveryRefreshPlanRequestV2): Promise<RecoveryFlowResponseV2>;
  restart(request: RecoveryRestartRequestV2): Promise<RecoveryFlowResponseV2>;
}
```

- [ ] **Step 1:** Pin the exact read-only Operation and map all five closed action requests/responses; copy no backend validators or reducers.
- [ ] **Step 2:** Give the client no apply method, retry store, persistence, automatic Binding choice or silent Plan refresh.
- [ ] **Step 3:** Instantiate it from the existing production Operation transport and inject it into Ask Mate ItemView.
- [ ] **Step 4:** Test exact payloads, redacted presentation errors, no mutation calls, and no token/query/Plan retention in plugin data.
- [ ] **Step 5:** Run `npm test` and `npm run typecheck` from `obsidian-plugin/`.
- [ ] **Step 6:** Create local commit `feat: add Obsidian Recovery Flow client`.

---

### Task 11: Render and prove S06A Recovery Flow preview

**Work-OS:** S06A

**Files:**
- Create: `obsidian-plugin/src/project-hub/recovery-panel.ts`
- Create: `obsidian-plugin/tests/project-hub-recovery-view.test.ts`
- Modify: `obsidian-plugin/src/ask-mate/view.ts`
- Modify: `obsidian-plugin/tests/ask-mate-view.test.ts`
- Modify: `obsidian-plugin/styles.css`
- Modify: `obsidian-plugin/test-settings.mjs`

**Interfaces:**

```ts
export interface RecoveryPanelState {
  projectId: ProjectId;
  flow: RecoveryFlowResponseV2 | null;
  query: string;
  selectedCandidateId: string | null;
  selectedBinding: { bindingId: string; bindingRevision: number } | null;
  busy: boolean;
  error: string | null;
}
export class ProjectHubRecoveryPanel {
  open(projectId: ProjectId): Promise<void>;
  search(query: string): Promise<void>;
  followRecommended(): Promise<void>;
  plan(candidateId: string, bindingId: string, bindingRevision: number): Promise<void>;
  refreshPlan(): Promise<void>;
  restart(): Promise<void>;
  render(container: HTMLElement): void;
  dispose(): void;
}
```

- [ ] **Step 1:** Delegate only Ask Mate `context.kind === "project"` to the panel; note/selection/Canvas behavior remains unchanged.
- [ ] **Step 2:** Render open stage work/context/citations/suggested queries, searched results/candidates, needs-agent-selection choices, planned Plan/alternatives, stale changed owners/restart, and unavailable remediation.
- [ ] **Step 3:** Auto-submit only the exact server-supplied recommended next request. Multiple Bindings require the user. Candidate replacement validates the full prior Plan; expired Plan requires explicit refresh.
- [ ] **Step 4:** Keep all state in ItemView memory. `dispose`, reload and reopen discard query/results/selection/Binding/Plan and start from open.
- [ ] **Step 5:** Implement semantic headings, labels, focus retention, keyboard order, live status, cancellation, bounded display, Citation Target actions, and no empty success.
- [ ] **Step 6:** Test every stage/transition, branch mixing error, reload reset, cancellation and byte-identical fixture/plugin data.
- [ ] **Step 7:** Run `npm test`, `npm run typecheck`, and `npm run build`.
- [ ] **Step 8:** Verify actual Obsidian preview and record interaction/visual evidence; principal acceptance gates Task 12.
- [ ] **Step 9:** Create local commit `feat: add Ask Mate Recovery Flow preview`.

---

### Task 12: Implement claim-first Workflow apply

**Work-OS:** S04B

**Files:**
- Create: `mcp-server/src/workflow/recovery-apply.ts`
- Create: `mcp-server/src/workflow/recovery-apply.test.ts`
- Modify: `mcp-server/src/workflow/workflow.ts`
- Modify: `mcp-server/src/workflow/workflow.test.ts`
- Modify: `mcp-server/src/core/operations.ts`
- Modify: `mcp-server/src/agent-domain/operations.ts`
- Modify: `mcp-server/src/agent-domain/operations.test.ts`
- Modify: `mcp-server/src/project/agent-room-legacy-characterization.test.ts`
- Modify: `mcp-server/src/project/project-context.e2e.test.ts`
- Modify: `scripts/verify_fleet_workflow.ts`
- Modify: `scripts/verify_fleet_workflow.test.ts`

**Interfaces:**

```ts
export interface RecoveryApplyRequestV2 {
  schemaVersion: "recovery-apply-request/v2";
  plan: ProjectHubRecoveryPlanV2;
  planFingerprint: RecoveryFingerprint;
  planningInput: { query: string; limit: number };
  transitionToken: string;
}
export interface RecoveryApplyDependencies {
  store: WorkRunStore;
  recomputeCurrentPlanBasis(
    plan: ProjectHubRecoveryPlanV2,
    planningInput: RecoveryApplyRequestV2["planningInput"],
  ): Promise<void>;
  join(plan: ProjectHubRecoveryPlanV2, actorId: string, token: string): Promise<Record<string, unknown>>;
  createAndJoin(plan: ProjectHubRecoveryPlanV2, actorId: string, token: string): Promise<Record<string, unknown>>;
  now(): number;
}
```

- [ ] **Step 1:** Validate request/Plan bytes, safe normalized query/limit planning input, actor and token digest without fresh expiry enforcement; load exact token/plan claim first.
- [ ] **Step 2:** Return applied, block outcome-unknown, or recover claimed even after Plan expiry; reject actor/Plan/token/planning-input rebound and persist only the planning-input digest.
- [ ] **Step 3:** Only a new claim uses planning input to recompute open→search→candidates→Binding and prove Plan `searchInputFingerprint`, searched-basis, search and candidate fingerprints, then validates five-minute expiry and current owner/capability/lease facts before atomically writing claims.
- [ ] **Step 4:** Resume exact Work Run with authenticated actor and Plan role/Binding/Profile locks. Create deterministic run/lease for actor and join; never manual start.
- [ ] **Step 5:** Reconcile owner bytes/receipt before another call and implement every apply crash window, expiry-after-claim, replay and two-token race.
- [ ] **Step 6:** Register apply through Workflow dependencies and migrate the frozen `makeWorkflowOps` inventory including Fleet verifier.
- [ ] **Step 7:** Run focused apply/store/Workflow/Plan/Project/Agent Domain tests and typecheck; from root run Fleet verifier tests.
- [ ] **Step 8:** Record S04B evidence and create local commit `feat: add Recovery Flow apply`.

---

### Task 13: Implement claimed Work Run output governance

**Work-OS:** S05

**Files:**
- Create: `mcp-server/src/workflow/output-governance.ts`
- Create: `mcp-server/src/workflow/output-governance.test.ts`
- Modify: `mcp-server/src/workflow/work-run-store.ts`
- Modify: `mcp-server/src/workflow/work-run-store.test.ts`
- Modify: `mcp-server/src/workflow/workflow.ts`
- Modify: `mcp-server/src/workflow/workflow.test.ts`
- Modify: `mcp-server/src/core/operations.ts`
- Modify: `mcp-server/src/core/project-memory-operations.ts`
- Modify: `mcp-server/src/core/project-memory-operations.test.ts`
- Modify: `mcp-server/src/agent-domain/operations.ts`
- Modify: `mcp-server/src/agent-domain/operations.test.ts`
- Modify: `mcp-server/src/project/project-context.e2e.test.ts`
- Modify: `mcp-server/src/project/project-hub.test.ts`
- Modify: `scripts/verify_fleet_workflow.ts`
- Modify: `scripts/verify_fleet_workflow.test.ts`
- Modify: `compiler/work_driver.py`
- Modify: `tests/test_work_driver.py`

**Interfaces:**

```ts
export interface WorkRunOutputSubmissionV1 {
  schemaVersion: "work-run-output-submission/v1";
  result: "output" | "quarantine";
  output: WorkRunOutputV1 | null;
  quarantine: WorkRunOutputQuarantineV1 | null;
}
export type WorkflowAgentLeaveRequestV2 =
  | {
      mode: "complete";
      project: string;
      agent: string;
      work_run_id: string;
      transition_token: string;
      target_state: "completed" | "awaiting_review";
      submission: WorkRunOutputSubmissionV1;
      summary: string;
    }
  | {
      mode: "terminate";
      project: string;
      agent: string;
      work_run_id: string;
      transition_token: string;
      target_state: "failed" | "cancelled";
      submission: null;
      summary: string;
    };
export interface WorkRunOutputRouteReceiptV1 {
  schemaVersion: "work-run-output-route/v1";
  outputFingerprint: RecoveryFingerprint;
  tokenDigest: RecoveryFingerprint;
  state: "accepted" | "review-required" | "denied" | "outcome-unknown";
  ownerOperation: string | null;
  ownerReceiptFingerprint: RecoveryFingerprint | null;
  diagnostics: RecoveryFlowDiagnosticV2[];
  recordedAt: string;
  fingerprint: RecoveryFingerprint;
}
```

- [ ] **Step 1:** Validate the full complete/terminate leave union, exact identity/token/target/submission relationships, valid/quarantine arms, classifications, bounds, citations/provenance and safe non-persistence/non-echo. Actor comes only from OperationContext.
- [ ] **Step 2:** Reject legacy leave `work_run_state|output_class|approval_status`, unknown fields, complete mode without submission, and terminate mode with submission.
- [ ] **Step 3:** Claim output fingerprint plus leave-token/actor digest before owner mutation; implement first-token-wins, same-token replay, rebound, owner-receipt recovery and outcome-unknown.
- [ ] **Step 4:** Route view artifact-only, allowlisted Work-OS transition, cited Project Memory draft/exact existing Dream Time proposal, approved external effect, and quarantine review receipt.
- [ ] **Step 5:** Reject `completed|awaiting_review` from step/checkpoint; migrate Agent Domain, Project E2E, Workflow and Fleet verifier successful/review callers to complete-mode leave. Failed/cancelled uses terminate mode.
- [ ] **Step 6:** Remove only the production-unused Python output router and its isolated test; retain durable Work Run field compatibility.
- [ ] **Step 7:** Fault-test each mutating route before owner, after owner/before route receipt, and after receipt/before response; prove one owner effect.
- [ ] **Step 8:** Run MCP focused tests/typecheck, Fleet verifier tests and Python Work Driver tests.
- [ ] **Step 9:** Record S05 evidence and create local commit `feat: govern Work Run output claims`.

---

### Task 14: Complete S06B confirmation, receipt, and Flow restart

**Work-OS:** S06B

**Files:**
- Modify: `obsidian-plugin/src/project-hub/recovery-client.ts`
- Modify: `obsidian-plugin/src/project-hub/recovery-panel.ts`
- Modify: `obsidian-plugin/tests/project-hub-recovery-client.test.ts`
- Modify: `obsidian-plugin/tests/project-hub-recovery-view.test.ts`
- Modify: `obsidian-plugin/styles.css`

- [ ] **Step 1:** Add exact `workflow.recovery.apply` mapping only after Task 12, with full V2 Plan/fingerprint, safe ephemeral current query/limit planning input, and replay-stable token derived from operation, Project, Plan and confirmation actor; persist no raw query.
- [ ] **Step 2:** Require explicit confirmation of the exact visible unexpired Plan; cancellation invokes no mutation and auto-refresh is forbidden.
- [ ] **Step 3:** Render claimed/applied/outcome-unknown and exact owner receipt; outcome-unknown disables another apply and links doctor remediation.
- [ ] **Step 4:** After applied receipt, discard ephemeral Flow state and call Flow open from current owners; persist no claim/receipt/task/query/Plan state.
- [ ] **Step 5:** Test stale/expired Plan, rebound, capability/lease failure, adapter error, cancellation, focus and owner restart.
- [ ] **Step 6:** Run plugin tests/typecheck/build and actual sanitized apply/receipt/restart journey.
- [ ] **Step 7:** Record S06B evidence and create local commit `feat: complete Obsidian Recovery Flow action`.

---

### Task 15: Add dedicated CLI and cross-surface parity

**Work-OS:** S07

**Files:**
- Create: `mcp-server/src/project-hub/cli.ts`
- Create: `mcp-server/src/project-hub/cli.test.ts`
- Create: `mcp-server/src/project-hub/parity.test.ts`
- Modify: `mcp-server/package.json`

**Interfaces:**

```ts
export type RecoveryFlowCliCommand =
  | "open" | "search" | "plan" | "refresh-plan" | "restart" | "apply";
export interface RecoveryFlowCliResult { command: RecoveryFlowCliCommand; result: unknown; }
export async function runRecoveryFlowCli(
  argv: string[],
  invoke?: (operation: string, args: Record<string, unknown>) => Promise<unknown>,
): Promise<RecoveryFlowCliResult>;
```

- [ ] **Step 1:** Follow existing direct Operation-dispatch CLI patterns and map only adapter arguments to shared Flow/apply Operations.
- [ ] **Step 2:** Use JSON input files for full prior Plan/stale response/apply request; secrets never enter argv or errors. Claim files are not CLI commands.
- [ ] **Step 3:** Add package bin/files/esbuild target; generated bundle remains untracked.
- [ ] **Step 4:** Compare domain/MCP/CLI stages, Flow/Plan fingerprints, owner locks, recommended requests, reasons, citations, diagnostics, apply states and receipts on one fixture.
- [ ] **Step 5:** Run CLI/parity/Project tests, typecheck/build, then real CLI open→search→plan smoke commands.
- [ ] **Step 6:** Record S07 evidence and create local commit `feat: add Recovery Flow CLI parity`.

---

### Task 16: Enforce S08 Foundation acceptance

**Work-OS:** S08

**Files:**
- Create: `mcp-server/tests/fixtures/project-hub-recovery/**`
- Create: `mcp-server/src/project-hub/recovery-loop.e2e.test.ts`
- Modify: `01-Projects/obsidian-llm-wiki/issues/p0-s08-recovery-loop-acceptance.md`

- [ ] **Step 1:** Build one sanitized fixture containing every owner, Work Run/event context, unique/multiple/no Binding cases, reviewed/draft memory, repeated queries, candidates, capabilities, claims, outputs and canaries.
- [ ] **Step 2:** Automate V1 absence/equivalence history, all request actions/response stages, stateless recomputation, branch mixing rejection, candidate override, explicit refresh, stale/unavailable, resume/create, apply/output crash windows/races/replay/outcome-unknown and parity.
- [ ] **Step 3:** Scan every domain/plugin/MCP/CLI/Flow/Plan/claim/receipt/quarantine/error serialization for canaries, credentials, transcripts and absolute paths.
- [ ] **Step 4:** In actual Obsidian, run one familiarization and three measured flows from Open Project Hub invocation to cited immutable Plan preview; record raw timings and require each under 60 seconds.
- [ ] **Step 5:** Run the exact OpenSpec Foundation command matrix across MCP, plugin, Fleet verifier, Python compatibility and strict OpenSpec validation. Any failure opens a linked issue and blocks Foundation.
- [ ] **Step 6:** Record S08 evidence and create local commit `test: enforce Recovery Flow foundation gate`.

---

### Task 17: Align durable status and generated references

**Files:**
- Modify: `01-Projects/obsidian-llm-wiki/issues/p0-s01b-project-hub-recovery-flow-v2.md`
- Modify: S02–S08 recovery issue files
- Modify: `ROADMAP.md`
- Modify: generated MCP operation reference through its generator
- Modify: `CHANGELOG.md`
- Modify: `RELEASE_NOTES.md`

- [ ] **Step 1:** Update issue state/review/dependencies/evidence only for independently verified slices; never rewrite S01 v1 completion history.
- [ ] **Step 2:** Regenerate operation references; do not hand-edit generated operation signatures.
- [ ] **Step 3:** Update roadmap/changelog/release notes only for behavior that passed S08; keep parent brief incomplete until actual journey passes.
- [ ] **Step 4:** Run independent final review against R1–R11, clean V1 removal, every exported caller, authority/privacy/crash invariants and test quality.
- [ ] **Step 5:** Rerun the exact gates named by findings, then create local commit `docs: close Recovery Flow foundation slice`.

---

## Self-Review Gate

- R1–R11 map to Tasks 1–16.
- S01B is a complete internal contract kernel, not a public partial/stub Operation.
- Search is mandatory/repeatable; only the selected branch feeds Plan.
- Stateless requests repeat minimal inputs; refresh/override submit complete prior Plan.
- V1 is removed only when full V2 read stages are registered in Task 9.
- Plan contains no invented execution identity; apply actor supplies it.
- Flow ends before mutation; Project Hub remains read-only.
- Apply and output have claim/replay/crash/outcome-unknown protocols.
- Ask Mate Flow state is ephemeral and reload-tested.
- Every known Workflow factory and successful/review completion caller is named.
- No placeholder, compatibility shim, second authority, or hidden follow-up remains.