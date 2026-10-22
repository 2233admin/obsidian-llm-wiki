---
type: issue
entity: project/obsidian-llm-wiki/issue/plugin-main-ts-test-coverage
state: todo
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/plugin-main-ts-test-coverage
description: "Plugin 0.4.0: lifecycle and Promote coverage exists; close remaining migration persistence, activation registration, command eligibility, unload cleanup, and confirmation-boundary gaps"
status: active
priority: 2
blocked-by: []
last-verified: 2026-09-01
---

Plugin: rebaseline `main.ts` lifecycle and Promote coverage

## Context

The plugin now has real host-level coverage in:

- `tests/main-lifecycle.test.ts` for migration failure/retry, successful
  migration, rollback, wrapper rejection, and Recovery client wiring.
- `tests/promote-flow.test.ts` for dry-run outcomes, confirmation, apply
  invocation, executable arguments, and failure feedback.

The current slice closes these observable contracts:

- `applyPluginDataPlan()` preimage-write failure and no-assignment save branches,
- `onload()` view, command, ribbon, file-menu, and settings registration,
- command/file-menu eligibility for unsupported files and missing Project binding,
- `onunload()` view detachment and transport cleanup,
- Promote dry-run, confirmation, one-apply, and explicit failure feedback.

## Fix

Extend the existing bundled Node test harnesses without adding a production
registry or a second plugin runtime. Keep migration and Promote behavior in
`src/main.ts`; add only the missing assertions and failure fixtures in the
existing test files.

## Acceptance

- CI runs `main.ts` lifecycle and Promote tests through `npm test`.
- Migration tests prove failed migration preserves the legacy source, successful
  migration writes a matching device-local preimage before stripping it, and
  rollback fails closed when the preimage is unavailable.
- Registration tests prove the supported views, commands, ribbon, file-menu,
  settings tab, eligibility boundaries, and unload cleanup.
- Promote tests prove dry-run → confirmation → one apply and explicit failure
  feedback.
- Acceptance is based on observable behavior and regression coverage, not a
  blanket line-coverage percentage.

## Verification

- `cd obsidian-plugin && npm test` — 112 passed, 0 failed, 0 skipped.
- `npm run typecheck` — passed.
- `npm run build` — passed.
- `npm run verify:bundle-boundary` — passed.
