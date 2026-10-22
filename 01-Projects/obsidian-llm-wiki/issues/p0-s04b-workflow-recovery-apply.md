---
type: issue
entity: project/obsidian-llm-wiki/issue/p0-s04b-workflow-recovery-apply
state: done
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

- [x] `recovery-apply-request/v2` contains the complete Plan, presented fingerprint, safe normalized `{query,limit}` planning input, and transition token; actor comes only from OperationContext.
- [x] Immutable Plan owns role/Binding/Profile and search-input/search/candidate fingerprints but no raw query, agent ID, or host; authenticated actor becomes Work Run identity and host fallback.
- [x] Existing exact applied/claimed/outcome-unknown claims are loaded before new-claim expiry checks; claim recovery after Plan expiry verifies Plan/token/planning-input/actor and local Work Run/lease identity without re-reading mutable pre-claim selection locks.
- [x] A new claim uses ephemeral planning input to recompute open→search→candidate→Binding and prove the Plan basis, then revalidates current owner/capability/lease facts and expiry before mutation; claim persists only the planning-input digest.
- [x] A Plan produced with `workflow.recovery.plan` but missing or unusable `workflow.recovery.apply` is rejected as `unavailable` before claim creation; cover this in `mcp-server/src/workflow/recovery-apply.test.ts`.
- [x] Resume reuses exact Project/Work Item/Work Run. Create derives one Work Run ID from Project/Work Item/Plan fingerprint, creates/verifies one durable lease and local lease for actor, and never calls manual start.
- [x] Same-token replay returns/recovers one receipt; rebound conflicts; two-token race creates/joins at most one Work Run.
- [x] Every crash window, including expiry after claim, deterministically returns one receipt or persists outcome-unknown and blocks mutation replay.
- [x] Every frozen `makeWorkflowOps` caller, including Fleet verifier, is migrated and verified.

## Demo

Apply resume/create Plans, interrupt every claim/owner/receipt window, retry before and after Plan expiry, race two tokens, and observe one Work Run receipt or explicit outcome-unknown reconciliation.

## Dependencies

Blocked by accepted S06A actual-Obsidian preview. Project Hub remains read-only.

**Capability dependency:** S04B registers `workflow.recovery.apply`. The apply Operation independently proves both current planning basis (Plan fingerprint, `searchInputFingerprint`, `searchFingerprint`, `candidateSetFingerprint`) and `workflow.recovery.apply: available` capability. Planning capability (`workflow.recovery.plan`) is necessary but not sufficient for mutation; it is checked separately in candidate composition (S04P) and does not authorize apply.

## Non-goals

- Do not add a mutating Project Hub Operation, server Flow session, manual Work Run start, or Plan store.

## Verification evidence

- Integrated commits: `b411435` (apply), `cb93531` (security hardening), and `fbb5dbf` (Fleet privacy gate).
- Independent task review: Spec Compliance PASS; Task Quality APPROVED. Independent security re-review: Security APPROVED; all seven findings addressed with no new Critical or Important breakage.
- Integrated focused backend matrix: 83 passed across nine Workflow/core/Agent/Project files. Compiled real-vault apply smoke: 14 passed, including resume, deterministic create-and-join, replay, apply capability absence, concurrency, privacy, future clock, and index recovery.
- Apply authorization is injected independently from planning capability. Same-token concurrency performs one owner call. Receipt projection is allowlist-only. New claims reject future Plans. Write Policy enumerates exact claim, run, lease, lock, lifetime, and event targets.
- Claims persist digests and bounded identity/receipt fields only; raw planning query, transition token, prompts, transcripts, secrets, and machine paths are absent.
- `PYTHON=python bun test scripts/verify_fleet_workflow.test.ts`: 15 passed. Phase-all Fleet acceptance: 13/13 checks passed.
- `npm run typecheck -- --pretty false`, `npm run build`, strict OpenSpec validation, catalog drift, privacy scans, and `git diff --check` passed.

## Fix round 2 (Fleet verifier portable base_head)

The phase-all Fleet verifier flagged the legitimate Work Driver `base_head`
(`01-Projects/fleet-acceptance/issues/cloud-workflow.md`) as a machine-local
value leak because it was bundled with `vault`, `deviceState`, and the local
lease path. `base_head` is intentionally the authoritative relative Work
Note ID and must travel in shared state (hub citations reference it).
The fix introduces `assertPortableBaseHead`, drops `base_head` from the
machine-local deny list, and re-asserts every other privacy rule.

- `scripts/verify_fleet_workflow.ts`: exported `assertPortableBaseHead`,
  removed `proof.lease.base_head` from the leak loop, asserted the portable
  note-id shape and that it appears in shared state.
- `scripts/verify_fleet_workflow.test.ts`: positive case accepts the
  canonical `01-Projects/fleet-acceptance/issues/cloud-workflow.md`;
  negative case rejects drive (`C:\...`, `C:/...`), UNC, `file://`,
  `/Users`, `/home`, `/private`, `/tmp`, `/var/tmp`, backslash segments,
  empty string, missing `.md` suffix, leading `/`, and non-string inputs.
- `assertSharedSecretFree` and the broad privacy scans remain unchanged.

### Evidence

```
$ PYTHON=python bun test scripts/verify_fleet_workflow.test.ts
 15 pass
 0 fail
Ran 15 tests across 1 file. [6.06s]

$ PYTHON=python bun scripts/verify_fleet_workflow.ts --phase all --json
... 13 checks pass, including "shared-state-secret-free" ...

$ openspec validate --changes --strict
✓ change/add-ask-mate-visual-workspace
✓ change/internalize-agent-wiki-toolchain
✓ change/official-obsidian-plugin-distribution
✓ change/project-hub-recovery-loop
Totals: 4 passed, 0 failed (4 items)

$ git diff --check
(no output)
```
