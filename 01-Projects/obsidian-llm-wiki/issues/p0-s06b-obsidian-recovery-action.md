---
type: issue
entity: project/obsidian-llm-wiki/issue/p0-s06b-obsidian-recovery-action
state: backlog
review: draft
kind: knowledge-task
id: obsidian-llm-wiki/p0-s06b-obsidian-recovery-action
description: "P0 S06B: complete the Obsidian recovery action, receipt, and refresh journey"
status: active
priority: 1
blocked-by:
  - obsidian-llm-wiki/p0-s04b-workflow-recovery-apply
  - obsidian-llm-wiki/p0-s05-agent-output-governance
last-verified: 2026-08-27
---

# P0 S06B: Obsidian recovery action and receipt

Parent brief: [[llmwiki-project-driven-knowledge-workspace]]
OpenSpec: `openspec/changes/project-hub-recovery-loop/`
Implementation plan: `docs/superpowers/plans/2026-08-27-project-hub-recovery-loop.md` Task 12

## What to build

Extend the accepted S06A preview with explicit confirmation, Workflow-owned apply, transition-claim state, owner receipt, outcome-unknown remediation, output-governance result, and recomposed Project Hub refresh. The plugin remains a derived control surface.

## Acceptance

- [ ] The user confirms the exact immutable plan before `workflow.recovery.apply`; cancellation performs no write.
- [ ] Resume and create display claimed/applied states and the exact owner receipt without copying Workflow state into plugin storage.
- [ ] `outcome-unknown` blocks another mutation and links the user to doctor reconciliation.
- [ ] Accepted output refreshes through `project.hub.get`; draft/rejected output does not appear as current truth.
- [ ] Missing capability, stale plan, rebound token, expired lease, and adapter failure remain visible with remediation.
- [ ] Keyboard order and focus survive confirmation, error, receipt, and refresh states in actual Obsidian.
- [ ] The actual sanitized apply/receipt/refresh path passes before S07 MCP/CLI parity starts.

## Demo

In Obsidian, confirm one resume or create plan, observe its transition claim and single Work Run receipt, refresh the Hub from owner state, then exercise one outcome-unknown reconciliation path.

## Dependencies

Blocked by S04B and S05. S06A must already be accepted; S07 is blocked on this actual-surface proof.

## Non-goals

- Do not persist plugin-owned task, plan, claim, receipt, or run authority.
- Do not add MCP/CLI-specific semantics or bypass Workflow output governance.
