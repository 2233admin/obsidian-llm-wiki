# Project Hub Recovery Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` or `executing-plans` to implement one reviewed task at a time. Every task ends with focused verification and an atomic commit. No implementation starts until OpenSpec Phase 0 is approved.

**Goal:** Turn the existing `project-hub-recovery/v1` snapshot into a complete Obsidian-first interrupted-work recovery journey with bounded context, cited retrieval, immutable action planning, crash-safe Workflow apply, governed output routing, and MCP/CLI parity.

**Architecture:** Keep `project.hub.*` read-only and keep S01 unchanged. Extract reusable contract and Workflow read/store seams from the existing monoliths, then compose S02–S04A through owner-backed read models. Present recovery in the existing LLM Wiki/Ask Mate Project context, not the advanced control-plane modal. Route the one mutation through Workflow, preserve cross-runtime Work Run fields, and make TypeScript the only output-governance authority.

**Tech Stack:** TypeScript 7, Node.js 20+, Bun tests, existing Operation/Application Runtime, `@obsidian-llm-wiki/agent-domain`, Obsidian ItemView API, existing Python Work Driver compatibility tests, Markdown Work-OS, canonical JSON and SHA-256 fingerprints.

**Spec:** `openspec/changes/project-hub-recovery-loop/`

## Global Constraints

- `project-hub-recovery/v1` and its existing callers remain unchanged.
- Project Hub is a derived read model; every `project.hub.*` operation remains `mutating: false`.
- Project ID is durable identity. Workspace paths are machine-local bindings and never enter shared contracts.
- Work-OS owns Work Item state; Workflow owns Work Run identity, leases, transitions, checkpoints, claims, and receipts.
- Project Memory owns reviewed claims; Session Records supply safe recovery metadata, never raw transcript bodies.
- Agent Domain owns Project Agent Binding and Profile revisions.
- Settings/Capability owners supply current capability facts and remediation.
- Obsidian is the primary human recovery surface. MCP and CLI follow only after the accepted Obsidian path.
- Existing Python Work Driver durable fields remain byte-compatible; its unused output-routing helper is removed when TypeScript routing lands.
- No new search index, runtime dependency, external projection, Fleet behavior, Source Input type, compatibility alias, or plugin-owned recovery store.
- All collections and strings use the exact OpenSpec bounds. Unknown fields are rejected; nullable fields serialize as `null`.
- Unsafe caller input is rejected without echo. Unsafe optional owner data is omitted with a stable diagnostic. Unsafe identity or mandatory safety data makes the result unavailable.
- Fingerprints use canonical normalized bytes and exclude display-only timestamps exactly as specified.

---

## Verified Source Baseline

The implementation plan is based on the current repository, not a partial search result.

| Concern | Current source fact | Planning consequence |
|---|---|---|
| Recovery primitives | `mcp-server/src/project-hub/recovery.ts` owns private canonicalization, SHA-256, citation, and validation helpers. | Extract one shared contract-support module before adding four more closed contracts; do not copy helpers. |
| Work Run authority | `mcp-server/src/workflow/workflow.ts` is a 2,235-line module; durable run, lock, lease, lifetime, and event readers are private. | Extract store and read-model seams first; S02 and S04B must not reach into projection internals. |
| Checkpoints | Work Run checkpoint summaries/evidence live in `01-Projects/<slug>/agents/<agent>/events.md`; durable run transitions alone do not contain the full checkpoint contract. | The Workflow read model binds both durable run JSON and the matching agent event log. |
| Retrieval | `mcp-server/src/unified-query.ts` receives generic `SearchResult` values and has no canonical Project or owner-revision contract. | Do not overload generic RRF search with Project authority. Build a bounded Project Hub owner-source composer and use existing adapters only behind strict Project-root filtering. |
| Agent selection | `project/project-hub.ts` already reads `AgentDomainService` bindings/profiles from `_llmwiki/agent-domain/v1`. | Reuse that owner through a focused selection source; never trust plugin-supplied agent facts. |
| Primary Obsidian entry | `main.ts` opens the LLM Wiki/Ask Mate ItemView for current Project Context. `control-plane-ui.ts` labels itself an advanced administrative surface. | S06A/S06B use a focused recovery panel inside Ask Mate Project context; do not make the advanced modal the product journey. |
| Output routing | TypeScript Workflow currently accepts `output_class`/`approval_status`; `compiler/work_driver.py` also has an unused `route_work_run_output` helper referenced only by its test. | Preserve durable field compatibility, add the closed submission/quarantine plus claimed TypeScript router, then delete the obsolete Python router and its isolated test. |
| Composition | `makeAllOperations`, `agent-domain/operations.ts`, two Project characterization tests, `workflow.test.ts`, and `scripts/verify_fleet_workflow.ts` call `makeWorkflowOps`. | Any Workflow factory signature change migrates this frozen caller inventory and its tests in the same task. |
| CLI | Existing CLIs invoke shared Operation handlers through `createOperationDispatcher`. | The dedicated Project Hub CLI composes the same Project Hub/Workflow operations; it does not reimplement contract semantics. |

A task stops if any row no longer matches the implementation snapshot. The controller updates this plan before delegating another slice.

---

## File and Module Map

```text
mcp-server/src/project-hub/
  contract-support.ts          shared closed-contract normalization, safety, bounds, fingerprints
  resume-context.ts           S02 closed context contract and pure composition
  search-source.ts            Project-scoped owner reads and owner locks
  search.ts                   S03 closed search contract and deterministic ranking
  action-candidates.ts        S04A available/unavailable candidate set
  agent-selection.ts          current Agent Binding/Profile owner adapter
  action-plan.ts              immutable five-minute action plan
  cli.ts                      dedicated Project Hub CLI over shared operations
  *.test.ts                   contract, owner, CLI, parity, and end-to-end tests

mcp-server/src/workflow/
  work-run-store.ts           durable runs, local leases, atomic files, shared lock
  workflow-read-model.ts      bounded Work Run and checkpoint reads
  recovery-apply.ts           plan claim, token index, replay-safe resume/create apply
  output-governance.ts        work-run-output/v1 validation and owner routing
  workflow.ts                 Operation registration and existing agent lifecycle

obsidian-plugin/src/project-hub/
  recovery-client.ts          stateless typed Operation client
  recovery-panel.ts           focused recovery state and keyboard-operable rendering

obsidian-plugin/src/ask-mate/view.ts
  delegates Project context to the recovery panel without copying domain state
```

---

### Task 1: Extract shared recovery contract support

**Files:**
- Create: `mcp-server/src/project-hub/contract-support.ts`
- Create: `mcp-server/src/project-hub/contract-support.test.ts`
- Modify: `mcp-server/src/project-hub/recovery.ts`
- Modify: `mcp-server/src/project-hub/index.ts`

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

- [ ] **Step 1:** Write failing tests for canonical key ordering, array-order preservation, lowercase SHA-256 form, UTF-8 byte counting, unknown-field rejection, control characters, embedded credentials, prompt/transcript markers, and Windows/POSIX/UNC/home-relative paths under suspicious and benign keys.
- [ ] **Step 2:** Run `npm exec bun -- test src/project-hub/contract-support.test.ts`; confirm only the missing module fails.
- [ ] **Step 3:** Move the reusable canonicalization/fingerprint behavior out of `recovery.ts`; add value-based safety and closed-object helpers without changing S01 output bytes.
- [ ] **Step 4:** Update `recovery.ts` to consume the shared helpers and keep every exported S01 type/function unchanged.
- [ ] **Step 5:** Run `npm exec bun -- test src/project-hub/contract-support.test.ts src/project/project-hub.test.ts` and `npm run typecheck`.
- [ ] **Step 6:** Commit `refactor: share Project Hub recovery contract support`.

---

### Task 2: Extract the Workflow Work Run store

**Files:**
- Create: `mcp-server/src/workflow/work-run-store.ts`
- Create: `mcp-server/src/workflow/work-run-store.test.ts`
- Modify: `mcp-server/src/workflow/workflow.ts`
- Modify: `mcp-server/src/workflow/workflow.test.ts`

**Interfaces:**

```ts
export interface WorkRunStore {
  withLock<T>(action: () => T): T;
  read(projectSlug: string, workRunId: string): Record<string, unknown> | null;
  writeAtomic(projectSlug: string, workRunId: string, value: Record<string, unknown>): void;
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

- [ ] **Step 1:** Characterize current lock acquisition, stale-lock conflict with manual-removal remediation, durable run path, local lease lookup, atomic replacement, rollback, and byte-for-byte replay in store tests. Do not invent automatic stale-lock recovery during this extraction.
- [ ] **Step 2:** Extract those behaviors from `workflow.ts` without changing operation names, params, returned fields, durable JSON, Markdown lifetime files, or event logs.
- [ ] **Step 3:** Migrate `workflow.agent.start|join|step|checkpoint|leave|doctor` to the store and remove the old private duplicates.
- [ ] **Step 4:** Run `npm exec bun -- test src/workflow/work-run-store.test.ts src/workflow/workflow.test.ts` and `npm run typecheck`.
- [ ] **Step 5:** Commit `refactor: extract Workflow Work Run store`.

---

### Task 3: Add the bounded Workflow read model

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
export function createFileWorkflowReadModel(vaultPath: string): WorkflowReadModel;
```

- [ ] **Step 1:** Write fixtures for active, terminal, expired, malformed, Project-mismatched, and Work-Item-mismatched durable runs plus two agent-event checkpoints for one Work Run.
- [ ] **Step 2:** Implement read-only selection over durable run JSON and matching agent event logs; derive checkpoint IDs from stable event identity, not array position.
- [ ] **Step 3:** Sort runs by authoritative observation time descending then Work Run ID ascending; sort retained checkpoints chronologically after selecting the newest 32.
- [ ] **Step 4:** Prove reads create no files and returned values exclude transition tokens, lease tokens, prompts, transcript bodies, and absolute paths.
- [ ] **Step 5:** Run `npm exec bun -- test src/workflow/workflow-read-model.test.ts src/workflow/workflow.test.ts` and `npm run typecheck`.
- [ ] **Step 6:** Commit `feat: add bounded Workflow recovery read model`.

---

### Task 4: Implement S02 resumable context

**Files:**
- Create: `mcp-server/src/project-hub/resume-context.ts`
- Create: `mcp-server/src/project-hub/resume-context.test.ts`
- Modify: `mcp-server/src/project-hub/index.ts`
- Modify: `mcp-server/src/project/project-hub.ts`
- Modify: `mcp-server/src/project/project-hub.test.ts`

**Interfaces:**

```ts
export const PROJECT_HUB_RESUME_CONTEXT_SCHEMA_VERSION = "project-hub-resume-context/v1" as const;
export interface ResumeContextRequest {
  projectReference: string;
  snapshotFingerprint: RecoveryFingerprint;
  requestedWorkRunId: string | null;
}
export interface ResumeContextOwners {
  workflow: WorkflowReadModel;
  loadWorkItem(projectId: string, workItemId: string): unknown;
  loadProjectMemory(projectId: string): Promise<unknown>;
  listSessions(projectId: string): Promise<readonly unknown[]>;
}
export function composeProjectHubResumeContext(
  request: ResumeContextRequest,
  snapshot: ProjectHubRecoverySnapshot,
  owners: ResumeContextOwners,
  generatedAt: string,
): ProjectHubResumeContext;
export function validateProjectHubResumeContext(value: unknown): ProjectHubResumeContext;
```

- [ ] **Step 1:** Add failing contract tests for both closed arms, required nulls, owner locks, exact enums, 32/32/64/16/32 count caps, 64 KiB cap, omission counters, and fingerprint exclusions.
- [ ] **Step 2:** Implement explicit-run, S01-recommended-run, and latest-session selection. An invalid explicit run returns its own `not-resumable` reason and never falls through.
- [ ] **Step 3:** Allocate mandatory envelope/task/prerequisite/blocking diagnostics first; append decisions, checkpoints, citations, and non-blocking diagnostics only in D4 order.
- [ ] **Step 4:** Register `project.hub.resume-context.get` in `makeProjectHubOps`; compose through Work-OS, Workflow read model, `createDurableProjectMemorySource`, and Session Records.
- [ ] **Step 5:** Test S01 staleness separately from downstream owner-lock staleness, reviewed-only decisions, mandatory-envelope overflow, canaries, and byte-identical read behavior.
- [ ] **Step 6:** Run `npm exec bun -- test src/project-hub/resume-context.test.ts src/project/project-hub.test.ts src/project/agent-room-legacy-characterization.test.ts src/workflow/workflow-read-model.test.ts` and `npm run typecheck`.
- [ ] **Step 7:** Record evidence in `p0-s02-resumable-agent-context.md`; commit `feat: add Project Hub resumable context`.

---

### Task 5: Implement S03 Project-scoped cited retrieval

**Files:**
- Create: `mcp-server/src/project-hub/search-source.ts`
- Create: `mcp-server/src/project-hub/search-source.test.ts`
- Create: `mcp-server/src/project-hub/search.ts`
- Create: `mcp-server/src/project-hub/search.test.ts`
- Modify: `mcp-server/src/project-hub/index.ts`
- Modify: `mcp-server/src/project/project-hub.ts`
- Modify: `mcp-server/src/project/project-hub.test.ts`

**Interfaces:**

```ts
export type ProjectHubSearchOwner =
  | "work-os" | "project-memory" | "source-evidence" | "session-record" | "workflow";
export interface ProjectHubOwnerSnapshot {
  owner: ProjectHubSearchOwner;
  revision: string | number | null;
  fingerprint: RecoveryFingerprint | null;
  state: "current" | "stale" | "unavailable";
  items: readonly ProjectHubOwnerItem[];
  diagnostics: readonly ProjectHubRecoveryDiagnostic[];
}
export interface ProjectHubSearchSource {
  snapshot(projectId: string): Promise<readonly ProjectHubOwnerSnapshot[]>;
}
export function createProjectHubSearchSource(
  vaultPath: string,
  workflow: WorkflowReadModel,
): ProjectHubSearchSource;
export function searchProjectHub(
  input: ProjectHubSearchInput,
  owners: readonly ProjectHubOwnerSnapshot[],
): ProjectHubSearchResult;
```

- [ ] **Step 1:** Characterize the five owner roots and prove every candidate path belongs to the canonical Project before normalization.
- [ ] **Step 2:** Implement direct owner snapshots from reviewed Work-OS, Project Memory, Project Source/Evidence, Session Record, and Workflow records. Do not modify generic RRF semantics or create an index.
- [ ] **Step 3:** Implement NFKC/trim/whitespace query normalization, exact match classes, owner/freshness/score/ID ordering, 25-result/32-diagnostic/4-citation/8-provenance/4 KiB item/128 KiB response caps, omissions, and fingerprint.
- [ ] **Step 4:** Register read-only `project.hub.search`; bind S01 plus exact owner locks and return partial state when one owner is unavailable.
- [ ] **Step 5:** Test current blocker retrieval, cross-Project exclusion, stale owner without false S01 staleness, deterministic truncation, source canaries, and no writes.
- [ ] **Step 6:** Run `npm exec bun -- test src/project-hub/search-source.test.ts src/project-hub/search.test.ts src/project/project-hub.test.ts` and `npm run typecheck`.
- [ ] **Step 7:** Record evidence in `p0-s03-project-cited-retrieval.md`; commit `feat: add Project-scoped cited recovery search`.

---

### Task 6: Implement S04A action candidates

**Files:**
- Create: `mcp-server/src/project-hub/action-candidates.ts`
- Create: `mcp-server/src/project-hub/action-candidates.test.ts`
- Modify: `mcp-server/src/project-hub/index.ts`
- Modify: `mcp-server/src/project/project-hub.ts`
- Modify: `mcp-server/src/project/project-hub.test.ts`

**Interfaces:**

```ts
export const PROJECT_HUB_ACTION_CANDIDATES_SCHEMA_VERSION = "project-hub-action-candidates/v1" as const;
export function composeProjectHubActionCandidates(input: {
  snapshot: ProjectHubRecoverySnapshot;
  context: ProjectHubResumeContext;
  search: ProjectHubSearchResult;
  capabilityFacts: readonly ProjectHubCapabilityFact[];
  generatedAt: string;
}): ProjectHubActionCandidates;
export function validateProjectHubActionCandidates(value: unknown): ProjectHubActionCandidates;
```

- [ ] **Step 1:** Write closed-schema tests for available/unavailable arms, capability facts, exact IDs, upstream locks, one recommended candidate, empty fingerprinting, and remediation.
- [ ] **Step 2:** Reuse only S01 `resume-work-run` identity for resume; create only from session-sourced context with matching current unblocked Work Item and satisfied capabilities.
- [ ] **Step 3:** Return the unavailable arm for blocked work, missing capability, unavailable context/search, or no safe action; never reinterpret `inspect-work-item`.
- [ ] **Step 4:** Register `project.hub.action-candidates.get` and test read-only/no-write behavior.
- [ ] **Step 5:** Run `npm exec bun -- test src/project-hub/action-candidates.test.ts src/project/project-hub.test.ts` and `npm run typecheck`.
- [ ] **Step 6:** Commit `feat: add Project Hub recovery action candidates`.

---

### Task 7: Implement immutable action plans and Agent selection

**Files:**
- Create: `mcp-server/src/project-hub/agent-selection.ts`
- Create: `mcp-server/src/project-hub/agent-selection.test.ts`
- Create: `mcp-server/src/project-hub/action-plan.ts`
- Create: `mcp-server/src/project-hub/action-plan.test.ts`
- Modify: `mcp-server/src/project-hub/index.ts`
- Modify: `mcp-server/src/project/project-hub.ts`
- Modify: `mcp-server/src/project/project-hub.test.ts`

**Interfaces:**

```ts
export interface RecoveryAgentSelectionSource {
  resolve(projectId: string, bindingId: string, bindingRevision: number): Promise<{
    role: string;
    bindingId: string; bindingRevision: number;
    profileId: string; profileRevision: number;
    capabilityFacts: ProjectHubCapabilityFact[];
  }>;
}
export function createFileRecoveryAgentSelectionSource(vaultPath: string): RecoveryAgentSelectionSource;
export function composeProjectHubActionPlan(
  candidateSet: ProjectHubActionCandidates,
  input: { candidateSetFingerprint: RecoveryFingerprint; candidateId: string; agentSelection: { bindingId: string; bindingRevision: number } },
  agent: Awaited<ReturnType<RecoveryAgentSelectionSource["resolve"]>>,
  nowMs: number,
): ProjectHubActionPlan;
```

- [ ] **Step 1:** Read the exact current Binding revision and its referenced Profile revision through `AgentDomainService`; reject disabled, missing, stale Project-context, wrong-Project, and capability-mismatched selections.
- [ ] **Step 2:** Implement the closed plan with all upstream locks, exact candidate, role and Binding/Profile revision facts, capability facts, citations, owning operation, five-minute server-clock expiry, and 15-minute create lease. Do not invent `agentId` or host; apply binds the authenticated Operation actor.
- [ ] **Step 3:** Reject unavailable, invented, stale, or mismatched candidates and selections without substituting another candidate or agent.
- [ ] **Step 4:** Register `project.hub.action.plan`; assert every Project Hub operation remains read-only and the fixture is byte-identical.
- [ ] **Step 5:** Run `npm exec bun -- test src/project-hub/agent-selection.test.ts src/project-hub/action-plan.test.ts src/project/project-hub.test.ts` and `npm run typecheck`.
- [ ] **Step 6:** Record S04A evidence in `p0-s04-work-run-next-action.md`; commit `feat: add immutable Project Hub recovery plans`.

---

### Task 8: Add the stateless Obsidian recovery client

**Files:**
- Create: `obsidian-plugin/src/project-hub/recovery-client.ts`
- Create: `obsidian-plugin/tests/project-hub-recovery-client.test.ts`
- Modify: `obsidian-plugin/src/main.ts`
- Modify: `obsidian-plugin/test-settings.mjs`
- Modify: `obsidian-plugin/tests/main-lifecycle.test.ts`

**Interfaces:**

```ts
export const PROJECT_HUB_RECOVERY_OPERATIONS = {
  snapshot: "project.hub.get",
  context: "project.hub.resume-context.get",
  search: "project.hub.search",
  candidates: "project.hub.action-candidates.get",
  plan: "project.hub.action.plan",
} as const;
export class ProjectHubRecoveryClient {
  snapshot(projectId: ProjectId): Promise<ProjectHubRecoveryProjection>;
  context(input: RecoveryContextClientInput): Promise<ProjectHubResumeContext>;
  search(input: RecoverySearchClientInput): Promise<ProjectHubSearchResult>;
  candidates(input: RecoveryCandidateClientInput): Promise<ProjectHubActionCandidates>;
  plan(input: RecoveryPlanClientInput): Promise<ProjectHubActionPlan>;
}
```

- [ ] **Step 1:** Pin the exact operation names and typed request/response mappings; the client owns no validators, retries, stores, or approval state.
- [ ] **Step 2:** Reject unsafe backend presentation text through the existing safe presentation boundary; the preview client has no mutation method or transition-token state.
- [ ] **Step 3:** Instantiate the client from the existing production control-plane transport and inject it into the LLM Wiki ItemView.
- [ ] **Step 4:** Test exact payload mapping, unavailable arms, stale errors, and that the S06A operation map contains no Workflow mutation.
- [ ] **Step 5:** Run `npm test` and `npm run typecheck` from `obsidian-plugin/`.
- [ ] **Step 6:** Commit `feat: add Obsidian Project Hub recovery client`.

---

### Task 9: Render S06A in the LLM Wiki Project context

**Files:**
- Create: `obsidian-plugin/src/project-hub/recovery-panel.ts`
- Create: `obsidian-plugin/tests/project-hub-recovery-view.test.ts`
- Modify: `obsidian-plugin/src/ask-mate/view.ts`
- Modify: `obsidian-plugin/styles.css`
- Modify: `obsidian-plugin/test-settings.mjs`
- Modify: `obsidian-plugin/tests/ask-mate-view.test.ts`

**Interfaces:**

```ts
export interface RecoveryPanelState {
  projectId: ProjectId;
  snapshot: ProjectHubRecoveryProjection | null;
  context: ProjectHubResumeContext | null;
  search: ProjectHubSearchResult | null;
  candidates: ProjectHubActionCandidates | null;
  selectedCandidateId: string | null;
  selectedBinding: { bindingId: string; bindingRevision: number } | null;
  plan: ProjectHubActionPlan | null;
  busy: boolean;
  error: string | null;
}
export class ProjectHubRecoveryPanel {
  load(projectId: ProjectId): Promise<void>;
  search(query: string): Promise<void>;
  preview(candidateId: string, bindingId: string, bindingRevision: number): Promise<void>;
  render(container: HTMLElement): void;
  dispose(): void;
}
```

- [ ] **Step 1:** In `AskMateView`, route only `context.kind === "project"` to the recovery panel; keep note/selection/Canvas behavior unchanged.
- [ ] **Step 2:** Render stage, done/in-progress/blocked/not-started groups, freshness, diagnostics, citations, bounded context, retrieval, candidate availability, Agent Binding selection, effects, and immutable plan.
- [ ] **Step 3:** Render exact remediation for missing capability, blocked work, unavailable evidence/candidate, and stale snapshot/owner/Binding locks. Empty data never appears as success.
- [ ] **Step 4:** Implement semantic headings, labeled controls, keyboard order, focus retention after refresh/error, cancellation, live status, and readable plan details.
- [ ] **Step 5:** Prove preview invokes only read-only operations and leaves the fixture byte-identical.
- [ ] **Step 6:** Run `npm test`, `npm run typecheck`, and `npm run build` from `obsidian-plugin/`.
- [ ] **Step 7:** Verify the actual Obsidian preview and record interaction/visual evidence in `p0-s06-obsidian-recovery-surface.md`; principal acceptance gates S04B.
- [ ] **Step 8:** Commit `feat: add Obsidian recovery plan preview`.

---

### Task 10: Implement crash-safe Workflow recovery apply

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
export interface RecoveryApplyDependencies {
  store: WorkRunStore;
  recomputePlan(plan: unknown): ProjectHubActionPlan;
  revalidateOwners(plan: ProjectHubActionPlan): Promise<void>;
  join(plan: ProjectHubActionPlan, actorId: string, transitionToken: string): Promise<Record<string, unknown>>;
  createAndJoin(plan: ProjectHubActionPlan, actorId: string, transitionToken: string): Promise<Record<string, unknown>>;
  now(): number;
}
export function applyRecoveryPlan(
  request: RecoveryApplyRequest,
  actorId: string,
  dependencies: RecoveryApplyDependencies,
): Promise<RecoveryApplyReceipt>;
```

- [ ] **Step 1:** Validate the closed request shape, recompute the presented plan fingerprint, authenticate the Operation actor, and hash the transition token without enforcing fresh-plan expiry.
- [ ] **Step 2:** Under the shared Work Run lock, load token and plan claims first. Reject actor/plan/token rebound; return `applied`, block `outcome-unknown`, or recover the exact `claimed` transition even when the plan has since expired.
- [ ] **Step 3:** Only for a new claim, validate five-minute expiry, Binding/Profile revisions, capabilities, every upstream lock, and lease prerequisites, then atomically claim plan fingerprint and token digest.
- [ ] **Step 4:** On claimed-transition recovery, revalidate request/plan/token/actor and local Work Run/lease identity, reconcile owner bytes/receipt before another call, and do not re-evaluate expiry or mutable pre-claim locks.
- [ ] **Step 5:** Resume only through replay-safe `workflow.agent.join` with the authenticated actor as `agentId`, the plan role/Binding/Profile locks, and the exact Work Run identity.
- [ ] **Step 6:** For create, derive one Work Run ID from Project ID, Work Item ID, and plan fingerprint; create or verify one durable leased run and matching local lease for the authenticated actor, then join. Never call manual `workflow.agent.start`.
- [ ] **Step 7:** Persist `claimed`, `applied`, or `outcome-unknown` plus the closed receipt. Same-token replay returns the exact receipt; unprovable outcome blocks replay and points to `workflow.agent.doctor`.
- [ ] **Step 8:** Register `workflow.recovery.apply` through `makeWorkflowOps` dependencies and migrate the frozen caller inventory: `core/operations.ts`, `agent-domain/operations.ts`, `workflow.test.ts`, `project/agent-room-legacy-characterization.test.ts`, `project/project-context.e2e.test.ts`, and `scripts/verify_fleet_workflow.ts`.
- [ ] **Step 9:** Test before-owner, after-create-before-join-receipt, after-receipt-before-response, expiry-after-claim recovery, same-token replay, rebound token, and concurrent two-token one-plan windows.
- [ ] **Step 10:** From `mcp-server/`, run `npm exec bun -- test src/workflow/recovery-apply.test.ts src/workflow/workflow.test.ts src/project-hub/action-plan.test.ts src/project/project-hub.test.ts src/project/agent-room-legacy-characterization.test.ts src/project/project-context.e2e.test.ts src/agent-domain/operations.test.ts` and `npm run typecheck`; from the repo root run `bun test scripts/verify_fleet_workflow.test.ts`.
- [ ] **Step 11:** Record evidence in `p0-s04b-workflow-recovery-apply.md`; commit `feat: add crash-safe Workflow recovery apply`.

---

### Task 11: Implement TypeScript-owned output governance

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
export interface WorkRunOutputV1 {
  schemaVersion: "work-run-output/v1";
  outputId: string;
  projectId: string;
  workItemId: string;
  workRunId: string;
  outputClass: "view" | "work-state-transition" | "knowledge-claim" | "external-side-effect";
  payload: unknown;
  citationTargets: string[];
  provenance: string[];
  producedAt: string;
  fingerprint: RecoveryFingerprint;
}
export interface WorkRunOutputQuarantineV1 {
  projectId: string;
  workItemId: string;
  workRunId: string;
  observedClass: string | null;
  payloadFingerprint: RecoveryFingerprint | null;
  provenance: string[];
  diagnostics: ProjectHubRecoveryDiagnostic[];
  producedAt: string;
  fingerprint: RecoveryFingerprint;
}
export interface WorkRunOutputSubmissionV1 {
  schemaVersion: "work-run-output-submission/v1";
  result: "output" | "quarantine";
  output: WorkRunOutputV1 | null;
  quarantine: WorkRunOutputQuarantineV1 | null;
}
export interface WorkRunOutputRouteReceipt {
  schemaVersion: "work-run-output-route/v1";
  outputFingerprint: RecoveryFingerprint;
  tokenDigest: RecoveryFingerprint;
  state: "accepted" | "review-required" | "denied" | "outcome-unknown";
  ownerOperation: string | null;
  ownerReceiptFingerprint: RecoveryFingerprint | null;
  diagnostics: ProjectHubRecoveryDiagnostic[];
  recordedAt: string;
  fingerprint: RecoveryFingerprint;
}
```

- [ ] **Step 1:** Add closed validation for valid and quarantine submission arms, canonical fingerprints, required knowledge citations, authoritative identity matching, bounded diagnostics, and non-persistence/non-echo of malformed payload bytes.
- [ ] **Step 2:** Before every owner mutation, atomically claim output fingerprint plus leave transition-token digest in `output-claims/` and `output-tokens/`. Implement first-token-wins, same-token replay, rebound conflict, owner-receipt recovery, and outcome-unknown precedence.
- [ ] **Step 3:** Route `view` to artifact/receipt only; it never mutates Project or Knowledge truth.
- [ ] **Step 4:** Route `work-state-transition` only through an output-fingerprint-idempotent allowlisted Work-OS owner port and bind its durable receipt.
- [ ] **Step 5:** Route `knowledge-claim` through an output-fingerprint-idempotent Project Memory draft port. Create one cited draft or bind an exact existing Dream Time proposal without duplicating it; never auto-promote.
- [ ] **Step 6:** Route `external-side-effect` only after exact per-run approval and an Operation Write Policy allow verdict through an output-fingerprint-idempotent owner port; persist denial or outcome-unknown honestly.
- [ ] **Step 7:** Route quarantine directly to a `review-required` receipt without persisting unsafe content or invoking a content owner.
- [ ] **Step 8:** Make `workflow.agent.leave` the only `completed|awaiting_review` boundary. Reject those states from step/checkpoint and migrate the frozen callers in `agent-domain/operations.ts`, `project/project-context.e2e.test.ts`, `workflow.test.ts`, and `scripts/verify_fleet_workflow.ts`; preserve durable `output_class`/`approval_status`. Failed/cancelled termination remains available without a successful output.
- [ ] **Step 9:** Delete the unused Python `route_work_run_output` helper and its isolated test; retain Python Work Run creation/transition field compatibility.
- [ ] **Step 10:** Fault-inject before owner mutation, after owner mutation before route-receipt persistence, and after receipt persistence before response for each mutating owner route; prove at most one owner effect.
- [ ] **Step 11:** Prove only accepted owner state changes the recomposed Hub fingerprint; draft/rejected/quarantined output remains non-current.
- [ ] **Step 12:** From `mcp-server/`, run `npm exec bun -- test src/workflow/output-governance.test.ts src/workflow/work-run-store.test.ts src/workflow/workflow.test.ts src/core/project-memory-operations.test.ts src/agent-domain/operations.test.ts src/project/project-context.e2e.test.ts src/project/project-hub.test.ts` and `npm run typecheck`; from the repo root run `bun test scripts/verify_fleet_workflow.test.ts` and `PYTHONUTF8=1 python -m pytest tests/test_work_driver.py -q`.
- [ ] **Step 13:** Record evidence in `p0-s05-agent-output-governance.md`; commit `feat: route Work Run output through governance`.

---

### Task 12: Complete S06B apply, receipt, and refresh

**Files:**
- Modify: `obsidian-plugin/src/project-hub/recovery-client.ts`
- Modify: `obsidian-plugin/src/project-hub/recovery-panel.ts`
- Modify: `obsidian-plugin/tests/project-hub-recovery-client.test.ts`
- Modify: `obsidian-plugin/tests/project-hub-recovery-view.test.ts`
- Modify: `obsidian-plugin/styles.css`

**Interfaces:**

```ts
export const PROJECT_HUB_RECOVERY_APPLY_OPERATION = "workflow.recovery.apply" as const;
export interface RecoveryApplyClientInput {
  schemaVersion: "recovery-apply-request/v1";
  plan: ProjectHubActionPlan;
  planFingerprint: RecoveryFingerprint;
  transitionToken: string;
}
export interface ProjectHubRecoveryApplyClient {
  apply(input: RecoveryApplyClientInput): Promise<RecoveryApplyReceipt>;
}
```

- [ ] **Step 1:** Add the exact `workflow.recovery.apply` client mapping and closed apply/receipt types only after S04B exists; keep it separate from the S06A read-only operation map.
- [ ] **Step 2:** Add explicit confirmation bound to the exact current plan fingerprint; cancellation invokes no mutation.
- [ ] **Step 3:** Derive the replay-stable transition token from operation, Project ID, plan fingerprint, and confirmation actor, send it only in the apply request, and never persist or render it.
- [ ] **Step 4:** Render claimed/applied/outcome-unknown states and the exact owner receipt; outcome-unknown disables another apply and exposes doctor remediation.
- [ ] **Step 5:** Refresh only through `project.hub.get` and downstream read operations after an accepted owner receipt; store no plugin-owned task, claim, receipt, or run authority.
- [ ] **Step 6:** Test stale plan, rebound token, missing capability, expired lease, adapter failure, cancel, focus retention, and refreshed owner state.
- [ ] **Step 7:** Run `npm test`, `npm run typecheck`, and `npm run build` from `obsidian-plugin/`.
- [ ] **Step 8:** Execute the actual sanitized apply/receipt/refresh path in Obsidian and record evidence in `p0-s06b-obsidian-recovery-action.md`; principal acceptance gates S07.
- [ ] **Step 9:** Commit `feat: complete Obsidian recovery action journey`.

---

### Task 13: Add dedicated CLI and parity

**Files:**
- Create: `mcp-server/src/project-hub/cli.ts`
- Create: `mcp-server/src/project-hub/cli.test.ts`
- Create: `mcp-server/src/project-hub/parity.test.ts`
- Modify: `mcp-server/package.json`

**Interfaces:**

```ts
export type ProjectHubCliCommand =
  | "snapshot" | "context" | "search" | "candidates" | "plan" | "apply";
export interface ProjectHubCliResult { command: ProjectHubCliCommand; result: unknown; }
export async function runProjectHubCli(
  argv: string[],
  invoke?: (operation: string, args: Record<string, unknown>) => Promise<unknown>,
): Promise<ProjectHubCliResult>;
```

- [ ] **Step 1:** Follow the existing direct Operation-dispatch CLI pattern: parse only adapter arguments, create the same Project Hub/Workflow operation set, and invoke canonical operation names.
- [ ] **Step 2:** Add exact command/argument mapping for snapshot, context, search, candidates, plan, and apply. JSON files carry full plan/apply payloads; secrets never appear in argv or output errors. Claim files remain internal Workflow storage and are not CLI commands.
- [ ] **Step 3:** Add package bin/files/build targets for `llmwiki-project-hub`; generated bundles remain untracked.
- [ ] **Step 4:** On one fixture, compare domain, MCP, and CLI schema versions, fingerprints, reason codes, citations, diagnostics, apply states, and receipts returned by shared operations. Redact adapter-specific stacks and unsafe values.
- [ ] **Step 5:** Run `npm exec bun -- test src/project-hub/cli.test.ts src/project-hub/parity.test.ts src/project/project-hub.test.ts`, `npm run typecheck`, and `npm run build`.
- [ ] **Step 6:** Run `node dist/project-hub/cli.js snapshot --vault tests/fixtures/project-hub-recovery --project project/alpha` and record output in `p0-s07-mcp-cli-parity.md`.
- [ ] **Step 7:** Commit `feat: add Project Hub recovery CLI parity`.

---

### Task 14: Enforce S08 end-to-end acceptance

**Files:**
- Create: `mcp-server/tests/fixtures/project-hub-recovery/**`
- Create: `mcp-server/src/project-hub/recovery-loop.e2e.test.ts`
- Modify: `01-Projects/obsidian-llm-wiki/issues/p0-s08-recovery-loop-acceptance.md`

- [ ] **Step 1:** Build one sanitized fixture containing Project Registry/Binding, Work-OS items, reviewed and draft memory, Session Record, Work Run, agent events/checkpoints, Agent Binding/Profile, capability state, citations, expected locks/fingerprints, and synthetic canaries under suspicious and benign keys.
- [ ] **Step 2:** Automate normal/interrupted recovery, unavailable remediation, stale S01/downstream owner/Binding, missing capability, expired run, valid/quarantined output, resume/create, apply crash windows including expiry-after-claim, output-routing crash windows, same-token replay, both two-token races, outcome-unknown reconciliation, and cross-surface parity.
- [ ] **Step 3:** Scan every domain, plugin-client, MCP, CLI, claim, receipt, diagnostic, and error serialization for canaries, credentials, transcript bodies, and absolute paths.
- [ ] **Step 4:** In actual Obsidian, perform one familiarization and three measured runs. Start at Open Project Hub invocation and stop when a cited action's immutable plan preview is visible; record raw timestamps and require every run under 60 seconds.
- [ ] **Step 5:** Run the exact OpenSpec T9.4 MCP, plugin, Python compatibility, and strict OpenSpec validation commands. Any failure creates a linked Work-OS issue and keeps S08/Foundation incomplete.
- [ ] **Step 6:** Record complete evidence in `p0-s08-recovery-loop-acceptance.md`; commit `test: enforce Project Hub recovery foundation gate`.

---

### Task 15: Align durable status and generated references

**Files:**
- Modify: `01-Projects/obsidian-llm-wiki/issues/p0-s02-resumable-agent-context.md`
- Modify: `01-Projects/obsidian-llm-wiki/issues/p0-s03-project-cited-retrieval.md`
- Modify: `01-Projects/obsidian-llm-wiki/issues/p0-s04-work-run-next-action.md`
- Modify: `01-Projects/obsidian-llm-wiki/issues/p0-s04b-workflow-recovery-apply.md`
- Modify: `01-Projects/obsidian-llm-wiki/issues/p0-s05-agent-output-governance.md`
- Modify: `01-Projects/obsidian-llm-wiki/issues/p0-s06-obsidian-recovery-surface.md`
- Modify: `01-Projects/obsidian-llm-wiki/issues/p0-s06b-obsidian-recovery-action.md`
- Modify: `01-Projects/obsidian-llm-wiki/issues/p0-s07-mcp-cli-parity.md`
- Modify: `01-Projects/obsidian-llm-wiki/issues/p0-s08-recovery-loop-acceptance.md`
- Modify: `ROADMAP.md`
- Modify: `docs/mcp-tools-reference.md`
- Modify: `CHANGELOG.md`
- Modify: `RELEASE_NOTES.md`

- [ ] **Step 1:** Update each issue state/review/dependencies/evidence only for the slice whose verification and independent review passed.
- [ ] **Step 2:** Regenerate operation references from the shared operation catalog; do not hand-edit generated operation signatures.
- [ ] **Step 3:** Update roadmap, changelog, and release notes only for behavior that passed S08. Keep the parent product brief incomplete until the real sanitized journey passes.
- [ ] **Step 4:** Run independent final review against OpenSpec R1–R11, authority/privacy/crash invariants, every changed exported-symbol caller, and test quality.
- [ ] **Step 5:** Rerun affected verification after findings, then commit `docs: close Project Hub recovery foundation slice`.

---

## Self-Review Gate

- Every R1–R11 scenario maps to Tasks 4–14.
- S01 remains unchanged except reuse of behavior-preserving extracted helpers.
- Generic `unified-query.ts` is not made a Project authority.
- Recovery appears in the primary LLM Wiki Project context, not the advanced control-plane modal.
- Workflow factory call sites in core and Agent Domain are both included.
- Python output-routing dead code is included in the TypeScript authority cutover.
- Every mutation has a lock, replay rule, owner receipt, and outcome-unknown path.
- No step contains an unspecified implementation placeholder; all code paths, operations, tests, and evidence destinations are named.
