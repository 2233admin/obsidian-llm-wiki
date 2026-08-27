---
type: issue
entity: project/obsidian-llm-wiki/issue/p0-s02-resumable-agent-context
state: backlog
review: draft
kind: knowledge-task
id: obsidian-llm-wiki/p0-s02-resumable-agent-context
description: "P0 S02: build a safe resumable Agent context bundle for an active project"
status: active
priority: 1
blocked-by:
  - obsidian-llm-wiki/p0-s01-project-hub-recovery-snapshot
last-verified: 2026-08-27
---

# P0 S02: resumable Agent context

Parent brief: [[llmwiki-project-driven-knowledge-workspace]]

## What to build

From a Project Hub recovery snapshot, resolve the latest valid resumable Work Run or Session Record into a bounded context bundle. The bundle must carry the stable Project ID, Work Item ID, Work Run ID, current task state, reviewed decisions, relevant citations, recent checkpoints, and explicit missing prerequisites without treating raw session output as project truth.

## Acceptance

- [ ] A versioned context-bundle contract identifies Project ID, Work Item ID, Work Run ID, source Session Record, freshness, citations, and resume prerequisites.
- [ ] Selecting a valid resumable run returns enough context for a new Agent session to continue without replaying the full transcript.
- [ ] Missing, expired, stale, or incompatible runs return an explained non-resumable result and a manual next action.
- [ ] Session-derived claims remain draft or evidence until the owning Promotion Policy accepts them.
- [ ] Private transcript content, cookies, tokens, and machine-local paths are excluded from persisted or returned context.
- [ ] Repeated resolution of the same inputs yields the same bundle fingerprint.

## Demo

Select the latest resumable Work Run in a sanitized project and receive a compact, cited context bundle plus the exact next action; select an expired run and see a deterministic remediation instead.

## Dependencies

Blocked by S01 because the bundle is selected from the Project Hub recovery snapshot.
