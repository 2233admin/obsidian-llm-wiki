---
type: issue
entity: project/obsidian-llm-wiki/issue/p0-s05-agent-output-governance
state: backlog
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/p0-s05-agent-output-governance
description: "P0 S05: claim and route every successful/review Work Run output exactly once"
status: active
priority: 1
blocked-by:
  - obsidian-llm-wiki/p0-s04b-workflow-recovery-apply
last-verified: 2026-08-28
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