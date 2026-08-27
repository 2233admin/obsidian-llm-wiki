---
type: issue
entity: project/obsidian-llm-wiki/issue/p0-s06-obsidian-recovery-surface
state: backlog
review: draft
kind: knowledge-task
id: obsidian-llm-wiki/p0-s06-obsidian-recovery-surface
description: "P0 S06A: prove the Obsidian Project Hub recovery preview before mutation"
status: active
priority: 1
blocked-by:
  - obsidian-llm-wiki/p0-s01-project-hub-recovery-snapshot
  - obsidian-llm-wiki/p0-s02-resumable-agent-context
  - obsidian-llm-wiki/p0-s03-project-cited-retrieval
  - obsidian-llm-wiki/p0-s04-work-run-next-action
last-verified: 2026-08-27
---

# P0 S06A: Obsidian recovery preview

Parent brief: [[llmwiki-project-driven-knowledge-workspace]]

## What to build

Make the Obsidian plugin prove the primary human recovery journey before Workflow mutation is implemented. Present the S01 snapshot, S02 context, S03 cited retrieval, additive S04A candidates, and immutable plan preview without copying domain state or performing a write.

## Acceptance

- [ ] The user can open a Project Hub for a Project ID and see the bounded current recovery snapshot, work-state groups, freshness, and diagnostics without opening raw files.
- [ ] Important claims link to Citation Targets and distinguish reviewed evidence from drafts or model summaries.
- [ ] The user can inspect context, search evidence, select an available candidate, choose an exact current Project Agent Binding revision, and inspect the immutable plan and effects.
- [ ] Missing capability, blocked work, unavailable candidate, stale S01/owner/Agent Binding lock, and unavailable evidence show exact remediation; the UI never presents empty or guessed state as current.
- [ ] Every Project Hub operation used by this preview is read-only and the sanitized fixture remains byte-identical.
- [ ] Keyboard order, focus retention, cancellation, and plan-preview readability pass in the actual Obsidian surface.
- [ ] Principal accepts the actual-surface preview before S04B mutation starts.

## Demo

Open a sanitized interrupted Project in Obsidian, inspect state/context/citations, search the current blocker, select resume or create candidate, and review the immutable plan while proving that no Work Run or durable state changed.

## Dependencies

Blocked by S01, S02, S03, and S04A. S04B is blocked on this actual-Obsidian proof.

## Non-goals

- Do not call `workflow.recovery.apply`, create/resume a Work Run, or show a success receipt.
- Do not persist plugin-owned recovery, task, plan, or run state.
