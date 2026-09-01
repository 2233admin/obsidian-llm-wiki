---
type: issue
entity: project/obsidian-llm-wiki/issue/p0-s03b-production-recovery-search-owners
state: done
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/p0-s03b-production-recovery-search-owners
description: "P0 S03B: wire every canonical Recovery search owner in production"
status: active
priority: 1
blocked-by:
  - obsidian-llm-wiki/p0-s04p-workflow-recovery-plan
blocks:
  - obsidian-llm-wiki/p0-s06-obsidian-recovery-surface
last-verified: 2026-08-28
---

# P0 S03B: production Recovery search owner wiring

Parent brief: [[llmwiki-project-driven-knowledge-workspace]]
OpenSpec: `openspec/changes/project-hub-recovery-loop/`

## Root cause

The reviewed S03 contract requires Project-scoped search over Work-OS, Project Memory, Source/Evidence, Session Record, and Workflow records. Production `defaultRecoverySearchSource` currently configures only the Work-OS reader. Unit tests use injected readers, so they pass while the real Obsidian Flow cannot return Workflow Work Runs/checkpoints as search results. Consequently candidate composition cannot expose alternate resume candidates and S06A candidate replacement is unreachable in production.

## Acceptance

- [x] Production configures all five canonical readers: `work-os`, `project-memory`, `source-evidence`, `session-record`, and `workflow`.
- [x] Readers reuse authoritative owner read models; they do not introduce a second index, database, or generic adapter authority.
- [x] Cross-Project records are excluded before normalization, ranking, fingerprinting, and diagnostics.
- [x] Project Memory emits reviewed decisions only; Session Record emits safe captured/indexed metadata only.
- [x] Workflow emits current Project Work Runs and safe checkpoints with stable identities and resolvable Citation Targets; no actor secrets, tokens, prompts, transcript bodies, or absolute paths.
- [x] Source/Evidence uses canonical Source Registry/evidence records and bounded safe text; a missing registry is a current empty owner, while malformed/unreadable state is explicit unavailable.
- [x] Owner revision/fingerprint/state and deterministic ordering remain stable; reads write zero bytes.
- [x] A production-wiring integration test with two current Workflow runs yields a recommended resume candidate plus an alternate candidate, enabling explicit candidate replacement.
- [x] Existing repeated-query, branch-mixing, stale/unavailable, response-bound, S04P Plan, and V1-absence gates remain green.

## Non-goals

- Do not add an index or change generic `query.unified` ranking.
- Do not change Recovery schemas, candidate limits, Plan semantics, S04P capability separation, or S04B apply behavior.
- Do not persist search or Flow state.

## Verification

Run focused Project Hub/search/workflow/memory/source tests, MCP typecheck/build, strict OpenSpec validation, a no-write byte/hash proof, and the actual sanitized Obsidian candidate-replacement path. Keep S06A T5.3 blocked until independent review and integration pass.

## Evidence

- Production wiring now composes all five canonical owner readers from the Work-OS, Project Memory, Source Registry/evidence, Session Record, and Workflow read models.
- Focused affected-owner suite: 80 passed, 0 failed across 13 files.
- S04P Task 9A matrix command: 86 passed, 0 failed across 11 files (the count includes the three new production-wiring cases).
- `npm run typecheck -- --pretty false`: passed; `npm run build`: passed; `openspec validate project-hub-recovery-loop --strict --no-interactive`: valid.
- Production-wiring tests prove missing/malformed Source Registry handling, foreign-project exclusion before normalization, privacy filtering, deterministic repeated snapshots, query branch mixing, alternate Work Run replacement, and unchanged SHA-256 file hashes across reads.
- Independent review: Spec Compliance PASS; Task Quality APPROVED; zero findings.
- Integrated verification: 76 passed across 13 affected owner files, 86 passed across the S04P parity matrix, typecheck passed, and strict OpenSpec validation passed.
- Remaining gate: the actual sanitized S06A Obsidian six-stage and candidate-replacement run.
