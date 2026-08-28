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
  - obsidian-llm-wiki/p0-s04p-workflow-recovery-plan
last-verified: 2026-08-28
---

# P0 S06A: Ask Mate Recovery Flow preview

Parent brief: [[llmwiki-project-driven-knowledge-workspace]]
OpenSpec: `openspec/changes/project-hub-recovery-loop/`
Implementation plan: `docs/superpowers/plans/2026-08-27-project-hub-recovery-loop.md` Tasks 10–11

## What to build

Expose the complete read-only V2 Flow through the existing LLM Wiki/Ask Mate ItemView opened for current Project Context. Add a stateless typed client and focused panel for open, repeated search, automatic recommended-request following, explicit Binding selection, candidate replacement, planned, explicit Plan refresh, stale restart, and unavailable remediation.

## Acceptance

- [x] The primary entry is Ask Mate Project Context; `control-plane-ui.ts` remains advanced administration.
- [x] S06A maps only `project.hub.recovery.flow`; it has no apply method or Workflow mutation path.
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
- Full `npm test` passes 82/82 after correcting three stale `PluginPresentation` test expectations; `npm run typecheck -- --pretty false` and `npm run build` also pass after integration.
- Independent code/spec review found no Critical, Important, or Minor findings. Accessibility review's placeholder citation-link blocker was repaired in `b1be249` and independently verified closed.

## Actual-surface evidence and blocker

- The built plugin was installed and reloaded in desktop Obsidian 1.13.7. `vault-mind-promote:open-ask-mate-project-context` mounted one `.llmwiki-ask-mate-project-recovery` surface and rendered the real `open` stage for `project/llmwiki-product`, including Flow fingerprint, eight owner locks, bounded facts, search controls, diagnostics, and explicit Work-OS remediation.
- Installed plugin `data.json` remained byte-identical before and after the actual open flow (`sha256:cc0f866e947e22de07286f00e6028b7b89b6b1ed7a13634e551453bf23baa767`).
- S04P is implemented and independently verified: the read-only `workflow.recovery.plan` Operation and capability are available, while `workflow.recovery.apply` remains absent/unusable until S04B.
- S06A must reach `planned` with the plan capability available while apply is absent/unusable; apply availability is not a prerequisite for read-only preview.
- T5.3 is unblocked. Full six-stage actual Obsidian verification and principal acceptance remain open.

## Demo

Open the sanitized Project, search twice, auto-follow a unique Binding,
exercise `needs-agent-selection` with valid multiple Bindings/candidates and no
generated Plan request, reach `planned` with apply absent/unusable, exercise
candidate replacement, expire/refresh a Plan, restart stale Flow, render
`unavailable` remediation, reload the ItemView, and prove no durable or
plugin-owned Flow state exists. Capture before/after SHA-256 and byte counts for
fixture vault files, plugin `data.json`, and durable recovery roots.

## Dependencies

Blocked by complete S04A V2 read Flow and V1 cutover. S04B remains blocked until actual Obsidian proof is accepted.

## Non-goals

- Do not apply a Plan, show a success receipt, persist Flow state, or place recovery in the advanced control-plane modal.
