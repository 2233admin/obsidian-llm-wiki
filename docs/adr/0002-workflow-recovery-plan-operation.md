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

**Schema:** `workflow-recovery-plan/v1`

**`mutating: false`** — this Operation writes zero bytes, persists nothing, and has no actor/token/claim/apply path.

**Purpose:** Provide a standalone planning capability fact that candidate composition and compatible Agent Profile validation can require without depending on the mutating `workflow.recovery.apply`.

### D2. Operation request/response shape

**Request arms** — the Operation accepts only the closed Plan arms already defined in `project-hub-recovery-flow-request/v2`:

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

### D3. One shared planning handler

**`project.hub.recovery.flow`** delegates its `plan/from-search`, `plan/override`, and `refresh-plan` actions to the shared planning handler. The public surfaces are **duplicated** (Flow still exposes the same plan actions; the new Operation exposes them independently), but the **semantics, validators, and fingerprints are not copied** — both surfaces call the same internal handler.

**Handler owns:**
- Full stateless prerequisite recomputation: open → search → candidate → Binding
- Plan fingerprint derivation
- Stale/unavailable response composition
- Five-minute expiry enforcement

**Handler does not own:**
- Actor or token validation (apply-only)
- Claim creation or persistence (apply-only)
- Transition token or receipt (apply-only)

### D4. Capability fact: `workflow.recovery.plan` available when registered

**Introduction:** `workflow.recovery.plan` capability fact enters production state `available` only when the Operation is registered in `makeWorkflowOps`.

**Purpose:** Candidate composition (S04A `composeRecoveryCandidates`) requires `workflow.recovery.plan: available` instead of `workflow.recovery.apply: available`.

**Compatible Agent Profiles:** Profile capability requirements use `workflow.recovery.plan`, not `workflow.recovery.apply`, for planning gate.

**Effect:** Candidate recommendation, `needs-agent-selection`, and `planned` stages become reachable without S04B. The full read-only Flow exercises correctly in S06A.

### D5. Apply separation: planning capability never authorizes mutation

**Planning capability (`workflow.recovery.plan: available`) is necessary but not sufficient for mutation.**

`workflow.recovery.apply` independently proves:
1. Current planning basis (Plan fingerprint, `searchInputFingerprint`, `searchFingerprint`, `candidateSetFingerprint`)
2. `workflow.recovery.apply: available` capability
3. Valid transition token and authenticated actor
4. Claim does not already exist for this plan/token/actor

Missing planning capability → explicit bounded remediation in the unavailable response.

Missing apply capability → separate unavailable response from the apply Operation itself.

### D6. Error, stale, and unavailable behavior

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

**No write occurs in any error path.** The Operation is idempotent read-only.

### D7. Privacy and no-write guarantees

- The Operation reads Project/Work-OS/Workflow/Memory/Session owners through the same seams as `project.hub.recovery.flow`.
- The Operation writes **zero bytes** to the filesystem, vault, or durable store.
- No claim, token, Plan, session, or intermediate state is persisted.
- No actor identity, host, credential, or raw query is ever persisted.
- The Operation does not call `workflow.agent.start`, `join`, `step`, `checkpoint`, or `leave`.

### D8. Caller migration

`project.hub.recovery.flow` delegates plan actions to the shared handler. Callers of `project.hub.recovery.flow` with plan/refresh/override actions experience **identical behavior** — the delegation is an implementation detail.

New callers may invoke `workflow.recovery.plan` directly with a complete Plan request to obtain a `planned`/`stale`/`unavailable` response without going through the full Flow.

### D9. Generated operation docs

The `npm run generate-tools-doc` pipeline regenerates the operation catalog entry for `workflow.recovery.plan` with:
- `name`: `workflow.recovery.plan`
- `mutating`: `false`
- `description`: read-only immutable Plan preview from current Project facts
- `request arms`: `plan/from-search`, `plan/override`, `refresh-plan`
- `response stages`: `planned`, `stale`, `unavailable`
- `no apply`, `no claim`, `no token`

### D10. API and CLI implications

**MCP:** `workflow.recovery.plan` is a standard Operation callable through the MCP transport. It follows the same schema/response conventions as other Workflow Operations.

**CLI:** The dedicated Recovery Flow CLI (`mcp-server/src/project-hub/cli.ts`) exposes `workflow.recovery.plan` as a `plan` command after `open` and `search`. The CLI does not read claim files or implement stage transitions.

**No new CLI command is required** for the Operation itself — the existing `plan` command in the Flow CLI maps to this Operation.

### D11. Exact tests

| Test | Coverage |
|---|---|
| Operation registration | `workflow.recovery.plan` registered with correct mutating flag and schema version |
| Capability fact injection | `workflow.recovery.plan: available` appears in capability list after registration |
| Request arm validation | Each of the three arms is accepted with exact fields; unknown arms reject |
| Response shape | `planned`/`stale`/`unavailable` responses match Flow response shapes |
| Prerequisite recomputation | Plan action recomputes open/search/candidates/Binding and validates fingerprints |
| Stale response | Mismatched fingerprints produce `stale` with ordered changed owners |
| Unavailable response | Missing/expired candidates produce `unavailable` with remediation |
| No write | No filesystem call, claim, token, or durable state after any request arm |
| Duplicate with Flow | Same request to Flow and direct Operation produces identical `planned`/`stale`/`unavailable` response |
| Capability separation | `workflow.recovery.plan: available` does not imply `workflow.recovery.apply: available` |
| S06A candidate composition | `composeRecoveryCandidates` accepts `workflow.recovery.plan` capability for recommendation |

### D12. Actual Obsidian QA

After S04P registers `workflow.recovery.plan`:
1. Reload the plugin in Obsidian 1.13.7.
2. Open `vault-mind-promote:open-ask-mate-project-context`.
3. Execute `open` → `search` with a safe query.
4. Observe `searched` stage with candidates and recommended plan intent.
5. Auto-follow or explicitly submit the plan request.
6. Observe `planned` stage with immutable Plan preview.
7. Verify no bytes written to vault, plugin data, or durable store.
8. Verify plugin `data.json` unchanged.

---

## Consequences

### Positive

- S06A desktop surface becomes unblocked: full Flow stages (`searched`, `needs-agent-selection`, `planned`) are reachable without S04B.
- S04B retains its correct dependency order: apply still requires S06A acceptance before starting.
- Capability separation is explicit and auditable: planning does not imply mutation authorization.
- Shared handler eliminates duplicated planning logic between Flow and direct Operation callers.
- Product owner selection is honored without relitigating the decision.

### Negative

- Two public surfaces expose plan actions: `project.hub.recovery.flow` and `workflow.recovery.plan`. This is intentional — both surfaces are useful and the handler is shared.
- Candidate composition must migrate from checking `workflow.recovery.apply` to checking `workflow.recovery.plan`. This is a one-line change in `action-candidates.ts` (already verified in code).

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

The Operation accepts only existing closed Plan arms from `project-hub-recovery-flow-request/v2`. No new schema is introduced. A second Plan schema would duplicate validators and fingerprints.

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
| Recovery spec | `openspec/changes/project-hub-recovery-loop/specs/project-hub-recovery-loop/spec.md` | Add R12 |
| OpenSpec tasks | `openspec/changes/project-hub-recovery-loop/tasks.md` | Add Task 9A |
| OpenSpec design | `openspec/changes/project-hub-recovery-loop/design.md` | Add D15–D17 |
| OpenSpec proposal | `openspec/changes/project-hub-recovery-loop/proposal.md` | Update change list |
| Implementation plan | `docs/superpowers/plans/2026-08-27-project-hub-recovery-loop.md` | Add Task 9A / T4.5 slice |
| Roadmap | `ROADMAP.md` | Add S04P dependency note |
| S04A issue | `01-Projects/obsidian-llm-wiki/issues/p0-s04-work-run-next-action.md` | Amend blocked-by |
| S04B issue | `01-Projects/obsidian-llm-wiki/issues/p0-s04b-workflow-recovery-apply.md` | Clarify capability dependency |
| S06A issue | `01-Projects/obsidian-llm-wiki/issues/p0-s06-obsidian-recovery-surface.md` | Update blocker, unblock T5.3 |
| CONTEXT.md | `CONTEXT.md` | Add `workflow.recovery.plan` Operation definition |

---

## Verification

1. **Design review:** Independent reviewer validates this ADR against actual S04A code contracts and the S06A blocker evidence.
2. **ADR approval:** Principal approves before implementation.
3. **S04P implementation:** Register `workflow.recovery.plan` as `mutating: false`, delegate from Flow, update capability check in `composeRecoveryCandidates`, update Agent Domain Profile requirements.
4. **S06A re-exercise:** After S04P lands, re-run actual Obsidian surface test. Verify `searched`, `needs-agent-selection`, and `planned` stages are reachable.
5. **S04B proceeds:** After S06A principal acceptance, S04B implementation starts with correct capability separation.

---

## Rollback

If the shared handler approach introduces regressions in `project.hub.recovery.flow` plan actions:
1. Revert the delegation call in `project.hub.recovery.flow` to inline planning (no handler abstraction change to callers).
2. Revert `composeRecoveryCandidates` capability check to `workflow.recovery.apply`.
3. Revert Agent Domain Profile capability requirements.

Rollback does not require reverting the Operation registration itself — the Operation can remain registered while callers use the inline path.

---

## Owners

- **Design:** this worktree  
- **S04P implementation:** assigned agent  
- **S06A re-acceptance:** product owner  
- **S04B continuation:** assigned agent after S06A acceptance
