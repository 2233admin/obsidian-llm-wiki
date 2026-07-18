---
type: issue
entity: project/obsidian-llm-wiki/issue/add-ask-mate-visual-workspace
state: todo
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/add-ask-mate-visual-workspace
description: Build Ask Mate, interactive mind maps, governed problem intake, and user-approved Issue or PR contribution.
status: active
priority: 1
blocked-by:
- project/obsidian-llm-wiki/issue/fix-work-os-nested-worktree-duplication
assignee: codex
last-verified: 2026-07-19
labels:
- ready-for-agent
- ask-mate
- mind-map
- problem-intake
- obsidian-plugin
- project-management
---
# Add Ask Mate Visual Workspace

## Outcome

Deliver a GPL-3.0-only Obsidian experience that can read user-authored Markdown or supported core Canvas structures, clarify and generate mind maps interactively, turn reviewed OBC or approved plugin findings into canonical Work-OS tasks, and let users explicitly keep a product problem local, submit a redacted upstream Issue, or prepare a verified draft pull request.

## Architecture

- Visual Workspace owns Mind Map Documents, safe edit plans, and deterministic projections.
- Problem Intake owns diagnostic observations, deduplication, triage, and issue proposals.
- Ask Mate is the Obsidian interaction surface and owns no parallel domain state.
- Work-OS Markdown issues remain the only authoritative project work state.
- Host Capability adapters remain typed, allowlisted, permission-gated, and read-only for diagnostic discovery.
- Problem Intake owns contribution choice and immutable previews; governed tracker/forge adapters own confirmed remote side effects.
- Pull requests require isolated changes, regression evidence, exact diff review, and separate push/create confirmation; the flow never merges automatically.

## Implementation Contract

OpenSpec change: `openspec/changes/add-ask-mate-visual-workspace/`

Implementation follows that change's proposal, design, capability specs, and checkbox tasks. The first usable vertical slice is Markdown mind-map read, preview, and hash-locked apply; Ask Mate, Problem Intake/OBC, plugin diagnostics, and Project Hub traceability follow in that dependency order.

## Acceptance

- A user can create and revise a useful mind map directly in Obsidian without a paid mind-map plugin.
- User-authored notes or supported Canvas files are read without modification and ambiguous structure is confirmed before adoption.
- No generated map or issue mutation is applied before a visible preview and explicit confirmation.
- Repeated OBC or plugin findings deduplicate into provenance-bearing observations.
- Approved findings route through Project Operations to create or update Work-OS issues.
- A user can keep a finding local, submit an editable and secret-safe upstream Issue, or prepare a pull request only when a bounded isolated fix passes its declared regression tests.
- No remote Issue, branch push, pull request, ready-for-review transition, or merge occurs from diagnostic collection or model output alone.
- Remote create operations are replay-safe after a durable receipt, and outcome-unknown responses block blind retry.
- Project Hub can trace map nodes and observations through issue, Work Run, and verification state.
- Strict OpenSpec validation, domain tests, Obsidian integration tests, OBC tests, typecheck/build, and GPL dependency checks pass.
