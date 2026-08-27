---
type: issue
entity: project/obsidian-llm-wiki/issue/p0-s08-recovery-loop-acceptance
state: backlog
review: draft
kind: knowledge-task
id: obsidian-llm-wiki/p0-s08-recovery-loop-acceptance
description: "P0 S08: verify the complete project recovery loop across failure states and hosts"
status: active
priority: 1
blocked-by:
  - obsidian-llm-wiki/p0-s06-obsidian-recovery-surface
  - obsidian-llm-wiki/p0-s07-mcp-cli-parity
last-verified: 2026-08-27
---

# P0 S08: recovery-loop integration acceptance

Parent brief: [[llmwiki-project-driven-knowledge-workspace]]

## What to build

Create a sanitized end-to-end acceptance fixture and run the full recovery journey through the primary Obsidian surface plus MCP and CLI parity paths. Cover normal recovery, interrupted work, stale evidence, missing capability, expired Work Run, governance routing, replay, and explicit failure remediation.

## Acceptance

- [ ] The fixture contains Project ID, Workspace Binding, Work-OS items, citations, reviewed memory, Session Record, Work Run, capability state, and expected recovery snapshot.
- [ ] A normal project opens with current state, evidence, resumable context, and a bounded next action.
- [ ] Stale evidence, missing capability, expired run, malformed result, and invalid action each produce visible diagnostics and a manual or governed next step.
- [ ] Obsidian, MCP, and CLI produce equivalent snapshot fingerprints and equivalent action receipts for the same fixture.
- [ ] Repeating a transition request is replay-safe and does not duplicate Work Runs or state changes.
- [ ] The user can complete the journey within the agreed initial target of 60 seconds on a previously active project, with the measurement command or manual procedure recorded.
- [ ] No test fixture or captured output contains private vault content, tokens, cookies, or machine-local absolute paths.
- [ ] Any failure blocks the foundation exit and creates a linked follow-up issue rather than being waived as pre-existing.

## Demo

Start with a deliberately interrupted sanitized project, recover it in Obsidian, verify one citation, resume or select the next action, then reproduce the same snapshot and receipt through MCP and CLI while exercising stale and blocked paths.

## Dependencies

Blocked by S06 and S07. This is the final cross-host acceptance gate for the P0 recovery journey.
