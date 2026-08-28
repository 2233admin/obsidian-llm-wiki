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
- [x] The panel renders all six stages, work/context/evidence/candidates/Binding/Plan facts, Citation Targets, omissions, and exact remediation without empty success states.
- [x] Only the server-supplied closed recommended next request may auto-advance; multiple Bindings require user selection.
- [x] Candidate replacement validates the full prior Plan and makes the new Plan the only confirmation object.
- [x] Expired Plan remains visible as expired until explicit Refresh Plan; no background replacement occurs.
- [x] Query, results, Flow fingerprints, candidate, Binding, and Plan live only in ItemView memory; dispose/reload/reopen starts at current open and plugin data remains byte-identical.
- [x] Keyboard order, semantic labels/headings, live status, focus retention, cancellation, stale/unavailable readability, and Plan readability pass in actual Obsidian.
- [ ] Principal accepts actual-surface evidence before S04B starts.

## S06A automated evidence

- Recovery client and panel focused tests pass; lifecycle injection test passes.
- `npm run typecheck -- --pretty false` passes with declared `mcp-server` dependencies installed locally.
- `npm run build` passes.
- `openspec validate project-hub-recovery-loop --strict --no-interactive` passes.
- Full `npm test` passes 84/84; `npm run typecheck -- --pretty false` and `npm run build` pass after integration.
- Independent code/spec reviews found no Critical, Important, or Minor findings. The citation action, Search button pointer path, production search-owner wiring, and narrow-sidebar citation layout fixes were independently approved.

## Actual-surface evidence

- The final built plugin ran in an isolated sanitized `qa-vault` under desktop Obsidian 1.13.7. `vault-mind-promote:open-ask-mate-project-context` mounted one real `.llmwiki-ask-mate-project-recovery` surface for `project/s06a-qa`.
- All six stages were observed: `open`; held `searched` with four cited results and two resume candidates; `needs-agent-selection` with two current Bindings and no generated Plan request; `planned` with `workflow.recovery.plan: available` while apply remained absent/unusable; `stale` after a controlled Work-OS state transition; and bounded `unavailable` after disabling compatible Bindings.
- Repeated searches (`recovery`, `alternate`) produced independent Plan fingerprints. One unique Binding auto-followed only the server recommendation. Multiple Bindings required an explicit radio selection. Candidate replacement changed `resume:work-run/current` to `resume:work-run/alternate`.
- A controlled clock advance rendered the Plan expired, disabled candidate replacement, and kept `Refresh Plan` enabled. Explicit refresh replaced fingerprint `sha256:395d3e993ed698cc70d3d50d96d8e8ff52117e65c1cf4368d8087ad8d693e368` with `sha256:0db1dd7a271533e89a6e8465ba28f8018ea7d6bbfa2139033c88f733de3fb1a3`.
- The visible Cancel control suppressed a delayed plan response and left the panel at `searched`, not `planned`. Reopening Project Context reset stage to `open`, cleared the query, and discarded the prior candidate/Plan.
- Keyboard order moved from the non-empty query input to enabled Search; the actual focused Search button had a 2px solid outline. Citation buttons opened the exact vault note, retained 40px hit height, wrapped long targets, and reduced panel horizontal overflow from 26px to zero (`clientWidth == scrollWidth == 264`).
- Before/after manifests covered 13 fixture, Source, Work-OS, Workflow, Agent Domain, and plugin-data files. Every byte count and SHA-256 matched after all read-only flows; controlled stale/Binding mutations were restored before comparison.
- Principal acceptance remains the only open S06A gate. S04B remains blocked until that decision.

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
