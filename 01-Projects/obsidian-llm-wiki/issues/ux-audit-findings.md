---
type: issue
entity: project/obsidian-llm-wiki/issue/ux-audit-findings
state: todo
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/ux-audit-findings
description: "UX audit: MCP tool semantics, Obsidian plugin UX, and setup experience have 10 confirmed defects across three user personas"
status: active
priority: 2
blocked-by: []
last-verified: 2026-08-24
labels:
  - ready-for-agent
---

# UX Audit Findings — 2026-08-24

Three user personas confirmed with defects: **Agent** (MCP tools), **Human/Obsidian** (plugin UI), **Human/Terminal** (setup).

---

## Problem Statement

LLM Wiki serves three distinct user personas but has critical UX defects for each:

- **Agent users** receive silent failures from MCP tools that appear to mutate but actually do nothing (dryRun defaults), and encounter deprecated/ambiguous tools with no guidance.
- **Human/Obsidian users** face an undifferentiated settings page with no onboarding guidance, opaque scope semantics, and no feedback when actions succeed or fail.
- **Human/Terminal users** have no install verification step and encounter outdated documentation examples that make first-run impossible.

---

## User Stories

### Agent (MCP Tool Consumer)

1. As an agent, I want write tools to **actually write by default**, so that forgetting to pass `dryRun: false` does not result in silent no-ops that are indistinguishable from success.
2. As an agent, I want deprecated tools to be **clearly marked** in their description, so I do not waste cycles calling operations that no longer function.
3. As an agent, I want `vault.ingest` and `source.register` to have **clearly different contracts** documented, so I can choose the right tool without guessing.
4. As an agent, I want `vault.backlinks` and `vault.graph` to include **output schema examples** in their documentation, so I know how to consume the returned data.
5. As an agent, I want tool error codes to be **consistent and documented**, so I can handle failure paths systematically.
6. As an agent, I want `vault.project` to **guide me to `project.init`** when given an unknown name, with a clear error message that names the correct alternative.

### Human / Obsidian Plugin

7. As an Obsidian user, I want the Settings page to be **partitioned into logical groups** (essential vs advanced), so I am not overwhelmed by 200+ settings on first open.
8. As an Obsidian user, I want **scope labels** (user-device / vault / product) to have inline explanations, so I understand what I am choosing before I change a setting.
9. As an Obsidian user, I want Secret Reference inputs to **not fire duplicate mutations** on sequential change events, so editing a locator does not create two identical records.
10. As an Obsidian user, I want Ask Mate to show a **meaningful empty state** with guidance on what to do next when no context is available.
11. As an Obsidian user, I want the Promote flow to give **explicit feedback** at every step (what was detected, what will be written, what succeeded), so I am never uncertain whether promotion happened.

### Human / Terminal (Setup)

12. As a terminal user, I want `setup` to include a **verification step** that confirms MCP registration succeeded, so I know the installation is complete rather than guessing.
13. As a terminal user, I want `setup --list` to list all available host targets, so I do not need to guess the correct flag.
14. As a terminal user, I want documentation examples to reference **paths that actually exist**, so my first-run experience does not fail immediately.

---

## Solution

Fix all 14 user stories across three areas:

### Area A — MCP Tool Defaults and Documentation

- Change `dryRun` default from `true` to `false` on all write operations (`vault.create`, `vault.append`, `vault.modify`, `vault.decide`, `vault.meeting`, `vault.delete`, `vault.mkdir`, `vault.ingest`, `vault.person`, `vault.daily`). Add an explicit `--dry-run` or `dryRun: true` opt-in flag for simulation. Agent must request simulation explicitly.
- Mark `vault.lint` with `[DEPRECATED]` prefix in its operation description and make it return a clear `{ deprecated: true, useInstead: "problem.intake.scan" }` response.
- Add 1-line `description` field to every operation that is currently missing one or is a single ambiguous sentence.
- Add `returns` section to all operations that return non-trivial data (`vault.backlinks`, `vault.graph`, `vault.list`, `vault.getMetadata`).
- Align domain error helpers (`badRequest`, `notFound`, `conflict`, `unsupported`, `internal`) with actual MCP error format; add a test that enforces every `makeErr` path produces a `{ code: number, message: string }` shape.

### Area B — Obsidian Plugin UI

- Partition `LLMWikiSettingTab` into two sections: **Getting Started** (workspace binding, selected scope, health overview) and **All Settings** (collapsible, everything else). Default to collapsed on first visit; remember expanded state in plugin data.
- Add a `<kbd>?</kbd>` help button next to each scope selector that shows a popover explaining the three scopes in plain language.
- Add debounce (300ms) on Secret Reference text input change handler to prevent double-mutation on sequential keystrokes or double-enter.
- Add explicit empty state component in `AskMateView` with: current context description, suggested first action, and "Ask a question" CTA.
- Add Notice + inline status text on all Promote flow steps (detecting → planning → writing → done).

### Area C — Setup and Documentation

- Add `setup --doctor` / `setup.ps1 -Doctor` flag that runs the MCP server verification (existing `llmwiki_doctor.py`-style checks) and prints a clear PASS/FAIL summary. This is distinct from install — it runs anytime to diagnose a broken setup.
- Add `setup --list` / `setup.ps1 -List` that prints all available host targets.
- Audit GUIDE.md and remove or fix all paths that reference `examples/collab-vault/`. Replace with instructions that work on the actual bundled demo vault if one exists, or remove the section entirely.

---

## Implementation Decisions

### Area A — MCP Server

- All `dryRun` default flips must be made in `mcp-server/src/core/operations.ts` and reflected in the operation schema. A test should enumerate every mutating operation and assert `dryRun` defaults to `false` after the change.
- Deprecated `vault.lint` returns `{ deprecated: true, useInstead: "problem.intake.scan" }` with HTTP 410 semantics in the MCP response.
- Error shape consistency: introduce `OperationError` class in domain types and enforce it at the MCP adapter boundary. Every error response from the server must be `{ code: number, message: string }` — not raw thrown objects.

### Area B — Obsidian Plugin

- Settings page partitioning: add `settingsExpandedSections: string[]` to plugin data, default `["getting-started"]`. First visit auto-expands getting-started. Section collapse state persists across sessions.
- Scope help: add `addButton` with `?` icon next to scope dropdown; on click renders a small Modal with scope explanations.
- Secret Reference debounce: replace `inputEl.addEventListener("change", ...)` with a debounced handler using `setTimeout` / `clearTimeout` pattern, 300ms.
- Ask Mate empty state: add `renderEmptyState()` method that produces the same visual structure as loaded state but with placeholder content and a focused `<textarea>`.
- Promote feedback: use Obsidian `Notice` for transient feedback; update inline status element in real time.

### Area C — Setup

- `setup --doctor` runs `llmwiki_doctor.py` internally and parses its JSON output to produce a human-readable table.
- `setup --list` reads host targets from a shared manifest (`manifest.json` already has `versions.json`) rather than hardcoding in the script.

---

## Testing Decisions

### Area A — MCP Server

- **Good test**: Enumerate every operation tagged `mutating: true`; call it with no `dryRun` arg; verify a real write occurred on disk.
- **Good test**: Call `vault.lint`; assert response contains `deprecated: true` and `useInstead` field.
- **Good test**: Trigger each error helper; assert MCP response conforms to `{ code, message }`.
- Modules: `mcp-server/src/core/operations.ts`, `mcp-server/src/mcp-runtime/`, `mcp-server/src/index.ts`.

### Area B — Obsidian Plugin

- **Good test**: Render `LLMWikiSettingTab` with 200+ definitions; assert first render shows only getting-started section.
- **Good test**: Type in Secret Reference field twice within 200ms; assert exactly one mutation call.
- **Good test**: Open `AskMateView` with no context; assert `<textarea>` is rendered and focused.
- Modules: `obsidian-plugin/src/main.ts` (LLMWikiSettingTab, PromotePlanModal), `obsidian-plugin/src/ask-mate/view.ts`.
- Prior art: existing `ask-mate-*.test.ts` test suite for similar component behavior.

### Area C — Setup

- **Good test**: Run `setup --doctor` on an unconfigured machine; assert "FAIL" output for missing MCP registration.
- **Good test**: Run `setup --doctor` after valid MCP registration; assert "PASS" for all checks.
- Modules: `setup`, `setup.ps1`, `scripts/llmwiki_doctor.py`.

---

## Out of Scope

- Any changes to the underlying data model or vault structure.
- Any changes to the compiler or capture pipeline.
- Adding new MCP operations (only fixing existing operation UX).
- Changes to the fleet mode or multi-agent orchestration.
- Accessibility audit (separate workstream).

---

## Baseline

Audited 2026-08-24 against commit `f2227ca` on Windows 11. Findings verified by reading source: `mcp-server/src/core/operations.ts`, `mcp-server/src/index.ts`, `obsidian-plugin/src/main.ts`, `obsidian-plugin/src/ask-mate/view.ts`, `docs/GUIDE.md`, `docs/mcp-tools-reference.md`.
