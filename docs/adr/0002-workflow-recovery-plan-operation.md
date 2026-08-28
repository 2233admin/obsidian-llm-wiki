# ADR 0002 — Read-Only `workflow.recovery.plan` Operation

> **Status:** proposed
> **Date:** 2026-08-28
> **Deciders:** product owner
> **Obsidian blocker resolved:** S06A desktop surface acceptance blocked by capability cycle (S04A exposes no `workflow.recovery.apply` capability; candidate composition requires it `available`; S04B blocked on S06A principal acceptance).

---

## Context

### The capability cycle (root cause)

S06A recorded a dependency cycle in the approved contract:

1. **S04A truthfully exposes no `workflow.recovery.apply` capability** until S04B registers it.
2. **Candidate composition in `composeRecoveryCandidates`** requires `workflow.recovery.apply` to be `available` before any candidate can be recommended.
3. **S04B is blocked on S06A principal acceptance** — the surface cannot reach `searched`/`needs-agent-selection`/`planned` without the capability.
4. **Therefore the full Flow cannot be exercised in actual Obsidian** without either reordering S04B before S06A or changing the gate.

The approved gate (S06A acceptance before S04B starts) is correct for the apply path. The problem is that candidate composition checks a capability it should not need for read-only preview.

### What the blocker prevents

- `searched` stage with candidates and recommended plan intent
- `needs-agent-selection` stage
- `planned` stage with immutable Plan preview
- Candidate replacement and explicit Plan refresh
- Principal acceptance of the actual surface

### What the product owner selected

The product owner explicitly selected a **new public read-only `workflow.recovery.plan` Operation**, not a capability-fact-only change and not a S04B reorder.

---

## Decision

### D1. Introduce `workflow.recovery.plan` as a read-only Workflow Operation

**Name:** `workflow.recovery.plan`

**Request schema:** `workflow-recovery-plan-request/v1` — the outer Operation envelope containing one existing closed `project-hub-recovery-flow-request/v2` Plan/refresh request arm (`plan/from-search`, `plan/override`, or `refresh-plan`). There is no `workflow-recovery-plan/v1` Plan or response schema.

**Response shapes:** reuse existing V2 Flow response schemas:

| Response stage | Source schema |
|---|---|
| `planned` | `RecoveryPlannedResponseV2` |
| `stale` | `RecoveryStaleResponseV2` |
| `unavailable` | `RecoveryUnavailableResponseV2` |

**`mutating: false`** — this Operation writes zero bytes, persists nothing, and has no actor/token/claim/apply path.

**Purpose:** Provide a standalone planning capability fact that candidate composition and compatible Agent Profile validation can require without depending on the mutating `workflow.recovery.apply`.

### D2. Operation request/response shape

**Request arms** — the outer Operation envelope accepts only the closed Plan arms already defined in `project-hub-recovery-flow-request/v2`:

| Request arm | Source | Required fields |
|---|---|---|
| `plan/from-search` | `RecoveryPlanFromSearchRequestV2` | `openFlowFingerprint`, `searchedBasisFlowFingerprint`, `plannedFlowFingerprint:null`, `query`, `limit`, `candidateId`, `agentSelection`, `priorPlan:null` |
| `plan/override` | `RecoveryPlanOverrideRequestV2` | `openFlowFingerprint`, `searchedBasisFlowFingerprint`, `plannedFlowFingerprint`, `query`, `limit`, `candidateId`, `agentSelection`, `priorPlan` (complete) |
| `refresh-plan` | `RecoveryRefreshPlanRequestV2` | `openFlowFingerprint`, `searchedBasisFlowFingerprint`, `plannedFlowFingerprint`, `query`, `limit`, `priorPlan` (complete) |

The Operation does **not** accept `open`, `search`, or `restart` arms. Those remain Flow-only actions.

**Response shape** — returns only existing Flow response stages:

| Response stage | Source |
|---|---|
| `planned` | `RecoveryPlannedResponseV2` |
| `stale` | `RecoveryStaleResponseV2` |
| `unavailable` | `RecoveryUnavailableResponseV2` |

The Operation never returns `open`, `searched`, or `needs-agent-selection` directly — those are Flow-only stages.

### D3. `RecoveryPlanningService`: one shared runtime-constructed service

**Construction:** `RecoveryPlanningService` is constructed once by core composition (inside `makeAllOperations` or the equivalent composition root) and injected into both `makeProjectHubOps` (for `project.hub.recovery.flow` plan/refresh/override delegation) and `makeWorkflowOps` (for `workflow.recovery.plan` registration).

**Runtime injection pattern:**

```ts
// Core composition (inside makeAllOperations or equivalent)
const recoveryPlanHandler = new RecoveryPlanningService(deps);
const projectHubOps = makeProjectHubOps(registry, settings, { recoveryPlanHandler });
const workflowOps = makeWorkflowOps(registry, settings, { recoveryPlanHandler });
```

**Service owns:**
- Full stateless prerequisite recomputation: open → search → candidate → Binding
- Plan fingerprint derivation
- Stale/unavailable response composition
- Five-minute expiry enforcement
- The single `handlePlanRequest` method called by both surfaces

**Service does not own:**
- Actor or token validation (apply-only)
- Claim creation or persistence (apply-only)
- Transition token or receipt (apply-only)

**Capability fact:** `workflow.recovery.plan` capability enters production state `available` when the Operation is registered in `makeWorkflowOps`, not before. Operation order does not determine capability visibility — the capability fact is injected alongside the Operation registration.

### D4. `defaultRecoveryOwners` / core wiring change

**Change:** In the core composition root where `loadCapabilities` is configured for the Recovery open stage, add the `RecoveryPlanningService` instance and remove `loadCapabilities: []`.

**Before:**
```ts
// Inside makeProjectHubOps or composition root
const defaultRecoveryOwners = {
  loadCapabilities: () => [], // empty — no planning capability
  // ...
};
```

**After:**
```ts
// Inside makeProjectHubOps or composition root
const defaultRecoveryOwners = {
  recoveryPlanHandler: sharedRecoveryPlanHandler, // injected from core composition
  // loadCapabilities is resolved from the capability factory, not here
};
```

**Integration test proving capability visibility:** After `makeWorkflowOps` registers `workflow.recovery.plan`, calling the capability factory and filtering for `workflow.recovery.plan` returns `available`. This test must pass even if `makeProjectHubOps` is not yet called — operation order does not determine capability visibility.

**Integration test proving apply is not advertised before S04B:** Before S04B registers `workflow.recovery.apply`, calling the capability factory for that operation name returns `unavailable` or `not_found`. The absence of `workflow.recovery.apply` capability does not prevent `workflow.recovery.plan` from being `available`.

### D5. Plan validation and candidate gating migrate from apply to plan

**`recovery-flow.ts` changes:**

| Behavior | Before S04P | After S04P |
|---|---|---|
| Plan candidate gating in `composeRecoveryCandidates` | checks `workflow.recovery.apply: available` | checks `workflow.recovery.plan: available` |
| Plan validation in `recovery-flow.ts` | `plan` action validates against `workflow.recovery.apply` | `plan` action validates against `workflow.recovery.plan` capability fact |
| S04B independently requires | (not yet implemented) | `workflow.recovery.apply: available` in addition to plan basis |

**Source files affected:**
- `mcp-server/src/project-hub/action-candidates.ts` — `composeRecoveryCandidates` capability check
- `mcp-server/src/project-hub/recovery-flow.ts` — `plan` action delegates to `RecoveryPlanningService`

**Test files affected:**
- `mcp-server/src/project-hub/action-candidates.test.ts` — update capability fixture from `workflow.recovery.apply` to `workflow.recovery.plan`
- `mcp-server/src/project-hub/recovery-flow.test.ts` — add integration test: plan action succeeds when `workflow.recovery.plan: available`; plan action fails with `capability_unavailable` when it is not
- `mcp-server/src/core/operations.test.ts` — add test: `workflow.recovery.plan` capability appears after registration, before any apply registration

**Key files and fixtures to migrate:**

| File | Change |
|---|---|
| `mcp-server/src/project-hub/action-candidates.ts` | `composeRecoveryCandidates` checks `workflow.recovery.plan: available` |
| `mcp-server/src/project-hub/action-candidates.test.ts` | capability fixture: `workflow.recovery.apply` → `workflow.recovery.plan` |
| `mcp-server/src/project-hub/recovery-flow.ts` | `plan` action delegates to `RecoveryPlanningService` |
| `mcp-server/src/core/operations.ts` | register `workflow.recovery.plan` Operation; inject `RecoveryPlanningService` |
| `mcp-server/src/workflow/workflow.ts` | `makeWorkflowOps` registers `workflow.recovery.plan` with injected service |
| `mcp-server/src/project/project-hub.ts` | `makeProjectHubOps` receives injected service |
| `mcp-server/src/core/operations.test.ts` | new: capability fact appears after registration |
| `mcp-server/src/project-hub/recovery-flow.test.ts` | new: plan delegation and capability-gated behavior |

### D6. Two scenario distinctions

**Scenario A — `needs-agent-selection` (multiple Bindings, no generated Plan request):**

When `composeRecoveryCandidates` finds 2–16 compatible Bindings and no generated plan request is produced, the Flow returns `needs-agent-selection`. This stage is reachable with only `workflow.recovery.plan: available`. The user must supply an exact Binding, after which the Flow derives the plan request and returns `planned`.

**Scenario B — `searched` with unique Binding (one plan request generated):**

When `composeRecoveryCandidates` finds exactly one compatible Binding, the searched response contains one derived plan intent. This intent deterministically becomes a closed plan request. The `searched` stage is reachable with only `workflow.recovery.plan: available`. No user-supplied Binding is required.

**Scenario B distinction — multiple Bindings with no candidate plan intent:**

When multiple Bindings are found but none produces a generated plan request (e.g., no candidate meets all safety criteria), the Flow returns `unavailable` with `no_compatible_binding`. The user is not shown a `needs-agent-selection` screen. This distinction matters because multiple Bindings alone do not expose a generated Plan request — the user must select a Binding first.

### D7. Apply separation: planning capability never authorizes mutation

**Planning capability (`workflow.recovery.plan: available`) is necessary but not sufficient for mutation.**

`workflow.recovery.apply` independently proves:
1. Current planning basis (Plan fingerprint, `searchInputFingerprint`, `searchFingerprint`, `candidateSetFingerprint`)
2. `workflow.recovery.apply: available` capability
3. Valid transition token and authenticated actor
4. Claim does not already exist for this plan/token/actor

Missing planning capability → explicit bounded remediation in the unavailable response.

Missing apply capability → separate unavailable response from the apply Operation itself.

### D8. Error, stale, and unavailable behavior

| Condition | Response |
|---|---|
| Open prerequisite fingerprint mismatch | `stale` with ordered changed owners and restart request |
| Searched basis fingerprint mismatch | `stale` |
| Plan/planned fingerprint mismatch | `stale` |
| Incomplete prior Plan on override/refresh | `unavailable` with `prior_plan_incomplete` reason |
| Candidate or Binding not current | `unavailable` with `binding_or_candidate_unavailable` reason |
| No compatible Bindings | `unavailable` with `no_compatible_binding` reason |
| Plan expired on override | `unavailable` with `plan_expired` reason |
| Owner lock changed | `stale` with ordered changed owners |
| Planning capability unavailable | `unavailable` with `capability_unavailable` reason and remediation |

**No write occurs in any error path.** The Operation is idempotent read-only.

### D9. Privacy and no-write guarantees

- The Operation reads Project/Work-OS/Workflow/Memory/Session owners through the same seams as `project.hub.recovery.flow`.
- The Operation writes **zero bytes** to the filesystem, vault, or durable store.
- No claim, token, Plan, session, or intermediate state is persisted.
- No actor identity, host, credential, or raw query is ever persisted.
- The Operation does not call `workflow.agent.start`, `join`, `step`, `checkpoint`, or `leave`.

### D10. Caller migration

`project.hub.recovery.flow` delegates plan actions to the shared service. Callers of `project.hub.recovery.flow` with plan/refresh/override actions experience **identical behavior** — the delegation is an implementation detail.

New callers may invoke `workflow.recovery.plan` directly with a complete Plan request to obtain a `planned`/`stale`/`unavailable` response without going through the full Flow.

### D11. Generated operation docs

The `npm run generate-tools-doc` pipeline regenerates the operation catalog entry for `workflow.recovery.plan` with:
- `name`: `workflow.recovery.plan`
- `mutating`: `false`
- `description`: read-only immutable Plan preview from current Project facts
- `request schema`: `workflow-recovery-plan-request/v1` (outer envelope containing one `project-hub-recovery-flow-request/v2` Plan arm)
- `response schemas`: `RecoveryPlannedResponseV2`, `RecoveryStaleResponseV2`, `RecoveryUnavailableResponseV2`
- `no apply`, `no claim`, `no token`

### D12. API and CLI implications

**MCP:** `workflow.recovery.plan` is a standard Operation callable through the MCP transport. It follows the same schema/response conventions as other Workflow Operations.

**CLI:** The dedicated Recovery Flow CLI (`mcp-server/src/project-hub/cli.ts`) exposes `workflow.recovery.plan` as a `plan` command after `open` and `search`. The CLI does not read claim files or implement stage transitions.

**No new CLI command is required** for the Operation itself — the existing `plan` command in the Flow CLI maps to this Operation.

### D13. Exact test descriptions

| Test | Coverage | File |
|---|---|---|
| Operation registration | `workflow.recovery.plan` registered with correct mutating flag and request/response schema | `mcp-server/src/core/operations.test.ts` |
| Capability fact injection | `workflow.recovery.plan: available` appears in capability list after registration | `mcp-server/src/core/operations.test.ts` |
| Operation order independence | capability appears even when `makeWorkflowOps` is called before `makeProjectHubOps` | `mcp-server/src/core/operations.test.ts` |
| Request arm validation | each of the three arms is accepted with exact fields; unknown arms reject | `mcp-server/src/core/operations.test.ts` |
| Response shape | `planned`/`stale`/`unavailable` responses match Flow response shapes | `mcp-server/src/project-hub/recovery-flow.test.ts` |
| Prerequisite recomputation | plan action recomputes open/search/candidates/Binding and validates fingerprints | `mcp-server/src/project-hub/recovery-flow.test.ts` |
| Stale response | mismatched fingerprints produce `stale` with ordered changed owners | `mcp-server/src/project-hub/recovery-flow.test.ts` |
| Unavailable response | missing/expired candidates produce `unavailable` with remediation | `mcp-server/src/project-hub/recovery-flow.test.ts` |
| No write | no filesystem call, claim, token, or durable state after any request arm | `mcp-server/src/core/operations.test.ts` |
| Duplicate with Flow | same request to Flow and direct Operation produces identical `planned`/`stale`/`unavailable` response | `mcp-server/src/project-hub/recovery-flow.test.ts` |
| Capability separation | `workflow.recovery.plan: available` does not imply `workflow.recovery.apply: available` | `mcp-server/src/core/operations.test.ts` |
| S06A candidate composition | `composeRecoveryCandidates` accepts `workflow.recovery.plan` capability for recommendation | `mcp-server/src/project-hub/action-candidates.test.ts` |
| Plan without apply advertised | before S04B, `workflow.recovery.apply` capability is not available but plan still works | `mcp-server/src/core/operations.test.ts` |
| S04B rejects without apply | after S04P but before S04B, apply request returns `unavailable` | `mcp-server/src/workflow/recovery-apply.test.ts` (added in S04B) |

### D14. Actual Obsidian QA

After S04P registers `workflow.recovery.plan`:
1. Reload the plugin in Obsidian 1.13.7.
2. Open `vault-mind-promote:open-ask-mate-project-context`.
3. Execute `open` → `search` with a safe query.
4. Observe `searched` stage with candidates and recommended plan intent, OR `needs-agent-selection` stage with multiple Bindings, OR `unavailable` if no compatible Binding.
5. If a unique Binding exists, auto-follow or explicitly submit the plan request.
6. Observe `planned` stage with immutable Plan preview.
7. Verify no bytes written to vault, plugin data, or durable store.
8. Verify plugin `data.json` unchanged.

**Stop conditions for T5.3:**
- `searched` stage is unreachable without `workflow.recovery.plan` capability → stop, return evidence, re-run after S04P.
- `planned` stage is unreachable without `workflow.recovery.apply` capability → expected. Continue to step 8.
- Any byte is written to vault/plugin data during read-only stages → stop, file bug.
- Keyboard/focus/cancellation does not work → stop, file bug.

**Rollback:** If the shared service approach introduces regressions in `project.hub.recovery.flow` plan actions:
1. Revert the delegation call in `project.hub.recovery.flow` to inline planning (no service abstraction change to callers).
2. Revert `composeRecoveryCandidates` capability check to `workflow.recovery.apply`.
3. Revert Agent Domain Profile capability requirements.

Rollback does not require reverting the Operation registration itself — the Operation can remain registered while callers use the inline path.

---

## Consequences

### Positive

- S06A desktop surface becomes unblocked: full Flow stages (`searched`, `needs-agent-selection`, `planned`) are reachable without S04B.
- S04B retains its correct dependency order: apply still requires S06A acceptance before starting.
- Capability separation is explicit and auditable: planning does not imply mutation authorization.
- Shared `RecoveryPlanningService` eliminates duplicated planning logic between Flow and direct Operation callers.
- Product owner selection is honored without relitigating the decision.

### Negative

- Two public surfaces expose plan actions: `project.hub.recovery.flow` and `workflow.recovery.plan`. This is intentional — both surfaces are useful and the service is shared.
- Candidate composition must migrate from checking `workflow.recovery.apply` to checking `workflow.recovery.plan`. This is a targeted change in `action-candidates.ts`.

### Neutral

- S04B remains blocked on S06A principal acceptance. S04P unblocks the *surface*, not the *apply path*.
- The cycle is resolved at the design level; implementation requires S04P code work before S06A re-exercises the full Flow.

---

## Alternatives Considered

### A. Reorder S04B before S06A (rejected)

The approved gate (S06A acceptance before S04B) is correct. Apply is mutation that requires demonstrated read-only preview first. Reordering would bypass the gate.

### B. Capability-fact-only change without new Operation (rejected)

Simply changing `composeRecoveryCandidates` to check a different capability name does not produce a public capability fact in production. An Operation registration is required to introduce a named, observable capability that surfaces and Agent Profiles can reference.

### C. Compatibility alias `workflow.recovery.apply → workflow.recovery.plan` (rejected explicitly)

A compatibility alias would conflate planning and mutation authorization. The contract explicitly requires separation: planning capability never authorizes mutation, and apply must independently prove both planning basis and apply availability.

### D. Second Plan schema (rejected explicitly)

The Operation accepts only existing closed Plan arms from `project-hub-recovery-flow-request/v2`. No new schema is introduced. A second Plan schema would duplicate validators and fingerprints. The request envelope is `workflow-recovery-plan-request/v1`; the Plan and response schemas remain `project-hub-recovery-plan/v2` and `RecoveryPlannedResponseV2`/`RecoveryStaleResponseV2`/`RecoveryUnavailableResponseV2`.

### E. Test-only capability injection as product proof (rejected explicitly)

The capability fact must be introduced by production Operation registration, not by test fixture injection. Test-only injection proves nothing about the production capability state.

---

## Non-Goals

- `workflow.recovery.plan` does not create or claim a Work Run.
- The Operation does not accept actor or transition token.
- The Operation does not persist a Plan, claim, token, or session.
- The Operation does not authorize mutation — only `workflow.recovery.apply` does.
- `workflow.recovery.apply` is not introduced or validated by this decision.
- S04B scope is not changed; S04P does not implement apply.
- The S06A gate is not waived; S06A must still demonstrate actual-surface acceptance after S04P.

---

## Assets

| Asset | Path | Change |
|---|---|---|
| This ADR | `docs/adr/0002-workflow-recovery-plan-operation.md` | Create |
| Work-OS issue | `01-Projects/obsidian-llm-wiki/issues/p0-s04p-workflow-recovery-plan.md` | Create |
| Recovery spec | `openspec/changes/project-hub-recovery-loop/specs/project-hub-recovery-loop/spec.md` | Add R12–R15 |
| OpenSpec tasks | `openspec/changes/project-hub-recovery-loop/tasks.md` | Add Task 9A / T4.5 |
| OpenSpec design | `openspec/changes/project-hub-recovery-loop/design.md` | Add D15–D17 |
| OpenSpec proposal | `openspec/changes/project-hub-recovery-loop/proposal.md` | Update change list |
| Implementation plan | `docs/superpowers/plans/2026-08-27-project-hub-recovery-loop.md` | Add Task 9A / T4.5 slice |
| Roadmap | `ROADMAP.md` | Add S04P dependency note |
| S04B issue | `01-Projects/obsidian-llm-wiki/issues/p0-s04b-workflow-recovery-apply.md` | Clarify capability dependency |
| S06A issue | `01-Projects/obsidian-llm-wiki/issues/p0-s06-obsidian-recovery-surface.md` | Update blocker, unblock T5.3 |
| CONTEXT.md | `CONTEXT.md` | Add `workflow.recovery.plan` Operation definition |

---

## Verification

1. **Design review:** Independent reviewer validates this ADR against actual S04A code contracts and the S06A blocker evidence.
2. **ADR approval:** Principal approves before implementation.
3. **S04P implementation:** Register `workflow.recovery.plan` as `mutating: false`, construct and inject `RecoveryPlanningService`, delegate from Flow, update capability check in `composeRecoveryCandidates`, update Agent Domain Profile requirements.
4. **S06A re-exercise:** After S04P lands, re-run actual Obsidian surface test. Verify `searched`, `needs-agent-selection`, and `planned` stages are reachable.
5. **S04B proceeds:** After S06A principal acceptance, S04B implementation starts with correct capability separation.

---

## Evidence destinations and promotion gate

This ADR is `review: draft` and non-executable until the principal approves the written spec. After principal approval, a later integration commit promotes the Work-OS issue `p0-s04p-workflow-recovery-plan` to `review: reviewed` and `state: todo` for implementation.

Evidence collected during S04P implementation:
- S04P verification evidence → `01-Projects/obsidian-llm-wiki/issues/p0-s04p-workflow-recovery-plan.md`
- S06A T5.3 surface evidence → `01-Projects/obsidian-llm-wiki/issues/p0-s06-obsidian-recovery-surface.md`

Promotion gate: principal must approve the `review: draft` ADR before any implementation commit is created in this worktree.

---

## Owners

| Role | Owner |
|---|---|
| Product owner (driver/approver) | product owner — approves ADR, approves S06A surface, authorizes S04B to proceed |
| Workflow maintainer (contract owner) | Workflow team — owns `workflow.recovery.plan` / `workflow.recovery.apply` Operation contracts, schema vocabulary, and capability fact semantics |
| S04P Work-OS issue (implementation owner) | `01-Projects/obsidian-llm-wiki/issues/p0-s04p-workflow-recovery-plan.md` — tracks implementation state, blockers, and evidence |
| Independent controller/reviewer (verification owner) | independent reviewer — verifies design against S04A contracts, approves ADR, reviews S04P implementation before promotion |

---

## Rollback

If the shared service approach introduces regressions in `project.hub.recovery.flow` plan actions:
1. Revert the delegation call in `project.hub.recovery.flow` to inline planning (no service abstraction change to callers).
2. Revert `composeRecoveryCandidates` capability check to `workflow.recovery.apply`.
3. Revert Agent Domain Profile capability requirements.

Rollback does not require reverting the Operation registration itself — the Operation can remain registered while callers use the inline path.
