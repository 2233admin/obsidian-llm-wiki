---
type: issue
entity: project/obsidian-llm-wiki/issue/p0-s01-project-hub-recovery-snapshot
state: backlog
review: draft
kind: knowledge-task
id: obsidian-llm-wiki/p0-s01-project-hub-recovery-snapshot
description: "P0 S01: compose a deterministic Project Hub recovery snapshot"
status: active
priority: 1
blocked-by: []
last-verified: 2026-08-27
---

# P0 S01: Project Hub recovery snapshot

Parent brief: [[llmwiki-project-driven-knowledge-workspace]]

## What to build

Define and implement the read-only recovery snapshot that Project Hub uses as its product entry. Compose current Project ID and Workspace Binding, Work-OS state, reviewed Project Memory, recent Work Runs or Session Records, capability health, freshness, diagnostics, citation targets, and bounded next-action candidates without creating a second state store.

## Acceptance

- [ ] A versioned JSON-safe snapshot contract exists with stable Project ID, freshness, diagnostics, citations, current stage, done, in-progress, blocked, not-started, and next-action fields.
- [ ] The composer reads each input through its owning domain boundary and never writes Work-OS, Memory, Session Record, or Settings state.
- [ ] Machine-local workspace paths remain bindings and never replace Project ID.
- [ ] Missing, stale, partial, and unavailable inputs remain explicit states with a remediation or manual next step.
- [ ] A sanitized project fixture produces the same snapshot and fingerprint on repeated runs.
- [ ] Contract tests prove that a malformed or stale input cannot silently become current truth.

## Demo

Open a sanitized Project Hub input and see a deterministic recovery snapshot with the project state, evidence links, freshness, diagnostics, and one bounded next action.

## Dependencies

None. This slice creates the shared read model consumed by later slices.
