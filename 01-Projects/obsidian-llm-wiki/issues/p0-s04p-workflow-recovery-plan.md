---
type: issue
entity: project/obsidian-llm-wiki/issue/p0-s04p-workflow-recovery-plan
state: todo
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/p0-s04p-workflow-recovery-plan
description: "P0 S04P: register read-only workflow.recovery.plan Operation to unblock S06A surface"
status: active
priority: 1
blocked-by:
  - obsidian-llm-wiki/p0-s04-work-run-next-action
blocks:
  - obsidian-llm-wiki/p0-s06-obsidian-recovery-surface
last-verified: 2026-08-28
---

# P0 S04P: register read-only `workflow.recovery.plan` Operation

Parent brief: [[llmwiki-project-driven-knowledge-workspace]]
ADR: `docs/adr/0002-workflow-recovery-plan-operation.md`
OpenSpec: `openspec/changes/project-hub-recovery-loop/`
Implementation plan: `docs/superpowers/plans/2026-08-27-project-hub-recovery-loop.md` Task 9A

## What to build

Register `workflow.recovery.plan` as a `mutating: false` Workflow Operation that accepts only the closed Plan request arms (`plan/from-search`, `plan/override`, `refresh-plan`) and returns only existing `planned|stale|unavailable` Flow responses. One default Recovery runtime is created with the plan capability fact; one `RecoveryPlanningService` is created from its capability-aware dependencies and the same runtime/service are injected into both `makeProjectHubOps` and `makeWorkflowOps` before either operation array is built. `composeRecoveryCandidates` and `validateRecoveryPlanV2` require `workflow.recovery.plan: available` instead of apply for planning; the Plan keeps `owningOperation: 'workflow.recovery.apply'` for later mutation. The Operation writes zero bytes, has no actor/token/claim/apply path, and persists nothing.

Implementation file set: `mcp-server/src/project-hub/recovery-flow.ts`,
`mcp-server/src/project-hub/action-plan.ts`,
`mcp-server/src/project/project-hub.ts`,
`mcp-server/src/workflow/recovery-plan.ts`,
`mcp-server/src/workflow/workflow.ts`, and
`mcp-server/src/core/operations.ts`, with focused tests in
`action-plan.test.ts`, `search.test.ts`, `agent-selection.test.ts`,
`action-candidates.test.ts`, `project/project-hub.test.ts`,
`recovery-flow.test.ts`, Workflow/core operation catalog tests, and
`mcp-server/src/workflow/recovery-plan.test.ts`,
`mcp-server/src/scripts/generate-tools-doc.test.ts`. Check
`mcp-server/src/scripts/generate-tools-doc.ts` and regenerate
`docs/mcp-tools-reference.md`; change the generator source only if catalog
handling requires it.

## Background and root cause

Before S04P, the planning gate was coupled to a capability that only S04B may
register:

1. S04A truthfully exposes no `workflow.recovery.apply` capability until S04B registers it.
2. Candidate composition (`composeRecoveryCandidates`) was coupled to the
   future apply capability before recommending candidates.
3. S04B is blocked on S06A principal acceptance.
4. S04P separates the read-only planning capability from apply; S06A remains
   blocked pending this principal-gated design and its later implementation.

The product owner explicitly selected a **new public read-only `workflow.recovery.plan` Operation** to break this cycle, not a capability-fact-only change and not a S04B reorder.

## Acceptance

- [ ] Exact envelope: `WORKFLOW_RECOVERY_PLAN_REQUEST_SCHEMA_VERSION = "workflow-recovery-plan-request/v1"`; `WorkflowRecoveryPlanEnvelopeV1 { schemaVersion; request: RecoveryPlanFromSearchRequestV2 | RecoveryPlanOverrideRequestV2 | RecoveryRefreshPlanRequestV2 }`. Plan arms source `project-hub-recovery-flow-request/v2`; responses reuse `RecoveryPlannedResponseV2 | RecoveryStaleResponseV2 | RecoveryUnavailableResponseV2`; no `workflow-recovery-plan/v1` Plan/response schema.
- [ ] Exact service: `RecoveryPlanningService { capabilityFact; plan(request): Promise<RecoveryPlannedResponseV2 | RecoveryStaleResponseV2 | RecoveryUnavailableResponseV2> }` plus `createRecoveryPlanningService(dependencies): RecoveryPlanningService`. Service owns prerequisite recomputation, Plan fingerprint derivation, stale/unavailable response composition, and five-minute expiry enforcement.
- [ ] Core creates the default Recovery runtime with `workflow.recovery.plan: available`, creates the service from capability-aware runtime dependencies, then injects the same runtime/service into current `makeProjectHubOps(registry, settingsService?, options?)` and `makeWorkflowOps(vaultPath, options?)` before either operation array is built. Operation order cannot control visibility.
- [ ] `project.hub.recovery.flow` delegates its plan/refresh/override actions to the shared service; callers experience identical behavior.
- [ ] `workflow.recovery.plan` capability fact enters production state `available` when the Operation is registered. Operation order does not determine capability visibility.
- [ ] Integration test proves Project Hub sees `workflow.recovery.plan` after registration and never sees `workflow.recovery.apply` before S04B.
- [ ] `composeRecoveryCandidates` checks `workflow.recovery.plan: available` (not `workflow.recovery.apply`) for candidate recommendation.
- [ ] `validateRecoveryPlanV2` in `mcp-server/src/project-hub/recovery-flow.ts` migrates its capability invariant from available apply to available plan; `owningOperation` remains apply. S04B performs the separate apply-capability check before claims.
- [ ] Compatible Agent Profile capability requirements use `workflow.recovery.plan` (not `workflow.recovery.apply`) for planning gate.
- [ ] Missing planning capability produces explicit bounded remediation in the unavailable response.
- [ ] Planning capability never authorizes mutation; `workflow.recovery.apply` independently proves both current planning basis and apply availability.
- [ ] No bytes written, no actor/token/claim/apply path, no Plan/session/claim persistence.
- [ ] Catalog checks cover `docs/mcp-tools-reference.md`, `mcp-server/src/scripts/generate-tools-doc.ts`, and `mcp-server/src/scripts/generate-tools-doc.test.ts`; run `npm run generate-tools-doc`. Change generator source only if catalog handling requires it; current fallback should render the new Workflow entry.
- [ ] Existing `project.hub.recovery.flow` plan action tests pass because the service is shared (scope of change is delegation, not behavior).
- [ ] Direct `workflow.recovery.plan` request tests pass with identical `planned|stale|unavailable` responses.
- [ ] Fixtures migrate apply-only planning facts to plan in `action-plan.test.ts`, `search.test.ts`, `agent-selection.test.ts`, `action-candidates.test.ts`, `project/project-hub.test.ts`, and `recovery-flow.test.ts`; valid multiple Bindings return `needs-agent-selection` with bindings/candidates and no generated Plan request, never false `no_compatible_binding`/`no_safe_candidate`.

## Non-goals

- Do not create or claim a Work Run.
- Do not accept actor or transition token.
- Do not persist a Plan, claim, token, or session.
- Do not authorize mutation — only `workflow.recovery.apply` does.
- Do not implement `workflow.recovery.apply`.
- Do not change S04B scope.
- Do not waive S06A gate — principal must still accept actual surface.

## PRD/ROADMAP wording

The product owner approved ADR 0002 and promoted S04P to
`review: reviewed` with `state: todo`. S04P is the immediately executable
leaf. S06A remains blocked until S04P implementation and independent
verification pass.

## Dependencies

Blocked by complete S04A V2 read Flow and V1 cutover. Blocks completion of S06A (T5.3). S04B continues to be blocked on S06A principal acceptance.

## Demo

Register the Operation, invoke it directly
with a complete Plan request, observe `planned|stale|unavailable` responses,
verify before/after SHA-256 and byte equality for fixture vault files, plugin
`data.json`, and durable recovery roots, verify `composeRecoveryCandidates`
and `validateRecoveryPlanV2` accept only the plan capability, and run the
actual Obsidian six-stage S06A gate: `open`, `searched`,
`needs-agent-selection` (valid multiple Bindings/candidates, no generated Plan
request), `planned` while apply is absent/unusable, `stale`, and
`unavailable` with bounded remediation. Stop on any write, missing plan
capability, failure to reach planned without apply, skipped fingerprint
validation, or keyboard/focus/cancellation failure.

## Schema vocabulary

- Operation request schema: `workflow-recovery-plan-request/v1` (outer envelope)
- Plan arm source schema: `project-hub-recovery-flow-request/v2`
- Plan schema: `project-hub-recovery-plan/v2`
- Response schemas: `RecoveryPlannedResponseV2`, `RecoveryStaleResponseV2`, `RecoveryUnavailableResponseV2`
- There is no `workflow-recovery-plan/v1` Plan or response schema.
