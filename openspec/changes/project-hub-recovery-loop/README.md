# Project Hub recovery loop

Status: **DRAFT — awaiting principal review**

This OpenSpec turns the completed `project-hub-recovery/v1` snapshot into the first complete interrupted-work recovery journey. It governs S02–S08, including the explicit S04A/S04B and S06A/S06B splits; S01 is the implemented baseline and is not redesigned here.

## Read order

1. [`proposal.md`](proposal.md) — why this change exists and its scope.
2. [`design.md`](design.md) — authority boundaries, contracts, data flow, and failure policy.
3. [`specs/project-hub-recovery-loop/spec.md`](specs/project-hub-recovery-loop/spec.md) — observable requirements and rejection scenarios.
4. [`tasks.md`](tasks.md) — principal gate and reviewable work packages.
5. [`docs/superpowers/plans/2026-08-27-project-hub-recovery-loop.md`](../../../docs/superpowers/plans/2026-08-27-project-hub-recovery-loop.md) — verified source baseline, exact file map, interfaces, test-first steps, commands, and commits.

## Work-OS links

- Parent brief: `01-Projects/obsidian-llm-wiki/issues/llmwiki-project-driven-knowledge-workspace.md`
- S01 baseline: `01-Projects/obsidian-llm-wiki/issues/p0-s01-project-hub-recovery-snapshot.md`
- Delivery issues: `p0-s02-*` through `p0-s08-*`, plus `p0-s04b-workflow-recovery-apply.md` and `p0-s06b-obsidian-recovery-action.md`, in the same issue directory.

No implementation may start from this OpenSpec until Phase 0 is approved. Phase 0 first rechecks the detailed plan's source baseline against the approved commit; a stale or incomplete caller/file map blocks delegation. Luna receives only one approved task slice, its exact file scope, and its required verification commands.