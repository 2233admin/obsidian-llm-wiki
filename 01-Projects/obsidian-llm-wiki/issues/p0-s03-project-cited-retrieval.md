---
type: issue
entity: project/obsidian-llm-wiki/issue/p0-s03-project-cited-retrieval
state: backlog
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

- [ ] Search accepts a canonical Project ID, current open Flow Fingerprint, NFKC-normalized 1–2048-byte safe query, and limit `1..25`.
- [ ] Sources are reviewed Work-OS, Project Memory, Project Source/Evidence, safe Session Record metadata, and safe Workflow Work Run/checkpoint evidence.
- [ ] Generic `unified-query.ts` and adapter RRF output do not become Project authority; no search index is added.
- [ ] Cross-Project material is excluded before ranking.
- [ ] Results carry stable Knowledge Item identity/type, owner, match class, integer score, freshness, confidence, provenance, and 1–4 resolvable Citation Targets.
- [ ] Result/diagnostic/item/response bounds, deterministic ordering, omissions, and owner-lock fingerprints match OpenSpec D7.
- [ ] Multiple queries from one open stage produce independent Flow branches; branch mixing is rejected as stale.
- [ ] The issue produces internal searched basis only and registers no public partial Flow Operation.

## Demo

From one open Flow, search two different queries, show independent fingerprints and cited results, reject a cross-branch candidate, and expose an unavailable owner as partial rather than current.

## Dependencies

Blocked by S02 because search reuses its Workflow read model and recomputes its open Flow prerequisite.

## Non-goals

- Do not generate a candidate/Binding/Plan, mutate state, or expose a standalone public `project.hub.search` Operation.