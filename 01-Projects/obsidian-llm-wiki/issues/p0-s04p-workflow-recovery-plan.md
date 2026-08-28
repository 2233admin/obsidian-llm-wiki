---
type: issue
entity: project/obsidian-llm-wiki/issue/p0-s04p-workflow-recovery-plan
state: todo
review: draft
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

Register `workflow.recovery.plan` as a `mutating: false` Workflow Operation that accepts only the closed Plan request arms (`plan/from-search`, `plan/override`, `refresh-plan`) and returns only existing `planned|stale|unavailable` Flow responses. One shared planning handler is owned by `project.hub.recovery.flow` for delegation; `composeRecoveryCandidates` checks `workflow.recovery.plan: available` instead of `workflow.recovery.apply`. The Operation writes zero bytes, has no actor/token/claim/apply path, and persists nothing.

## Background and root cause

S06A desktop acceptance is blocked by a dependency cycle:

1. S04A truthfully exposes no `workflow.recovery.apply` capability until S04B registers it.
2. Candidate composition (`composeRecoveryCandidates`) requires `workflow.recovery.apply: available` before recommending candidates.
3. S04B is blocked on S06A principal acceptance.
4. Therefore `searched`, `needs-agent-selection`, and `planned` stages are unreachable without S04B.

The product owner explicitly selected a **new public read-only `workflow.recovery.plan` Operation** to break this cycle, not a capability-fact-only change and not a S04B reorder.

## Acceptance

- [ ] `workflow.recovery.plan` registered with `mutating: false`, schema `workflow-recovery-plan/v1`, request arms `plan/from-search|override`, `refresh-plan`, and response stages `planned|stale|unavailable`.
- [ ] One shared planning handler owns full stateless prerequisite recomputation (open→search→candidate→Binding) and Plan fingerprint derivation; semantics/validators/fingerprints are not duplicated.
- [ ] `project.hub.recovery.flow` delegates its plan/refresh/override actions to the shared handler; callers experience identical behavior.
- [ ] `workflow.recovery.plan` capability fact enters production state `available` when the Operation is registered.
- [ ] `composeRecoveryCandidates` checks `workflow.recovery.plan: available` (not `workflow.recovery.apply`) for candidate recommendation.
- [ ] Compatible Agent Profile capability requirements use `workflow.recovery.plan` (not `workflow.recovery.apply`) for planning gate.
- [ ] Missing planning capability produces explicit bounded remediation in the unavailable response.
- [ ] Planning capability never authorizes mutation; `workflow.recovery.apply` independently proves both current planning basis and apply availability.
- [ ] No bytes written, no actor/token/claim/apply path, no Plan/session/claim persistence.
- [ ] `npm run generate-tools-doc` regenerates operation catalog with correct schema and description.
- [ ] Existing `project.hub.recovery.flow` plan action tests pass without modification.
- [ ] Direct `workflow.recovery.plan` request tests pass with identical `planned|stale|unavailable` responses.

## Non-goals

- Do not create or claim a Work Run.
- Do not accept actor or transition token.
- Do not persist a Plan, claim, token, or session.
- Do not authorize mutation — only `workflow.recovery.apply` does.
- Do not implement `workflow.recovery.apply`.
- Do not change S04B scope.
- Do not waive S06A gate — principal must still accept actual surface.

## Dependencies

Blocked by complete S04A V2 read Flow and V1 cutover. Blocks completion of S06A (T5.3). S04B continues to be blocked on S06A principal acceptance.

## Demo

Register the Operation, invoke it directly with a complete Plan request, observe `planned|stale|unavailable` responses, verify no bytes written, verify `composeRecoveryCandidates` accepts `workflow.recovery.plan` capability, and re-run S06A surface test to prove `searched`, `needs-agent-selection`, and `planned` stages are reachable.
