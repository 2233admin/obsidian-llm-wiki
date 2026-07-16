---
type: issue
entity: project/obsidian-llm-wiki/issue/plugin-promote-frontmatter-gate
state: todo
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/plugin-promote-frontmatter-gate
description: "Promote plugin: gate command/file-menu on metadataCache frontmatter (review: draft) instead of offering Promote on every md file"
status: active
priority: 2
blocked-by: []
last-verified: 2026-07-16
---

Promote plugin: gate the gesture on frontmatter, not on "is markdown"

## Context

The command palette `checkCallback` and the `file-menu` handler only check
`file.extension === "md"`, so "Promote candidate" shows on EVERY markdown
note — reviewed snapshots, knowledge notes, board views. Clicking shells out
to python just to learn `NOT_DRAFT`. Menu clutter + wasted subprocess, and
poor citizenship next to other plugins' file-menu items.

Obsidian core already has the answer in-process:
`app.metadataCache.getFileCache(file)?.frontmatter` — zero-cost read of
`review` / `status` / work-state fields.

## Fix

- Only show the menu item / enable the command when frontmatter says the note
  is a promotable draft candidate (`review: draft`, with the legacy
  `status: draft` fallback — same precedence as `work_protocol._status`).
- Keep the python-side `NOT_DRAFT` answer as the authoritative backstop (the
  frontmatter gate is UX, not the truth gate).

## Acceptance

- Non-draft notes: no menu item, command hidden in palette.
- Draft note: gesture appears; promote flow unchanged.
- Precedence matches compiler (`review` first, `status` fallback) — cite
  `work_protocol` in a comment so the two never drift silently.

## Baseline (2026-07-16)

Target = GitHub main `2233admin/obsidian-llm-wiki`, plugin 0.4.0-beta.1
(main.ts ~546 lines, Settings Platform split, PR #49/#50 merged). Finding
re-verified against that ref. 5090 local `D:\projects\vault-mind` is stale
(0.1.0) — pull/fetch main before fixing.
