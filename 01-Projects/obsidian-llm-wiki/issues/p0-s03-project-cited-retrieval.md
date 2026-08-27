---
type: issue
entity: project/obsidian-llm-wiki/issue/p0-s03-project-cited-retrieval
state: backlog
review: draft
kind: knowledge-task
id: obsidian-llm-wiki/p0-s03-project-cited-retrieval
description: "P0 S03: provide project-scoped search with resolvable citation targets"
status: active
priority: 1
blocked-by:
  - obsidian-llm-wiki/p0-s01-project-hub-recovery-snapshot
last-verified: 2026-08-27
---

# P0 S03: project-scoped cited retrieval

Parent brief: [[llmwiki-project-driven-knowledge-workspace]]

## What to build

Give Project Hub a read-only retrieval operation scoped to the active Project and its Workspace Binding. Normalize results from vault material, project issues, reviewed decisions, Source records, and relevant Session or Work Run evidence into one result shape with citation targets, provenance, freshness, and confidence or unknown state.

## Acceptance

- [ ] Search accepts a Project ID and query intent without exposing a machine-local path as durable identity.
- [ ] Results carry a stable Knowledge Item identity, display label, Knowledge Item Type, source/provenance, freshness, and at least one resolvable Citation Target when the result is presented as evidence.
- [ ] Results from outside the active Project are excluded or explicitly labeled as external context.
- [ ] Missing, stale, ambiguous, and unavailable sources remain visible diagnostics rather than silently dropped facts.
- [ ] The same query and source snapshot produce deterministic ordering and a stable result fingerprint.
- [ ] Search remains read-only and cannot promote a result or modify project state.

## Demo

Search an active project for its current blocker and receive the matching Issue, decision, and session evidence with clickable citation targets; search a project with stale material and see the freshness warning.

## Dependencies

Blocked by S01 because retrieval is scoped and surfaced through the recovery snapshot.
