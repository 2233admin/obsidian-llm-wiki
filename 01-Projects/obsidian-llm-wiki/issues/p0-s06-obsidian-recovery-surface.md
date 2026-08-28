---
type: issue
entity: project/obsidian-llm-wiki/issue/p0-s06-obsidian-recovery-surface
state: in-progress
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/p0-s06-obsidian-recovery-surface
description: "P0 S06A: prove the read-only Recovery Flow in Ask Mate Project Context"
status: active
priority: 1
blocked-by:
  - obsidian-llm-wiki/p0-s04-work-run-next-action
last-verified: 2026-08-28
---

# P0 S06A: Ask Mate Recovery Flow preview

Parent brief: [[llmwiki-project-driven-knowledge-workspace]]
OpenSpec: `openspec/changes/project-hub-recovery-loop/`
Implementation plan: `docs/superpowers/plans/2026-08-27-project-hub-recovery-loop.md` Tasks 10–11

## What to build

Expose the complete read-only V2 Flow through the existing LLM Wiki/Ask Mate ItemView opened for current Project Context. Add a stateless typed client and focused panel for open, repeated search, automatic recommended-request following, explicit Binding selection, candidate replacement, planned, explicit Plan refresh, stale restart, and unavailable remediation.

## Acceptance

- [ ] The primary entry is Ask Mate Project Context; `control-plane-ui.ts` remains advanced administration.
- [ ] S06A maps only `project.hub.recovery.flow`; it has no apply method or Workflow mutation path.
- [ ] The panel renders all six stages, work/context/evidence/candidates/Binding/Plan facts, Citation Targets, omissions, and exact remediation without empty success states.
- [ ] Only the server-supplied closed recommended next request may auto-advance; multiple Bindings require user selection.
- [ ] Candidate replacement validates the full prior Plan and makes the new Plan the only confirmation object.
- [ ] Expired Plan remains visible as expired until explicit Refresh Plan; no background replacement occurs.
- [ ] Query, results, Flow fingerprints, candidate, Binding, and Plan live only in ItemView memory; dispose/reload/reopen starts at current open and plugin data remains byte-identical.
- [ ] Keyboard order, semantic labels/headings, live status, focus retention, cancellation, stale/unavailable readability, and Plan readability pass in actual Obsidian.
- [ ] Principal accepts actual-surface evidence before S04B starts.

## S06A automated evidence

- Recovery client and panel focused tests pass; lifecycle injection test passes.
- `npm run typecheck -- --pretty false` passes with declared `mcp-server` dependencies installed locally.
- `npm run build` passes.
- `openspec validate project-hub-recovery-loop --strict --no-interactive` passes.
- Full `npm test` reaches all recovery tests successfully but retains three unrelated baseline settings-shape failures involving `settingsExpandedSections`; no recovery test fails.

## Actual-surface gate remaining

Coordinator must run the built plugin in desktop Obsidian against the sanitized Project and record truthful evidence for: all six stages; repeated search; exact unique recommendation follow; multiple-Binding selection; candidate replacement; expired Plan and explicit refresh; citation activation; cancellation; stale/unavailable remediation; reload/reopen reset; unchanged plugin-data and fixture bytes; keyboard order, focus retention, live/urgent status, readable Plan, and minimum hit targets. T5.3 and principal acceptance remain open; S04B stays blocked.

## Demo

Open the sanitized Project, search twice, auto-follow a unique Binding, exercise multiple-Binding selection and candidate replacement, expire/refresh a Plan, restart stale Flow, reload the ItemView, and prove no durable or plugin-owned Flow state exists.

## Dependencies

Blocked by complete S04A V2 read Flow and V1 cutover. S04B remains blocked until actual Obsidian proof is accepted.

## Non-goals

- Do not apply a Plan, show a success receipt, persist Flow state, or place recovery in the advanced control-plane modal.
