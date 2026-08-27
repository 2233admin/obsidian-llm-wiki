---
type: issue
entity: project/obsidian-llm-wiki/issue/p0-s04b-workflow-recovery-apply
state: backlog
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/p0-s04b-workflow-recovery-apply
description: "P0 S04B: apply one Recovery Flow v2 Plan through crash-safe Workflow ownership"
status: active
priority: 1
blocked-by:
  - obsidian-llm-wiki/p0-s06-obsidian-recovery-surface
last-verified: 2026-08-28
---

# P0 S04B: claim-first Recovery Flow apply

Parent brief: [[llmwiki-project-driven-knowledge-workspace]]
OpenSpec: `openspec/changes/project-hub-recovery-loop/`
Implementation plan: `docs/superpowers/plans/2026-08-27-project-hub-recovery-loop.md` Task 12

## What to build

Apply one complete current `project-hub-recovery-plan/v2` plus safe ephemeral query/limit planning input through Workflow-owned `workflow.recovery.apply`. Validate Plan bytes, planning proof, and authenticated actor; load exact claims before fresh expiry checks; claim plan/token/planning-input digests before owner mutation; then resume the exact Work Run or execute deterministic TypeScript-governed create-and-join. Persist one auditable receipt or outcome-unknown and never persist the raw query.

## Acceptance

- [ ] `recovery-apply-request/v2` contains the complete Plan, presented fingerprint, safe normalized `{query,limit}` planning input, and transition token; actor comes only from OperationContext.
- [ ] Immutable Plan owns role/Binding/Profile and search-input/search/candidate fingerprints but no raw query, agent ID, or host; authenticated actor becomes Work Run identity and host fallback.
- [ ] Existing exact applied/claimed/outcome-unknown claims are loaded before new-claim expiry checks; claim recovery after Plan expiry verifies Plan/token/planning-input/actor and local Work Run/lease identity without re-reading mutable pre-claim selection locks.
- [ ] A new claim uses ephemeral planning input to recompute open→search→candidate→Binding and prove the Plan basis, then revalidates current owner/capability/lease facts and expiry before mutation; claim persists only the planning-input digest.
- [ ] Resume reuses exact Project/Work Item/Work Run. Create derives one Work Run ID from Project/Work Item/Plan fingerprint, creates/verifies one durable lease and local lease for actor, and never calls manual start.
- [ ] Same-token replay returns/recovers one receipt; rebound conflicts; two-token race creates/joins at most one Work Run.
- [ ] Every crash window, including expiry after claim, deterministically returns one receipt or persists outcome-unknown and blocks mutation replay.
- [ ] Every frozen `makeWorkflowOps` caller, including Fleet verifier, is migrated and verified.

## Demo

Apply resume/create Plans, interrupt every claim/owner/receipt window, retry before and after Plan expiry, race two tokens, and observe one Work Run receipt or explicit outcome-unknown reconciliation.

## Dependencies

Blocked by accepted S06A actual-Obsidian preview. Project Hub remains read-only.

## Non-goals

- Do not add a mutating Project Hub Operation, server Flow session, manual Work Run start, or Plan store.