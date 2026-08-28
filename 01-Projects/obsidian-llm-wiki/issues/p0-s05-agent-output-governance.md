---
type: issue
entity: project/obsidian-llm-wiki/issue/p0-s05-agent-output-governance
state: in-progress
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/p0-s05-agent-output-governance
description: "P0 S05: claim and route every successful/review Work Run output exactly once"
status: active
priority: 1
blocked-by:
  - obsidian-llm-wiki/p0-s04b-workflow-recovery-apply
last-verified: 2026-08-29
---

# P0 S05: claimed Work Run output governance

Parent brief: [[llmwiki-project-driven-knowledge-workspace]]
OpenSpec: `openspec/changes/project-hub-recovery-loop/`
Implementation plan: `docs/superpowers/plans/2026-08-27-project-hub-recovery-loop.md` Task 13

## What to build

Clean-cut `workflow.agent.leave` to a closed request union: complete mode carries exact Work Run identity, transition token, `completed|awaiting_review`, and one valid/quarantine submission; terminate mode carries `failed|cancelled` and `submission:null`. Actor comes from OperationContext. Claim output fingerprint plus leave-token/actor digest before owner mutation, route exactly once, and return a durable receipt or outcome-unknown.

## Acceptance

- [ ] Complete/terminate arms reject unknown fields and invalid target/submission combinations; legacy leave `work_run_state|output_class|approval_status` is rejected.
- [ ] Valid classes are explicit: view, work-state-transition, knowledge-claim, and external-side-effect.
- [ ] Quarantine persists only authoritative Work Run identities, safe observed class, payload fingerprint, provenance, and bounded diagnostics; malformed payload bytes are never stored or echoed.
- [ ] Output/token/actor claim is durable before owner mutation; same-token retry returns or recovers one owner receipt, rebound conflicts, and unprovable owner result becomes outcome-unknown without repeating the effect.
- [ ] View remains artifact-only; work-state transition uses allowlisted Work-OS; knowledge claim creates/binds one cited Project Memory draft without promotion; external effect requires exact approval and Operation Write Policy.
- [ ] step/checkpoint cannot enter `completed|awaiting_review`; all existing successful/review callers migrate to complete-mode leave. Failed/cancelled uses terminate mode.
- [ ] Durable `output_class` and `approval_status` remain compatible inside TypeScript/Python Work Run records even though legacy public leave fields are removed.
- [ ] The production-unused Python output router is removed and no second routing authority remains.
- [ ] Only accepted owner state changes the recomposed Recovery Flow; review-required/denied/quarantined output is not current truth.

## Demo

Route every valid class and quarantine, replay/race/interupt each mutating owner path, bind an existing Dream Time proposal without duplication, and observe one owner receipt or outcome-unknown.

## Dependencies

Blocked by S04B because governance starts from the applied Work Run result boundary.

## Non-goals

- Do not auto-promote claims, repeat unknown external effects, or persist raw Agent responses.

## Verification report — 2026-08-29

Implemented the remaining governance hardening on top of `a9a8bdacb7aa4f6ae8f9ef6ff93b87af1ccd6145`:

- `workflow.agent.leave` now rejects any `agent` other than the authenticated `OperationContext` actor, including direct handler invocation.
- `WorkRunStore` strictly scans bounded output claims by token digest before creating a claim, preventing an initial split-index rebound from producing a second owner effect; missing indexes are repaired.
- Quarantine receipts remain review-required and effect-free across interruption/restart; malformed diagnostics and non-array citation targets are rejected without raw payload echo.
- Safe owner reconciliation runs before `outcome-unknown`; external nested invocation exceptions/results after invocation remain unknown and are never relabeled denied. External authorization uses the server-issued Agent Domain grant path with active child/profile/binding checks, exact operation/project/run/actor/output approval bindings, and external-write scope.
- Dream Time’s internal leave caller now uses the authenticated actor, satisfying the same actor invariant.

Exact verified tests:

- `bun test src/workflow`: 67 passed, 0 failed across `output-governance.test.ts`, `recovery-apply.test.ts`, `recovery-plan.test.ts`, `work-run-store.test.ts`, `workflow-read-model.test.ts`, and `workflow.test.ts`.
- `bun test src/agent-domain/operations.test.ts`: 13 passed, 0 failed.
- `npm run typecheck`: passed; platform builds and TypeScript no-emit passed.

Crash-route matrix:

| Route | Before owner | After owner / before receipt | Receipt / token split | Replay result |
|---|---|---|---|---|
| quarantine | review receipt, no owner mutation | review receipt via safe reconcile | claim scan repairs missing token | same review receipt |
| view | unknown unless exact owner receipt is observable | exact lifetime leave receipt recovers | claim scan repairs missing token | one receipt; no repeat |
| work-state transition | unknown unless exact issue owner result is observable | nested dispatcher policy/target checks apply | claim scan repairs missing token | one joined issue mutation |
| knowledge claim | unknown unless exact owner receipt is observable | one cited draft / lifetime receipt | claim scan repairs missing token | one draft, no promotion |
| external side effect | denied with diagnostic before nested invocation | throw/unknown result persists outcome-unknown | claim scan repairs missing token | blocked until explicit reconciliation |
| terminate | exact leave receipt or unknown | exact lifetime leave receipt recovers | claim scan repairs missing token | one terminal transition |

The repository-wide `npm test` invocation remains Bun-runner incompatible in this checkout: its mixed `node:test` files produce nested `describe()`/`test()` errors after the passing suites; no S05 assertion failure was observed in the focused slices above.

## Verification evidence — 2026-08-29 (R8 integration repair)

- `bun test src/workflow/output-governance.test.ts src/workflow/workflow.test.ts`: **48 passed, 0 failed**. Named new coverage: `pre-owner token write failure preserves a claimed retry and runs one owner effect`; `work-state output routes through the production dispatcher and reconciles a nested owner throw`; `external output uses a real Agent Domain grant and production nested dispatcher exactly once`; `review-required outputs cannot complete without explicit approval`; `workflow.agent.leave quarantine is review-required and does not mutate lifetime or events`.
- `bun test mcp-server/src/agent-domain/operations.test.ts`: **13 passed, 0 failed**.
- `npm run typecheck`: **passed**. `npm run build`: **passed**.
- Repairs cover pre-owner claim recovery, observable Work-OS state reconciliation, real Agent Domain grant loading (including canonical `child.grantSummary == grant`), cited draft-only knowledge routing, and Windows-safe draft filenames. S05 remains **in-progress**; Fleet/Python/strict OpenSpec gates were not run in this worker checkout.
