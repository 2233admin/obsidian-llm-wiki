---
type: issue
entity: project/obsidian-llm-wiki/issue/plugin-promote-view-refresh
state: todo
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/plugin-promote-view-refresh
description: "Promote plugin: refresh derived views (kanban board.md / _work-os.canvas / _current-truth.md) after apply — they stay stale until the next compile leg"
status: active
priority: 2
blocked-by: []
last-verified: 2026-07-16
---

Promote plugin: recompile derived views after a successful apply

## Context

Promote changes work_state, but `board.md` (obsidian-kanban native format),
`_work-os.canvas` (JSONCanvas) and `_current-truth.md` are compile outputs.
The plugin never triggers recompilation, so inside Obsidian the kanban board
and canvas keep showing the pre-promote state until the next schtasks compile
leg fires. This is the core "doesn't drive other plugins" gap: the kanban
plugin would re-render for free the moment `board.md` changes.

## Fix

- After `--apply` succeeds, optionally run the targeted view regen
  (`kb_meta` compile / `work board` — reuse the existing CLI, no new
  mechanism) with a plugin setting to toggle ("Recompile views after
  promote", default on).
- Keep it synchronous-with-notice or fire-and-forget with completion Notice;
  no daemon, no watcher (§0 #8 carries over).

## Acceptance

- Promote inside Obsidian → kanban board reflects the new state without
  waiting for the scheduled compile leg.
- Toggle off → old behavior exactly.
- Compile failure surfaces as a Notice, never blocks the promote result
  (promote already succeeded; view refresh is best-effort).

## Baseline (2026-07-16)

Target = GitHub main `2233admin/obsidian-llm-wiki`, plugin 0.4.0-beta.1
(main.ts ~546 lines, Settings Platform split, PR #49/#50 merged). Finding
re-verified against that ref. 5090 local `D:\projects\vault-mind` is stale
(0.1.0) — pull/fetch main before fixing.
