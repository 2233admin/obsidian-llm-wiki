---
type: issue
entity: project/obsidian-llm-wiki/issue/fix-work-os-nested-worktree-duplication
state: done
review: reviewed
kind: bug
id: obsidian-llm-wiki/fix-work-os-nested-worktree-duplication
description: Prevent Work-OS scans from treating nested machine-local worktrees as canonical project issues.
status: active
priority: 1
assignee: codex
last-verified: 2026-07-18
labels:
- ready-for-agent
- work-os
- project-management
- data-integrity
- scanner
---
# Fix Work-OS Nested Worktree Duplication

## Problem

`python compiler/kb_meta.py work board . --project obsidian-llm-wiki` renders many canonical tasks repeatedly because the Work-OS note walk descends into `.orca/worktrees/**` and treats copied issue files as additional authoritative records.

The same entity was observed once in the canonical `01-Projects/obsidian-llm-wiki/issues/` root and sixteen more times under machine-local `.orca/worktrees/` roots. This makes board counts, scheduling, triage, estimates, and project-management views unreliable.

## Required Fix

- Define and enforce the canonical Work-OS scan scope instead of accepting nested repository or machine-local copies.
- Exclude `.orca/**` and equivalent machine-local/runtime roots without hiding legitimate canonical `01-Projects/**` records.
- Deduplicate or fail visibly when more than one authoritative note claims the same Work-OS entity.
- Apply the same scope rules to board rendering, Work Driver selection, currency/estimate projections, and MCP project adapters.

## Acceptance

- A fixture containing canonical issues plus nested `.orca/worktrees/**` copies renders each canonical entity exactly once.
- Work Driver never leases a nested worktree copy.
- Duplicate authoritative entities outside excluded roots produce deterministic diagnostics rather than repeated cards.
- Python board and TypeScript project projections remain parity-tested.
- Existing Work-OS, project, currency, and Work Driver tests pass.

## Verification

- Python and TypeScript scanners exclude all machine-local dot directories, including `.orca/worktrees/**`.
- Ambiguous reviewed terminal heads return deterministic `current_truth_conflict` diagnostics and are excluded from current-head board and Work Driver inputs.
- `python -m pytest compiler/tests/test_work_os.py compiler/tests/test_work_driver.py -q`: 195 passed.
- MCP TypeScript build passed.
- `node --test dist/project/parity.test.js dist/project/project.test.js`: 22 passed.
