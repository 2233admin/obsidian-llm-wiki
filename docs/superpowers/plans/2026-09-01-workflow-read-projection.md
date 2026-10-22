# Workflow Read Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `WorkflowReadModel` the single semantic read seam for Work Run runtime state while preserving Project Hub's current output structure and behavior.

**Architecture:** Extend the existing `WorkflowReadModel` module with one fully-evaluated `NormalizedWorkRunProjection` result for Project Hub runtime composition. Move Work Run JSON parsing, legacy alias handling, recursive file discovery, expiry, malformed diagnostics, workflow status parsing, and drift classification behind that existing seam. Project Hub will map the projection into its existing `runtime` section and will retain no second parser.

**Tech Stack:** TypeScript, Node `node:test`, filesystem-backed JSON/Markdown fixtures, SHA-256 fingerprints, existing MCP Project Hub and Workflow modules.

**Spec:** `docs/adr/0003-workflow-read-projection.md` (created in Task 1 from the confirmed Q1–Q12 decisions)

## Global Constraints

- `WorkflowReadModel` is the only semantic owner and public read seam for Work Run runtime state.
- Project Hub output shape, field meanings, sorting, health, freshness, and diagnostic strings remain unchanged.
- Do not add a second public reader module or a second Work Run store.
- Projection values are fully evaluated and immutable; no cross-request cache is introduced.
- Expiry uses an explicit `observedAt` input so tests are deterministic.
- Legacy JSON aliases and malformed-record behavior remain externally compatible: malformed, missing-project, and project-mismatched files contribute drift but do not enter `activeRuns`, `staleRuns`, or `runCount`; valid JSON arrays and non-null scalar values enter alias lookup and report `run_project_id_missing:<path>`, while JSON `null` remains a caught `malformed_run:<path>`; valid-project files with invalid Work Run or Work Item IDs remain represented with null invalid identifiers.
- Runtime file discovery remains recursive under the Work-OS `runs` root, excludes `output-*` and `recovery-*` internal trees, and reports non-canonical nested run paths as drift without silently dropping readable records.
- Vault Markdown and Work-OS records remain canonical; this change only moves read interpretation.
- Preserve unrelated dirty work. Do not commit, push, fetch, reset, clean, stash, or run project-wide validation during implementation tasks.

---

### Task 1: Record the read-seam contract and freeze current behavior

**Files:**
- Create: `docs/adr/0003-workflow-read-projection.md`
- Modify: `mcp-server/src/workflow/workflow-read-model.test.ts`
- Modify: `mcp-server/src/project/project-hub.test.ts`

**Interfaces:**
- Consumes: existing `WorkflowReadModel` and `composeProjectHub` behavior.
- Produces: named contract fixtures and tests for `NormalizedWorkRunProjection`, used by Tasks 2–4.

- [ ] **Step 1: Write the ADR from the confirmed decisions**

Record these decisions as accepted implementation constraints: extend `WorkflowReadModel`; keep Project Hub output unchanged; use structured contract tests plus 2–3 representative snapshots; compute expiry/drift per request with explicit `observedAt`; preserve aliases/malformed diagnostics; delete Hub's duplicate `runtimeSection` parser after cutover.

- [ ] **Step 2: Add deterministic Work Run fixture helpers**

Create fixtures for:

```ts
const normalRun = {
  projectId: 'project/alpha',
  workRunId: 'work-run/run-1',
  workItemId: 'project/alpha/issue/task-1',
  agentId: 'agent-1',
  state: 'running',
  stage: 'execute',
  updatedAt: '2026-09-01T10:00:00.000Z',
  leaseExpiresAt: '2026-09-01T11:00:00.000Z',
};

const legacyRun = {
  project_id: 'project/alpha',
  work_run_id: 'work-run/run-2',
  work_item_id: 'project/alpha/issue/task-2',
  agent_id: 'agent-1',
  state: 'awaiting_review',
  agentStage: 'review',
  updated_at: '2026-09-01T10:00:00.000Z',
  handoff_expires_at: '2026-09-01T09:00:00.000Z',
};
```

Add malformed, canonical/legacy conflict, project mismatch, invalid expiry, nested path, and excluded-tree fixtures. Use a fixed `observedAt` in every expiry assertion.

- [ ] **Step 3: Add failing Workflow projection contract tests**

Assert the future read seam returns a fully evaluated projection with:

```ts
const projection = model.readRuntimeProjection('project/alpha', 1725184800000);
assert.deepEqual(projection.activeRuns[0], {
  projectId: 'project/alpha',
  workRunId: 'work-run/run-1',
  workItemId: 'project/alpha/issue/task-1',
  state: 'running',
  stage: 'execute',
  resumable: true,
  path: '01-Projects/alpha/runs/run-1.json',
  stale: false,
  citationTargets: ['01-Projects/alpha/runs/run-1.json'],
});
assert.equal(projection.runCount, 2);
assert.deepEqual(projection.drift, [
  'expired_work_run:01-Projects/alpha/runs/run-2.json',
]);
```

Malformed JSON, missing-project, and project-mismatched files must be represented by drift only, matching the current Hub contract; they do not increment `runCount` or enter either run collection. Also assert legacy aliases, invalid IDs, invalid expiry, deterministic active/stale ordering with multiple records, raw source-file/diagnostic ordering, explicit `observedAt`, and immutable fully evaluated values.

- [ ] **Step 4: Add failing Project Hub contract tests and representative snapshots**

Before changing Hub implementation, capture the current `runtime` section for three fixtures: normal completed state, legacy alias state, and malformed/drift state. Prefer explicit assertions for fields and diagnostics; use snapshots only for the complete representative section shape. Exclude timestamps, incidental property ordering, and whitespace from semantic assertions. Cover `agentStateFiles`, source files/citation targets, freshness, health, workflow state, stage, and stage citation.

- [ ] **Step 5: Run the focused tests and record the expected failure**

Run:

```bash
cd mcp-server
npm exec bun -- test src/workflow/workflow-read-model.test.ts src/project/project-hub.test.ts
```

Expected: the new projection tests fail because `readRuntimeProjection` does not yet exist; existing tests remain the compatibility baseline.


---

### Task 2: Extend WorkflowReadModel with the normalized runtime projection

**Files:**
- Modify: `mcp-server/src/workflow/workflow-read-model.ts`
- Modify: `mcp-server/src/workflow/workflow-read-model.test.ts`

**Interfaces:**
- Consumes: existing `WorkflowRunRead`, `WorkflowCheckpointRead`, `createWorkflowReadModel`, and the Task 1 fixtures.
- Produces: `NormalizedWorkRunProjection` and `WorkflowReadModel.readRuntimeProjection(projectId, observedAt?)`.

The public types are:

```ts
export interface NormalizedWorkRunRuntime {
  readonly projectId: string;
  readonly workRunId: string | null;
  readonly workItemId: string | null;
  readonly state: string | null;
  readonly stage: string | null;
  readonly resumable: boolean;
  readonly path: string;
  readonly stale: boolean;
  readonly citationTargets: readonly string[];
}

export interface NormalizedWorkRunProjection {
  readonly activeRuns: readonly NormalizedWorkRunRuntime[];
  readonly staleRuns: readonly NormalizedWorkRunRuntime[];
  readonly runCount: number;
  readonly agentStateFiles: readonly string[];
  readonly workflowState: {
    readonly stage: string;
    readonly objective: string;
    readonly path: string;
  } | null;
  readonly stage: string | null;
  readonly stageCitation: string | null;
  readonly sourceFiles: readonly string[];
  readonly drift: readonly string[];
}

export interface WorkflowReadModel {
  readRun(projectId: string, workRunId: string): WorkflowRunRead | null;
  listRuns(projectId: string): WorkflowRunRead[];
  listCheckpoints(projectId: string, workRunId: string): WorkflowCheckpointRead[];
  checkpointSetFingerprint(projectId: string, workRunId: string): RecoveryFingerprint;
  readRuntimeProjection(projectId: string, observedAt?: number): NormalizedWorkRunProjection;
}
```

- [ ] **Step 1: Add the projection types and failing method implementation stub**

Add the types above and make the method throw a temporary error so TypeScript exposes every call site that must be wired. Do not add a second reader module or export parser helpers.

- [ ] **Step 2: Move alias-aware field selection into the Workflow implementation**

Implement a private helper that accepts canonical and legacy names, returns the canonical value when only one exists, and appends the existing conflict diagnostic when both differ. Cover `projectId/project_id`, `workRunId/work_run_id`, `workItemId/work_item_id`, and all existing expiry aliases including `leaseExpiresAt`, `lease_expires_at`, `handoffExpiresAt`, `handoff_expires_at`, `expiresAt`, and `expires_at`.

- [ ] **Step 3: Implement recursive runtime file discovery**

Walk the Work-OS `runs` root recursively. Include JSON files; exclude paths containing the existing `output-*` and `recovery-*` internal trees. Preserve relative vault paths for citations. Add a deterministic `run_noncanonical_path:<path>` drift entry for readable JSON below the direct `runs/` level, while still parsing the record.

- [ ] **Step 4: Implement fully evaluated run normalization and expiry**

For each readable JSON file, parse through the existing validation rules. Preserve the current Hub inclusion semantics: malformed JSON, missing project ID, and project-mismatched records contribute drift but are omitted from normalized run collections and `runCount`; valid JSON arrays and non-null scalar values follow the prior alias lookup and report `run_project_id_missing:<path>`, while JSON `null` dereference remains `malformed_run:<path>`; valid-project records with invalid Work Run or Work Item IDs remain represented with null invalid identifiers. For included records, preserve the active-state set (`planned`, `leased`, `running`, `awaiting_review`), expiry behavior, and resumability rules. Compute all values using the method's explicit `observedAt` value.
- [ ] **Step 5: Move workflow status and agent file reads behind the same projection**

Read the existing `workflow/status.md` and agent event roots from the Work-OS project root. Preserve `malformed_workflow_state`, `stage`, and `stageCitation` fallback behavior. Return all source files needed by Project Hub freshness calculation.

- [ ] **Step 6: Implement deterministic ordering and frozen output**

Preserve the existing Hub runtime ordering: active and stale runs retain the lexical `filesBelow` path order (including nested paths), and staged-run fallback selects the first resumable staged active run in that order. Preserve deterministic drift insertion order from the same file traversal. Sort source files only where the existing `section` helper sorts citation targets. Return new arrays and nested records on every call so callers cannot mutate internal state. Do not store the previous projection between calls.

- [ ] **Step 7: Run the focused Workflow tests**

Run:

```bash
cd mcp-server
npm exec bun -- test src/workflow/workflow-read-model.test.ts
```

Expected: all new projection tests and existing Workflow read tests pass.

---

### Task 3: Switch Project Hub to the Workflow projection and delete the duplicate parser

**Files:**
- Modify: `mcp-server/src/project/project-hub.ts`
- Modify: `mcp-server/src/project/project-hub.test.ts`

**Interfaces:**
- Consumes: `WorkflowReadModel.readRuntimeProjection(projectId, observedAt?)` from Task 2.
- Produces: unchanged Project Hub `sections.runtime` output and no Hub-owned Work Run JSON parser.

- [ ] **Step 1: Change `runtimeSection` to consume the existing read model**

Replace its raw file scanning, alias parsing, expiry calculation, malformed handling, workflow status read, active-run filtering, and staged-run selection with a single call:

```ts
const projection = workflow.readRuntimeProjection(
  context.projectId,
  observedAt,
);
```

Map `projection.sourceFiles` into the existing `section` freshness input and map projection fields into the current runtime data shape without renaming or reordering semantic fields.

- [ ] **Step 2: Remove the Hub duplicate implementation**

Delete `aliasedRunField` and the old `runtimeSection` parsing body. Remove now-unused imports such as direct Work Run JSON parsing helpers while retaining imports used by other Project Hub sections. Do not delete Workflow-owned parsers or change the `HubSection` contract.

- [ ] **Step 3: Preserve the existing Project Hub output contract**

Run the Task 1 structured assertions and representative snapshots. Assert identical values for active runs, stale runs, run count, agent state files, workflow state, stage, stage citation, freshness, health, and drift. Ensure Project Hub remains read-only and derived.

- [ ] **Step 4: Run the focused Project Hub tests**

Run:

```bash
cd mcp-server
npm exec bun -- test src/project/project-hub.test.ts src/workflow/workflow-read-model.test.ts
```

Expected: all focused tests pass with no duplicate-parser compatibility failures.

---

### Task 4: Prove the seam has locality and no hidden state

**Files:**
- Modify: `mcp-server/src/workflow/workflow-read-model.test.ts`
- Modify: `mcp-server/src/project/project-hub.test.ts`
- Inspect: `mcp-server/src/project/project-hub.ts`
- Inspect: `mcp-server/src/workflow/workflow-read-model.ts`

**Interfaces:**
- Consumes: the final `WorkflowReadModel` projection seam and unchanged Project Hub output.
- Produces: regression evidence for time determinism, source-path compatibility, alias compatibility, and deletion of the second path.

- [ ] **Step 1: Test explicit-time determinism**

Call `readRuntimeProjection` twice with the same vault and `observedAt`; assert deep equality. Call it with a later `observedAt`; assert only expiry/stale-derived values change. This proves no hidden `Date.now()` or cross-request cache is involved.

- [ ] **Step 2: Test alias and malformed compatibility**

Assert canonical-only, legacy-only, canonical/legacy-equal, canonical/legacy-conflicting, malformed JSON, project mismatch, invalid ID, invalid expiry, and nested-path diagnostics. Assert every citation target remains vault-relative and every diagnostic is deterministic.

- [ ] **Step 3: Test Project Hub uses one read seam**

Inject a test `WorkflowReadModel` whose `readRuntimeProjection` returns a known projection and whose other Work Run methods throw if called by `runtimeSection`. Assert Project Hub produces the expected runtime section from the single projection call. This test checks locality without exposing parser implementation details.

- [ ] **Step 4: Scan the changed modules for the deleted path**

Confirm `project-hub.ts` no longer contains raw Work Run JSON parsing, alias selection, expiry alias lists, or a second Work Run normalization path. Confirm only `workflow-read-model.ts` owns those semantics.

- [ ] **Step 5: Run the complete relevant verification set**

Run:

```bash
cd mcp-server
npm exec bun -- test src/workflow/workflow-read-model.test.ts src/project/project-hub.test.ts src/project-hub/recovery-open.test.ts src/project-hub/search.test.ts src/project-hub/recovery-flow.test.ts
npm run typecheck
```

Expected: all listed tests pass and TypeScript reports no errors.

- [ ] **Step 6: Run the repository's existing required gates once**

Run only after the focused seam tests pass:

```bash
cd mcp-server
npm test
```

Record the result as evidence for the implementation issue. Do not alter unrelated failures or broaden the refactor.

---

## Spec coverage review

- Q1 full semantic convergence: Tasks 2–3 move parsing, aliases, checkpoints, fingerprints, expiry, malformed handling, and drift behind Workflow.
- Q2 unchanged external contract: Tasks 1 and 3 use structured assertions and limited snapshots.
- Q3 Workflow ownership: Task 3 removes Hub parsing and Task 4 verifies a single call point.
- Q4 existing WorkflowReadModel seam: Task 2 extends it; no second public reader.
- Q5 contract strategy C: Task 1 uses explicit tests plus three representative snapshots.
- Q6 request-local memoization: Task 2 computes fully evaluated immutable output; Task 4 proves no cross-request state.
- Q7 compatibility/deletion: Tasks 2–4 preserve aliases and diagnostics and delete `runtimeSection`'s duplicate implementation.
- Q11 recursive discovery: Task 2 preserves recursion, exclusions, and reports nested paths as drift.
- Q12 explicit observedAt: Tasks 2 and 4 pass time explicitly and test determinism.

## Execution guard

This plan intentionally does not implement the broader Brain / Source / Knowledge Item consolidation, GBrain method absorption, retrieval unification, or graph/index replacement. Those remain separate architecture work until this focused read-seam change is reviewed and accepted.
