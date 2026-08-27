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
  - obsidian-llm-wiki/p0-s06b-obsidian-recovery-action
  - obsidian-llm-wiki/p0-s07-mcp-cli-parity
last-verified: 2026-08-27
---

# P0 S08: recovery-loop integration acceptance

Parent brief: [[llmwiki-project-driven-knowledge-workspace]]
OpenSpec: `openspec/changes/project-hub-recovery-loop/`
Implementation plan: `docs/superpowers/plans/2026-08-27-project-hub-recovery-loop.md` Tasks 14–15

## What to build

Create one sanitized end-to-end fixture and run the full recovery journey through accepted S06A/S06B Obsidian surfaces plus MCP and dedicated CLI parity. Cover normal recovery, interrupted work, S01/downstream-owner staleness, missing capability, expired Work Run, valid and quarantined output, apply and output-routing crash windows, replay, outcome-unknown reconciliation, and explicit remediation.

## Acceptance

- [ ] The fixture contains Project ID, Workspace Binding, Work-OS items, citations, reviewed memory, Session Record, Work Run, capability state, and expected recovery snapshot.
- [ ] A normal project opens with current state, evidence, resumable context, and a bounded next action.
- [ ] Stale evidence, missing capability, expired run, quarantined malformed result, and invalid action each produce visible diagnostics and a manual or governed next step without unsafe payload echo.
- [ ] Obsidian, MCP, and CLI produce equivalent snapshot fingerprints, apply states, and action receipts for the same fixture.
- [ ] Same-token replay, apply/output claim races, and every crash window preserve exactly one Work Run and at most one routed owner effect; unprovable outcomes block replay and require reconciliation.
- [ ] After one familiarization run, three measured runs start at Open Project Hub invocation and stop when a cited action's plan preview appears; all three are under 60 seconds and record raw timestamps.
- [ ] No fixture or serialized domain/Obsidian/MCP/CLI/claim/receipt/error output contains private vault material, canaries, tokens, cookies, transcript bodies, or absolute paths.
- [ ] Any failure blocks the foundation exit and creates a linked follow-up issue rather than being waived as pre-existing.

## Demo

Start with a deliberately interrupted sanitized project, recover it in Obsidian, verify one citation, resume or select the next action, then reproduce the same snapshot and receipt through MCP and CLI while exercising stale and blocked paths.

## Dependencies

Blocked by accepted S06B actual-Obsidian verification and S07 parity. This is the final cross-host foundation gate.
