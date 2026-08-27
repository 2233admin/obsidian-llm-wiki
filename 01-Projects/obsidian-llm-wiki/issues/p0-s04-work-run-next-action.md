---
type: issue
entity: project/obsidian-llm-wiki/issue/p0-s04-work-run-next-action
state: backlog
review: draft
kind: knowledge-task
id: obsidian-llm-wiki/p0-s04-work-run-next-action
description: "P0 S04A: derive additive recovery action candidates and immutable plans"
status: active
priority: 1
blocked-by:
  - obsidian-llm-wiki/p0-s01-project-hub-recovery-snapshot
  - obsidian-llm-wiki/p0-s02-resumable-agent-context
  - obsidian-llm-wiki/p0-s03-project-cited-retrieval
last-verified: 2026-08-27
---

# P0 S04A: recovery action candidates and plan

Parent brief: [[llmwiki-project-driven-knowledge-workspace]]
OpenSpec: `openspec/changes/project-hub-recovery-loop/`
Implementation plan: `docs/superpowers/plans/2026-08-27-project-hub-recovery-loop.md` Tasks 6–7

## What to build

Derive a versioned action-candidate set from the unchanged S01 snapshot plus current S02 context and S03 search locks. Reuse S01 resume actions and add a create candidate only through the OpenSpec rule; then produce an immutable, read-only plan for one candidate. This slice performs no Work Run mutation.

## Acceptance

- [ ] The closed candidate contract preserves S01, reuses valid resume identities, creates only from valid session/context/work/capability locks, and returns a fingerprinted zero-candidate unavailable arm with capability facts and remediation when no safe action exists.
- [ ] `project-hub-action-plan/v1` binds Project ID, Work Item ID, nullable Work Run ID, all upstream fingerprints, exact current Project Agent Binding/Profile revisions, citations, capability facts, five-minute expiry, owning operation, and candidate-set fingerprint.
- [ ] `project.hub.action-candidates.get` and `project.hub.action.plan` are read-only; all Project Hub operations remain `mutating: false`.
- [ ] Invented/stale candidates, unavailable arms, and changed/mismatched Agent Binding, Profile, capability, identity, or lock inputs reject explicitly and never substitute another action or agent.
- [ ] Same inputs produce the same candidate-set and plan fingerprints.
- [ ] Tests cover OpenSpec R6 and leave the sanitized fixture byte-identical.

## Demo

From a cited S01 snapshot, show one valid resume candidate; from a session-only fallback, show one additive create candidate; preview each immutable plan and prove that no Work Run or other durable state changed.

## Dependencies

Blocked by S01, S02, and S03. This read-only plan must pass before S06A Obsidian preview; S04B owns mutation.

## Non-goals

- Do not start, join, resume, or create a Work Run.
- Do not change `project-hub-recovery/v1` or reinterpret `inspect-work-item` as a create action.
