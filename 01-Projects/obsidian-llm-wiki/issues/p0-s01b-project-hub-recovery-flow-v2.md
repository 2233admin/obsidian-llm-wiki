---
type: issue
entity: project/obsidian-llm-wiki/issue/p0-s01b-project-hub-recovery-flow-v2
state: done
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/p0-s01b-project-hub-recovery-flow-v2
description: "P0 S01B: define the complete internal stateless Recovery Flow v2 contract kernel"
status: active
priority: 1
blocked-by:
  - obsidian-llm-wiki/p0-s01-project-hub-recovery-snapshot
last-verified: 2026-08-28
---

# P0 S01B: Recovery Flow v2 contract kernel

Parent brief: [[llmwiki-project-driven-knowledge-workspace]]
ADR: `docs/adr/0001-project-hub-recovery-flow-v2.md`
OpenSpec: `openspec/changes/project-hub-recovery-loop/`
Implementation plan: `docs/superpowers/plans/2026-08-27-project-hub-recovery-loop.md` Tasks 1–2

## What to build

Define the complete internal `project-hub-recovery-flow-request/v2` and `project-hub-recovery-flow/v2` contract kernel before any public V2 Operation exists. The kernel owns closed actions/stages, explicit nullable arms, owner-lock ordering, chained Flow Fingerprints, stateless prerequisite descriptors, stale/unavailable responses, and full-prior-Plan proof requirements.

## Acceptance

- [x] Every action/stage rejects unknown fields and omitted required nulls and enforces canonical Project identity, UTF-8/count/byte bounds, safe normalization, and canonical fingerprints.
- [x] Response is a six-interface literal-stage discriminated union; every cross-stage payload/intent/request arm rejects.
- [x] Request actions are exactly `open|search|plan|refresh-plan|restart`, and response stages are exactly `open|searched|needs-agent-selection|planned|stale|unavailable`; cross-stage payloads and next requests reject.
- [x] Flow Fingerprints use an intrinsic projection with fingerprint-free next-request intents; root convenience fields and exact next requests are derived only after hashing, so no field is self-referential.
- [x] `restart` carries one finite `RecoveryStaleProofV2` containing no response or next request.
- [x] Plan/from-search, plan/override, and refresh contracts use explicit searched-basis/planned fingerprints and minimum replay inputs; override/refresh require the complete prior Plan.
- [x] V1 canonical bytes and behavior remain unchanged while this internal kernel lands.
- [x] No partial `project.hub.recovery.flow` Operation, unsupported-stage branch, persisted Flow cache, or compatibility shim is introduced.

## Demo

Validate one fixture for every request action and response stage, reject branch mixing and malformed prior evidence, and prove the existing V1 fixture remains byte-identical.

## Dependencies

Blocked by completed S01 v1 only as the behavior baseline. S02 starts after this contract kernel passes independent review.

## Verification

- `npm exec bun -- test src/project-hub/contract-support.test.ts src/project-hub/recovery-flow.test.ts src/project/project-hub.test.ts` — 42 passed across 3 files.
- `npm run typecheck` — passed, including Settings Platform, Agent Domain, Visual Workspace, and Problem Intake builds.
- `openspec validate project-hub-recovery-loop --strict --no-interactive` — valid.
- V1 characterization remains green; the pre-extraction golden canonical serialization and fixed fingerprint assertion pass alongside the existing V1 behavior checks.
- V2 remains internal: only `project-hub/index.ts` exports the kernel; no `project.hub.recovery.flow` Operation or persisted Flow state was added.
- Independent final code review after both repair passes — approved with no Critical or Important findings.

## Non-goals

- Do not register the public Flow Operation or remove V1; S04A owns the clean cutover.
- Do not read owner files, search, create candidates, generate Plans, or mutate Workflow in this issue.