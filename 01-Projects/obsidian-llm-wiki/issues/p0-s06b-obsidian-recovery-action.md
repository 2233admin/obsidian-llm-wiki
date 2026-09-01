---
type: issue
entity: project/obsidian-llm-wiki/issue/p0-s06b-obsidian-recovery-action
state: done
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/p0-s06b-obsidian-recovery-action
description: "P0 S06B: confirm Recovery Flow Plan, show receipt, and restart from owner state"
status: active
priority: 1
blocked-by:
  - obsidian-llm-wiki/p0-s05-agent-output-governance
last-verified: 2026-08-29
---

# P0 S06B: Obsidian apply, receipt, and Flow restart

Parent brief: [[llmwiki-project-driven-knowledge-workspace]]
OpenSpec: `openspec/changes/project-hub-recovery-loop/`
Implementation plan: `docs/superpowers/plans/2026-08-27-project-hub-recovery-loop.md` Task 14

## What to build

Extend the accepted read-only panel with exact unexpired-Plan confirmation, Workflow apply, claim/receipt/outcome state, and a fresh Flow open from owner state. Keep transition token and all Flow state ephemeral.

## Acceptance

- [x] Apply mapping is added only after S04B and calls exact `workflow.recovery.apply` with full V2 Plan/fingerprint, current safe ephemeral query/limit planning input, and a replay-stable ephemeral token; no raw query is persisted in Plan, claim, or plugin data.
- [x] User confirms the exact visible unexpired Plan; cancellation performs no write and expired Plan requires explicit refresh.
- [x] claimed/applied/outcome-unknown and the exact owner receipt are visible without copying claim/run authority into plugin data.
- [x] outcome-unknown disables another mutation and exposes doctor reconciliation.
- [x] Accepted receipt discards current ephemeral Flow and opens a new Flow from owner state; review-required/denied output does not appear as current truth.
- [x] stale Plan, rebound token, missing capability, expired lease, adapter failure, confirmation/cancel, focus retention, and restart states pass tests and actual Obsidian verification.
- [x] Reload/reopen persists no query, results, candidate, Binding, Plan, claim, receipt, or Work Run state.

## Demo

Confirm one current Plan, observe one Work Run receipt and output route, restart Flow from owners, then exercise cancel, expired Plan, and outcome-unknown without duplicate mutation.

## Dependencies

Blocked by S05; accepted S06A preview is already required transitively. S07 starts only after actual S06B proof is accepted.

## Non-goals

- Do not add MCP/CLI semantics, plugin-owned recovery state, or direct owner writes.

## Verification evidence — 2026-08-29

- Review findings resolved: outcome-unknown now latches apply replay and disables Plan refresh; client apply input is normalized/bounded/safe; response actor identity is checked; Workflow join accepts already-running leased Work Runs; owner receipts include Work Item identity on first join and replay; Recovery apply owner paths are explicitly authorized by Operation Write Policy.
- Plugin suite: `npm test` — 93 passed, 0 failed.
- MCP source suite: `bun test src/` — 818 passed, 18 skipped, 0 failed.
- Focused Workflow/write-policy suite: 70 passed, 0 failed.
- Production bundle build and `npm run verify:bundle-boundary` passed; `git diff --check` passed.
- Actual Obsidian QA used the sanitized `qa-vault`: Open → Search (`recovery`) → exact Plan → Cancel (no apply) → exact confirmation → `workflow.recovery.apply` returned `applied`, rendered the sanitized owner receipt, and reopened `open` from current owner state. The final bundle reload started at `open` with no Plan, apply result, query, or transition token in the UI. Plugin `data.json` remained limited to presentation and device binding.
- QA fixture changes were confined to ignored `.gstack/qa-vault` state; no shared vault or source files were used as Recovery persistence.
