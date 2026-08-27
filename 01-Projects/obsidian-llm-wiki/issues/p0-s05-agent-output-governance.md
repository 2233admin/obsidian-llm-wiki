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
  - obsidian-llm-wiki/p0-s04-work-run-next-action
last-verified: 2026-08-27
---

# P0 S05: Agent output governance

Parent brief: [[llmwiki-project-driven-knowledge-workspace]]

## What to build

Classify every completed Agent result from the Work Run boundary as a derived view, work-state transition, knowledge claim, or external side effect. Route each class through the matching Promotion Policy, capture draft evidence where needed, and keep the Project Hub refresh derived from accepted domain state.

## Acceptance

- [ ] The four Run Output Classes are explicit and versioned.
- [ ] View output cannot be promoted as project truth.
- [ ] Work-state transitions may follow the allowlisted automatic path and return a receipt.
- [ ] Knowledge claims always enter a reviewable draft or review queue with citations.
- [ ] External side effects require explicit per-run approval and an Operation Write Policy verdict.
- [ ] Unclassifiable or malformed output falls back to review instead of being silently discarded or promoted.
- [ ] Accepted output is captured with Project ID, Work Run ID, provenance, and a refreshable fingerprint.

## Demo

Run one Agent task that returns each output class and see the four distinct routes, including a hard approval gate for an external side effect and a draft artifact for a knowledge claim.

## Dependencies

Blocked by S04 because governance starts from the Work Run result boundary.
