---
type: issue
entity: project/obsidian-llm-wiki/issue/p0-s08-recovery-loop-acceptance
state: done
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/p0-s08-recovery-loop-acceptance
description: "P0 S08: verify Recovery Flow v2 cutover, failures, parity, privacy, and timing"
status: active
priority: 1
blocked-by:
  - obsidian-llm-wiki/p0-s07-mcp-cli-parity
last-verified: 2026-09-01
---

# P0 S08: Recovery Flow v2 Foundation acceptance

Parent brief: [[llmwiki-project-driven-knowledge-workspace]]
OpenSpec: `openspec/changes/project-hub-recovery-loop/`
Implementation plan: `docs/superpowers/plans/2026-08-27-project-hub-recovery-loop.md` Task 16

## What to build

Create one sanitized end-to-end fixture and actual-Obsidian procedure covering V1 removal, all V2 Flow actions/stages, stateless recomputation, repeated search branches, Binding/candidate/Plan decisions, explicit refresh, Workflow apply, output routing, parity, privacy canaries, failure/replay paths, and the under-60-second Plan-preview target.

## Acceptance

- [x] V1 production schema/types/validator/export/file and `project.hub.get.recovery` are absent; V1 historical issue/ADR prose remains.
- [x] Fixture includes every owner, Work Run/events, unique/multiple/no compatible Bindings, reviewed/draft memory, repeated queries, alternate candidates, capabilities, claims, outputs, and canaries. Direct coverage includes a checkpoint event, source-evidence/session-record search payloads, agent-domain/settings capability facts, and durable claim/output records. `RecoveryOpenOwners` has independent source-evidence, Agent Domain, and Settings snapshot readers with owner-specific locks.
- [x] All five request actions and six response stages pass; minimal-input prerequisite recomputation rejects branch mixing and full-prior-Plan refresh/override works.
- [x] Search is mandatory/repeatable; auto-plan eligibility uses exactly one Binding; multiple Binding, candidate override, expired Plan, explicit refresh, stale restart, and unavailable remediation are observable.
- [x] Apply/output same-token replay, both claim races, every crash window, and outcome-unknown preserve exactly one Work Run and at most one owner effect.
- [x] Obsidian, MCP, and CLI agree on Flow/Plan fingerprints, locks, stages, recommendations, apply state, and receipts; read-path parity and actual Obsidian rendering are verified. The complete three-surface apply/receipt comparison is covered by the shared-Operation parity fixture below.
- [x] ItemView reload persists no Flow state and no serialized surface contains canaries, credentials, transcript bodies, unsafe query material, or absolute paths.
- [x] After one familiarization, three actual-Obsidian runs from Open Project Hub invocation to cited immutable Plan preview are each under 60 seconds with raw timings.
- [x] Any failure creates a linked follow-up and leaves S08/Foundation incomplete.

## Demo

Recover a deliberately interrupted sanitized Project end to end, repeat and mix searches, exercise Binding/candidate/refresh/stale/unavailable paths, confirm one Plan, route output, verify parity and privacy, then record three timing runs.

## Verification evidence — 2026-09-01

- Foundation fixture gate: `npm exec bun -- test src/project-hub/cli.test.ts src/project-hub/parity.test.ts src/project-hub/recovery-loop.e2e.test.ts` — 11 passed, 0 failed.
- Apply/receipt parity coverage added in `mcp-server/src/project-hub/parity.test.ts`: one sanitized Plan/request is sent through the MCP dispatcher, CLI adapter, and real Obsidian `ProjectHubRecoveryClient`; all three must return the same applied response/receipt/fingerprints, while same-token replay invokes the owner once.
- Focused acceptance run after the branch-matrix, fixture-coverage, independent-owner, and failure-boundary additions: `npm exec bun -- test src/project-hub/recovery-loop.e2e.test.ts src/project-hub/parity.test.ts src/project-hub/cli.test.ts src/workflow/recovery-apply.test.ts src/workflow/output-governance.test.ts` — 58 passed, 0 failed.
- `recovery-loop.e2e.test.ts` now executes sanitized no/multiple-compatible-Binding, repeated-search branch mixing, explicit override/refresh, stale, and unavailable cases. Existing `recovery-apply.test.ts` and `output-governance.test.ts` retain the deterministic replay/race/crash-window matrix; no duplicate authority or adapter claim reads were added.
- Bounded sanitized fixture coverage is asserted in `mcp-server/src/project-hub/recovery-loop.e2e.test.ts`: the fixture includes a checkpoint event, source-evidence/session-record search payloads, agent-domain/settings capability facts, canonical owner IDs, Binding variants, reviewed/draft memory markers, repeated queries, alternate candidates, durable claim/output records, and raw-canary exclusion without adapter claim-file reads. `RecoveryOpenOwners` reads independent source-evidence, Agent Domain, and Settings snapshots under owner-specific locks; failure-boundary assertions preserve one Work Run and at most one owner effect across replay, races, crash windows, and outcome-unknown paths.
- Focused durable fixture verification: `npm exec bun -- test src/project-hub/recovery-loop.e2e.test.ts src/project-hub/parity.test.ts src/project-hub/cli.test.ts` — 11 passed, 0 failed.
- Durable-store assertions verify all four recovery/output claim and token files exist on disk, preserve exact bytes across Flow open/search/plan calls, and keep record digests and raw canaries out of responses.
- MCP: `npm test` — 868 passed, 18 skipped, 0 failed. Plugin: `npm test` — 98 passed, 0 failed; plugin typecheck and production build passed.
- Resolved the SkillWatcher Node/browser timer flake: the lifecycle harness lacked `window.setTimeout`/`window.clearTimeout`; `obsidian-plugin/src/agentfiles/watcher.ts` now uses the Node-safe timer boundary. Three consecutive plugin runs each reported 98/98 pass; plugin typecheck and production build also passed.
- Root Python verification: `python -m pytest -q` — 284 passed, 1 skipped. Fleet verifier: all checks ok.
- Typecheck passed; `openspec validate project-hub-recovery-loop --strict` — valid. Diff-check passed.
- Actual Obsidian 1.13.7 QA on sanitized `qa-vault` rendered the updated Getting Started card, capability remediation action, and Project recovery surface. Three measured latest-bundle Open Project Hub → cited immutable Plan preview runs took 542 ms, 1113 ms, and 441 ms.
- Session-archiver machine-absolute-path finding resolved. S08 is complete and the Foundation exit is accepted.

## Dependencies

S07 MCP/CLI parity is complete. S08 is complete and the Foundation exit
is accepted.

## Non-goals

- Do not waive pre-existing failures, retain V1 compatibility, or declare Foundation complete from automated tests alone without actual Obsidian evidence.