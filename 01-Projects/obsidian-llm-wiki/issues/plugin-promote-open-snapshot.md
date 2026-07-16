---
type: issue
entity: project/obsidian-llm-wiki/issue/plugin-promote-open-snapshot
state: todo
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/plugin-promote-open-snapshot
description: "Promote plugin: open the written reviewed snapshot after apply instead of Notice-only"
status: active
priority: 3
blocked-by: []
last-verified: 2026-07-16
---

Promote plugin: open the written snapshot after apply

## Context

On success the plugin only shows a Notice with `snapshot_note_id`; the user
has to hunt the file down manually before they can review & commit. The
result JSON already carries the path (`written` / `snapshot_note_id`).

## Fix

Resolve via `vault.getAbstractFileByPath()` and open with
`workspace.getLeaf().openFile()` right after apply — the git-review gate then
starts with the artifact on screen.

## Acceptance

- Successful apply lands the user in the new reviewed snapshot.
- Path-miss (compile wrote elsewhere / race) degrades to today's Notice,
  never throws.

## Baseline (2026-07-16)

Target = GitHub main `2233admin/obsidian-llm-wiki`, plugin 0.4.0-beta.1
(main.ts ~546 lines, Settings Platform split, PR #49/#50 merged). Finding
re-verified against that ref. 5090 local `D:\projects\vault-mind` is stale
(0.1.0) — pull/fetch main before fixing.
