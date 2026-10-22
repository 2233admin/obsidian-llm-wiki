---
type: issue
entity: project/obsidian-llm-wiki/issue/p0-s03-project-cited-retrieval
state: done
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/p0-s03-project-cited-retrieval
description: "P0 S03: add mandatory repeatable Project-scoped cited search to Recovery Flow"
status: active
priority: 1
blocked-by:
  - obsidian-llm-wiki/p0-s02-resumable-agent-context
last-verified: 2026-08-28
---

# P0 S03: Recovery Flow cited search

Parent brief: [[llmwiki-project-driven-knowledge-workspace]]
OpenSpec: `openspec/changes/project-hub-recovery-loop/`
Implementation plan: `docs/superpowers/plans/2026-08-27-project-hub-recovery-loop.md` Task 6

## What to build

Implement mandatory, repeatable, read-only cited search over canonical current Project owner records. Recompute and verify the S02 open stage before every search, normalize query and results into the V2 searched basis, bind exact owner locks, and keep each query on its own chained Flow branch.

## Acceptance

- [x] Search accepts a canonical Project ID, current open Flow Fingerprint, NFKC-normalized 1–2048-byte safe query, and limit `1..25`.
- [x] Sources are reviewed Work-OS, Project Memory, Project Source/Evidence, safe Session Record metadata, and safe Workflow Work Run/checkpoint evidence.
- [x] Generic `unified-query.ts` and adapter RRF output do not become Project authority; no search index is added.
- [x] Cross-Project material is excluded before ranking.
- [x] Results carry stable Knowledge Item identity/type, owner, match class, integer score, freshness, confidence, provenance, and 1–4 resolvable Citation Targets.
- [x] Result/diagnostic/item/response bounds, deterministic ordering, omissions, and owner-lock fingerprints match OpenSpec D7.
- [x] Multiple queries from one open stage produce independent Flow branches; branch mixing is rejected as stale.
- [x] The issue produces internal searched basis only and registers no public partial Flow Operation.

## Demo

From one open Flow, search two different queries, show independent fingerprints and cited results, reject a cross-branch candidate, and expose an unavailable owner as partial rather than current.

## Dependencies

Blocked by S02 because search reuses its Workflow read model and recomputes its open Flow prerequisite.

## Non-goals

- Do not generate a candidate/Binding/Plan, mutate state, or expose a standalone public `project.hub.search` Operation.

## Evidence

- Added internal Project owner snapshots and cited searched basis composition in `mcp-server/src/project-hub/search-source.ts` and `mcp-server/src/project-hub/search.ts`, with focused contract tests.
- Verified canonical Project scoping, reviewed/safe owner material, foreign-record exclusion before ranking/fingerprinting, exact owner locks, query/response bounds, deterministic branches, and explicit stale recomputation.
- `mcp-server/`: `npm exec bun -- test src/project-hub/recovery-open.test.ts src/project-hub/search-source.test.ts src/project-hub/search.test.ts src/workflow/workflow-read-model.test.ts` — 12 pass.
- OpenSpec T3.3 command including `src/project-hub/recovery-flow.test.ts` — 32 pass.
- `mcp-server/`: `npm run typecheck` — pass.
- Repair evidence: removed the dead ISO-date regex and added a deterministic response-budget test asserting exact canonical bytes reported by `omitted.bytes`.
- Independent review of `94595b5..feb744c` found no Critical or Important findings; both Minor findings were repaired in `b851595` and independently verified closed.
- After integration, the coordinator repeated the OpenSpec T3.3 test set with 32 passing tests and repeated `npm run typecheck` successfully.
