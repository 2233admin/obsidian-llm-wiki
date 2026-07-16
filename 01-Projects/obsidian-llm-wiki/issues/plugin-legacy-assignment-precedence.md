---
type: issue
entity: project/obsidian-llm-wiki/issue/plugin-legacy-assignment-precedence
state: todo
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/plugin-legacy-assignment-precedence
description: "Plugin 0.4.0: collectLegacyAssignments lets stale top-level pythonPath/kbMetaPath overwrite newer assignments-dict values during migration"
status: active
priority: 2
blocked-by: []
last-verified: 2026-07-16
---

Plugin migration: legacy field precedence inverted

## Context (verified against GitHub main, plugin 0.4.0-beta.1)

`settings.ts:172-195` `collectLegacyAssignments`: entries from
`raw.assignments[scope]` are collected first, then older top-level
`raw.pythonPath`/`raw.kbMetaPath` unconditionally `byIdentity.set(...)`
the same `user-device:runtime.python.path` / `runtime.kb_meta.path` keys.
A data.json carrying both formats (top-level fields never pruned by an old
version + newer assignments dict) migrates the STALE value.

## Fix

Process direct bindings first, then let `assignments` overwrite — newer
format wins. One-line ordering swap plus a test with both formats present.

## Acceptance

- data.json with conflicting top-level and assignments values → assignments
  value survives migration.
- Regression test red on old order.
