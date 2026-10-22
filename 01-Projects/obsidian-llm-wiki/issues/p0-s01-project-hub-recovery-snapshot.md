---
type: issue
entity: project/obsidian-llm-wiki/issue/p0-s01-project-hub-recovery-snapshot
state: done
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/p0-s01-project-hub-recovery-snapshot
description: "P0 S01: compose a deterministic Project Hub recovery snapshot"
status: active
priority: 1
blocked-by: []
last-verified: 2026-08-28
---

# P0 S01: Project Hub recovery snapshot

Parent brief: [[llmwiki-project-driven-knowledge-workspace]]

## What to build

Define and implement the read-only recovery snapshot that Project Hub uses as its product entry. Compose current Project ID and Workspace Binding, Work-OS state, reviewed Project Memory, recent Work Runs or Session Records, capability health, freshness, diagnostics, citation targets, and bounded next-action candidates without creating a second state store.

## Acceptance

- [x] A versioned JSON-safe snapshot contract exists with stable Project ID, freshness, diagnostics, citations, current stage, done, in-progress, blocked, not-started, and next-action fields.
- [x] The composer reads each input through its owning domain boundary and never writes Work-OS, Memory, Session Record, or Settings state.
- [x] Machine-local workspace paths remain bindings and never replace Project ID.
- [x] Missing, stale, partial, and unavailable inputs remain explicit states with a remediation or manual next step.
- [x] A sanitized project fixture produces the same snapshot and fingerprint on repeated runs.
- [x] Contract tests prove that a malformed or stale input cannot silently become current truth.

## Demo

Open a sanitized Project Hub input and see a deterministic recovery snapshot with the project state, evidence links, freshness, diagnostics, and one bounded next action.

## Verification

- `npm exec bun -- test src/project/project-hub.test.ts src/project/agent-room-legacy-characterization.test.ts src/workflow/workflow.test.ts` — 50 passed.
- `npm run typecheck` — passed, including settings, Agent Domain, Visual Workspace, and Problem Intake package builds.
- `npm run test:source` — 725 passed; one pre-existing stale generated-doc failure remains in `src/scripts/generate-tools-doc.test.ts` because `docs/mcp-tools-reference.md` does not match the generator output.

## Dependencies

None. This slice creates the shared read model consumed by later slices.

## Historical status and successor

This issue remains the completed V1 behavior/evidence record and is never
reopened or rewritten as V2. The approved successor is
[[p0-s01b-project-hub-recovery-flow-v2]]. S04A will use this issue's fixture for
V1-to-V2 action-fact equivalence, then clean-remove V1 production code without
altering this historical completion record.
