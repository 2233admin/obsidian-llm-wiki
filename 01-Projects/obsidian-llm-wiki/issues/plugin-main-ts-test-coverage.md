---
type: issue
entity: project/obsidian-llm-wiki/issue/plugin-main-ts-test-coverage
state: todo
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/plugin-main-ts-test-coverage
description: "Plugin 0.4.0: zero test coverage on main.ts — onload ordering, applyPluginDataPlan save-timing, promote flow all untested (why the data-loss bug shipped)"
status: active
priority: 2
blocked-by: []
last-verified: 2026-07-16
---

Plugin: main.ts has zero test coverage

## Context (verified against GitHub main, plugin 0.4.0-beta.1)

`tests/settings.test.ts` (384 lines) exercises settings.ts /
settings-client.ts / settings-host.ts / executable-command.ts in isolation.
Nothing instantiates the plugin or covers:

- `onload()` ordering (stripped-data assignment vs migration acceptance —
  exactly where plugin-migration-data-loss shipped),
- `applyPluginDataPlan` save-timing branches,
- `runPromote`/`promote()` dry-run → confirm → apply flow and its execFile
  argument construction,
- command/file-menu registration.

## Fix

Fake `App`/`Plugin` harness (or extract sequencing into pure functions —
prefer the extraction, deep-module style) covering the four areas above.
Land alongside plugin-migration-data-loss so its regression test has a
home.

## Acceptance

- CI runs main.ts-level tests; the data-loss regression test lives here.
- Coverage on the migration sequencing path specifically, not just line %.
