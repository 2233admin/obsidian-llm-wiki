---
type: issue
entity: project/obsidian-llm-wiki/issue/p0-s04-work-run-next-action
state: backlog
review: draft
kind: knowledge-task
id: obsidian-llm-wiki/p0-s04-work-run-next-action
description: "P0 S04: turn a cited recovery next action into a governed Work Run"
status: active
priority: 1
blocked-by:
  - obsidian-llm-wiki/p0-s01-project-hub-recovery-snapshot
  - obsidian-llm-wiki/p0-s02-resumable-agent-context
  - obsidian-llm-wiki/p0-s03-project-cited-retrieval
last-verified: 2026-08-27
---

# P0 S04: Work Run next action

Parent brief: [[llmwiki-project-driven-knowledge-workspace]]

## What to build

Let the user choose one bounded next action from the recovery snapshot and either resume a valid Work Run or create a new governed Work Run. Pass stable Project ID, Work Item ID, Work Run ID, transition context, citations, and capability prerequisites through the owning Work Driver and Agent Layer.

## Acceptance

- [ ] A next-action candidate can be selected only from the current, fingerprinted recovery snapshot.
- [ ] Resume and create paths use stable Project ID, Work Item ID, Work Run ID, and transition token values.
- [ ] The action carries the relevant evidence and context bundle without copying private transcript material into project truth.
- [ ] Missing capability, expired lease, stale snapshot, invalid target, and duplicate transition token fail explicitly before mutation.
- [ ] A successful start or resume returns an auditable Work Run receipt and updates no state outside the owning operation.
- [ ] Repeating the same transition request is replay-safe and does not create a second Work Run.

## Demo

From a cited recovery snapshot, choose “continue next task,” resume the valid Work Run, and see its receipt; repeat the request and receive the recorded result instead of a duplicate run.

## Dependencies

Blocked by S01, S02, and S03. The action needs the recovery snapshot, resumable context, and cited retrieval result.
