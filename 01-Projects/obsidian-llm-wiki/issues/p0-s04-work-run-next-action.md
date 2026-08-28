---
type: issue
entity: project/obsidian-llm-wiki/issue/p0-s04-work-run-next-action
state: in-progress
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/p0-s04-work-run-next-action
description: "P0 S04A: complete Recovery Flow candidates and Plans, then clean-cut V1"
status: active
priority: 1
blocked-by:
  - obsidian-llm-wiki/p0-s03-project-cited-retrieval
last-verified: 2026-08-28
---

# P0 S04A: complete read-only Recovery Flow and V1 cutover

Parent brief: [[llmwiki-project-driven-knowledge-workspace]]
ADR: `docs/adr/0001-project-hub-recovery-flow-v2.md`
OpenSpec: `openspec/changes/project-hub-recovery-loop/`
Implementation plan: `docs/superpowers/plans/2026-08-27-project-hub-recovery-loop.md` Tasks 7–9

## What to build

Add resume/create candidates, exact compatible Binding/Profile eligibility, immutable five-minute Plans, full stateless prerequisite recomputation, explicit Plan refresh, and candidate replacement. Then register the complete read-only `project.hub.recovery.flow`, migrate every repository caller, remove `project.hub.get.recovery`, and delete the V1 contract in one clean cutover.

## Acceptance

- [x] Candidate set reuses exact resume identity or permits governed Session create only under current unblocked Work Item/context/capability facts; exactly one safe candidate is recommended.
- [x] Zero compatible Bindings returns unavailable; one produces a fingerprint-free plan intent then a derived closed request; 2–16 returns every Binding in needs-agent-selection; 17+ returns `binding_selection_too_large` without truncation.
- [x] Plan binds root open and searched-basis Flow fingerprints, search-input/search/candidate fingerprints, candidate, role, exact Binding/Profile revisions, owner locks, capabilities, citations, five-minute expiry, and Workflow owning operation; it contains no invented agent ID or host.
- [x] Plan/from-search requires null planned/prior Plan fields; plan/override and refresh require immediate planned plus searched-basis fingerprints and the complete prior Plan.
- [x] Candidate replacement produces a new current Plan/fingerprint; expired Plans require explicit refresh and are never silently substituted.
- [x] The complete Flow Operation supports all five actions/six stages, remains `mutating:false`, and writes no bytes.
- [x] V1 action facts pass equivalence before `project-hub-recovery/v1`, its types/validator/export/tests/file, and `project.hub.get.recovery` are removed.
- [x] No V1 compatibility alias, dual response, standalone public search/candidate/plan Operation, or partial V2 branch remains.

## Demo

Open, search, auto-follow one unique Binding, preview a Plan, replace the candidate, refresh an expired Plan, exercise multiple-Binding selection, and prove V1 symbols are absent while `project.hub.get` remains a normal Hub read.

## Dependencies

Blocked by S03. S06A begins only after the complete V2 read Flow and clean cutover pass independent review.

## Non-goals

- Do not call `workflow.recovery.apply`, create/resume a Work Run, or persist Flow state.

## Evidence

- Added exact candidate/Binding/Profile eligibility, immutable Plan derivation, explicit refresh/recomputation, and the complete read-only `project.hub.recovery.flow`; removed the V1 recovery module and `project.hub.get.recovery` response.
- From `mcp-server/`: the required T4.4 suite — 47 passed, 0 failed.
- From `mcp-server/`: `npm run typecheck -- --pretty false` — passed, including platform builds.
- Repository root: `openspec validate project-hub-recovery-loop --strict --no-interactive` — passed.
- Runtime absence scan found no V1 schema/type/validator/export/module or `project.hub.get.recovery` references outside permitted historical contract prose. Generated operation references were regenerated with `npm run build` and `npm run generate-tools-doc`.
- Independent review remains pending; issue intentionally stays `in-progress` and S06A+ remains untouched.
