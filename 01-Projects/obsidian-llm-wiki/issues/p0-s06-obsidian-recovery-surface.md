---
type: issue
entity: project/obsidian-llm-wiki/issue/p0-s06-obsidian-recovery-surface
state: backlog
review: draft
kind: knowledge-task
id: obsidian-llm-wiki/p0-s06-obsidian-recovery-surface
description: "P0 S06: ship the Obsidian Project Hub recovery surface"
status: active
priority: 1
blocked-by:
  - obsidian-llm-wiki/p0-s01-project-hub-recovery-snapshot
  - obsidian-llm-wiki/p0-s02-resumable-agent-context
  - obsidian-llm-wiki/p0-s03-project-cited-retrieval
  - obsidian-llm-wiki/p0-s04-work-run-next-action
  - obsidian-llm-wiki/p0-s05-agent-output-governance
last-verified: 2026-08-27
---

# P0 S06: Obsidian recovery surface

Parent brief: [[llmwiki-project-driven-knowledge-workspace]]

## What to build

Make the Obsidian plugin the primary human-facing Project Hub surface. Present the recovery snapshot, citations, freshness and diagnostics, resumable Agent context, and explicit next actions without copying domain state into plugin-owned storage.

## Acceptance

- [ ] The user can open a Project Hub for a Project ID and see the current recovery snapshot in a bounded, scannable view.
- [ ] Done, in-progress, blocked, not-started, next action, freshness, and diagnostics are visible without opening raw files first.
- [ ] Important claims link to their Citation Targets and distinguish evidence from model summaries.
- [ ] The user can inspect a resumable Agent context and choose a governed next action from the same surface.
- [ ] Missing capability or stale data shows a remediation path; the UI never silently presents an empty or guessed state as current.
- [ ] Project Hub writes only through domain operations and remains a derived view after refresh.
- [ ] Keyboard navigation and focus states support the recovery journey on the supported Obsidian surface.

## Demo

Open a sanitized project in Obsidian, inspect its state and citations, resume its Agent context, select the next action, and return to the refreshed Hub after the receipt.

## Dependencies

Blocked by S01 through S05. This is the primary human surface over the completed domain journey.
