---
type: issue
entity: project/obsidian-llm-wiki/issue/p0-s05-agent-output-governance
state: backlog
review: draft
kind: knowledge-task
id: obsidian-llm-wiki/p0-s05-agent-output-governance
description: "P0 S05: classify Agent output and route it through governance"
status: active
priority: 1
blocked-by:
  - obsidian-llm-wiki/p0-s04b-workflow-recovery-apply
last-verified: 2026-08-27
---

# P0 S05: Agent output governance

Parent brief: [[llmwiki-project-driven-knowledge-workspace]]
OpenSpec: `openspec/changes/project-hub-recovery-loop/`
Implementation plan: `docs/superpowers/plans/2026-08-27-project-hub-recovery-loop.md` Task 11

## What to build

Classify every completed Agent result from the Work Run boundary as a derived view, work-state transition, knowledge claim, or external side effect. Route each class through the matching Promotion Policy, capture draft evidence where needed, and keep the Project Hub refresh derived from accepted domain state.

## Acceptance

- [ ] The four Run Output Classes are explicit and versioned.
- [ ] View output cannot be promoted as project truth.
- [ ] Work-state transitions may follow the allowlisted automatic path and return a receipt.
- [ ] Knowledge claims always enter a reviewable draft or review queue with citations.
- [ ] External side effects require explicit per-run approval and an Operation Write Policy verdict.
- [ ] Unclassifiable or malformed output uses a closed quarantine arm that persists only safe identity, payload fingerprint, provenance, and diagnostics; unsafe payload bytes are neither stored nor echoed.
- [ ] Output fingerprint plus leave transition token is claimed before owner mutation; same-token retry returns or recovers one owner receipt, rebound conflicts, and unprovable owner outcome becomes `outcome-unknown` without repeating the effect.
- [ ] Accepted output is captured with Project ID, Work Run ID, provenance, and a refreshable fingerprint.

## Implementation boundary

- `workflow.agent.leave` is the single `completed|awaiting_review` boundary and consumes the closed output submission; step/checkpoint may record progress but cannot bypass routing.
- Preserve the durable `output_class` and `approval_status` fields used by TypeScript and Python Work Run records.
- TypeScript owns claimed routing and the route receipt. Remove the production-unused Python `route_work_run_output` helper when the TypeScript route lands; keep Python Work Run creation/transition compatibility.

## Demo

Run one Agent task that returns each output class and see the four distinct routes, including a hard approval gate for an external side effect and a draft artifact for a knowledge claim.

## Dependencies

Blocked by S04B because governance starts from the applied Work Run result boundary.
