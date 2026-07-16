---
type: issue
entity: project/obsidian-llm-wiki/issue/plugin-promote-obsidian-git-handoff
state: todo
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/plugin-promote-obsidian-git-handoff
description: "Promote plugin: detect obsidian-git and hand off to its stage/diff commands after apply (keep Notice fallback when absent)"
status: active
priority: 3
blocked-by: []
last-verified: 2026-07-16
---

Promote plugin: hand off to obsidian-git after apply

## Context

The promote contract ends with "Review & commit via git", but the plugin just
prints a Notice and leaves the user to switch tooling. If the community
obsidian-git plugin is installed (`app.plugins.plugins["obsidian-git"]`),
the gesture can close the loop in-app: open diff view / stage the written
snapshot via obsidian-git's registered commands.

This is deliberate reuse of an existing plugin, not a reimplementation —
never shell out to git ourselves from this plugin (the git review gate stays
human).

## Fix

- Feature-detect obsidian-git at promote time (not onload — it can be
  enabled later).
- After apply (and after the open-snapshot issue lands), invoke its
  diff/stage command for the written path; absent → today's Notice verbatim.
- Never auto-commit, never auto-push — detection only widens the UX, not the
  authority.

## Acceptance

- With obsidian-git enabled: promote → snapshot staged/diff shown in-app.
- Without it: behavior byte-identical to today.
- No direct `git` subprocess added to the plugin.

## Baseline (2026-07-16)

Target = GitHub main `2233admin/obsidian-llm-wiki`, plugin 0.4.0-beta.1
(main.ts ~546 lines, Settings Platform split, PR #49/#50 merged). Finding
re-verified against that ref. 5090 local `D:\projects\vault-mind` is stale
(0.1.0) — pull/fetch main before fixing.
