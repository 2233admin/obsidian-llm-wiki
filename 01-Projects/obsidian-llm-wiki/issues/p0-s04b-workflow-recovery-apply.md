---
type: issue
entity: project/obsidian-llm-wiki/issue/p0-s04b-workflow-recovery-apply
state: backlog
review: draft
kind: knowledge-task
id: obsidian-llm-wiki/p0-s04b-workflow-recovery-apply
description: "P0 S04B: apply an approved recovery plan through crash-safe Workflow ownership"
status: active
priority: 1
blocked-by:
  - obsidian-llm-wiki/p0-s04-work-run-next-action
  - obsidian-llm-wiki/p0-s06-obsidian-recovery-surface
last-verified: 2026-08-27
---

# P0 S04B: crash-safe Workflow recovery apply

Parent brief: [[llmwiki-project-driven-knowledge-workspace]]
OpenSpec: `openspec/changes/project-hub-recovery-loop/`

## What to build

Apply one current full `project-hub-action-plan/v1` through Workflow-owned `workflow.recovery.apply`. Recompute the presented fingerprint and owner locks, bind the authenticated actor and transition-token digest, then either join the existing run or execute the TypeScript-governed create-and-join branch. Persist a closed auditable receipt and stop for reconciliation when owner outcome cannot be proven.

## Acceptance

- [ ] The closed apply request carries the complete canonical plan, presented plan fingerprint, and transition token; authenticated actor context comes from the operation runtime.
- [ ] Plan-keyed claim, token index, `recovery-apply/v1` claim, and closed receipt fields/nulls/enums/bounds/fingerprints/timestamps match OpenSpec D8.
- [ ] Resume reuses the exact Project ID, Work Item ID, Work Run ID, and Agent Binding/Profile through existing join.
- [ ] Create does not call manual `workflow.agent.start`; it derives Work Run ID solely from the plan, then creates or verifies one durable leased run and local lease for the authoritative unblocked Work Item and exact Agent Binding/Profile before join.
- [ ] Token rebound conflicts; same-token replay returns the owner receipt; concurrent different tokens for one plan can produce at most one Work Run.
- [ ] Failure before owner mutation, after run/lease creation before join receipt, after applied receipt before response, and the two-token race are deterministic and tested.
- [ ] Unprovable owner outcome persists `outcome-unknown`, blocks automatic replay, and requires `workflow.agent.doctor` reconciliation.
- [ ] Project Hub remains read-only and no issue, memory, settings, or plugin-owned state is written directly.

## Demo

Apply one resume and one create plan, interrupt each fault-injection window, retry with the same token, and observe either the same single Work Run receipt or an explicit outcome-unknown reconciliation state.

## Dependencies

Blocked by S04A and S06A. The primary Obsidian preview must prove the plan is understandable before mutation is implemented.

## Non-goals

- Do not add a mutating `project.hub.*` operation.
- Do not change S01 semantics, call manual `workflow.agent.start`, or require the Python Work Driver.
